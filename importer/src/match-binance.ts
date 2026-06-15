// Motor de conciliacion BINANCE CH: cruza los movimientos del libro
// (fund_movements de la cuenta BINANCE CH) contra el estado de cuenta oficial
// relevante (external_transactions binance_statement). Genera sugerencias en
// reconciliations (status 'suggested') para aprobacion humana. No confirma nada.
//
// Estrategia: no hay referencia compartida entre libro y estado de cuenta, asi
// que se cruza por monto exacto + direccion + cercania de fecha, en pasadas de
// confianza decreciente, consumiendo 1:1 (cada fila se usa una sola vez).
import { dbClient } from './db.js';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayDiff = (a: string, b: string) =>
  Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);

type Ledger = { id: number; date: string; direction: string; amount: number; nombre: string | null };
type Stmt = { id: number; date: string; direction: string; amount: number; operation: string };

// Pasadas: cada una con tolerancia de dias y confianza.
const PASSES = [
  { maxDays: 0, confidence: 0.99, reason: 'monto y fecha exactos, misma direccion' },
  { maxDays: 1, confidence: 0.9, reason: 'monto exacto, misma direccion, fecha +-1 dia' },
  { maxDays: 3, confidence: 0.75, reason: 'monto exacto, misma direccion, fecha +-3 dias' },
];

async function main() {
  const db = dbClient();
  await db.connect();

  const ledgerRes = await db.query(
    `SELECT fm.id, fm.effective_at::date::text AS date, fm.direction,
            fm.usd_amount::float8 AS amount, fm.source_payload->>'nombre' AS nombre
     FROM fund_movements fm
     WHERE fm.account_id = (SELECT id FROM accounts WHERE name='BINANCE CH')
       AND fm.status <> 'voided'
       AND NOT EXISTS (SELECT 1 FROM reconciliations r
                       WHERE r.fund_movement_id = fm.id AND r.status <> 'rejected')`,
  );
  const stmtRes = await db.query(
    `SELECT et.id,
            (et.effective_at AT TIME ZONE 'America/Caracas')::date::text AS date,
            et.direction, et.native_amount::float8 AS amount,
            et.raw_payload->>'operation' AS operation
     FROM external_transactions et
     WHERE et.source_type='binance_statement' AND et.source_account='BINANCE CH'
       AND (et.raw_payload->>'relevant')::boolean
       AND NOT EXISTS (SELECT 1 FROM reconciliations r
                       WHERE r.external_transaction_id = et.id AND r.status <> 'rejected')`,
  );

  const ledger: Ledger[] = ledgerRes.rows.map((r) => ({ ...r, amount: round2(r.amount) }));
  const stmt: Stmt[] = stmtRes.rows.map((r) => ({ ...r, amount: round2(r.amount) }));

  // Indice de statement por clave monto|direccion para busqueda rapida.
  const stmtByKey = new Map<string, Stmt[]>();
  for (const s of stmt) {
    const k = `${s.amount}|${s.direction}`;
    (stmtByKey.get(k) ?? stmtByKey.set(k, []).get(k)!).push(s);
  }

  const usedStmt = new Set<number>();
  const matches: { ledgerId: number; stmtId: number; amount: number; confidence: number; reason: string }[] = [];

  for (const pass of PASSES) {
    for (const l of ledger) {
      if (matches.some((m) => m.ledgerId === l.id)) continue;
      const candidates = (stmtByKey.get(`${l.amount}|${l.direction}`) ?? [])
        .filter((s) => !usedStmt.has(s.id) && dayDiff(l.date, s.date) <= pass.maxDays)
        .sort((a, b) => dayDiff(l.date, a.date) - dayDiff(l.date, b.date));
      const best = candidates[0];
      if (best) {
        usedStmt.add(best.id);
        matches.push({ ledgerId: l.id, stmtId: best.id, amount: l.amount, confidence: pass.confidence, reason: pass.reason });
      }
    }
  }

  // Persistir sugerencias.
  try {
    await db.query('BEGIN');
    let inserted = 0;
    for (const m of matches) {
      const r = await db.query(
        `INSERT INTO reconciliations
           (fund_movement_id, external_transaction_id, allocated_native_amount, status, confidence, reasons)
         VALUES ($1, $2, $3, 'suggested', $4, $5)
         ON CONFLICT (fund_movement_id, external_transaction_id) DO NOTHING`,
        [m.ledgerId, m.stmtId, m.amount, m.confidence, JSON.stringify([m.reason])],
      );
      inserted += r.rowCount ?? 0;
    }
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('agent', 'match-binance', 'suggest_reconciliations', 'account', 'BINANCE CH', $1)`,
      [JSON.stringify({
        ledger_unmatched_before: ledger.length, stmt_relevant_unmatched_before: stmt.length,
        suggested: inserted,
      })],
    );
    await db.query('COMMIT');

    const byConf = new Map<number, number>();
    for (const m of matches) byConf.set(m.confidence, (byConf.get(m.confidence) ?? 0) + 1);

    console.log(`Libro BINANCE CH sin conciliar: ${ledger.length}`);
    console.log(`Estado de cuenta relevante sin conciliar: ${stmt.length}`);
    console.log(`\nSugerencias creadas: ${inserted}`);
    for (const [c, n] of [...byConf].sort((a, b) => b[0] - a[0])) console.log(`  confianza ${c}: ${n}`);
    console.log(`\nLibro sin pareja (registrado en mesa, no en Binance): ${ledger.length - matches.length}`);
    console.log(`Estado de cuenta sin pareja (en Binance, no en mesa): ${stmt.length - matches.length}`);
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
