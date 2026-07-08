import { google } from 'googleapis';
import { pool } from './db';

const SHEET_ID = process.env.KW2_SHEET_ID ?? '1bVhtBhS_cEDAnET8q5t4d4tT3pDE_bvEFD0oYjWaNWo';
const SOURCE = 'google_sheet_movimientos';
const TOL = 0.02;

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

function isSystemClient(name: string) {
  return SYSTEM_CLIENT_NAMES.has(name.toLowerCase());
}

export async function syncGoogleSheetCloud() {
  const output: string[] = [];
  const db = await pool.connect();

  try {
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

    await db.query('BEGIN');

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

    output.push('== MOVIMIENTOS (snapshot) ==');
    const movimientoRows = await readRange("'MOVIMIENTOS'!A2:S100000");
    const records = movimientoRows
      .map((row, i) => {
        const payload: Record<string, unknown> = { row_number: i + 2 };
        COLUMNS.forEach((name, idx) => (payload[name] = row[idx] ?? null));
        return payload;
      })
      .filter((p) => typeof p.fecha === 'number' && (p.id_banco || p.id_cliente));

    const batchId = `movimientos-${new Date().toISOString()}`;
    const del = await db.query(
      `DELETE FROM external_transactions
       WHERE source_type = 'google_sheet' AND source_account = 'MOVIMIENTOS'`,
    );

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
        return `('google_sheet', 'MOVIMIENTOS', $${base + 1}, $${base + 2}, $${base + 3}, 'USD', $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7})`;
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
    output.push(`Snapshot anterior borrado: ${del.rowCount} filas | insertadas: ${insertedSnapshot}`);

    output.push('== Reimport seguro (por kw2_id) ==');
    const accountsRes = await db.query(`SELECT id, name, medium FROM accounts`);
    const accountByName = new Map(accountsRes.rows.map((a) => [a.name, a]));
    const clientsRes = await db.query(`SELECT id, legacy_id FROM clients WHERE legacy_id IS NOT NULL`);
    const clientByLegacy = new Map(clientsRes.rows.map((c) => [c.legacy_id, c.id]));
    const snap = await db.query(
      `SELECT raw_payload p FROM external_transactions
       WHERE source_type='google_sheet' AND source_account='MOVIMIENTOS'
       ORDER BY (raw_payload->>'row_number')::int`,
    );

    const skipped: { rn: number; reason: string }[] = [];
    const rows: any[] = [];
    const snapshotKw2 = new Set<string>();
    const kw2Count = new Map<string, number>();
    for (const { p } of snap.rows) {
      const k = String(p.kw2_id ?? '').trim();
      if (k) kw2Count.set(k, (kw2Count.get(k) ?? 0) + 1);
    }
    const dupSet = new Set([...kw2Count].filter(([, count]) => count > 1).map(([k]) => k));

    for (const { p } of snap.rows) {
      const rn = Number(p.row_number);
      const kw2 = String(p.kw2_id ?? '').trim();
      if (!kw2) {
        skipped.push({ rn, reason: 'sin kw2_id' });
        continue;
      }
      snapshotKw2.add(kw2);
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
      });
    }

    let inserted = 0;
    let updated = 0;
    for (const r of rows) {
      const res = await db.query(
        `INSERT INTO fund_movements
           (kw2_id, account_id, client_id, direction, medium, native_currency, native_amount,
            usd_amount, exchange_rate, effective_at, sender_or_recipient, source, source_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,($10::date)::timestamptz,$11,$12,$13)
         ON CONFLICT (kw2_id) WHERE kw2_id IS NOT NULL DO UPDATE SET
           account_id=EXCLUDED.account_id, client_id=EXCLUDED.client_id, direction=EXCLUDED.direction,
           medium=EXCLUDED.medium, native_currency=EXCLUDED.native_currency, native_amount=EXCLUDED.native_amount,
           usd_amount=EXCLUDED.usd_amount, exchange_rate=EXCLUDED.exchange_rate, effective_at=EXCLUDED.effective_at,
           sender_or_recipient=EXCLUDED.sender_or_recipient, source_payload=EXCLUDED.source_payload, updated_at=now()
         RETURNING (xmax = 0) AS inserted`,
        [r.kw2, r.accountId, r.clientId, r.direction, r.medium, r.currency, r.native, r.usd, r.rate, r.date, r.sender, SOURCE, JSON.stringify(r.payload)],
      );
      res.rows[0].inserted ? inserted++ : updated++;
    }

    const voidRes = await db.query(
      `UPDATE fund_movements SET status='voided', updated_at=now()
       WHERE source=$1 AND status<>'voided' AND kw2_id IS NOT NULL AND NOT (kw2_id = ANY($2::text[]))
       RETURNING id, kw2_id,
         (SELECT count(*) FROM reconciliations r WHERE r.fund_movement_id=fund_movements.id AND r.status<>'rejected') AS recon`,
      [SOURCE, [...snapshotKw2]],
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
       VALUES ('app_web','sync-google-sheet','cloud_safe_reimport','account','MOVIMIENTOS',$1)`,
      [
        JSON.stringify({
          clients: { read: clients.length, inserted: clientsInserted, updated: clientsUpdated },
          accounts: { read: accounts.length, inserted: accountsInserted, updated: accountsUpdated },
          movimientos: { rows_read: movimientoRows.length, rows_valid: records.length, snapshot_inserted: insertedSnapshot },
          reimport: { inserted, updated, voided: voidRes.rowCount, voided_with_recon: voidedWithRecon.length, needs_review: needsReview.length, skipped: skipped.length },
          skipped_accounts: [...SKIPPED_ACCOUNTS],
          merged_clients: MERGED_LEGACY_IDS,
        }),
      ],
    );

    await db.query('COMMIT');

    output.push(`Insertados: ${inserted} | Actualizados: ${updated} | Anulados: ${voidRes.rowCount}`);
    output.push(`Omitidos: ${skipped.length}`);
    if (dupSet.size > 0) output.push(`kw2_id duplicados no procesados: ${[...dupSet].join(', ')}`);
    if (voidedWithRecon.length > 0) output.push(`${voidedWithRecon.length} anulados tenían conciliaciones: revisar.`);
    if (needsReview.length > 0) output.push(`${needsReview.length} movimientos quedaron needs_review.`);
    output.push('== Listo ==');

    return { ok: true, output: output.join('\n') };
  } catch (error) {
    await db.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    db.release();
  }
}
