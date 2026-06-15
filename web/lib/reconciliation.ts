// Logica de conciliacion BINANCE CH compartida por las pantallas y la API.
// Equivalente a importer/src/confirm-binance.ts pero para la app web.
import { pool } from './db';
import { createCorrectionForRecon } from './corrections';

const ACTOR_DEFAULT = 'app_web';
const TOL = 0.02;

export type Suggestion = {
  id: number;
  confidence: number;
  reason: string;
  alloc: string;
  ledger: { date: string; direction: string; amount: string; nombre: string | null };
  statement: { date: string; operation: string; amount: string; remark: string | null };
};

export async function accountId(name = 'BINANCE CH'): Promise<number> {
  const r = await pool.query(`SELECT id FROM accounts WHERE name=$1`, [name]);
  return r.rows[0].id;
}

export async function summary() {
  const accId = await accountId();
  const status = await pool.query(
    `SELECT r.status, count(*)::int n FROM reconciliations r
     JOIN fund_movements fm ON fm.id=r.fund_movement_id
     WHERE fm.account_id=$1 GROUP BY r.status`,
    [accId],
  );
  const totals = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM fund_movements WHERE account_id=$1 AND status<>'voided') AS ledger_total,
       (SELECT count(DISTINCT fund_movement_id)::int FROM reconciliations r
        JOIN fund_movements fm ON fm.id=r.fund_movement_id
        WHERE fm.account_id=$1 AND r.status IN ('suggested','confirmed')) AS ledger_matched`,
    [accId],
  );
  const byStatus: Record<string, number> = {};
  for (const r of status.rows) byStatus[r.status] = r.n;
  return {
    confirmed: byStatus.confirmed ?? 0,
    suggested: byStatus.suggested ?? 0,
    rejected: byStatus.rejected ?? 0,
    ledgerTotal: totals.rows[0].ledger_total,
    ledgerMatched: totals.rows[0].ledger_matched,
  };
}

export async function listSuggestions(onlyDubious = false): Promise<Suggestion[]> {
  const accId = await accountId();
  const rows = await pool.query(
    `SELECT r.id, r.confidence::float8 confidence, r.reasons->>0 reason, r.allocated_native_amount::text alloc,
            fm.effective_at::date::text lf, fm.direction ld, fm.usd_amount::text lmonto, fm.source_payload->>'nombre' nombre,
            (et.effective_at AT TIME ZONE 'America/Caracas')::date::text ef, et.raw_payload->>'operation' eop,
            et.native_amount::text emonto, et.raw_payload->>'remark' remark
     FROM reconciliations r
     JOIN fund_movements fm ON fm.id=r.fund_movement_id
     JOIN external_transactions et ON et.id=r.external_transaction_id
     WHERE fm.account_id=$1 AND r.status='suggested' ${onlyDubious ? 'AND r.confidence < 0.99' : ''}
     ORDER BY r.confidence, fm.effective_at`,
    [accId],
  );
  return rows.rows.map((r: any) => ({
    id: r.id,
    confidence: r.confidence,
    reason: r.reason,
    alloc: r.alloc,
    ledger: { date: r.lf, direction: r.ld, amount: r.lmonto, nombre: r.nombre },
    statement: { date: r.ef, operation: r.eop, amount: r.emonto, remark: r.remark },
  }));
}

async function recomputeStatus(client: any, movementIds: number[]) {
  for (const id of movementIds) {
    await client.query(
      `UPDATE fund_movements fm SET status = CASE
         WHEN s.confirmed >= fm.usd_amount - $2 THEN 'reconciled'
         WHEN s.confirmed > 0 THEN 'partially_reconciled'
         ELSE 'posted' END, updated_at=now()
       FROM (SELECT COALESCE(SUM(allocated_native_amount),0) confirmed
             FROM reconciliations WHERE fund_movement_id=$1 AND status='confirmed') s
       WHERE fm.id=$1 AND fm.status<>'voided'`,
      [id, TOL],
    );
  }
}

export async function decide(
  ids: number[], status: 'confirmed' | 'rejected', actor = ACTOR_DEFAULT,
  adjust?: 'date' | 'amount' | null,
): Promise<number> {
  if (ids.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE reconciliations SET status=$2,
          confirmed_by = CASE WHEN $2='confirmed' THEN $3 ELSE confirmed_by END,
          confirmed_at = CASE WHEN $2='confirmed' THEN now() ELSE confirmed_at END,
          updated_at = now()
       WHERE id = ANY($1) AND status='suggested' RETURNING id, fund_movement_id`,
      [ids, status, actor],
    );
    const changed = upd.rows.map((r: any) => r.id);
    const movements = [...new Set(upd.rows.map((r: any) => r.fund_movement_id))] as number[];
    await recomputeStatus(client, movements);

    // Al confirmar una sola sugerencia se puede pedir un cambio en la hoja.
    if (adjust && status === 'confirmed' && changed.length === 1) {
      await createCorrectionForRecon(client, changed[0], adjust, actor);
    }
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('user', $1, $2, 'reconciliation', 'BINANCE CH', $3)`,
      [actor, status === 'confirmed' ? 'confirm_reconciliations' : 'reject_reconciliations', JSON.stringify({ ids: changed })],
    );
    await client.query('COMMIT');
    return changed.length;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function confirmHigh(actor = ACTOR_DEFAULT): Promise<number> {
  const accId = await accountId();
  const ids = (
    await pool.query(
      `SELECT r.id FROM reconciliations r JOIN fund_movements fm ON fm.id=r.fund_movement_id
       WHERE fm.account_id=$1 AND r.status='suggested' AND r.confidence >= 0.99`,
      [accId],
    )
  ).rows.map((r: any) => r.id);
  return decide(ids, 'confirmed', actor);
}
