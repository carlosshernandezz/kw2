import { pool } from './db';

const TAG = 'matcher Bs por identidad historica';
const ACTOR = 'app_web';

export type BsSuggestion = {
  movementId: number;
  reconciliationIds: number[];
  confidence: number;
  reasons: string[];
  ledger: { kw2Id: string | null; row: number | null; date: string; bank: string; client: string; amount: number; rate: number | null };
  statement: { id: number; amount: number; description: string }[];
  statementTotal: number;
  commission: number;
};

export type AmbiguousIdentity = {
  bank: string;
  type: string;
  identity: string;
  clients: { id: number; name: string; evidence: number }[];
};

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();
const NENEKA_CONTROL_DESCRIPTIONS = new Set(['COMISION', 'A', 'SI', 'AJUSTE BS', 'TS']);

function identity(bank: string, description: string): { type: string; value: string } | null {
  const text = normalize(description);
  if (!text) return null;
  if (bank === 'BDV VENISUM' || bank === 'BDV SOLUCIONES') {
    const match = text.match(/(?:^|\s)V\s*0*([0-9]{6,10})(?:\s|$)/);
    return match ? { type: 'cedula', value: match[1] } : null;
  }
  if (bank === 'NENEKA' && !NENEKA_CONTROL_DESCRIPTIONS.has(text)) {
    return { type: 'descripcion', value: text };
  }
  return null;
}

export async function bsSummary() {
  const row = (await pool.query(
    `SELECT
       count(*) FILTER (WHERE fm.status='reconciled')::int reconciled,
       count(*) FILTER (WHERE fm.status<>'reconciled' AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL)::int pending,
       count(*) FILTER (WHERE NULLIF(fm.source_payload->>'operacion','') IS NULL)::int not_applicable,
       count(DISTINCT fm.id) FILTER (WHERE EXISTS (
         SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status='suggested' AND r.reasons @> $1::jsonb
       ))::int suggested
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
     WHERE fm.source='google_sheet_movimientos' AND a.medium='bs' AND fm.status<>'voided'`,
    [JSON.stringify([TAG])],
  )).rows[0];
  return row;
}

export async function bsSuggestions(): Promise<BsSuggestion[]> {
  const rows = await pool.query(
    `SELECT fm.id movement_id, fm.kw2_id, (fm.source_payload->>'row_number')::int row_number,
            fm.effective_at::date::text date, a.name bank, c.name client,
            fm.native_amount::float8 ledger_amount, fm.exchange_rate::float8 rate,
            min(r.confidence)::float8 confidence,
            array_agg(r.id ORDER BY r.id) reconciliation_ids,
            (array_agg(r.reasons ORDER BY r.id))[1] reasons,
            json_agg(json_build_object('id',et.id,'amount',et.native_amount::float8,
              'description',COALESCE(et.raw_payload->>'descripcion','')) ORDER BY et.id) statement,
            sum(et.native_amount)::float8 statement_total
     FROM reconciliations r
     JOIN fund_movements fm ON fm.id=r.fund_movement_id
     JOIN accounts a ON a.id=fm.account_id
     JOIN clients c ON c.id=fm.client_id
     JOIN external_transactions et ON et.id=r.external_transaction_id
     WHERE r.status='suggested' AND r.reasons @> $1::jsonb
     GROUP BY fm.id, fm.kw2_id, fm.source_payload->>'row_number', fm.effective_at,
              a.name, c.name, fm.native_amount, fm.exchange_rate
     ORDER BY fm.effective_at, c.name`,
    [JSON.stringify([TAG])],
  );
  return rows.rows.map((r: any) => ({
    movementId: r.movement_id,
    reconciliationIds: r.reconciliation_ids,
    confidence: r.confidence,
    reasons: r.reasons,
    ledger: { kw2Id: r.kw2_id, row: r.row_number, date: r.date, bank: r.bank, client: r.client, amount: r.ledger_amount, rate: r.rate },
    statement: r.statement,
    statementTotal: r.statement_total,
    commission: Math.max(0, Math.round((r.statement_total - r.ledger_amount) * 100) / 100),
  }));
}

