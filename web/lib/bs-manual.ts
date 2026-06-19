import { pool } from './db';

const TOL = 0.02;
const ACTOR = 'app_web';

export type BsLedgerPending = {
  id: number; date: string; direction: string; bs: number; usd: number;
  client: string; bank: string; row: number | null; kw2Id: string | null;
};
export type BsStatementPending = {
  id: number; date: string; direction: string; bs: number; bank: string; description: string;
};

export async function unmatchedBsLedger(): Promise<BsLedgerPending[]> {
  const result = await pool.query(
    `SELECT fm.id, fm.effective_at::date::text date, fm.direction,
            fm.native_amount::float8 bs, fm.usd_amount::float8 usd,
            c.name client, a.name bank, (fm.source_payload->>'row_number')::int row_number,
            fm.kw2_id
     FROM fund_movements fm
     JOIN accounts a ON a.id=fm.account_id
     JOIN clients c ON c.id=fm.client_id
     WHERE fm.source='google_sheet_movimientos' AND fm.status<>'voided'
       AND a.medium='bs' AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM reconciliations r
         WHERE r.fund_movement_id=fm.id AND r.status IN ('confirmed','suggested'))
     ORDER BY fm.effective_at, fm.native_amount DESC`,
  );
  return result.rows.map((row: any) => ({
    id: Number(row.id), date: row.date, direction: row.direction, bs: Number(row.bs), usd: Number(row.usd),
    client: row.client, bank: row.bank, row: row.row_number == null ? null : Number(row.row_number), kw2Id: row.kw2_id,
  }));
}

export async function unmatchedBsStatement(): Promise<BsStatementPending[]> {
  const result = await pool.query(
    `SELECT et.id, (et.effective_at AT TIME ZONE 'America/Caracas')::date::text date,
            et.direction, et.native_amount::float8 bs, et.raw_payload->>'banco' bank,
            COALESCE(et.raw_payload->>'descripcion','') description
     FROM external_transactions et
     WHERE et.source_type='bank_statement' AND et.source_account='EDO CTA BS'
       AND et.direction IS NOT NULL AND et.native_amount IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM reconciliations r
         WHERE r.external_transaction_id=et.id AND r.status IN ('confirmed','suggested'))
       AND EXISTS (
         SELECT 1 FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
         WHERE fm.source='google_sheet_movimientos' AND fm.status<>'voided'
           AND a.medium='bs' AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL
           AND a.name=et.raw_payload->>'banco'
           AND fm.effective_at::date=(et.effective_at AT TIME ZONE 'America/Caracas')::date
           AND fm.direction=et.direction
           AND NOT EXISTS (SELECT 1 FROM reconciliations r2
             WHERE r2.fund_movement_id=fm.id AND r2.status IN ('confirmed','suggested'))
       )
     ORDER BY et.effective_at, et.native_amount DESC`,
  );
  return result.rows.map((row: any) => ({
    id: Number(row.id), date: row.date, direction: row.direction, bs: Number(row.bs),
    bank: row.bank, description: row.description,
  }));
}

function accountFeeRate(bank: string) {
  if (bank === 'BDV VENISUM' || bank === 'BDV SOLUCIONES') return 0.0025;
  if (bank === 'NENEKA') return 0.003;
  return null;
}

