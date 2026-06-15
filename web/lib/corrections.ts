// Cambios propuestos para la hoja MOVIMIENTOS. El sistema NO escribe en el
// Sheet: genera una lista de trabajo que un humano aplica a mano y reimporta.
import { pool } from './db';

export type Correction = {
  id: number;
  sheet: string;
  row: number | null;
  column: string;
  current: string | null;
  proposed: string | null;
  reason: string | null;
  locator: Record<string, unknown>;
  status: string;
  createdAt: string;
};

// Crea una correccion a partir de una reconciliacion, dentro de una transaccion.
// adjust: 'date' alinea la fecha del libro a la del estado de cuenta;
//         'amount' alinea el monto del libro al del estado de cuenta.
export async function createCorrectionForRecon(
  client: any, reconId: number, adjust: 'date' | 'amount', actor: string,
): Promise<number> {
  const r = (
    await client.query(
      `SELECT fm.id fmid, (fm.source_payload->>'row_number')::int rn, fm.effective_at::date::text lf,
              fm.direction, fm.usd_amount::text lamt,
              fm.source_payload->>'banco' banco, fm.source_payload->>'nombre' nombre,
              fm.source_payload->>'operacion' operacion,
              (et.effective_at AT TIME ZONE 'America/Caracas')::date::text ef, et.native_amount::text eamt
       FROM reconciliations rc
       JOIN fund_movements fm ON fm.id=rc.fund_movement_id
       JOIN external_transactions et ON et.id=rc.external_transaction_id
       WHERE rc.id=$1`,
      [reconId],
    )
  ).rows[0];
  if (!r) return 0;

  let column: string, current: string, proposed: string, reason: string;
  if (adjust === 'date') {
    if (r.lf === r.ef) return 0; // sin diferencia
    column = 'Fecha';
    current = r.lf;
    proposed = r.ef;
    reason = 'Alinear la fecha del libro a la del estado de cuenta de Binance';
  } else {
    if (Math.abs(Number(r.lamt) - Number(r.eamt)) < 0.005) return 0;
    column = r.direction === 'inflow' ? 'Monto Credito' : 'Monto Debito';
    current = r.direction === 'inflow' ? r.lamt : String(-Math.abs(Number(r.lamt)));
    proposed = r.direction === 'inflow' ? r.eamt : String(-Math.abs(Number(r.eamt)));
    reason = 'Alinear el monto del libro al del estado de cuenta de Binance';
  }

  const locator = {
    row_number: r.rn, fecha: r.lf, banco: r.banco, nombre: r.nombre,
    monto: r.lamt, operacion: r.operacion,
  };

  const ins = await client.query(
    `INSERT INTO sheet_corrections
       (sheet, source_row_number, fund_movement_id, reconciliation_id, column_name,
        current_value, proposed_value, locator, reason, created_by)
     VALUES ('MOVIMIENTOS', $1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (sheet, source_row_number, column_name, status) DO NOTHING`,
    [r.rn, r.fmid, reconId, column, current, proposed, JSON.stringify(locator), reason, actor],
  );
  return ins.rowCount ?? 0;
}

export async function listCorrections(status = 'pending'): Promise<Correction[]> {
  const rows = await pool.query(
    `SELECT id, sheet, source_row_number, column_name, current_value, proposed_value,
            reason, locator, status, created_at::text
     FROM sheet_corrections WHERE status=$1 ORDER BY source_row_number`,
    [status],
  );
  return rows.rows.map((r: any) => ({
    id: r.id, sheet: r.sheet, row: r.source_row_number, column: r.column_name,
    current: r.current_value, proposed: r.proposed_value, reason: r.reason,
    locator: r.locator, status: r.status, createdAt: r.created_at,
  }));
}

export async function setCorrectionStatus(
  ids: number[], status: 'applied' | 'dismissed', actor = 'app_web',
): Promise<number> {
  if (ids.length === 0) return 0;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE sheet_corrections SET status=$2,
          applied_by = CASE WHEN $2='applied' THEN $3 ELSE applied_by END,
          applied_at = CASE WHEN $2='applied' THEN now() ELSE applied_at END,
          updated_at = now()
       WHERE id = ANY($1) AND status='pending' RETURNING id`,
      [ids, status, actor],
    );
    await client.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('user', $1, $2, 'sheet_correction', 'MOVIMIENTOS', $3)`,
      [actor, status === 'applied' ? 'apply_sheet_correction' : 'dismiss_sheet_correction',
       JSON.stringify({ ids: upd.rows.map((x: any) => x.id) })],
    );
    await client.query('COMMIT');
    return upd.rowCount ?? 0;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function pendingCount(): Promise<number> {
  const r = await pool.query(`SELECT count(*)::int n FROM sheet_corrections WHERE status='pending'`);
  return r.rows[0].n;
}
