// Reporte de conciliacion BINANCE CH: resumen de sugerencias y lista de
// pendientes a revisar por un humano. Solo lectura.
import { dbClient } from './db.js';

async function main() {
  const db = dbClient();
  await db.connect();

  const summary = await db.query(`
    SELECT confidence, count(*) n, round(SUM(allocated_native_amount),2) monto
    FROM reconciliations r
    JOIN fund_movements fm ON fm.id=r.fund_movement_id
    WHERE fm.account_id=(SELECT id FROM accounts WHERE name='BINANCE CH')
    GROUP BY confidence ORDER BY confidence DESC`);

  console.log('=== Sugerencias de conciliacion BINANCE CH (status suggested) ===');
  for (const r of summary.rows) console.log(`  confianza ${r.confidence}: ${r.n} (USDT ${r.monto})`);

  const ledgerUnm = await db.query(`
    SELECT effective_at::date d, direction, usd_amount, source_payload->>'nombre' nombre
    FROM fund_movements fm
    WHERE fm.account_id=(SELECT id FROM accounts WHERE name='BINANCE CH') AND fm.status<>'voided'
      AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status<>'rejected')
    ORDER BY effective_at`);

  const stmtUnm = await db.query(`
    SELECT (effective_at AT TIME ZONE 'America/Caracas')::date d, direction, native_amount,
           raw_payload->>'operation' op, raw_payload->>'remark' remark
    FROM external_transactions et
    WHERE source_type='binance_statement' AND source_account='BINANCE CH'
      AND (raw_payload->>'relevant')::boolean
      AND (effective_at AT TIME ZONE 'America/Caracas')::date >= '2026-01-01'
      AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.external_transaction_id=et.id AND r.status<>'rejected')
    ORDER BY effective_at`);

  console.log(`\n=== Libro sin pareja: ${ledgerUnm.rows.length} (registrado en mesa, falta en Binance) ===`);
  console.log('  (posibles: P2P dividido en varias ordenes, error de registro, o monto con diferencia)');
  for (const r of ledgerUnm.rows.slice(0, 25))
    console.log(`  ${r.d} ${r.direction.padEnd(7)} ${String(r.usd_amount).padStart(12)} ${r.nombre ?? ''}`);
  if (ledgerUnm.rows.length > 25) console.log(`  ... y ${ledgerUnm.rows.length - 25} mas`);

  console.log(`\n=== Estado de cuenta 2026 sin pareja: ${stmtUnm.rows.length} (en Binance, falta en mesa) ===`);
  const byOp = new Map<string, number>();
  for (const r of stmtUnm.rows) byOp.set(r.op, (byOp.get(r.op) ?? 0) + 1);
  for (const [op, n] of [...byOp].sort((a, b) => b[1] - a[1])) console.log(`  ${op}: ${n}`);

  await db.end();
}

main().catch((err) => { console.error('Error:', err.message ?? err); process.exit(1); });
