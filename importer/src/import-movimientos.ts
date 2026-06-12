// Importa la hoja MOVIMIENTOS completa como snapshot crudo a external_transactions.
// Estrategia de snapshot: cada corrida reemplaza el snapshot anterior de
// MOVIMIENTOS (mismo source_type/source_account) y queda registrada en audit_events.
// No escribe en el Google Sheet.
import { google } from 'googleapis';
import { dbClient } from './db.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SHEET_ID } from './sheets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const COLUMNS = [
  'fecha', 'semana', 'type', 'id_banco', 'banco', 'id_cliente', 'nombre', 'tipo',
  'monto_credito', 'monto_debito', 'porcentaje', 'emisor_beneficiario', 'tasa',
  'monto_bs', 'operacion', 'x', 'conciliacion', 'alerta_banco',
] as const;

// Serial de Google Sheets -> fecha (dias desde 1899-12-30).
function serialToDate(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString().slice(0, 10);
}

async function main() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_APPLICATION_CREDENTIALS ?? path.join(ROOT, 'google-credentials.json'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });
  const sheets = google.sheets({ version: 'v4', auth });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SHEET_ID,
    range: "'MOVIMIENTOS'!A2:R100000",
    valueRenderOption: 'UNFORMATTED_VALUE',
    dateTimeRenderOption: 'SERIAL_NUMBER',
  });
  const rows = (res.data.values ?? []) as unknown[][];

  const records = rows
    .map((row, i) => {
      const payload: Record<string, unknown> = { row_number: i + 2 };
      COLUMNS.forEach((name, idx) => (payload[name] = row[idx] ?? null));
      return payload;
    })
    // Una fila valida tiene fecha numerica y banco o cliente.
    .filter((p) => typeof p.fecha === 'number' && (p.id_banco || p.id_cliente));

  const db = dbClient();
  await db.connect();

  const batchId = `movimientos-${new Date().toISOString()}`;

  try {
    await db.query('BEGIN');

    const del = await db.query(
      `DELETE FROM external_transactions
       WHERE source_type = 'google_sheet' AND source_account = 'MOVIMIENTOS'`,
    );

    const CHUNK = 500;
    let inserted = 0;
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
      const r = await db.query(
        `INSERT INTO external_transactions
           (source_type, source_account, external_id, effective_at, direction,
            native_currency, native_amount, description, raw_payload, import_batch_id)
         VALUES ${tuples.join(', ')}`,
        values,
      );
      inserted += r.rowCount ?? 0;
    }

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('importer', 'import-movimientos', 'import_movimientos_snapshot', 'import_run', $1, $2)`,
      [batchId, JSON.stringify({ rows_read: rows.length, rows_valid: records.length, deleted_previous: del.rowCount, inserted })],
    );

    await db.query('COMMIT');
    console.log(`Filas leidas: ${rows.length} | validas: ${records.length}`);
    console.log(`Snapshot anterior borrado: ${del.rowCount} filas | insertadas: ${inserted}`);
    console.log(`Batch: ${batchId}`);
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