export async function ambiguousIdentities(): Promise<AmbiguousIdentity[]> {
  const rows = await pool.query(
    `SELECT et.raw_payload->>'banco' bank, COALESCE(et.raw_payload->>'descripcion','') description,
            fm.client_id, c.name client
     FROM reconciliations r
     JOIN external_transactions et ON et.id=r.external_transaction_id
     JOIN fund_movements fm ON fm.id=r.fund_movement_id
     JOIN clients c ON c.id=fm.client_id
     WHERE r.status='confirmed' AND et.source_type='bank_statement'
       AND et.source_account='EDO CTA BS'
       AND et.raw_payload->>'banco' IN ('BDV VENISUM','BDV SOLUCIONES','NENEKA')`,
  );
  const grouped = new Map<string, { bank: string; type: string; identity: string; clients: Map<number, { id: number; name: string; evidence: number }> }>();
  for (const row of rows.rows) {
    const parsed = identity(row.bank, row.description);
    if (!parsed) continue;
    const key = `${row.bank}|${parsed.type}|${parsed.value}`;
    const item = grouped.get(key) ?? { bank: row.bank, type: parsed.type, identity: parsed.value, clients: new Map() };
    const id = Number(row.client_id);
    const current = item.clients.get(id);
    item.clients.set(id, { id, name: row.client, evidence: (current?.evidence ?? 0) + 1 });
    grouped.set(key, item);
  }
  return [...grouped.values()]
    .filter((item) => item.clients.size > 1)
    .map((item) => ({ bank: item.bank, type: item.type, identity: item.identity, clients: [...item.clients.values()].sort((a, b) => b.evidence - a.evidence) }))
    .sort((a, b) => a.bank.localeCompare(b.bank) || a.identity.localeCompare(b.identity));
}

async function createCommissionCorrections(client: any, movementId: number, actor: string) {
  const row = (await client.query(
    `SELECT fm.id, fm.kw2_id, (fm.source_payload->>'row_number')::int rn,
            fm.native_amount::float8 current_bs, fm.usd_amount::float8 usd,
            fm.exchange_rate::float8 current_rate, a.name bank, c.name client,
            COALESCE(sum(et.native_amount) FILTER (WHERE r.status='confirmed'),0)::float8 total_bs
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id JOIN clients c ON c.id=fm.client_id
     LEFT JOIN reconciliations r ON r.fund_movement_id=fm.id
     LEFT JOIN external_transactions et ON et.id=r.external_transaction_id
     WHERE fm.id=$1 GROUP BY fm.id, a.name, c.name`, [movementId],
  )).rows[0];
  if (!row || row.total_bs <= row.current_bs + 0.01 || row.usd <= 0) return 0;

  const expectedRate = row.bank === 'NENEKA' ? 0.003 : (row.bank === 'BDV VENISUM' || row.bank === 'BDV SOLUCIONES') ? 0.0025 : null;
  if (!expectedRate) return 0;
  const commission = row.total_bs - row.current_bs;
  if (Math.abs(commission - row.current_bs * expectedRate) > Math.max(0.02, commission * 0.001)) return 0;

  const locator = { kw2_id: row.kw2_id, row_number: row.rn, banco: row.bank, nombre: row.client };
  const proposedRate = row.total_bs / row.usd;
  let created = 0;
  for (const correction of [
    { column: 'Monto Bs', current: row.current_bs, proposed: row.total_bs },
    { column: 'Tasa', current: row.current_rate, proposed: proposedRate },
  ]) {
    const result = await client.query(
      `INSERT INTO sheet_corrections
         (sheet, kind, source_row_number, fund_movement_id, column_name, current_value,
          proposed_value, locator, reason, created_by)
       VALUES ('MOVIMIENTOS','update',$1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (sheet, source_row_number, column_name, status) DO NOTHING`,
      [row.rn, movementId, correction.column, String(correction.current ?? ''), String(correction.proposed),
       JSON.stringify(locator), `Comisión bancaria ${row.bank}: ${commission.toFixed(2)} Bs (${(expectedRate * 100).toFixed(2)}%)`, actor],
    );
    created += result.rowCount ?? 0;
  }
  return created;
}

export async function decideBs(reconciliationIds: number[], status: 'confirmed' | 'rejected', actor = ACTOR) {
  if (!reconciliationIds.length) return { changed: 0, corrections: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const updated = await client.query(
      `UPDATE reconciliations SET status=$2, confirmed_by=CASE WHEN $2='confirmed' THEN $3 ELSE confirmed_by END,
          confirmed_at=CASE WHEN $2='confirmed' THEN now() ELSE confirmed_at END, updated_at=now()
       WHERE id=ANY($1) AND status='suggested' AND reasons @> $4::jsonb
       RETURNING id, fund_movement_id`,
      [reconciliationIds, status, actor, JSON.stringify([TAG])],
    );
    const movementIds = [...new Set(updated.rows.map((r: any) => Number(r.fund_movement_id)))] as number[];
    let corrections = 0;
    for (const movementId of movementIds) {
      if (status === 'confirmed') {
        await client.query(`UPDATE fund_movements SET status='reconciled', updated_at=now() WHERE id=$1 AND status<>'voided'`, [movementId]);
        corrections += await createCommissionCorrections(client, movementId, actor);
      }
    }
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('user',$1,$2,'reconciliation','EDO CTA BS',$3)`,
      [actor, status === 'confirmed' ? 'confirm_bs_suggestions' : 'reject_bs_suggestions', JSON.stringify({ reconciliationIds, movementIds, corrections })],
    );
    await client.query('COMMIT');
    return { changed: updated.rowCount ?? 0, corrections };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
