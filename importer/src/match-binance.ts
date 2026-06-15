// Motor de conciliacion BINANCE CH: cruza los movimientos del libro
// (fund_movements de la cuenta BINANCE CH) contra el estado de cuenta oficial
// relevante (external_transactions binance_statement). Genera sugerencias en
// reconciliations (status 'suggested') para aprobacion humana. No confirma nada.
//
// No hay referencia compartida entre libro y estado de cuenta, asi que se cruza
// por monto + direccion + cercania de fecha, en este orden:
//   1. 1:1 exacto (fecha exacta, luego +-1 y +-3 dias).
//   2. 1:1 con tolerancia de fee (diferencia <= 0.02 USDT, fee de Binance Pay).
//   3. Por suma: un movimiento del libro = varias filas del estado de cuenta
//      (mismo dia/direccion), y viceversa (pagos divididos).
// Cada fila se usa una sola vez. Regenera las sugerencias 'suggested'; respeta
// las que ya esten 'confirmed' o 'rejected'.
import { dbClient } from './db.js';

const round2 = (n: number) => Math.round(n * 100) / 100;
const dayDiff = (a: string, b: string) => Math.abs((Date.parse(a) - Date.parse(b)) / 86400000);
const FEE_EPS = 0.02;

type Ledger = { id: number; date: string; direction: string; amount: number; nombre: string };
type Stmt = { id: number; date: string; direction: string; amount: number; operation: string };
type Match = { ledgerId: number; stmtId: number; amount: number; confidence: number; reason: string };

// 1:1: pasadas de confianza decreciente.
const PASSES_1TO1 = [
  { maxDays: 0, eps: 0, confidence: 0.99, reason: 'monto y fecha exactos' },
  { maxDays: 1, eps: 0, confidence: 0.9, reason: 'monto exacto, fecha +-1 dia' },
  { maxDays: 0, eps: FEE_EPS, confidence: 0.88, reason: 'monto con tolerancia de fee, misma fecha' },
  { maxDays: 1, eps: FEE_EPS, confidence: 0.82, reason: 'monto con tolerancia de fee, fecha +-1 dia' },
  { maxDays: 3, eps: 0, confidence: 0.75, reason: 'monto exacto, fecha +-3 dias' },
];

// Busca un subconjunto de items (max maxSize) que sume target +- eps.
function findSubset(target: number, items: { id: number; amount: number }[], eps: number, maxSize: number): number[] | null {
  const n = Math.min(items.length, 12);
  const pool = items.slice(0, n);
  const result: number[] = [];
  const rec = (start: number, remaining: number, depth: number): boolean => {
    if (Math.abs(remaining) <= eps && result.length >= 2) return true;
    if (depth >= maxSize || start >= pool.length) return false;
    for (let i = start; i < pool.length; i++) {
      if (pool[i].amount - eps > remaining) continue;
      result.push(pool[i].id);
      if (rec(i + 1, round2(remaining - pool[i].amount), depth + 1)) return true;
      result.pop();
    }
    return false;
  };
  return rec(0, target, 0) ? [...result] : null;
}

