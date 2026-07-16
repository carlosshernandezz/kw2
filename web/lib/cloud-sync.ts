import { google } from 'googleapis';
import { randomUUID } from 'node:crypto';
import { pool } from './db';

const SHEET_ID = process.env.KW2_SHEET_ID ?? '1bVhtBhS_cEDAnET8q5t4d4tT3pDE_bvEFD0oYjWaNWo';
const SOURCE = 'google_sheet_movimientos';
const TOL = 0.02;
const BS_LINK_REASON = 'enlace EDO CTA BS columna D';
const BS_MATCH_REASON = 'matcher Bs por identidad historica';
const BS_EPS = 0.01;

const SKIPPED_ACCOUNTS = new Set(['EEE', 'TTT', 'XXX']);
const SKIPPED_CLIENT_IDS = new Set([334, 145]);
const MERGED_LEGACY_IDS: Record<number, number> = { 334: 75, 145: 346 };
const SYSTEM_CLIENT_NAMES = new Set(['ajuste bs', 'binance p2p', 'ts']);

type AccountSpec = { medium: string; currency: string; feeRate?: number };
const ACCOUNT_SPECS: Record<string, AccountSpec> = {
  AAA: { medium: 'cash', currency: 'USD' },
  BBB: { medium: 'usdt', currency: 'USDT' },
  GGG: { medium: 'bs', currency: 'VES', feeRate: 0.003 },
  KKK: { medium: 'transitory', currency: 'USD' },
  LLL: { medium: 'bs', currency: 'VES' },
  MMM: { medium: 'bs', currency: 'VES' },
  OOO: { medium: 'zelle', currency: 'USD' },
  PPP: { medium: 'bs', currency: 'VES' },
  QQQ: { medium: 'bs', currency: 'VES', feeRate: 0.0025 },
  RRR: { medium: 'bs', currency: 'VES' },
  SSS: { medium: 'bs', currency: 'VES', feeRate: 0.0025 },
  UUU: { medium: 'zelle', currency: 'USD' },
  YYY: { medium: 'commission', currency: 'USD' },
  ZZZ: { medium: 'expense', currency: 'USD' },
};

const COLUMNS = [
  'fecha',
  'semana',
  'type',
  'id_banco',
  'banco',
  'id_cliente',
  'nombre',
  'tipo',
  'monto_credito',
  'monto_debito',
  'porcentaje',
  'emisor_beneficiario',
  'tasa',
  'monto_bs',
  'operacion',
  'x',
  'conciliacion',
  'alerta_banco',
  'kw2_id',
] as const;

type ExternalRecord = {
  externalId: string;
  effectiveAt: string;
  direction: 'inflow' | 'outflow' | null;
  currency: string | null;
  amount: number | null;
  description: string | null;
  payload: Record<string, unknown>;
};
type Identity = { key: string; kind: 'cedula' | 'descripcion' };
type Ledger = {
  id: number;
  clientId: number;
  client: string;
  account: string;
  date: string;
  direction: 'inflow' | 'outflow';
  amount: number;
  kw2Id: string;
};
type Statement = {
  id: number;
  bank: string;
  date: string;
  direction: 'inflow' | 'outflow';
  amount: number;
  description: string;
  identity: Identity | null;
};
type IdentityOwner = {
  clientId: number;
  client: string;
  evidence: number;
  ruleStrategy?: 'preferred_client' | 'bridge_account';
  ruleInstruction?: string;
};
type Suggestion = { ledger: Ledger; rows: Statement[]; confidence: number; identity: Identity; owner: IdentityOwner; evidence: number };
type SyncAccount = { id: number; name: string; medium: string };

function movimientosSnapshotAccount(batchId: string): string {
  return `MOVIMIENTOS:${batchId}`;
}

function requireBatchId(batchId: string | undefined): string {
  if (!batchId || !/^[0-9a-f-]{36}$/i.test(batchId)) {
    throw new Error('La sincronizacion no tiene un batchId valido. Inicia de nuevo desde el boton.');
  }
  return batchId;
}

function serviceAccountCredentials() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw new Error('Falta GOOGLE_SERVICE_ACCOUNT_JSON en variables de entorno.');
  }

  const json = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const parsed = JSON.parse(json);
  if (typeof parsed.private_key === 'string') {
    parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
  }
  return parsed;
}

function sheetsClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountCredentials(),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  return google.sheets({ version: 'v4', auth });
}

async function readRange(range: string, valueRenderOption: 'UNFORMATTED_VALUE' | 'FORMULA' = 'UNFORMATTED_VALUE') {
  const sheets = sheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range,
    valueRenderOption,
    dateTimeRenderOption: valueRenderOption === 'UNFORMATTED_VALUE' ? 'SERIAL_NUMBER' : undefined,
  });
  return (res.data.values ?? []) as unknown[][];
}

