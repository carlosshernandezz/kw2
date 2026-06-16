// Capa de consultas deterministas (Fase 4). Estas funciones alimentan el
// dashboard ahora y seran las herramientas que use el agente local despues.
// Todo se calcula desde fund_movements (lo que cuadra contra DATA).
import { pool } from './db';

const BASE = `fm.source='google_sheet_movimientos' AND fm.status<>'voided'`;

export type ClientBalance = { legacyId: string; name: string; kind: string; balance: number };
export type AccountBalance = { legacyId: string; name: string; medium: string; balance: number };

// Saldo por cliente = entradas - salidas (USD). Negativo = deudor (debe a KW2),
// positivo = acreedor (KW2 le debe).
export async function clientBalances(): Promise<ClientBalance[]> {
  const r = await pool.query(
    `SELECT c.legacy_id, c.name, c.kind,
            SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END)::float8 balance
     FROM fund_movements fm JOIN clients c ON c.id = fm.client_id
     WHERE ${BASE}
     GROUP BY c.legacy_id, c.name, c.kind`,
  );
  return r.rows
    .map((x: any) => ({ legacyId: x.legacy_id, name: x.name, kind: x.kind, balance: Math.round(x.balance * 100) / 100 }))
    .filter((x) => Math.abs(x.balance) >= 0.005)
    .sort((a, b) => a.balance - b.balance);
}

// Saldo por cuenta = entradas - salidas (USD).
export async function accountBalances(): Promise<AccountBalance[]> {
  const r = await pool.query(
    `SELECT a.legacy_id, a.name, a.medium,
            SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END)::float8 balance
     FROM fund_movements fm JOIN accounts a ON a.id = fm.account_id
     WHERE ${BASE}
     GROUP BY a.legacy_id, a.name, a.medium
     ORDER BY a.name`,
  );
  return r.rows.map((x: any) => ({ legacyId: x.legacy_id, name: x.name, medium: x.medium, balance: Math.round(x.balance * 100) / 100 }));
}

export type Kpis = {
  totalDeudores: number; totalAcreedores: number;
  clientesDeudores: number; clientesAcreedores: number;
  porMedio: { medium: string; balance: number }[];
  movimientos: number;
};

export async function kpis(): Promise<Kpis> {
  const clients = await clientBalances();
  const real = clients.filter((c) => c.kind === 'client');
  const totalDeudores = real.filter((c) => c.balance < 0).reduce((a, c) => a + c.balance, 0);
  const totalAcreedores = real.filter((c) => c.balance > 0).reduce((a, c) => a + c.balance, 0);

  const accts = await accountBalances();
  const byMedium = new Map<string, number>();
  for (const a of accts) byMedium.set(a.medium, (byMedium.get(a.medium) ?? 0) + a.balance);

  const mov = await pool.query(`SELECT count(*)::int n FROM fund_movements fm WHERE ${BASE}`);

  return {
    totalDeudores: Math.round(totalDeudores * 100) / 100,
    totalAcreedores: Math.round(totalAcreedores * 100) / 100,
    clientesDeudores: real.filter((c) => c.balance < 0).length,
    clientesAcreedores: real.filter((c) => c.balance > 0).length,
    porMedio: [...byMedium].map(([medium, balance]) => ({ medium, balance: Math.round(balance * 100) / 100 })),
    movimientos: mov.rows[0].n,
  };
}
