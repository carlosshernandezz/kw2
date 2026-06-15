// Conciliacion manual BINANCE CH: el humano decide los matches que el motor
// automatico no puede resolver, y marca las discrepancias.
import { pool } from './db';
import { accountId } from './reconciliation';

const ACTOR = 'app_web';
const TOL = 0.02;

export type LedgerRow = { id: number; date: string; direction: string; amount: string; nombre: string | null; row: number | null };
export type StmtRow = { id: number; date: string; direction: string; amount: string; operation: string; remark: string | null };

// Movimientos del libro sin conciliar y sin marca de discrepancia.
export async function unmatchedLedger(): Promise<LedgerRow[]> {
  const accId = await accountId();
  const r = await pool.query(
    `SELECT fm.id, fm.effective_at::date::text date, fm.direction, fm.usd_amount::text amount,
            fm.source_payload->>'nombre' nombre, (fm.source_payload->>'row_number')::int row
     FROM fund_movements fm
     WHERE fm.account_id=$1 AND fm.status<>'voided'
       AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status<>'rejected')
       AND NOT EXISTS (SELECT 1 FROM reconciliation_marks m WHERE m.entity_type='fund_movement' AND m.entity_id=fm.id AND m.status='active')
     ORDER BY fm.effective_at, fm.usd_amount DESC`,
    [accId],
  );
  return r.rows;
}

// Filas del estado de cuenta relevantes (2026) sin conciliar y sin marca.
export async function unmatchedStatement(): Promise<StmtRow[]> {
  const r = await pool.query(
    `SELECT et.id, (et.effective_at AT TIME ZONE 'America/Caracas')::date::text date, et.direction,
            et.native_amount::text amount, et.raw_payload->>'operation' operation, et.raw_payload->>'remark' remark
     FROM external_transactions et
     WHERE et.source_type='binance_statement' AND et.source_account='BINANCE CH'
       AND (et.raw_payload->>'relevant')::boolean
       AND (et.effective_at AT TIME ZONE 'America/Caracas')::date >= '2026-01-01'
       AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.external_transaction_id=et.id AND r.status<>'rejected')
       AND NOT EXISTS (SELECT 1 FROM reconciliation_marks m WHERE m.entity_type='external_transaction' AND m.entity_id=et.id AND m.status='active')
     ORDER BY et.effective_at, et.native_amount DESC`,
  );
  return r.rows;
}