async function main() {
  const db = dbClient();
  await db.connect();

  const accId = (await db.query(`SELECT id FROM accounts WHERE name='BINANCE CH'`)).rows[0].id;

  // Regenerar limpio: borrar solo sugerencias no decididas.
  await db.query(
    `DELETE FROM reconciliations r USING fund_movements fm
     WHERE r.fund_movement_id=fm.id AND fm.account_id=$1 AND r.status='suggested'`,
    [accId],
  );

  const ledgerRes = await db.query(
    `SELECT fm.id, fm.effective_at::date::text AS date, fm.direction, fm.usd_amount::float8 AS amount,
            COALESCE(fm.source_payload->>'nombre','') AS nombre
     FROM fund_movements fm
     WHERE fm.account_id=$1 AND fm.status<>'voided'
       AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status<>'rejected')`,
    [accId],
  );
  const stmtRes = await db.query(
    `SELECT et.id, (et.effective_at AT TIME ZONE 'America/Caracas')::date::text AS date,
            et.direction, et.native_amount::float8 AS amount,
            COALESCE(et.raw_payload->>'operation','') AS operation
     FROM external_transactions et
     WHERE et.source_type='binance_statement' AND et.source_account='BINANCE CH'
       AND (et.raw_payload->>'relevant')::boolean
       AND (et.effective_at AT TIME ZONE 'America/Caracas')::date >= '2026-01-01'
       AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.external_transaction_id=et.id AND r.status<>'rejected')`,
  );

  const ledger: Ledger[] = ledgerRes.rows.map((r) => ({ ...r, amount: round2(r.amount) }));
  const stmt: Stmt[] = stmtRes.rows.map((r) => ({ ...r, amount: round2(r.amount) }));

  const usedLedger = new Set<number>();
  const usedStmt = new Set<number>();
  const matches: Match[] = [];

  // --- Fase 1: 1:1 ---
  for (const pass of PASSES_1TO1) {
    for (const l of ledger) {
      if (usedLedger.has(l.id)) continue;
      const best = stmt
        .filter((s) => !usedStmt.has(s.id) && s.direction === l.direction
          && Math.abs(s.amount - l.amount) <= pass.eps && dayDiff(l.date, s.date) <= pass.maxDays)
        .sort((a, b) => (Math.abs(a.amount - l.amount) - Math.abs(b.amount - l.amount))
          || (dayDiff(l.date, a.date) - dayDiff(l.date, b.date)))[0];
      if (best) {
        usedLedger.add(l.id); usedStmt.add(best.id);
        matches.push({ ledgerId: l.id, stmtId: best.id, amount: l.amount, confidence: pass.confidence, reason: pass.reason });
      }
    }
  }

  // --- Fase 1.5: P2P del dia completo ---
  // Caso seguro (sin riesgo de falsos positivos por subconjuntos): cuando hay
  // exactamente UN movimiento del libro 'Binance P2P' sin conciliar en un dia,
  // y la suma de TODAS las P2P Trading del estado de cuenta de ese dia y misma
  // direccion (todas, no un subconjunto) coincide con su monto.
  const isLedgerP2P = (l: Ledger) => l.nombre.toLowerCase().includes('binance p2p');
  const isStmtP2P = (s: Stmt) => s.operation.toLowerCase() === 'p2p trading';
  const dayKey = (date: string, dir: string) => `${date}|${dir}`;

  const ledgerP2PByDay = new Map<string, Ledger[]>();
  for (const l of ledger) {
    if (usedLedger.has(l.id) || !isLedgerP2P(l)) continue;
    const k = dayKey(l.date, l.direction);
    (ledgerP2PByDay.get(k) ?? ledgerP2PByDay.set(k, []).get(k)!).push(l);
  }
  for (const [k, ls] of ledgerP2PByDay) {
    if (ls.length !== 1) continue; // ambiguo: mas de un movimiento del libro ese dia
    const l = ls[0];
    const [date, dir] = k.split('|');
    const dayStmt = stmt.filter((s) => !usedStmt.has(s.id) && isStmtP2P(s) && s.date === date && s.direction === dir);
    if (dayStmt.length < 2) continue; // si es 1 ya lo cubrio la fase 1:1
    const sum = round2(dayStmt.reduce((a, s) => a + s.amount, 0));
    if (Math.abs(sum - l.amount) <= FEE_EPS) {
      usedLedger.add(l.id);
      for (const s of dayStmt) {
        usedStmt.add(s.id);
        matches.push({ ledgerId: l.id, stmtId: s.id, amount: s.amount, confidence: 0.9,
          reason: `P2P del dia completo: ${dayStmt.length} ordenes del estado de cuenta suman el movimiento del libro` });
      }
    }
  }

  // --- Fase 2: por suma (divididos) ---
  for (const maxDays of [0, 1]) {
    const conf = maxDays === 0 ? 0.8 : 0.7;
    // 2a. un movimiento del libro = varias filas del estado de cuenta
    for (const l of ledger) {
      if (usedLedger.has(l.id)) continue;
      const cand = stmt.filter((s) => !usedStmt.has(s.id) && s.direction === l.direction && dayDiff(l.date, s.date) <= maxDays)
        .sort((a, b) => b.amount - a.amount);
      const subset = findSubset(l.amount, cand, FEE_EPS, 4);
      if (subset) {
        usedLedger.add(l.id);
        for (const sid of subset) {
          usedStmt.add(sid);
          const s = stmt.find((x) => x.id === sid)!;
          matches.push({ ledgerId: l.id, stmtId: sid, amount: s.amount, confidence: conf,
            reason: `libro dividido en ${subset.length} ordenes del estado de cuenta${maxDays ? ' (fecha +-1 dia)' : ''}` });
        }
      }
    }
    // 2b. una fila del estado de cuenta = varios movimientos del libro
    for (const s of stmt) {
      if (usedStmt.has(s.id)) continue;
      const cand = ledger.filter((l) => !usedLedger.has(l.id) && l.direction === s.direction && dayDiff(s.date, l.date) <= maxDays)
        .sort((a, b) => b.amount - a.amount);
      const subset = findSubset(s.amount, cand, FEE_EPS, 4);
      if (subset) {
        usedStmt.add(s.id);
        for (const lid of subset) {
          usedLedger.add(lid);
          const l = ledger.find((x) => x.id === lid)!;
          matches.push({ ledgerId: lid, stmtId: s.id, amount: l.amount, confidence: conf,
            reason: `fila del estado de cuenta cubre ${subset.length} movimientos del libro${maxDays ? ' (fecha +-1 dia)' : ''}` });
        }
      }
    }
  }

  // Persistir.
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
      [JSON.stringify({ ledger_unmatched_before: ledger.length, stmt_unmatched_before: stmt.length, suggested: inserted })],
    );
    await db.query('COMMIT');

    const byConf = new Map<number, number>();
    for (const m of matches) byConf.set(m.confidence, (byConf.get(m.confidence) ?? 0) + 1);
    console.log(`Libro BINANCE CH sin conciliar (inicio): ${ledger.length}`);
    console.log(`Estado de cuenta 2026 relevante sin conciliar (inicio): ${stmt.length}`);
    console.log(`\nSugerencias creadas: ${inserted}`);
    for (const [c, n] of [...byConf].sort((a, b) => b[0] - a[0])) console.log(`  confianza ${c}: ${n}`);
    console.log(`\nLibro sin pareja: ${ledger.length - usedLedger.size}`);
    console.log(`Estado de cuenta 2026 sin pareja: ${stmt.length - usedStmt.size}`);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('Error:', err.message ?? err); process.exit(1); });
