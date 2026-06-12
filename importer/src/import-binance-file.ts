// Importa un estado de cuenta oficial de Binance (xlsx exportado de binance.com)
// a external_transactions (source_type binance_statement, source_account BINANCE CH).
// Aplica las reglas de binance-rules.ts y guarda cada fila cruda con su marca
// de relevancia. Reemplaza el snapshot anterior de esta fuente.
//
// Uso: npx tsx src/import-binance-file.ts <ruta-al-xlsx>
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { dbClient } from './db.js';
import { isRelevant, fixedClientName } from './binance-rules.js';

const SOURCE_TYPE = 'binance_statement';
const SOURCE_ACCOUNT = 'BINANCE CH';

const filePath = process.argv[2];
if (!filePath) {
  console.error('Uso: npx tsx src/import-binance-file.ts <ruta-al-xlsx>');
  process.exit(1);
}

// El export trae "YY(YY)-MM-DD HH:mm:ss" en hora UTC-4.
function parseTime(v: unknown): string | null {
  const m = String(v ?? '').match(/^(\d{2,4})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  const year = m[1].length === 2 ? `20${m[1]}` : m[1];
  return `${year}-${m[2]}-${m[3]}T${m[4]}-04:00`;
}

async function main() {
  const wb = XLSX.read(readFileSync(filePath));
  const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });

  const records: {
    externalId: string; effectiveAt: string; direction: string; coin: string;
    amount: number; payload: Record<string, unknown>;
  }[] = [];
  let relevantCount = 0;

  for (const [i, r] of rows.entries()) {
    const time = parseTime(r[1]);
    const change = Number(r[7]);
    if (!time || !Number.isFinite(change) || change === 0) continue;
    const row = {
      account: String(r[3] ?? '').trim(),
      operation: String(r[4] ?? '').trim(),
      coin: String(r[6] ?? '').trim(),
    };
    const relevant = isRelevant(row);
    if (relevant) relevantCount++;
    records.push({
      externalId: String(i + 1),
      effectiveAt: time,
      direction: change > 0 ? 'inflow' : 'outflow',
      coin: row.coin,
      amount: Math.abs(change),
      payload: {
        row_number: i + 1,
        user_id: r[0] ?? null,
        time: r[1],
        account: row.account,
        operation: row.operation,
        coin: row.coin,
        change,
        remark: r[9] ?? null,
        relevant,
        fixed_client: fixedClientName(row),
        file: filePath.split('/').pop(),
      },
    });
  }

  const db = dbClient();
  await db.connect();
  const batchId = `binance-file-${new Date().toISOString()}`;

  try {
    await db.query('BEGIN');
    const del = await db.query(
      `DELETE FROM external_transactions WHERE source_type = $1 AND source_account = $2`,
      [SOURCE_TYPE, SOURCE_ACCOUNT],
    );

    const CHUNK = 500;
    let inserted = 0;
    for (let i = 0; i < records.length; i += CHUNK) {
      const chunk = records.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((rec, j) => {
        const b = j * 6;
        values.push(rec.externalId, rec.effectiveAt, rec.direction, rec.coin, rec.amount, JSON.stringify(rec.payload));
        return `('${SOURCE_TYPE}', '${SOURCE_ACCOUNT}', $${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, '${batchId}')`;
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
       VALUES ('importer', 'import-binance-file', 'import_binance_statement', 'import_run', $1, $2)`,
      [batchId, JSON.stringify({ file: filePath, rows_read: rows.length, inserted, relevant: relevantCount, deleted_previous: del.rowCount })],
    );
    await db.query('COMMIT');

    console.log(`Filas insertadas: ${inserted} (reemplazo ${del.rowCount} previas)`);
    console.log(`Relevantes para conciliar BINANCE CH: ${relevantCount}`);
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
