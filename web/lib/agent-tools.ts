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

// que_falta_conciliar: pendientes de conciliación en BINANCE CH.
export async function unreconciledBinance() {
  const accId = (await pool.query(`SELECT id FROM accounts WHERE name='BINANCE CH'`)).rows[0]?.id;
  const libro = await pool.query(
    `SELECT count(*)::int n FROM fund_movements fm
     WHERE fm.account_id=$1 AND ${BASE}
       AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.fund_movement_id=fm.id AND r.status<>'rejected')
       AND NOT EXISTS (SELECT 1 FROM reconciliation_marks m WHERE m.entity_type='fund_movement' AND m.entity_id=fm.id AND m.status='active')`,
    [accId],
  );
  const estado = await pool.query(
    `SELECT count(*)::int n FROM external_transactions et
     WHERE et.source_type='binance_statement' AND et.source_account='BINANCE CH' AND (et.raw_payload->>'relevant')::boolean
       AND (et.effective_at AT TIME ZONE 'America/Caracas')::date >= '2026-01-01'
       AND NOT EXISTS (SELECT 1 FROM reconciliations r WHERE r.external_transaction_id=et.id AND r.status<>'rejected')
       AND NOT EXISTS (SELECT 1 FROM reconciliation_marks m WHERE m.entity_type='external_transaction' AND m.entity_id=et.id AND m.status='active')`,
  );
  return { cuenta: 'BINANCE CH', movimientos_libro_sin_conciliar: libro.rows[0].n, filas_estado_sin_conciliar: estado.rows[0].n };
}

