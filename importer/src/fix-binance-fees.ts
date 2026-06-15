// Arregla los fees de Binance Pay: un envio del libro (ej. 165,00) aparece en el
// estado de cuenta como dos filas con la MISMA referencia: principal (164,99) +
// fee (0,01). El matcher solo concilio la principal. Aqui ligamos cada fee de
// 0,01 sin conciliar al mismo movimiento del libro que su principal (por remark
// identico), dejando el libro intacto, y descartamos las correcciones de
// "bajar 0,01" que ya no aplican.
import { dbClient } from './db.js';

async function main() {
  const db = dbClient();
  await db.connect();
  const accId = (await db.query(`SELECT id FROM accounts WHERE name='BINANCE CH'`)).rows[0].id;

  // Fees 0,01 sin conciliar cuyo principal (misma referencia) SI esta conciliado.
  const pairs = await db.query(
    `SELECT fee.id fee_id, fee.native_amount fee_amt, r.fund_movement_id fm
     FROM external_transactions fee
     JOIN external_transactions main
       ON main.source_account='BINANCE CH' AND main.source_type='binance_statement'
      AND main.direction=fee.direction
      AND main.raw_payload->>'remark' = fee.raw_payload->>'remark'
      AND main.native_amount > 0.01
     JOIN reconciliations r ON r.external_transaction_id=main.id AND r.status='confirmed'
     WHERE fee.source_account='BINANCE CH' AND fee.source_type='binance_statement'
       AND (fee.raw_payload->>'relevant')::boolean AND fee.native_amount=0.01
       AND fee.raw_payload->>'remark' IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM reconciliations r2 WHERE r2.external_transaction_id=fee.id AND r2.status<>'rejected')`,
  );

  try {
    await db.query('BEGIN');
    let linked = 0;
    const fms = new Set<number>();
    for (const p of pairs.rows) {
      const r = await db.query(
        `INSERT INTO reconciliations (fund_movement_id, external_transaction_id, allocated_native_amount, status, confidence, reasons, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,'confirmed',1.0,$4,'system',now())
         ON CONFLICT (fund_movement_id, external_transaction_id) DO NOTHING`,
        [p.fm, p.fee_id, p.fee_amt, JSON.stringify(['fee de Binance Pay (misma referencia que el envio principal)'])],
      );
      if (r.rowCount) { linked++; fms.add(p.fm); }
    }

    // Recalcular estado de los movimientos afectados.
    for (const fm of fms) {
      await db.query(
        `UPDATE fund_movements f SET status = CASE
           WHEN s.c >= f.usd_amount - 0.001 THEN 'reconciled' WHEN s.c > 0 THEN 'partially_reconciled' ELSE 'posted' END, updated_at=now()
         FROM (SELECT COALESCE(SUM(allocated_native_amount),0) c FROM reconciliations WHERE fund_movement_id=$1 AND status='confirmed') s
         WHERE f.id=$1 AND f.status<>'voided'`,
        [fm],
      );
    }

    // Descartar las correcciones de "bajar 0,01" de esos movimientos.
    const dis = await db.query(
      `UPDATE sheet_corrections SET status='dismissed', updated_at=now()
       WHERE status='pending' AND kind='update' AND column_name LIKE 'Monto%'
         AND fund_movement_id = ANY($1::bigint[])
         AND abs(abs(NULLIF(current_value,'')::numeric) - abs(NULLIF(proposed_value,'')::numeric)) <= 0.015
       RETURNING id`,
      [[...fms]],
    );

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('system','fix-binance-fees','link_binance_pay_fees','account','BINANCE CH',$1)`,
      [JSON.stringify({ fees_linked: linked, movements: [...fms].length, corrections_dismissed: dis.rowCount })],
    );
    await db.query('COMMIT');

    console.log(`Fees de 0,01 ligados a su envio: ${linked}`);
    console.log(`Movimientos del libro afectados: ${fms.size}`);
    console.log(`Correcciones de "bajar 0,01" descartadas: ${dis.rowCount}`);
  } catch (e: any) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('Error:', err.message ?? err); process.exit(1); });