// Conciliacion manual: une un conjunto de filas del libro con uno del estado de
// cuenta. Se exige que un lado sea exactamente una fila (1:1, N:1 o 1:N) y que
// los totales coincidan. Crea reconciliations 'confirmed'.
export async function manualMatch(ledgerIds: number[], stmtIds: number[], actor = ACTOR): Promise<{ ok: boolean; error?: string }> {
  if (ledgerIds.length === 0 || stmtIds.length === 0) return { ok: false, error: 'Selecciona filas en ambos lados.' };
  if (ledgerIds.length > 1 && stmtIds.length > 1) return { ok: false, error: 'Un lado debe ser una sola fila (1:1, varias→1 o 1→varias).' };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const led = (await client.query(`SELECT id, usd_amount::float8 amt, direction FROM fund_movements WHERE id=ANY($1)`, [ledgerIds])).rows;
    const stm = (await client.query(`SELECT id, native_amount::float8 amt, direction FROM external_transactions WHERE id=ANY($1)`, [stmtIds])).rows;
    const sumL = led.reduce((a, r) => a + r.amt, 0);
    const sumS = stm.reduce((a, r) => a + r.amt, 0);
    if (Math.abs(sumL - sumS) > TOL) {
      await client.query('ROLLBACK');
      return { ok: false, error: `Los totales no coinciden: libro ${sumL.toFixed(2)} vs estado ${sumS.toFixed(2)}.` };
    }
    const dirsL = new Set(led.map((r) => r.direction));
    const dirsS = new Set(stm.map((r) => r.direction));
    if (dirsL.size > 1 || dirsS.size > 1 || [...dirsL][0] !== [...dirsS][0]) {
      await client.query('ROLLBACK');
      return { ok: false, error: 'Las direcciones (entra/sale) no coinciden.' };
    }

    const pairs: [number, number, number][] =
      stmtIds.length === 1
        ? led.map((l) => [l.id, stmtIds[0], l.amt]) // N:1
        : stm.map((s) => [ledgerIds[0], s.id, s.amt]); // 1:N
    for (const [fm, et, alloc] of pairs) {
      await client.query(
        `INSERT INTO reconciliations (fund_movement_id, external_transaction_id, allocated_native_amount, status, confidence, reasons, confirmed_by, confirmed_at)
         VALUES ($1,$2,$3,'confirmed',1.0,$4,$5,now())
         ON CONFLICT (fund_movement_id, external_transaction_id) DO UPDATE SET status='confirmed', updated_at=now()`,
        [fm, et, alloc, JSON.stringify(['conciliación manual']), actor],
      );
    }
    for (const id of ledgerIds) {
      await client.query(
        `UPDATE fund_movements fm SET status = CASE
           WHEN s.c >= fm.usd_amount - $2 THEN 'reconciled' WHEN s.c > 0 THEN 'partially_reconciled' ELSE 'posted' END, updated_at=now()
         FROM (SELECT COALESCE(SUM(allocated_native_amount),0) c FROM reconciliations WHERE fund_movement_id=$1 AND status='confirmed') s
         WHERE fm.id=$1`,
        [id, TOL],
      );
    }
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('user',$1,'manual_reconcile','account','BINANCE CH',$2)`,
      [actor, JSON.stringify({ ledgerIds, stmtIds })],
    );
    await client.query('COMMIT');
    return { ok: true };
  } catch (e: any) {
    await client.query('ROLLBACK');
    return { ok: false, error: e.message };
  } finally {
    client.release();
  }
}

// Marca movimientos del libro como sin contraparte en el estado de cuenta.
export async function markLedgerNoCounterpart(ids: number[], actor = ACTOR): Promise<number> {
  if (ids.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const id of ids) {
      const r = await client.query(
        `INSERT INTO reconciliation_marks (entity_type, entity_id, mark, created_by)
         VALUES ('fund_movement',$1,'no_statement_counterpart',$2)
         ON CONFLICT DO NOTHING`,
        [id, actor],
      );
      n += r.rowCount ?? 0;
    }
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('user',$1,'mark_no_statement_counterpart','fund_movement','BINANCE CH',$2)`,
      [actor, JSON.stringify({ ids })],
    );
    await client.query('COMMIT');
    return n;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

// Marca filas del estado de cuenta como faltantes en MOVIMIENTOS y crea la
// correccion "agregar fila" para la hoja.
export async function markStatementMissingInSheet(ids: number[], actor = ACTOR): Promise<number> {
  if (ids.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let n = 0;
    for (const id of ids) {
      const m = await client.query(
        `INSERT INTO reconciliation_marks (entity_type, entity_id, mark, created_by)
         VALUES ('external_transaction',$1,'missing_in_sheet',$2)
         ON CONFLICT DO NOTHING RETURNING id`,
        [id, actor],
      );
      if (m.rowCount === 0) continue; // ya marcada
      n++;
      const et = (
        await client.query(
          `SELECT (effective_at AT TIME ZONE 'America/Caracas')::date::text d, direction, native_amount::text amt,
                  raw_payload->>'operation' op, raw_payload->>'remark' remark
           FROM external_transactions WHERE id=$1`,
          [id],
        )
      ).rows[0];
      const dir = et.direction === 'inflow' ? 'Ingreso' : 'Egreso';
      const desc = `${et.d} · BINANCE CH · ${dir} ${et.amt} USDT · ${et.op}${et.remark ? ' · ' + et.remark : ''}`;
      await client.query(
        `INSERT INTO sheet_corrections (sheet, kind, column_name, current_value, proposed_value, locator, reason, created_by)
         VALUES ('MOVIMIENTOS','add_row','(fila nueva)', NULL, $1, $2, $3, $4)`,
        [desc, JSON.stringify({ external_transaction_id: id, ...et }),
         'Existe en el estado de cuenta de Binance pero falta en MOVIMIENTOS; agregar la fila (definir el cliente)', actor],
      );
    }
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('user',$1,'mark_missing_in_sheet','external_transaction','BINANCE CH',$2)`,
      [actor, JSON.stringify({ ids })],
    );
    await client.query('COMMIT');
    return n;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
