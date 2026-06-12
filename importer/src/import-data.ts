// Importa la hoja DATA del Sheet "2026 KW2" a las tablas clients y accounts.
// Idempotente: re-ejecutarlo actualiza por legacy_id sin duplicar.
// No escribe en el Google Sheet.
import pg from 'pg';
import { readRange } from './sheets.js';

// Decisiones confirmadas el 12-jun-2026:
// - LEDCH (EEE), GREEN BLOCK (TTT) y RETIRO (XXX) no se importan.
//   RETIRO no tiene ninguna fila en MOVIMIENTOS.
// - Chato existe duplicado en DATA (IDs 75 y 334); el canonico es 75
//   (unico con movimientos). El 334 no se importa.
const SKIPPED_ACCOUNTS = new Set(['EEE', 'TTT', 'XXX']);
const SKIPPED_CLIENT_IDS = new Set([334]);
const MERGED_LEGACY_IDS: Record<number, number> = { 334: 75 };

const SYSTEM_CLIENT_NAMES = new Set(
  ['2025', 'Binance P2P', 'Binance Loan', 'Prestamo Binance', 'Sin Identificar', 'TS', 'CH', 'Ajuste BS'].map((n) =>
    n.toLowerCase(),
  ),
);
const isSystemClient = (name: string) =>
  SYSTEM_CLIENT_NAMES.has(name.toLowerCase()) || name.toLowerCase().startsWith('comisiones ');

type AccountSpec = { medium: string; currency: string; feeRate?: number };
const ACCOUNT_SPECS: Record<string, AccountSpec> = {
  AAA: { medium: 'cash', currency: 'USD' }, // CASH CH
  BBB: { medium: 'usdt', currency: 'USDT' }, // BINANCE CH
  GGG: { medium: 'bs', currency: 'VES', feeRate: 0.003 }, // NENEKA
  KKK: { medium: 'transitory', currency: 'USD' }, // TRANSITORIA
  LLL: { medium: 'bs', currency: 'VES' }, // BS BANESCO
  MMM: { medium: 'bs', currency: 'VES' }, // BS BDV
  OOO: { medium: 'zelle', currency: 'USD' }, // ZELLE CH
  PPP: { medium: 'bs', currency: 'VES' }, // TRANSITORIA BS
  QQQ: { medium: 'bs', currency: 'VES', feeRate: 0.0025 }, // BDV VENISUM
  RRR: { medium: 'bs', currency: 'VES' }, // BS MERCANTIL
  SSS: { medium: 'bs', currency: 'VES', feeRate: 0.0025 }, // BDV SOLUCIONES
  UUU: { medium: 'zelle', currency: 'USD' }, // ZELLE MANUEL
  YYY: { medium: 'commission', currency: 'USD' }, // COMISION
  ZZZ: { medium: 'expense', currency: 'USD' }, // GASTO
};

async function main() {
  const rows = await readRange("'DATA'!A3:K2000");

  const clients = rows
    .filter((r) => r[0] !== '' && r[0] != null && String(r[2] ?? '').trim() !== '')
    .map((r) => ({
      legacyId: Number(r[0]),
      shortName: String(r[1] ?? '').trim() || null,
      name: String(r[2]).trim(),
      sheetBalance: r[3] ?? null,
    }))
    .filter((c) => !SKIPPED_CLIENT_IDS.has(c.legacyId));

  const accounts = rows
    .filter((r) => String(r[5] ?? '').trim() !== '' && String(r[6] ?? '').trim() !== '')
    .map((r) => ({
      legacyId: String(r[5]).trim(),
      name: String(r[6]).trim(),
      sheetBalance: r[7] ?? null,
    }))
    .filter((a) => !SKIPPED_ACCOUNTS.has(a.legacyId));

  const missingSpec = accounts.filter((a) => !ACCOUNT_SPECS[a.legacyId]);
  if (missingSpec.length > 0) {
    throw new Error(
      `Cuentas sin especificacion de medio/moneda: ${missingSpec.map((a) => `${a.legacyId} ${a.name}`).join(', ')}. ` +
        'Agregalas a ACCOUNT_SPECS antes de importar.',
    );
  }

  const db = new pg.Client({
    host: '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'kw2',
    user: process.env.POSTGRES_USER ?? 'kw2_app',
    password: process.env.POSTGRES_PASSWORD,
  });
  await db.connect();

  try {
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

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('importer', 'import-data', 'import_data_sheet', 'import_run', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), $1)`,
      [
        JSON.stringify({
          source: 'google_sheet DATA',
          clients: { read: clients.length, inserted: clientsInserted, updated: clientsUpdated },
          accounts: { read: accounts.length, inserted: accountsInserted, updated: accountsUpdated },
          skipped_accounts: [...SKIPPED_ACCOUNTS],
          merged_clients: MERGED_LEGACY_IDS,
        }),
      ],
    );

    await db.query('COMMIT');

    console.log(`Clientes: ${clientsInserted} insertados, ${clientsUpdated} actualizados (${clients.length} leidos)`);
    console.log(`Cuentas: ${accountsInserted} insertadas, ${accountsUpdated} actualizadas (${accounts.length} leidas)`);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