function serialToDate(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const NENEKA_CONTROL_DESCRIPTIONS = new Set(['COMISION', 'A', 'SI', 'AJUSTE BS', 'TS']);

function identityFor(bank: string, description: string): Identity | null {
  const normalizedBank = normalizeText(bank);
  const normalizedDescription = normalizeText(description);
  if (!normalizedDescription) return null;

  if (normalizedBank === 'BDV VENISUM' || normalizedBank === 'BDV SOLUCIONES') {
    const match = normalizedDescription.match(/(?:^|\s)V\s*0*([0-9]{6,10})(?:\s|$)/);
    return match ? { kind: 'cedula', key: match[1] } : null;
  }

  if (normalizedBank === 'NENEKA') {
    if (NENEKA_CONTROL_DESCRIPTIONS.has(normalizedDescription)) return null;
    return { kind: 'descripcion', key: normalizedDescription };
  }

  return null;
}

function mapKey(bank: string, identity: Identity): string {
  return `${normalizeText(bank)}|${identity.kind}|${identity.key}`;
}

function isCommissionRow(row: Statement): boolean {
  return normalizeText(row.description).startsWith('COMISION PAGO A PROVEEDORES');
}

function feeRate(account: string): number | null {
  if (account === 'BDV VENISUM' || account === 'BDV SOLUCIONES') return 0.0025;
  if (account === 'NENEKA') return 0.003;
  return null;
}

function uniqueSubset(target: number, rows: Statement[], owner: IdentityOwner, identityMap: Map<string, IdentityOwner>): Statement[] | null {
  const pool = rows.slice(0, 14);
  const solutions = new Map<string, Statement[]>();
  const chosen: Statement[] = [];

  const validIdentity = (row: Statement) => {
    if (!row.identity) return false;
    return identityMap.get(mapKey(row.bank, row.identity))?.clientId === owner.clientId;
  };

  const walk = (start: number, sum: number) => {
    if (solutions.size > 1) return;
    if (Math.abs(sum - target) <= BS_EPS) {
      if (chosen.some(validIdentity)) {
        const signature = chosen.map((r) => r.id).sort((a, b) => a - b).join(',');
        solutions.set(signature, [...chosen]);
      }
      return;
    }
    if (sum > target + BS_EPS || chosen.length >= 6) return;
    for (let i = start; i < pool.length; i++) {
      const row = pool[i];
      if (!validIdentity(row) && !isCommissionRow(row)) continue;
      chosen.push(row);
      walk(i + 1, sum + row.amount);
      chosen.pop();
    }
  };

  walk(0, 0);
  return solutions.size === 1 ? [...solutions.values()][0] : null;
}

async function loadEdoCtaBs(): Promise<ExternalRecord[]> {
  const rows = await readRange("'EDO CTA BS'!A2:G100000");
  const formulas = await readRange("'EDO CTA BS'!D2:D100000", 'FORMULA');
  const enlaceRowOf = (i: number): number | null => {
    const f = String(formulas[i]?.[0] ?? '');
    const m = f.match(/MOVIMIENTOS!\s*O\s*(\d+)/i);
    return m ? Number(m[1]) : null;
  };

  return rows
    .map((r, i) => ({ r, rowNumber: i + 2, enlaceRow: enlaceRowOf(i) }))
    .filter(({ r }) => typeof r[1] === 'number' && String(r[0] ?? '').trim() !== '')
    .map(({ r, rowNumber, enlaceRow }) => {
      const credito = num(r[4]);
      const debito = num(r[5]);
      return {
        externalId: String(rowNumber),
        effectiveAt: serialToDate(r[1] as number),
        direction: credito != null ? 'inflow' as const : debito != null ? 'outflow' as const : null,
        currency: 'VES',
        amount: credito ?? (debito != null ? Math.abs(debito) : null),
        description: String(r[2] ?? '').trim() || null,
        payload: {
          row_number: rowNumber,
          banco: String(r[0]).trim(),
          fecha: r[1],
          descripcion: r[2] ?? null,
          enlace_movimientos: r[3] ?? null,
          enlace_row: enlaceRow,
          credito,
          debito,
          saldo: r[6] ?? null,
        },
      };
    });
}

async function loadEdoCtaCash(): Promise<ExternalRecord[]> {
  const rows = await readRange("'EDO CTA CASH'!A2:F100000");
  return rows
    .map((r, i) => ({ r, rowNumber: i + 2 }))
    .filter(({ r }) => typeof r[0] === 'number')
    .map(({ r, rowNumber }) => {
      const abono = num(r[2]);
      const cargo = num(r[3]);
      return {
        externalId: String(rowNumber),
        effectiveAt: serialToDate(r[0] as number),
        direction: abono != null ? 'inflow' as const : cargo != null ? 'outflow' as const : null,
        currency: 'USD',
        amount: abono ?? (cargo != null ? Math.abs(cargo) : null),
        description: String(r[4] ?? '').trim() || null,
        payload: {
          row_number: rowNumber,
          fecha: r[0],
          operacion: r[1] ?? null,
          abono,
          cargo,
          descripcion: r[4] ?? null,
          ultimo_saldo: r[5] ?? null,
        },
      };
    });
}

function parseBinanceTime(v: unknown): string | null {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString();
  const m = String(v ?? '').match(/^(\d{2})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}T${m[4]}-04:00`;
}

async function loadBinance(): Promise<ExternalRecord[]> {
  const rows = await readRange("'Edo cuenta binance'!A1:N100000");
  const out: ExternalRecord[] = [];
  for (const [i, r] of rows.entries()) {
    const time = parseBinanceTime(r[3]);
    const change = num(r[9]);
    if (!time || change == null) continue;
    out.push({
      externalId: String(i + 1),
      effectiveAt: time,
      direction: change >= 0 ? 'inflow' : 'outflow',
      currency: String(r[8] ?? '').trim() || null,
      amount: Math.abs(change),
      description: String(r[6] ?? '').trim() || null,
      payload: {
        row_number: i + 1,
        user_id: r[2] ?? null,
        time: r[3],
        account: r[5] ?? null,
        operation: r[6] ?? null,
        coin: r[8] ?? null,
        change,
        remark: r[10] ?? null,
      },
    });
  }
  return out;
}

function isSystemClient(name: string) {
  return SYSTEM_CLIENT_NAMES.has(name.toLowerCase());
}

async function importExternalSources(db: any, output: string[]) {
  const sources: { sourceType: string; sourceAccount: string; records: ExternalRecord[] }[] = [
    { sourceType: 'bank_statement', sourceAccount: 'EDO CTA BS', records: await loadEdoCtaBs() },
    { sourceType: 'cash_count', sourceAccount: 'EDO CTA CASH', records: await loadEdoCtaCash() },
    { sourceType: 'binance_statement', sourceAccount: 'Edo cuenta binance', records: await loadBinance() },
  ];
  const batchId = `sources-${new Date().toISOString()}`;

  output.push('== Estados externos ==');
  for (const { sourceType, sourceAccount, records } of sources) {
    await db.query(
      `DELETE FROM reconciliations r USING external_transactions et
       WHERE r.external_transaction_id = et.id AND et.source_type=$1 AND et.source_account=$2`,
      [sourceType, sourceAccount],
    );
    const del = await db.query(
      `DELETE FROM external_transactions WHERE source_type = $1 AND source_account = $2`,
      [sourceType, sourceAccount],
    );

    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((rec, j) => {
        const base = j * 8;
        values.push(
          sourceType,
          sourceAccount,
          rec.externalId,
          rec.effectiveAt,
          rec.direction,
          rec.currency,
          rec.amount,
          JSON.stringify({ ...rec.payload, description: rec.description }),
        );
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, '${batchId}')`;
      });
      const res = await db.query(
        `INSERT INTO external_transactions
           (source_type, source_account, external_id, effective_at, direction,
            native_currency, native_amount, raw_payload, import_batch_id)
         VALUES ${tuples.join(', ')}`,
        values,
      );
      inserted += res.rowCount ?? 0;
    }

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('importer', 'sync-google-sheet', 'import_source_snapshot', 'import_run', $1, $2)`,
      [batchId, JSON.stringify({ source_type: sourceType, source_account: sourceAccount, deleted_previous: del.rowCount, inserted })],
    );
    output.push(`${sourceAccount}: ${inserted} filas (reemplazo ${del.rowCount} previas)`);
  }
}

async function reconstructBsLinks(db: any, output: string[]) {
  const fm = await db.query(
    `SELECT (fm.source_payload->>'row_number')::int rn, (fm.source_payload->>'operacion')::numeric op, fm.id
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
     WHERE fm.source='google_sheet_movimientos' AND a.medium='bs'
       AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL`,
  );
  const byRow = new Map<number, number>();
  const byOp = new Map<number, number[]>();
  for (const r of fm.rows) {
    byRow.set(Number(r.rn), Number(r.id));
    const op = Number(r.op);
    (byOp.get(op) ?? byOp.set(op, []).get(op)!).push(Number(r.id));
  }

  const bank = await db.query(
    `SELECT id, native_amount::float8 amt,
            NULLIF(raw_payload->>'enlace_row','')::int enlace_row,
            CASE WHEN (raw_payload->>'enlace_movimientos') ~ '^[0-9]+(\\.[0-9]+)?$'
                 THEN (raw_payload->>'enlace_movimientos')::numeric END op
     FROM external_transactions
     WHERE source_type='bank_statement' AND source_account='EDO CTA BS'
       AND ((raw_payload->>'enlace_row') ~ '^[0-9]+$' OR (raw_payload->>'enlace_movimientos') ~ '^[0-9]+(\\.[0-9]+)?$')`,
  );

  await db.query(`DELETE FROM reconciliations WHERE reasons @> $1::jsonb`, [JSON.stringify([BS_LINK_REASON])]);

  let linked = 0;
  const skipped = { sin_match: 0, ambiguo: 0 };
  const fmReconciled = new Set<number>();
  for (const b of bank.rows) {
    let fmId: number | undefined = b.enlace_row != null ? byRow.get(Number(b.enlace_row)) : undefined;
    if (fmId == null && b.op != null) {
      const ids = byOp.get(Number(b.op));
      if (ids && ids.length === 1) fmId = ids[0];
      else if (ids && ids.length > 1) {
        skipped.ambiguo++;
        continue;
      }
    }
    if (fmId == null) {
      skipped.sin_match++;
      continue;
    }
    const res = await db.query(
      `INSERT INTO reconciliations (fund_movement_id, external_transaction_id, allocated_native_amount, status, confidence, reasons, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,'confirmed',1.0,$4,'sheet',now())
       ON CONFLICT (fund_movement_id, external_transaction_id) DO NOTHING`,
      [fmId, b.id, Math.abs(Number(b.amt)) || 0.01, JSON.stringify([BS_LINK_REASON])],
    );
    if (res.rowCount) {
      linked++;
      fmReconciled.add(fmId);
    }
  }

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
     VALUES ('importer','sync-google-sheet','reconstruct_bs_reconciliations','account','EDO CTA BS',$1)`,
    [JSON.stringify({ linked, movimientos_conciliados: fmReconciled.size, skipped })],
  );

  const resumen = (await db.query(
    `SELECT
       count(*) FILTER (WHERE fm.status='reconciled') conciliados,
       count(*) FILTER (WHERE fm.status<>'reconciled' AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL) pendientes_con_op,
       count(*) FILTER (WHERE fm.status<>'reconciled' AND NULLIF(fm.source_payload->>'operacion','') IS NULL) sin_operacion_no_aplica
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
     WHERE fm.source='google_sheet_movimientos' AND a.medium='bs' AND fm.status<>'voided'`,
  )).rows[0];

  output.push('== Conciliacion Bs desde enlaces del Sheet ==');
  output.push(`Enlaces reconstruidos: ${linked} | movimientos conciliados: ${fmReconciled.size}`);
  output.push(`Omitidos: sin match ${skipped.sin_match}, ambiguos ${skipped.ambiguo}`);
  output.push(`Estado Bs: conciliados ${resumen.conciliados} | pendientes ${resumen.pendientes_con_op} | no aplica ${resumen.sin_operacion_no_aplica}`);
}

