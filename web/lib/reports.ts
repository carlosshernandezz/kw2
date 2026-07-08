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

const r2 = (n: number) => Math.round(n * 100) / 100;

export type Kpis = {
  totalDeudores: number; totalAcreedores: number;
  clientesDeudores: number; clientesAcreedores: number;
  porMedio: { medium: string; balance: number }[];
  movimientos: number;
  comisiones: number; gastos: number; utilidad: number;
  controlCero: { name: string; balance: number }[];
};

export type ProfitPeriod = {
  label: string; start: string; end: string; commissions: number; expenses: number; profit: number;
  previousProfit: number; changePct: number | null;
};

export type ProfitPoint = { label: string; profit: number; commissions: number; expenses: number };

export type Dashboard = {
  daily: ProfitPeriod; weekly: ProfitPeriod; monthly: ProfitPeriod;
  dailyTrend: ProfitPoint[]; weeklyTrend: ProfitPoint[]; monthlyTrend: ProfitPoint[];
  topDebtors: ClientBalance[]; topCreditors: ClientBalance[];
};

// Utilidad de la mesa = Comisiones cobradas - Gastos pagados.
// En el libro: comisiones van como debitos en la cuenta COMISION (saldo
// negativo) y gastos como creditos en GASTO (saldo positivo).
export async function utilidad(): Promise<{ comisiones: number; gastos: number; utilidad: number }> {
  const r = await pool.query(
    `SELECT a.medium, SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END)::float8 bal
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
     WHERE ${BASE} AND a.medium IN ('commission','expense') GROUP BY a.medium`,
  );
  let comisionBal = 0, gastoBal = 0;
  for (const x of r.rows) { if (x.medium === 'commission') comisionBal = x.bal; else gastoBal = x.bal; }
  const comisiones = -comisionBal; // saldo negativo -> total cobrado positivo
  const gastos = gastoBal;
  return { comisiones: r2(comisiones), gastos: r2(gastos), utilidad: r2(comisiones - gastos) };
}

