// Aprobacion humana de las sugerencias de conciliacion BINANCE CH.
// Subcomandos:
//   confirm-high            confirma en bloque las sugerencias de confianza >= 0.99
//   review                  lista las sugerencias dudosas (< 0.99) para revisar
//   confirm <id> [id...]    confirma reconciliaciones por id
//   reject  <id> [id...]    rechaza reconciliaciones por id
//
// Al confirmar se marca reconciliations.status='confirmed' (confirmed_by/at) y se
// recalcula el estado de cada fund_movement afectado (reconciled / partially).
// Todo queda auditado. Nada se confirma sin que un humano lo ordene.
import { dbClient } from './db.js';

const ACTOR = process.env.KW2_ACTOR ?? 'carlos';
const TOL = 0.02;

async function affectedMovements(db: any, reconIds: number[]): Promise<number[]> {
  if (reconIds.length === 0) return [];
  const r = await db.query(`SELECT DISTINCT fund_movement_id FROM reconciliations WHERE id = ANY($1)`, [reconIds]);
  return r.rows.map((x: any) => x.fund_movement_id);
}

async function recomputeStatus(db: any, movementIds: number[]) {
  for (const id of movementIds) {
    await db.query(
      `UPDATE fund_movements fm SET status = CASE
         WHEN s.confirmed >= fm.usd_amount - $2 THEN 'reconciled'
         WHEN s.confirmed > 0 THEN 'partially_reconciled'
         ELSE 'posted' END,
         updated_at = now()
       FROM (SELECT COALESCE(SUM(allocated_native_amount),0) confirmed
             FROM reconciliations WHERE fund_movement_id=$1 AND status='confirmed') s
       WHERE fm.id=$1 AND fm.status<>'voided'`,
      [id, TOL],
    );
  }
}

async function setStatus(db: any, ids: number[], status: 'confirmed' | 'rejected') {
  await db.query('BEGIN');
  const upd = await db.query(
    `UPDATE reconciliations SET status=$2,
        confirmed_by = CASE WHEN $2='confirmed' THEN $3 ELSE confirmed_by END,
        confirmed_at = CASE WHEN $2='confirmed' THEN now() ELSE confirmed_at END,
        updated_at = now()
     WHERE id = ANY($1) AND status='suggested'
     RETURNING id`,
    [ids, status, ACTOR],
  );
  const changed = upd.rows.map((r: any) => r.id);
  await recomputeStatus(db, await affectedMovements(db, changed));
  await db.query(
    `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
     VALUES ('user', $1, $2, 'reconciliation', 'BINANCE CH', $3)`,
    [ACTOR, status === 'confirmed' ? 'confirm_reconciliations' : 'reject_reconciliations', JSON.stringify({ ids: changed })],
  );
  await db.query('COMMIT');
  return changed.length;
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const db = dbClient();
  await db.connect();
  const accId = (await db.query(`SELECT id FROM accounts WHERE name='BINANCE CH'`)).rows[0].id;

  try {
    if (cmd === 'confirm-high') {
      const ids = (await db.query(
        `SELECT r.id FROM reconciliations r JOIN fund_movements fm ON fm.id=r.fund_movement_id
         WHERE fm.account_id=$1 AND r.status='suggested' AND r.confidence >= 0.99`,
        [accId],
      )).rows.map((x: any) => x.id);
      const n = await setStatus(db, ids, 'confirmed');
      console.log(`Confirmadas ${n} reconciliaciones de confianza >= 0.99.`);
    } else if (cmd === 'review') {
      const rows = (await db.query(
        `SELECT r.id, r.confidence, r.reasons->>0 motivo, r.allocated_native_amount alloc,
                fm.effective_at::date lf, fm.direction ld, fm.usd_amount lmonto, fm.source_payload->>'nombre' nombre,
                (et.effective_at AT TIME ZONE 'America/Caracas')::date ef, et.raw_payload->>'operation' eop,
                et.native_amount emonto, et.raw_payload->>'remark' remark
         FROM reconciliations r
         JOIN fund_movements fm ON fm.id=r.fund_movement_id
         JOIN external_transactions et ON et.id=r.external_transaction_id
         WHERE fm.account_id=$1 AND r.status='suggested' AND r.confidence < 0.99
         ORDER BY r.confidence, fm.effective_at`,
        [accId],
      )).rows;
      console.log(`Sugerencias dudosas a revisar: ${rows.length}\n`);
      for (const r of rows) {
        console.log(`#${r.id} conf ${r.confidence} | ${r.motivo}`);
        const alloc = Number(r.alloc) !== Number(r.emonto) ? ` (asigna ${r.alloc})` : '';
        console.log(`   LIBRO  ${r.lf} ${r.ld} ${r.lmonto} ${r.nombre ?? ''}`);
        console.log(`   ESTADO ${r.ef} ${r.eop} ${r.emonto}${alloc} ${r.remark ?? ''}`);
      }
      console.log(`\nConfirmar:  npx tsx src/confirm-binance.ts confirm <id> [id...]`);
      console.log(`Rechazar:   npx tsx src/confirm-binance.ts reject <id> [id...]`);
    } else if (cmd === 'confirm' || cmd === 'reject') {
      const ids = args.map(Number).filter(Number.isFinite);
      if (ids.length === 0) { console.error('Indica al menos un id.'); process.exit(1); }
      const n = await setStatus(db, ids, cmd === 'confirm' ? 'confirmed' : 'rejected');
      console.log(`${cmd === 'confirm' ? 'Confirmadas' : 'Rechazadas'} ${n} reconciliaciones.`);
    } else {
      console.log('Uso: confirm-high | review | confirm <id...> | reject <id...>');
    }

    // Estado actual
    const st = await db.query(
      `SELECT r.status, count(*) n FROM reconciliations r JOIN fund_movements fm ON fm.id=r.fund_movement_id
       WHERE fm.account_id=$1 GROUP BY r.status ORDER BY r.status`,
      [accId],
    );
    console.log('\nEstado reconciliaciones BINANCE CH:');
    for (const s of st.rows) console.log(`  ${s.status}: ${s.n}`);
  } catch (err: any) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('Error:', err.message ?? err); process.exit(1); });
