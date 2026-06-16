// Herramientas deterministas del agente (Nivel 1, solo lectura). El agente NO
// inventa numeros: llama estas funciones que consultan la base y devuelven el
// resultado con evidencia (las filas que lo forman). Tambien las usa la web.
import { pool } from './db';

const BASE = `fm.source='google_sheet_movimientos' AND fm.status<>'voided'`;

export type ClientMovement = {
  date: string; account: string; medium: string; direction: string;
  usd: number; kw2id: string | null; reconciled: boolean;
};
export type ClientDetail = {
  legacyId: string; name: string; kind: string; balance: number;
  movimientos: ClientMovement[];
};

// Busca clientes por nombre (para resolver "Pedro" -> cliente).
export async function findClients(query: string): Promise<{ legacyId: string; name: string }[]> {
  const r = await pool.query(
    `SELECT legacy_id, name FROM clients
     WHERE legacy_id IS NOT NULL AND name ILIKE '%' || $1 || '%'
     ORDER BY name LIMIT 25`,
    [query],
  );
  return r.rows.map((x: any) => ({ legacyId: x.legacy_id, name: x.name }));
}

// get_client_balance: saldo del cliente + los movimientos que lo forman, con
// evidencia (cuenta, monto, kw2_id, si esta conciliado).
export async function clientDetail(legacyId: string): Promise<ClientDetail | null> {
  const c = (await pool.query(`SELECT id, legacy_id, name, kind FROM clients WHERE legacy_id=$1`, [legacyId])).rows[0];
  if (!c) return null;
  const rows = await pool.query(
    `SELECT fm.effective_at::date::text date, a.name account, a.medium,
            fm.direction, fm.usd_amount::float8 usd, fm.kw2_id,
            EXISTS (SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status='confirmed') reconciled
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
     WHERE fm.client_id=$1 AND ${BASE}
     ORDER BY fm.effective_at, fm.id`,
    [c.id],
  );
  const movimientos: ClientMovement[] = rows.rows.map((x: any) => ({
    date: x.date, account: x.account, medium: x.medium, direction: x.direction,
    usd: Math.round(x.usd * 100) / 100, kw2id: x.kw2_id, reconciled: x.reconciled,
  }));
  const balance = movimientos.reduce((s, m) => s + (m.direction === 'inflow' ? m.usd : -m.usd), 0);
  return { legacyId: c.legacy_id, name: c.name, kind: c.kind, balance: Math.round(balance * 100) / 100, movimientos };
}