export async function dashboard(): Promise<Dashboard> {
  const periods = await pool.query(
    `WITH anchor AS (SELECT (now() AT TIME ZONE 'America/Caracas')::date d),
     bounds AS (
       SELECT 'daily' kind, d start_at, d + 1 end_at, d - 1 previous_start FROM anchor
       UNION ALL SELECT 'weekly', date_trunc('week', d)::date, date_trunc('week', d)::date + 7, date_trunc('week', d)::date - 7 FROM anchor
       UNION ALL SELECT 'monthly', date_trunc('month', d)::date, (date_trunc('month', d) + interval '1 month')::date, (date_trunc('month', d) - interval '1 month')::date FROM anchor
     )
     SELECT b.kind, b.start_at::text, (b.end_at - 1)::text end_at,
       COALESCE(SUM(CASE WHEN fm.effective_at >= b.start_at AND fm.effective_at < b.end_at AND a.medium='commission'
         THEN CASE WHEN fm.direction='inflow' THEN -fm.usd_amount ELSE fm.usd_amount END ELSE 0 END),0)::float8 commissions,
       COALESCE(SUM(CASE WHEN fm.effective_at >= b.start_at AND fm.effective_at < b.end_at AND a.medium='expense'
         THEN CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END ELSE 0 END),0)::float8 expenses,
       COALESCE(SUM(CASE WHEN fm.effective_at >= b.previous_start AND fm.effective_at < b.start_at
         THEN CASE WHEN a.medium='commission' THEN CASE WHEN fm.direction='inflow' THEN -fm.usd_amount ELSE fm.usd_amount END
                   WHEN a.medium='expense' THEN CASE WHEN fm.direction='inflow' THEN -fm.usd_amount ELSE fm.usd_amount END ELSE 0 END ELSE 0 END),0)::float8 previous_profit
     FROM bounds b
     LEFT JOIN fund_movements fm ON fm.source='google_sheet_movimientos' AND fm.status<>'voided'
       AND fm.effective_at >= b.previous_start AND fm.effective_at < b.end_at
     LEFT JOIN accounts a ON a.id=fm.account_id AND a.medium IN ('commission','expense')
     GROUP BY b.kind, b.start_at, b.end_at, b.previous_start`,
  );

  const period = (kind: string, label: string): ProfitPeriod => {
    const x = periods.rows.find((row: any) => row.kind === kind);
    const commissions = r2(Number(x.commissions));
    const expenses = r2(Number(x.expenses));
    const profit = r2(commissions - expenses);
    const previousProfit = r2(Number(x.previous_profit));
    return {
      label, start: x.start_at, end: x.end_at, commissions, expenses, profit, previousProfit,
      changePct: Math.abs(previousProfit) < 0.005 ? null : r2(((profit - previousProfit) / Math.abs(previousProfit)) * 100),
    };
  };

  const trend = async (unit: 'day' | 'week' | 'month', count: number) => {
    const result = await pool.query(
      `WITH anchor AS (SELECT date_trunc($1, now() AT TIME ZONE 'America/Caracas')::date d),
       series AS (SELECT generate_series(d - ($2::int - 1) * ('1 ' || $1)::interval, d, ('1 ' || $1)::interval)::date start_at FROM anchor)
       SELECT s.start_at::text,
         COALESCE(SUM(CASE WHEN a.medium='commission' THEN CASE WHEN fm.direction='inflow' THEN -fm.usd_amount ELSE fm.usd_amount END ELSE 0 END),0)::float8 commissions,
         COALESCE(SUM(CASE WHEN a.medium='expense' THEN CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END ELSE 0 END),0)::float8 expenses
       FROM series s LEFT JOIN fund_movements fm ON fm.source='google_sheet_movimientos' AND fm.status<>'voided'
         AND fm.effective_at >= s.start_at AND fm.effective_at < s.start_at + ('1 ' || $1)::interval
       LEFT JOIN accounts a ON a.id=fm.account_id AND a.medium IN ('commission','expense')
       GROUP BY s.start_at ORDER BY s.start_at`, [unit, count],
    );
    return result.rows.map((x: any) => {
      const commissions = r2(Number(x.commissions));
      const expenses = r2(Number(x.expenses));
      return { label: x.start_at, commissions, expenses, profit: r2(commissions - expenses) };
    });
  };

  const clients = (await clientBalances()).filter((client) => client.kind === 'client');
  return {
    daily: period('daily', 'Hoy'), weekly: period('weekly', 'Esta semana'), monthly: period('monthly', 'Este mes'),
    dailyTrend: await trend('day', 14), weeklyTrend: await trend('week', 8), monthlyTrend: await trend('month', 6),
    topDebtors: clients.filter((client) => client.balance < 0).slice(0, 5),
    topCreditors: clients.filter((client) => client.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, 5),
  };
}

export async function kpis(): Promise<Kpis> {
  const clients = await clientBalances();
  const real = clients.filter((c) => c.kind === 'client');
  const totalDeudores = real.filter((c) => c.balance < 0).reduce((a, c) => a + c.balance, 0);
  const totalAcreedores = real.filter((c) => c.balance > 0).reduce((a, c) => a + c.balance, 0);

  const accts = await accountBalances();
  const byMedium = new Map<string, number>();
  for (const a of accts) byMedium.set(a.medium, (byMedium.get(a.medium) ?? 0) + a.balance);

  const mov = await pool.query(`SELECT count(*)::int n FROM fund_movements fm WHERE ${BASE}`);
  const u = await utilidad();
  const control = clients.filter((c) => c.kind === 'system').map((c) => ({ name: c.name, balance: c.balance }));

  return {
    totalDeudores: r2(totalDeudores),
    totalAcreedores: r2(totalAcreedores),
    clientesDeudores: real.filter((c) => c.balance < 0).length,
    clientesAcreedores: real.filter((c) => c.balance > 0).length,
    porMedio: [...byMedium].map(([medium, balance]) => ({ medium, balance: r2(balance) })),
    movimientos: mov.rows[0].n,
    comisiones: u.comisiones, gastos: u.gastos, utilidad: u.utilidad,
    controlCero: control,
  };
}