async function suggestBsMatches(db: any, output: string[]) {
  const history = await db.query(
    `SELECT et.raw_payload->>'banco' bank,
            COALESCE(et.raw_payload->>'descripcion','') description,
            fm.client_id, c.name client
     FROM reconciliations r
     JOIN external_transactions et ON et.id=r.external_transaction_id
     JOIN fund_movements fm ON fm.id=r.fund_movement_id
     JOIN clients c ON c.id=fm.client_id
     WHERE r.status='confirmed'
       AND et.source_type='bank_statement' AND et.source_account='EDO CTA BS'
       AND et.raw_payload->>'banco' IN ('BDV VENISUM','BDV SOLUCIONES','NENEKA')`,
  );

  const owners = new Map<string, Map<number, IdentityOwner>>();
  for (const row of history.rows) {
    const identity = identityFor(row.bank, row.description);
    if (!identity) continue;
    const key = mapKey(row.bank, identity);
    const candidates = owners.get(key) ?? new Map<number, IdentityOwner>();
    const current = candidates.get(Number(row.client_id));
    candidates.set(Number(row.client_id), {
      clientId: Number(row.client_id),
      client: row.client,
      evidence: (current?.evidence ?? 0) + 1,
    });
    owners.set(key, candidates);
  }

  const identityMap = new Map<string, IdentityOwner>();
  let ambiguousIdentities = 0;
  for (const [key, candidates] of owners) {
    if (candidates.size === 1) identityMap.set(key, [...candidates.values()][0]);
    else ambiguousIdentities++;
  }

  const reviewedRules = await db.query(
    `SELECT r.bank, r.identity_type, r.identity_value, r.strategy, r.client_id,
            r.instruction, c.name client
     FROM bs_identity_rules r JOIN clients c ON c.id=r.client_id
     WHERE r.status='active'`,
  );
  for (const row of reviewedRules.rows) {
    const identity: Identity = { kind: row.identity_type, key: row.identity_value };
    identityMap.set(mapKey(row.bank, identity), {
      clientId: Number(row.client_id),
      client: row.client,
      evidence: 0,
      ruleStrategy: row.strategy,
      ruleInstruction: row.instruction,
    });
  }

  const ledgerResult = await db.query(
    `SELECT fm.id, fm.client_id, c.name client, a.name account,
            fm.effective_at::date::text date, fm.direction,
            fm.native_amount::float8 amount, fm.kw2_id
     FROM fund_movements fm
     JOIN accounts a ON a.id=fm.account_id
     JOIN clients c ON c.id=fm.client_id
     WHERE fm.source='google_sheet_movimientos' AND a.medium='bs'
       AND fm.status<>'voided'
       AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM reconciliations r
         WHERE r.fund_movement_id=fm.id AND r.status IN ('confirmed','suggested')
       )
     ORDER BY fm.effective_at, fm.id`,
  );
  const ledger: Ledger[] = ledgerResult.rows.map((row: any) => ({
    id: Number(row.id),
    clientId: Number(row.client_id),
    client: row.client,
    account: row.account,
    date: row.date,
    direction: row.direction,
    amount: Number(row.amount),
    kw2Id: row.kw2_id,
  }));

  const statementResult = await db.query(
    `SELECT et.id, et.raw_payload->>'banco' bank,
            (et.effective_at AT TIME ZONE 'America/Caracas')::date::text date,
            et.direction, et.native_amount::float8 amount,
            COALESCE(et.raw_payload->>'descripcion','') description
     FROM external_transactions et
     WHERE et.source_type='bank_statement' AND et.source_account='EDO CTA BS'
       AND et.direction IS NOT NULL AND et.native_amount IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM reconciliations r
         WHERE r.external_transaction_id=et.id AND r.status IN ('confirmed','suggested')
       )
     ORDER BY et.effective_at, et.id`,
  );
  const statements: Statement[] = statementResult.rows.map((row: any) => ({
    id: Number(row.id),
    bank: row.bank,
    date: row.date,
    direction: row.direction,
    amount: Number(row.amount),
    description: row.description,
    identity: identityFor(row.bank, row.description),
  }));

  const suggestions: Suggestion[] = [];
  const usedStatements = new Set<number>();
  for (const movement of ledger) {
    const sameContext = statements.filter((row) =>
      !usedStatements.has(row.id)
      && row.bank === movement.account
      && row.date === movement.date
      && row.direction === movement.direction,
    );

    const identities = new Map<string, { identity: Identity; owner: IdentityOwner }>();
    for (const row of sameContext) {
      if (!row.identity) continue;
      const owner = identityMap.get(mapKey(row.bank, row.identity));
      if (owner?.clientId === movement.clientId) identities.set(mapKey(row.bank, row.identity), { identity: row.identity, owner });
    }

    const candidates: Suggestion[] = [];
    for (const { identity, owner } of identities.values()) {
      const compatible = sameContext.filter((row) => {
        if (isCommissionRow(row)) return true;
        if (!row.identity) return false;
        return identityMap.get(mapKey(row.bank, row.identity))?.clientId === movement.clientId;
      });
      let subset = uniqueSubset(movement.amount, compatible, owner, identityMap);
      if (!subset) continue;
      if (owner.ruleStrategy === 'bridge_account'
        && (subset.length !== 1 || Math.abs(subset[0].amount - movement.amount) > BS_EPS)) continue;

      const rate = feeRate(movement.account);
      if (rate && subset.length === 1 && Math.abs(subset[0].amount - movement.amount) <= BS_EPS) {
        const expectedFee = subset[0].amount * rate;
        const feeCandidates = sameContext.filter((row) => {
          if (subset!.some((selected) => selected.id === row.id)) return false;
          if (Math.abs(row.amount - expectedFee) > Math.max(BS_EPS, expectedFee * 0.0001)) return false;
          if (movement.account !== 'NENEKA') return isCommissionRow(row);
          if (!row.identity) return false;
          return identityMap.get(mapKey(row.bank, row.identity))?.clientId === movement.clientId;
        });
        if (feeCandidates.length === 1) subset = [...subset, feeCandidates[0]];
      }

      candidates.push({
        ledger: movement,
        rows: subset,
        confidence: subset.length === 1 ? 0.99 : 0.98,
        identity,
        owner,
        evidence: owner.evidence,
      });
    }

    const signatures = new Map(candidates.map((candidate) => [
      candidate.rows.map((row) => row.id).sort((a, b) => a - b).join(','),
      candidate,
    ]));
    if (signatures.size !== 1) continue;
    const suggestion = [...signatures.values()][0];
    suggestions.push(suggestion);
    suggestion.rows.forEach((row) => usedStatements.add(row.id));
  }

  await db.query(
    `DELETE FROM reconciliations
     WHERE status='suggested' AND reasons @> $1::jsonb`,
    [JSON.stringify([BS_MATCH_REASON])],
  );

  let inserted = 0;
  for (const suggestion of suggestions) {
    for (const row of suggestion.rows) {
      const reason = [
        BS_MATCH_REASON,
        'banco, fecha, direccion e identidad coinciden',
        `${suggestion.identity.kind}: ${suggestion.identity.key}`,
        suggestion.owner?.ruleStrategy ? `regla revisada: ${suggestion.owner.ruleStrategy}` : `evidencia historica: ${suggestion.evidence}`,
        ...(suggestion.owner.ruleInstruction ? [`instruccion: ${suggestion.owner.ruleInstruction}`] : []),
        suggestion.rows.length === 1 ? 'monto exacto 1:1' : `suma exacta 1:${suggestion.rows.length}`,
      ];
      const result = await db.query(
        `INSERT INTO reconciliations
           (fund_movement_id, external_transaction_id, allocated_native_amount, status, confidence, reasons)
         VALUES ($1,$2,$3,'suggested',$4,$5)
         ON CONFLICT (fund_movement_id, external_transaction_id) DO NOTHING`,
        [suggestion.ledger.id, row.id, row.amount, suggestion.confidence, JSON.stringify(reason)],
      );
      inserted += result.rowCount ?? 0;
    }
  }

  await db.query(
    `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
     VALUES ('importer','sync-google-sheet','suggest_bs_reconciliations','account','EDO CTA BS',$1)`,
    [JSON.stringify({
      identities_univocas: identityMap.size,
      identities_ambiguas: ambiguousIdentities,
      movimientos_pendientes: ledger.length,
      filas_estado_disponibles: statements.length,
      operaciones_sugeridas: suggestions.length,
      enlaces_sugeridos: inserted,
    })],
  );

  output.push('== Sugerencias Bs ==');
  output.push(`Identidades univocas: ${identityMap.size} | ambiguas: ${ambiguousIdentities}`);
  output.push(`Pendientes evaluados: ${ledger.length} | filas disponibles: ${statements.length}`);
  output.push(`Operaciones sugeridas: ${suggestions.length} | enlaces sugeridos: ${inserted}`);
}

