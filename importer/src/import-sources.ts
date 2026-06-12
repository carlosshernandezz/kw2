// Snapshots crudos de las fuentes de conciliacion del Sheet "2026 KW2":
//   EDO CTA BS (A:G)        -> external_transactions source_type bank_statement
//   EDO CTA CASH (A:F)      -> external_transactions source_type cash_count
//   Edo cuenta binance      -> external_transactions source_type binance_statement
// Misma estrategia que MOVIMIENTOS: cada corrida reemplaza el snapshot
// anterior de esa fuente y queda auditada. No escribe en el Google Sheet.
import { readRangeSerial, serialToDate } from './sheets.js';
import { dbClient } from './db.js';

type Record_ = {
  externalId: string;
  effectiveAt: string;
  direction: 'inflow' | 'outflow' | null;
  currency: string | null;
  amount: number | null;
  description: string | null;
  payload: Record<string, unknown>;
};

function num(v: unknown): number | null {
  return typeof v === 'number' ? v : null;
}

async function loadEdoCtaBs(): Promise<Record_[]> {
  const rows = await readRangeSerial("'EDO CTA BS'!A2:G100000");
  return rows
    .map((r, i) => ({ r, rowNumber: i + 2 }))
    .filter(({ r }) => typeof r[1] === 'number' && String(r[0] ?? '').trim() !== '')
    .map(({ r, rowNumber }) => {
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
          credito,
          debito,
          saldo: r[6] ?? null,
        },
      };
    });
}

async function loadEdoCtaCash(): Promise<Record_[]> {
  const rows = await readRangeSerial("'EDO CTA CASH'!A2:F100000");
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

// Binance exporta "YY-MM-DD HH:mm:ss" en UTC-4.
function parseBinanceTime(v: unknown): string | null {
  if (typeof v === 'number') return new Date(Math.round((v - 25569) * 86400 * 1000)).toISOString();
  const m = String(v ?? '').match(/^(\d{2})-(\d{2})-(\d{2}) (\d{2}:\d{2}:\d{2})$/);
  if (!m) return null;
  return `20${m[1]}-${m[2]}-${m[3]}T${m[4]}-04:00`;
}

async function loadBinance(): Promise<Record_[]> {
  const rows = await readRangeSerial("'Edo cuenta binance'!A1:N100000");
  const out: Record_[] = [];
  for (const [i, r] of rows.entries()) {
    const time = parseBinanceTime(r[3]);
    const change = num(r[9]);
    if (!time || change == null) continue; // metadatos, encabezados, filas vacias
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

async function main() {
  const sources: { sourceType: string; sourceAccount: string; records: Record_[] }[] = [
    { sourceType: 'bank_statement', sourceAccount: 'EDO CTA BS', records: await loadEdoCtaBs() },
    { sourceType: 'cash_count', sourceAccount: 'EDO CTA CASH', records: await loadEdoCtaCash() },
    { sourceType: 'binance_statement', sourceAccount: 'Edo cuenta binance', records: await loadBinance() },
  ];

  const db = dbClient();
  await db.connect();
  const batchId = `sources-${new Date().toISOString()}`;

  try {
    await db.query('BEGIN');
    for (const { sourceType, sourceAccount, records } of sources) {
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
            sourceType, sourceAccount, rec.externalId, rec.effectiveAt, rec.direction,
            rec.currency, rec.amount, JSON.stringify({ ...rec.payload, description: rec.description }),
          );
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, '${batchId}')`;
        });
        const r = await db.query(
          `INSERT INTO external_transactions
             (source_type, source_account, external_id, effective_at, direction,
              native_currency, native_amount, raw_payload, import_batch_id)
           VALUES ${tuples.join(', ')}`,
          values,
        );
        inserted += r.rowCount ?? 0;
      }
      await db.query(
        `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
         VALUES ('importer', 'import-sources', 'import_source_snapshot', 'import_run', $1, $2)`,
        [batchId, JSON.stringify({ source_type: sourceType, source_account: sourceAccount, deleted_previous: del.rowCount, inserted })],
      );
      console.log(`${sourceAccount}: ${inserted} filas (reemplazo ${del.rowCount} previas)`);
    }
    await db.query('COMMIT');
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