// zelles_sin_identificar: saldo del cliente "Sin Identificar" + alias pendientes.
export async function unidentifiedZelle() {
  const saldo = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END),0)::float8 s
     FROM fund_movements fm JOIN clients c ON c.id=fm.client_id
     WHERE c.name ILIKE 'sin identificar' AND ${BASE}`,
  );
  const alias = await pool.query(`SELECT count(*)::int n FROM client_aliases WHERE status='unidentified'`);
  return { saldo_sin_identificar_usd: Math.round(saldo.rows[0].s * 100) / 100, alias_zelle_sin_identificar: alias.rows[0].n };
}

// utilidad_mesa: Comisiones - Gastos.
export async function utilidadMesa() {
  const r = await pool.query(
    `SELECT a.medium, SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END)::float8 bal
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
     WHERE ${BASE} AND a.medium IN ('commission','expense') GROUP BY a.medium`,
  );
  let cb = 0, gb = 0;
  for (const x of r.rows) { if (x.medium === 'commission') cb = x.bal; else gb = x.bal; }
  const comisiones = Math.round(-cb * 100) / 100, gastos = Math.round(gb * 100) / 100;
  return { comisiones_cobradas_usd: comisiones, gastos_pagados_usd: gastos, utilidad_usd: Math.round((comisiones - gastos) * 100) / 100 };
}

// utilidad_periodo: Comisiones - Gastos de un día (si se da dia) o un mes.
// Sin parámetros usa el mes con datos más reciente.
export async function utilidadPeriodo(anio?: number, mes?: number, dia?: number) {
  const last = await pool.query(
    `SELECT EXTRACT(YEAR FROM max(effective_at))::int y, EXTRACT(MONTH FROM max(effective_at))::int m
     FROM fund_movements fm WHERE ${BASE}`,
  );
  const y = anio ?? last.rows[0].y;
  const m = mes ?? last.rows[0].m;
  const porDia = !!dia;
  const desde = porDia ? `make_date(${y},${m},${dia})` : `make_date(${y},${m},1)`;
  const paso = porDia ? `interval '1 day'` : `interval '1 month'`;
  const r = await pool.query(
    `SELECT a.medium, SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END)::float8 bal
     FROM fund_movements fm JOIN accounts a ON a.id=fm.account_id
     WHERE ${BASE} AND a.medium IN ('commission','expense')
       AND fm.effective_at >= ${desde} AND fm.effective_at < (${desde} + ${paso})
     GROUP BY a.medium`,
  );
  let cb = 0, gb = 0;
  for (const x of r.rows) { if (x.medium === 'commission') cb = x.bal; else gb = x.bal; }
  const comisiones = Math.round(-cb * 100) / 100, gastos = Math.round(gb * 100) / 100;
  return {
    periodo: porDia ? `${dia}/${m}/${y}` : `${m}/${y}`,
    comisiones_cobradas_usd: comisiones, gastos_pagados_usd: gastos,
    utilidad_usd: Math.round((comisiones - gastos) * 100) / 100,
  };
}

// estado_conciliacion: resumen de conciliación de BINANCE CH.
export async function estadoConciliacion() {
  const accId = (await pool.query(`SELECT id FROM accounts WHERE name='BINANCE CH'`)).rows[0]?.id;
  const total = (await pool.query(`SELECT count(*)::int n FROM fund_movements fm WHERE fm.account_id=$1 AND ${BASE}`, [accId])).rows[0].n;
  const conc = (await pool.query(
    `SELECT count(DISTINCT fm.id)::int n FROM fund_movements fm
     JOIN reconciliations r ON r.fund_movement_id=fm.id AND r.status='confirmed'
     WHERE fm.account_id=$1 AND ${BASE}`, [accId])).rows[0].n;
  const st = await pool.query(
    `SELECT r.status, count(*)::int n FROM reconciliations r JOIN fund_movements fm ON fm.id=r.fund_movement_id
     WHERE fm.account_id=$1 GROUP BY r.status`, [accId]);
  const byStatus: Record<string, number> = {};
  for (const x of st.rows) byStatus[x.status] = x.n;
  return {
    cuenta: 'BINANCE CH', movimientos_libro: total, movimientos_conciliados: conc,
    porcentaje_conciliado: total ? Math.round((conc / total) * 1000) / 10 : 0,
    reconciliaciones_confirmadas: byStatus.confirmed ?? 0,
    reconciliaciones_sugeridas: byStatus.suggested ?? 0,
    reconciliaciones_rechazadas: byStatus.rejected ?? 0,
  };
}

// buscar_duplicados: posibles duplicados (misma fecha, cliente, cuenta, dirección y monto).
export async function buscarDuplicados(limit = 30) {
  const r = await pool.query(
    `SELECT fm.effective_at::date::text fecha, c.name cliente, a.name cuenta, fm.direction, fm.usd_amount::float8 usd,
            count(*)::int veces, array_agg(fm.kw2_id) kw2_ids
     FROM fund_movements fm
     JOIN accounts a ON a.id=fm.account_id
     LEFT JOIN clients c ON c.id=fm.client_id
     WHERE ${BASE}
     GROUP BY fm.effective_at::date, c.name, a.name, fm.direction, fm.usd_amount
     HAVING count(*) > 1
     ORDER BY count(*) DESC, fm.usd_amount DESC
     LIMIT $1`, [limit]);
  return {
    grupos: r.rows.length,
    posibles_duplicados: r.rows.map((x: any) => ({
      fecha: x.fecha, cliente: x.cliente, cuenta: x.cuenta,
      direccion: x.direction === 'inflow' ? 'entra' : 'sale',
      usd: Math.round(x.usd * 100) / 100, veces: x.veces, kw2_ids: x.kw2_ids,
    })),
  };
}

// top_deudores_acreedores: mayores saldos de clientes reales.
export async function topBalances(n = 10) {
  const r = await pool.query(
    `SELECT c.name, SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END)::float8 bal
     FROM fund_movements fm JOIN clients c ON c.id=fm.client_id
     WHERE ${BASE} AND c.kind='client'
     GROUP BY c.name`,
  );
  const rows = r.rows.map((x: any) => ({ name: x.name, balance: Math.round(x.bal * 100) / 100 })).filter((x) => Math.abs(x.balance) >= 0.005);
  const deudores = rows.filter((x) => x.balance < 0).sort((a, b) => a.balance - b.balance).slice(0, n);
  const acreedores = rows.filter((x) => x.balance > 0).sort((a, b) => b.balance - a.balance).slice(0, n);
  return { top_deudores: deudores, top_acreedores: acreedores };
}