export type CloudSyncPhase =
  | 'data'
  | 'movimientos-snapshot'
  | 'movimientos-reimport'
  | 'movimientos-finalize'
  | 'sources'
  | 'bs'
  | 'suggestions';

async function syncDataCloud(db: any, output: string[]) {
  output.push('== DATA (clientes y cuentas) ==');
  const dataRows = await readRange("'DATA'!A3:K2000");
  const clients = dataRows
    .filter((r) => r[0] !== '' && r[0] != null && String(r[2] ?? '').trim() !== '')
    .map((r) => ({
      legacyId: Number(r[0]),
      shortName: String(r[1] ?? '').trim() || null,
      name: String(r[2]).trim(),
    }))
    .filter((c) => !SKIPPED_CLIENT_IDS.has(c.legacyId));

  const accounts = dataRows
    .filter((r) => String(r[5] ?? '').trim() !== '' && String(r[6] ?? '').trim() !== '')
    .map((r) => ({ legacyId: String(r[5]).trim(), name: String(r[6]).trim() }))
    .filter((a) => !SKIPPED_ACCOUNTS.has(a.legacyId));

  const missingSpec = accounts.filter((a) => !ACCOUNT_SPECS[a.legacyId]);
  if (missingSpec.length > 0) {
    throw new Error(`Cuentas sin especificacion: ${missingSpec.map((a) => `${a.legacyId} ${a.name}`).join(', ')}`);
  }

  let clientsInserted = 0;
  let clientsUpdated = 0;
  for (const c of clients) {
    const kind = isSystemClient(c.name) ? 'system' : 'client';
    const res = await db.query(
      `INSERT INTO clients (legacy_id, name, short_name, kind)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (legacy_id) DO UPDATE
         SET name = EXCLUDED.name,
             short_name = EXCLUDED.short_name,
             kind = EXCLUDED.kind,
             updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [String(c.legacyId), c.name, c.shortName, kind],
    );
    res.rows[0].inserted ? clientsInserted++ : clientsUpdated++;
  }

  let accountsInserted = 0;
  let accountsUpdated = 0;
  for (const a of accounts) {
    const spec = ACCOUNT_SPECS[a.legacyId];
    const res = await db.query(
      `INSERT INTO accounts (legacy_id, name, medium, native_currency, bank_fee_rate)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (legacy_id) DO UPDATE
         SET name = EXCLUDED.name,
             medium = EXCLUDED.medium,
             native_currency = EXCLUDED.native_currency,
             bank_fee_rate = EXCLUDED.bank_fee_rate,
             updated_at = now()
       RETURNING (xmax = 0) AS inserted`,
      [a.legacyId, a.name, spec.medium, spec.currency, spec.feeRate ?? null],
    );
    res.rows[0].inserted ? accountsInserted++ : accountsUpdated++;
  }

  output.push(`Clientes: ${clientsInserted} insertados, ${clientsUpdated} actualizados (${clients.length} leidos)`);
  output.push(`Cuentas: ${accountsInserted} insertadas, ${accountsUpdated} actualizadas (${accounts.length} leidas)`);
}

async function syncMovimientosSnapshotCloud(db: any, output: string[]) {
  output.push('== MOVIMIENTOS (snapshot) ==');
  const movimientoRows = await readRange("'MOVIMIENTOS'!A2:S100000");
  const records = movimientoRows
    .map((row, i) => {
      const payload: Record<string, unknown> = { row_number: i + 2 };
      COLUMNS.forEach((name, idx) => (payload[name] = row[idx] ?? null));
      return payload;
    })
    .filter((p) => typeof p.fecha === 'number' && (p.id_banco || p.id_cliente));

  const batchId = randomUUID();
  const snapshotAccount = movimientosSnapshotAccount(batchId);

  const CHUNK = 500;
  let insertedSnapshot = 0;
  for (let i = 0; i < records.length; i += CHUNK) {
    const chunk = records.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((p, j) => {
      const credito = typeof p.monto_credito === 'number' ? p.monto_credito : null;
      const debito = typeof p.monto_debito === 'number' ? p.monto_debito : null;
      const amount = credito ?? (debito != null ? Math.abs(debito) : null);
      const direction = credito != null ? 'inflow' : debito != null ? 'outflow' : null;
      const base = j * 7;
      values.push(
        String(p.row_number),
        serialToDate(p.fecha as number),
        direction,
        amount,
        p.nombre ?? null,
        JSON.stringify(p),
        batchId,
      );
      return `('google_sheet', '${snapshotAccount}', $${base + 1}, $${base + 2}, $${base + 3}, 'USD', $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
    });
    const res = await db.query(
      `INSERT INTO external_transactions
         (source_type, source_account, external_id, effective_at, direction,
          native_currency, native_amount, description, raw_payload, import_batch_id)
       VALUES ${tuples.join(', ')}`,
      values,
    );
    insertedSnapshot += res.rowCount ?? 0;
  }

  output.push(`Filas leidas: ${movimientoRows.length} | validas: ${records.length}`);
  output.push(`Snapshot ${batchId}: ${insertedSnapshot} filas insertadas`);
  return { batchId, totalRows: records.length };
}

