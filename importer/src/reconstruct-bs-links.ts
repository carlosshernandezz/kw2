// Reconstruye las conciliaciones Bs desde la columna D de EDO CTA BS (el enlace
// =MOVIMIENTOS!Oxxx que Carlos pone a mano). Espeja la conciliación que ya se
// hace en el Sheet: cada fila del estado de cuenta enlazada a un número de
// operación se concilia contra el movimiento Bs de MOVIMIENTOS con esa operación.
// Re-ejecutable: borra los enlaces reconstruidos y los vuelve a crear.
// Soporta 1:N (varias filas del banco a un movimiento, típico en Binance P2P).
import { dbClient } from './db.js';

const REASON = 'enlace EDO CTA BS columna D';

async function main() {
  const db = dbClient();
  await db.connect();
  try {
    // operacion -> fund_movement Bs (solo las no ambiguas)
    const fm = await db.query(
      `SELECT (fm.source_payload->>'operacion')::numeric op, fm.id
       FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
       WHERE fm.source='google_sheet_movimientos' AND a.medium='bs'
         AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL`,
    );
    const byOp = new Map<number, number[]>();
    for (const r of fm.rows) {
      const op = Number(r.op);
      (byOp.get(op) ?? byOp.set(op, []).get(op)!).push(r.id);
    }

    // filas del banco con enlace numérico
    const bank = await db.query(
      `SELECT id, native_amount::float8 amt, (raw_payload->>'enlace_movimientos')::numeric op
       FROM external_transactions
       WHERE source_type='bank_statement' AND source_account='EDO CTA BS'
         AND (raw_payload->>'enlace_movimientos') ~ '^[0-9]+(\\.[0-9]+)?$'`,
    );

    await db.query('BEGIN');
    // Limpiar reconstrucción previa (y dejar esos movimientos en 'posted' antes de re-marcar).
    await db.query(`DELETE FROM reconciliations WHERE reasons @> $1::jsonb`, [JSON.stringify([REASON])]);

    let linked = 0;
    const skipped = { sin_match: 0, ambiguo: 0 };
    const fmReconciled = new Set<number>();
    for (const b of bank.rows) {
      const ids = byOp.get(Number(b.op));
      if (!ids) { skipped.sin_match++; continue; }
      if (ids.length > 1) { skipped.ambiguo++; continue; }
      const fmId = ids[0];
      const r = await db.query(
        `INSERT INTO reconciliations (fund_movement_id, external_transaction_id, allocated_native_amount, status, confidence, reasons, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,'confirmed',1.0,$4,'sheet',now())
         ON CONFLICT (fund_movement_id, external_transaction_id) DO NOTHING`,
        [fmId, b.id, Math.abs(b.amt) || 0.01, JSON.stringify([REASON])],
      );
      if (r.rowCount) { linked++; fmReconciled.add(fmId); }
    }

    // Estado de los movimientos Bs: reconciled si tiene enlace, posted si no.
    await db.query(
      `UPDATE fund_movements fm SET status='reconciled', updated_at=now()
       FROM accounts a WHERE a.id=fm.account_id AND a.medium='bs' AND fm.source='google_sheet_movimientos'
         AND fm.status<>'voided'
         AND EXISTS (SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status='confirmed')`,
    );
    await db.query(
      `UPDATE fund_movements fm SET status='posted', updated_at=now()
       FROM accounts a WHERE a.id=fm.account_id AND a.medium='bs' AND fm.source='google_sheet_movimientos'
         AND fm.status NOT IN ('voided')
         AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status='confirmed')`,
    );

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('importer','reconstruct-bs-links','reconstruct_bs_reconciliations','account','EDO CTA BS',$1)`,
      [JSON.stringify({ linked, movimientos_conciliados: fmReconciled.size, skipped })],
    );
    await db.query('COMMIT');

    // Desglose honesto del estado Bs.
    const resumen = (await db.query(
      `SELECT
         count(*) FILTER (WHERE fm.status='reconciled') conciliados,
         count(*) FILTER (WHERE fm.status<>'reconciled' AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL) pendientes_con_op,
         count(*) FILTER (WHERE fm.status<>'reconciled' AND NULLIF(fm.source_payload->>'operacion','') IS NULL) sin_operacion_no_aplica
       FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
       WHERE fm.source='google_sheet_movimientos' AND a.medium='bs' AND fm.status<>'voided'`,
    )).rows[0];

    console.log(`Enlaces Bs reconstruidos: ${linked} (filas del banco)`);
    console.log(`Movimientos Bs conciliados: ${fmReconciled.size}`);
    console.log(`Omitidos al enlazar: sin match ${skipped.sin_match}, ambiguos ${skipped.ambiguo}`);
    console.log(`Estado Bs -> conciliados: ${resumen.conciliados} | pendientes (con operación, sin enlazar): ${resumen.pendientes_con_op} | sin operación (no aplica columna D): ${resumen.sin_operacion_no_aplica}`);
  } catch (e: any) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('Error:', err.message ?? err); process.exit(1); });