export async function manualMatchBs(ledgerIds: number[], statementIds: number[], actor = ACTOR) {
  if (!ledgerIds.length || !statementIds.length) throw new Error('Selecciona movimientos en ambos lados.');
  if (ledgerIds.length > 1 && statementIds.length > 1) throw new Error('Un lado debe contener una sola fila.');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ledger = (await client.query(
      `SELECT fm.id, fm.native_amount::float8 bs, fm.usd_amount::float8 usd, fm.direction,
              fm.effective_at::date::text date, a.name bank, fm.source_payload,
              fm.kw2_id, c.name client
       FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id JOIN clients c ON c.id=fm.client_id
       WHERE fm.id=ANY($1) FOR UPDATE`, [ledgerIds],
    )).rows;
    const statement = (await client.query(
      `SELECT id, native_amount::float8 bs, direction,
              (effective_at AT TIME ZONE 'America/Caracas')::date::text date,
              raw_payload->>'banco' bank
       FROM external_transactions WHERE id=ANY($1) FOR UPDATE`, [statementIds],
    )).rows;
    if (ledger.length !== ledgerIds.length || statement.length !== statementIds.length) throw new Error('Alguna fila ya no existe.');
    const contexts = new Set([...ledger, ...statement].map((row) => `${row.bank}|${row.date}|${row.direction}`));
    if (contexts.size !== 1) throw new Error('Banco, fecha y dirección deben coincidir.');
    const sumLedger = ledger.reduce((sum, row) => sum + row.bs, 0);
    const sumStatement = statement.reduce((sum, row) => sum + row.bs, 0);
    const difference = sumStatement - sumLedger;
    const rate = accountFeeRate(ledger[0].bank);
    const isExact = Math.abs(difference) <= TOL;
    const isKnownFee = ledger.length === 1 && rate != null
      && difference > 0
      && Math.abs(difference - sumLedger * rate) <= Math.max(TOL, difference * 0.001);
    if (!isExact && !isKnownFee) {
      throw new Error(`Los montos no coinciden: MOVIMIENTOS ${sumLedger.toFixed(2)} Bs y estado ${sumStatement.toFixed(2)} Bs.`);
    }

    const pairs: [number, number, number][] = statement.length === 1
      ? ledger.map((row) => [row.id, statement[0].id, row.bs])
      : statement.map((row) => [ledger[0].id, row.id, row.bs]);
    for (const [fundMovementId, externalId, amount] of pairs) {
      await client.query(
        `INSERT INTO reconciliations
           (fund_movement_id, external_transaction_id, allocated_native_amount,
            status, confidence, reasons, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,'confirmed',1,$4,$5,now())
         ON CONFLICT (fund_movement_id, external_transaction_id) DO UPDATE SET
           status='confirmed', confidence=1, reasons=EXCLUDED.reasons,
           confirmed_by=EXCLUDED.confirmed_by, confirmed_at=now(), updated_at=now()`,
        [fundMovementId, externalId, amount, JSON.stringify(['conciliación manual Bs']), actor],
      );
    }
    await client.query(`UPDATE fund_movements SET status='reconciled', updated_at=now() WHERE id=ANY($1)`, [ledgerIds]);

    let corrections = 0;
    if (isKnownFee) {
      const row = ledger[0];
      const payload = row.source_payload ?? {};
      const proposedRate = sumStatement / row.usd;
      for (const correction of [
        { column: 'Monto Bs', current: row.bs, proposed: sumStatement },
        { column: 'Tasa', current: row.bs / row.usd, proposed: proposedRate },
      ]) {
        const result = await client.query(
          `INSERT INTO sheet_corrections
             (sheet, kind, source_row_number, fund_movement_id, column_name,
              current_value, proposed_value, locator, reason, created_by)
           VALUES ('MOVIMIENTOS','update',$1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (sheet, source_row_number, column_name, status) DO NOTHING`,
          [payload.row_number ?? null, row.id, correction.column, String(correction.current), String(correction.proposed),
           JSON.stringify({ kw2_id: row.kw2_id, row_number: payload.row_number, banco: row.bank, nombre: row.client }),
           `Conciliación manual Bs: incluir comisión bancaria de ${difference.toFixed(2)} Bs`, actor],
        );
        corrections += result.rowCount ?? 0;
      }
    }
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('user',$1,'manual_reconcile_bs','account','EDO CTA BS',$2)`,
      [actor, JSON.stringify({ ledgerIds, statementIds, sumLedger, sumStatement, corrections })],
    );
    await client.query('COMMIT');
    return { changed: pairs.length, corrections };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