async function syncMovimientosReimportCloud(db: any, output: string[], batchId: string, offset: number, limit: number) {
  const snapshotAccount = movimientosSnapshotAccount(requireBatchId(batchId));
  output.push(`== Reimport seguro MOVIMIENTOS (${offset + 1}-${offset + limit}) ==`);
  const accountsRes = await db.query(`SELECT id, name, medium FROM accounts`);
  const accountByName = new Map<string, SyncAccount>(accountsRes.rows.map((a: SyncAccount) => [a.name, a]));
  const clientsRes = await db.query(`SELECT id, legacy_id FROM clients WHERE legacy_id IS NOT NULL`);
  const clientByLegacy = new Map(clientsRes.rows.map((c: any) => [c.legacy_id, c.id]));

  const dupRows = await db.query(
    `SELECT raw_payload->>'kw2_id' kw2_id, count(*) c
     FROM external_transactions
     WHERE source_type='google_sheet' AND source_account=$1
       AND NULLIF(raw_payload->>'kw2_id','') IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1`,
    [snapshotAccount],
  );
  const dupSet = new Set(dupRows.rows.map((r: any) => r.kw2_id));

  const snap = await db.query(
    `SELECT id, raw_payload p FROM external_transactions
     WHERE source_type='google_sheet' AND source_account=$1
     ORDER BY (raw_payload->>'row_number')::int
     LIMIT $2 OFFSET $3`,
    [snapshotAccount, limit, offset],
  );

  const skipped: { rn: number; reason: string }[] = [];
  const rows: any[] = [];
  for (const { id: snapshotId, p } of snap.rows) {
    const rn = Number(p.row_number);
    const kw2 = String(p.kw2_id ?? '').trim();
    if (!kw2) {
      skipped.push({ rn, reason: 'sin kw2_id' });
      continue;
    }
    if (dupSet.has(kw2)) {
      skipped.push({ rn, reason: `kw2_id duplicado: ${kw2}` });
      continue;
    }

    const account = accountByName.get(String(p.banco ?? '').trim());
    if (!account) {
      skipped.push({ rn, reason: `banco desconocido: ${p.banco}` });
      continue;
    }
    const credito = typeof p.monto_credito === 'number' ? p.monto_credito : null;
    const debito = typeof p.monto_debito === 'number' ? p.monto_debito : null;
    const usd = Math.abs(credito ?? debito ?? 0);
    if (usd === 0) {
      skipped.push({ rn, reason: 'monto cero' });
      continue;
    }
    const tipo = String(p.tipo ?? '').trim();
    if (tipo !== 'Ingreso' && tipo !== 'Egreso') {
      skipped.push({ rn, reason: `tipo invalido: ${tipo}` });
      continue;
    }
    if (tipo === 'Ingreso' && (credito == null || credito < 0)) {
      skipped.push({ rn, reason: 'signo inconsistente con Ingreso' });
      continue;
    }
    if (tipo === 'Egreso' && (debito == null || debito > 0)) {
      skipped.push({ rn, reason: 'signo inconsistente con Egreso' });
      continue;
    }

    const clientId = clientByLegacy.get(String(p.id_cliente ?? '')) ?? null;
    const tasa = typeof p.tasa === 'number' && p.tasa > 0 ? p.tasa : null;
    const montoBs = typeof p.monto_bs === 'number' ? Math.abs(p.monto_bs) : null;
    const useBs = account.medium === 'bs' && montoBs != null && montoBs > 0;

    rows.push({
      kw2,
      accountId: account.id,
      clientId,
      direction: tipo === 'Ingreso' ? 'inflow' : 'outflow',
      medium: account.medium,
      currency: useBs ? 'VES' : 'USD',
      native: useBs ? montoBs : usd,
      usd,
      rate: tasa,
      date: serialToDate(Number(p.fecha)),
      sender: String(p.emisor_beneficiario ?? '').trim() || null,
      payload: p,
      snapshotId,
    });
  }

  let inserted = 0;
  let updated = 0;
  const importedSnapshotIds = rows.map((row) => row.snapshotId);
  if (rows.length > 0) {
    const values: unknown[] = [];
    const tuples = rows.map((row, index) => {
      const base = index * 13;
      values.push(
        row.kw2, row.accountId, row.clientId, row.direction, row.medium, row.currency,
        row.native, row.usd, row.rate, row.date, row.sender, SOURCE, JSON.stringify(row.payload),
      );
      return `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8},$${base + 9},($${base + 10}::date)::timestamptz,$${base + 11},$${base + 12},$${base + 13})`;
    });
    const res = await db.query(
      `INSERT INTO fund_movements
         (kw2_id, account_id, client_id, direction, medium, native_currency, native_amount,
          usd_amount, exchange_rate, effective_at, sender_or_recipient, source, source_payload)
       VALUES ${tuples.join(', ')}
       ON CONFLICT (kw2_id) WHERE kw2_id IS NOT NULL DO UPDATE SET
         account_id=EXCLUDED.account_id, client_id=EXCLUDED.client_id, direction=EXCLUDED.direction,
         medium=EXCLUDED.medium, native_currency=EXCLUDED.native_currency, native_amount=EXCLUDED.native_amount,
         usd_amount=EXCLUDED.usd_amount, exchange_rate=EXCLUDED.exchange_rate, effective_at=EXCLUDED.effective_at,
         sender_or_recipient=EXCLUDED.sender_or_recipient, source_payload=EXCLUDED.source_payload, updated_at=now()
       RETURNING (xmax = 0) AS inserted`,
      values,
    );
    inserted = res.rows.filter((row: any) => row.inserted).length;
    updated = (res.rowCount ?? 0) - inserted;
  }

  if (importedSnapshotIds.length > 0) {
    await db.query(
      `UPDATE external_transactions
       SET raw_payload = raw_payload || jsonb_build_object('kw2_sync_imported_batch', $2::text)
       WHERE id = ANY($1::bigint[])`,
      [importedSnapshotIds, batchId],
    );
  }

  output.push(`Procesadas: ${snap.rows.length} | insertados ${inserted} | actualizados ${updated} | omitidos ${skipped.length}`);
  for (const item of skipped) {
    output.push(`Omitida fila ${item.rn}: ${item.reason}`);
  }
  return { done: snap.rows.length < limit, nextOffset: offset + snap.rows.length };
}

async function syncMovimientosFinalizeCloud(db: any, output: string[], batchId: string) {
  const snapshotAccount = movimientosSnapshotAccount(requireBatchId(batchId));
  output.push('== Finalizar MOVIMIENTOS ==');
  const latest = await db.query(
    `SELECT source_account
     FROM external_transactions
     WHERE source_type='google_sheet' AND source_account LIKE 'MOVIMIENTOS:%'
     GROUP BY source_account
     ORDER BY max(created_at) DESC, source_account DESC
     LIMIT 1`,
  );
  if (latest.rows[0]?.source_account !== snapshotAccount) {
    throw new Error('Existe una sincronizacion mas reciente. Esta ejecucion no puede finalizar ni anular movimientos.');
  }

  const readiness = await db.query(
    `SELECT
       count(*) FILTER (WHERE NULLIF(raw_payload->>'kw2_id','') IS NOT NULL)::int AS expected,
       count(*) FILTER (
         WHERE NULLIF(raw_payload->>'kw2_id','') IS NOT NULL
           AND raw_payload->>'kw2_sync_imported_batch'=$2
       )::int AS imported
     FROM external_transactions
     WHERE source_type='google_sheet' AND source_account=$1`,
    [snapshotAccount, batchId],
  );
  const expected = readiness.rows[0]?.expected ?? 0;
  const imported = readiness.rows[0]?.imported ?? 0;
  if (expected === 0) throw new Error('El snapshot no contiene movimientos con kw2_id. Se cancela el cierre por seguridad.');
  if (imported !== expected) {
    throw new Error(`Faltan ${expected - imported} movimientos por reimportar o corregir. No se anulo ningun movimiento.`);
  }

  const snapshotKw2Rows = await db.query(
    `SELECT raw_payload->>'kw2_id' kw2_id
     FROM external_transactions
     WHERE source_type='google_sheet' AND source_account=$1
       AND NULLIF(raw_payload->>'kw2_id','') IS NOT NULL`,
    [snapshotAccount],
  );
  const snapshotKw2 = snapshotKw2Rows.rows.map((r: any) => r.kw2_id);

  const voidRes = await db.query(
    `UPDATE fund_movements SET status='voided', updated_at=now()
     WHERE source=$1 AND status<>'voided' AND kw2_id IS NOT NULL AND NOT (kw2_id = ANY($2::text[]))
     RETURNING id, kw2_id,
       (SELECT count(*) FROM reconciliations r WHERE r.fund_movement_id=fund_movements.id AND r.status<>'rejected') AS recon`,
    [SOURCE, snapshotKw2],
  );
  const voidedWithRecon = voidRes.rows.filter((r: any) => Number(r.recon) > 0);

  const flagged = await db.query(
    `UPDATE fund_movements f SET status = CASE
       WHEN s.c = 0 THEN 'posted'
       WHEN abs(s.c - f.usd_amount) <= $2 THEN 'reconciled'
       ELSE 'needs_review' END, updated_at=now()
     FROM (SELECT fund_movement_id, COALESCE(SUM(allocated_native_amount),0) c
           FROM reconciliations WHERE status='confirmed' GROUP BY fund_movement_id) s
     WHERE f.id=s.fund_movement_id AND f.source=$1 AND f.status<>'voided' AND f.medium <> 'bs'
     RETURNING f.id, f.status, f.kw2_id, f.usd_amount, s.c`,
    [SOURCE, TOL],
  );
  const needsReview = flagged.rows.filter((r: any) => r.status === 'needs_review');

  await db.query(
    `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
     VALUES ('importer','sync-google-sheet','cloud_safe_reimport_finalize','account','MOVIMIENTOS',$1)`,
    [JSON.stringify({ batch_id: batchId, voided: voidRes.rowCount, voided_with_recon: voidedWithRecon.length, needs_review: needsReview.length })],
  );

  output.push(`Anulados: ${voidRes.rowCount}`);
  if (voidedWithRecon.length > 0) output.push(`${voidedWithRecon.length} anulados tenían conciliaciones: revisar.`);
  if (needsReview.length > 0) output.push(`${needsReview.length} movimientos quedaron needs_review.`);
}

export async function syncGoogleSheetCloud(
  phase: CloudSyncPhase,
  options: { batchId?: string; offset?: number; limit?: number } = {},
) {
  const output: string[] = [];
  const db = await pool.connect();

  try {
    if (phase === 'data') {
      await db.query('BEGIN');
      await syncDataCloud(db, output);
      await db.query('COMMIT');
      output.push('== Listo ==');
      return { ok: true, output: output.join('\n') };
    }

    if (phase === 'movimientos-snapshot') {
      await db.query('BEGIN');
      const snapshot = await syncMovimientosSnapshotCloud(db, output);
      await db.query('COMMIT');
      output.push('== Listo ==');
      return { ok: true, output: output.join('\n'), ...snapshot };
    }

    if (phase === 'movimientos-reimport') {
      await db.query('BEGIN');
      const progress = await syncMovimientosReimportCloud(db, output, requireBatchId(options.batchId), options.offset ?? 0, options.limit ?? 750);
      await db.query('COMMIT');
      output.push(progress.done ? '== Listo ==' : `Siguiente lote: ${progress.nextOffset}`);
      return { ok: true, output: output.join('\n'), ...progress };
    }

    if (phase === 'movimientos-finalize') {
      await db.query('BEGIN');
      await syncMovimientosFinalizeCloud(db, output, requireBatchId(options.batchId));
      await db.query('COMMIT');
      output.push('== Listo ==');
      return { ok: true, output: output.join('\n') };
    }

    if (phase === 'sources') {
      await db.query('BEGIN');
      await importExternalSources(db, output);
      await db.query('COMMIT');
      output.push('== Listo ==');
      return { ok: true, output: output.join('\n') };
    }

    if (phase === 'bs') {
      await db.query('BEGIN');
      await reconstructBsLinks(db, output);
      await db.query('COMMIT');
      output.push('== Listo ==');
      return { ok: true, output: output.join('\n') };
    }

    if (phase === 'suggestions') {
      await db.query('BEGIN');
      await suggestBsMatches(db, output);
      await db.query('COMMIT');
      output.push('== Listo ==');
      return { ok: true, output: output.join('\n') };
    }

    throw new Error(`Fase no soportada: ${phase}`);
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}
