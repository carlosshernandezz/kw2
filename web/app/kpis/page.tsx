import { dashboard, kpis, type ProfitPeriod, type ProfitPoint } from '@/lib/reports';
import { usd } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MEDIO: Record<string, string> = {
  cash: 'Efectivo', zelle: 'Zelle', usdt: 'USDT', bs: 'Bolívares',
  transitory: 'Transitoria', commission: 'Comisión', expense: 'Gasto', other: 'Otro',
};

const dateLabel = (date: string, unit: 'day' | 'week' | 'month') => {
  const value = new Date(`${date}T12:00:00`);
  if (unit === 'month') return value.toLocaleDateString('es-VE', { month: 'short' });
  if (unit === 'week') {
    const first = new Date(value.getFullYear(), 0, 1);
    return `Sem ${Math.ceil((((value.getTime() - first.getTime()) / 86400000) + first.getDay() + 1) / 7)}`;
  }
  return value.toLocaleDateString('es-VE', { day: '2-digit' });
};

const compactUsd = (value: number) => `$${new Intl.NumberFormat('es-VE', { notation: 'compact', maximumFractionDigits: 1 }).format(value)}`;

export default async function Page() {
  const [k, d] = await Promise.all([kpis(), dashboard()]);
  return (
    <div className="mx-auto max-w-7xl">
      <h1 className="text-2xl font-semibold text-slate-900">Dashboard</h1>
      <p className="mt-1 text-slate-500">Rentabilidad, exposición y liquidez calculadas desde el libro.</p>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <ProfitCard period={d.daily} />
        <ProfitCard period={d.weekly} />
        <ProfitCard period={d.monthly} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Trend title="Utilidad diaria" subtitle="Últimos 14 días" points={d.dailyTrend} unit="day" />
        <Trend title="Utilidad semanal" subtitle="Últimas 8 semanas" points={d.weeklyTrend} unit="week" />
        <Trend title="Utilidad mensual" subtitle="Últimos 6 meses" points={d.monthlyTrend} unit="month" />
        <Composition commissions={d.monthly.commissions} expenses={d.monthly.expenses} />
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        <Exposure title="Mayores deudores" rows={d.topDebtors} negative />
        <Exposure title="Mayores acreedores" rows={d.topCreditors} />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase text-slate-500">Posición actual</h2>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Total deudores" value={usd(k.totalDeudores)} sub={`${k.clientesDeudores} clientes`} tone="text-rose-700" />
        <Metric label="Total acreedores" value={usd(k.totalAcreedores)} sub={`${k.clientesAcreedores} clientes`} tone="text-emerald-700" />
        <Metric label="Movimientos" value={k.movimientos.toLocaleString('es-VE')} sub="en el libro" tone="text-slate-900" />
        <Metric label="Utilidad histórica" value={usd(k.utilidad)} sub="comisiones menos gastos" tone={k.utilidad >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
      </div>

      <h2 className="mt-8 text-sm font-semibold uppercase text-slate-500">Saldo por medio</h2>
      <div className="mt-2 grid grid-cols-2 gap-3 md:grid-cols-4">
        {k.porMedio.map((item) => <Metric key={item.medium} label={MEDIO[item.medium] ?? item.medium} value={usd(item.balance)} tone={item.balance < 0 ? 'text-rose-700' : 'text-slate-900'} />)}
      </div>
    </div>
  );
}

function ProfitCard({ period }: { period: ProfitPeriod }) {
  const direction = period.changePct == null ? 'Sin base comparable' : `${period.changePct >= 0 ? '+' : ''}${period.changePct.toLocaleString('es-VE')}% vs. período anterior`;
  return <section className="border border-slate-200 bg-white p-5">
    <div className="text-xs font-semibold uppercase text-slate-500">{period.label}</div>
    <div className={`mt-2 text-3xl font-semibold tabular-nums ${period.profit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>{usd(period.profit)}</div>
    <div className={`mt-1 text-xs ${period.changePct != null && period.changePct < 0 ? 'text-rose-600' : 'text-slate-500'}`}>{direction}</div>
    <div className="mt-4 grid grid-cols-2 border-t border-slate-100 pt-3 text-sm">
      <div><div className="text-xs text-slate-400">Comisiones</div><div className="font-medium text-slate-800">{usd(period.commissions)}</div></div>
      <div><div className="text-xs text-slate-400">Gastos</div><div className="font-medium text-slate-800">{usd(period.expenses)}</div></div>
    </div>
  </section>;
}

function Trend({ title, subtitle, points, unit }: { title: string; subtitle: string; points: ProfitPoint[]; unit: 'day' | 'week' | 'month' }) {
  const max = Math.max(1, ...points.map((point) => Math.abs(point.profit)));
  return <section className="border border-slate-200 bg-white p-5">
    <h2 className="font-semibold text-slate-900">{title}</h2><p className="text-xs text-slate-500">{subtitle}</p>
    <div className="mt-5 flex h-48 items-end gap-2 border-b border-slate-200">
      {points.map((point) => <div key={point.label} className="flex h-full min-w-0 flex-1 flex-col justify-end">
        <div className="truncate text-center text-[10px] font-medium text-slate-600">{Math.abs(point.profit) >= max * .18 ? compactUsd(point.profit) : ''}</div>
        <div title={`${dateLabel(point.label, unit)}: ${usd(point.profit)}`} className={`mx-auto w-full max-w-12 ${point.profit >= 0 ? 'bg-sky-600' : 'bg-rose-500'}`} style={{ height: `${Math.max(2, Math.abs(point.profit) / max * 145)}px` }} />
        <div className="mt-2 truncate text-center text-[10px] text-slate-500">{dateLabel(point.label, unit)}</div>
      </div>)}
    </div>
  </section>;
}

function Composition({ commissions, expenses }: { commissions: number; expenses: number }) {
  const total = Math.max(1, commissions + expenses);
  return <section className="border border-slate-200 bg-white p-5">
    <h2 className="font-semibold text-slate-900">Comisiones y gastos del mes</h2><p className="text-xs text-slate-500">Cuánto se genera y cuánto se consume</p>
    <div className="mt-8 space-y-6">
      <Bar label="Comisiones cobradas" value={commissions} width={commissions / total * 100} color="bg-emerald-600" />
      <Bar label="Gastos pagados" value={expenses} width={expenses / total * 100} color="bg-rose-500" />
    </div>
    <div className="mt-8 border-t border-slate-100 pt-4 text-sm text-slate-600">Por cada dólar cobrado en comisiones se gastan <strong>{commissions ? (expenses / commissions).toLocaleString('es-VE', { style: 'percent', maximumFractionDigits: 1 }) : '—'}</strong>.</div>
  </section>;
}

function Bar({ label, value, width, color }: { label: string; value: number; width: number; color: string }) {
  return <div><div className="mb-2 flex justify-between gap-4 text-sm"><span>{label}</span><strong>{usd(value)}</strong></div><div className="h-3 bg-slate-100"><div className={`h-full ${color}`} style={{ width: `${Math.max(0, Math.min(100, width))}%` }} /></div></div>;
}

function Exposure({ title, rows, negative = false }: { title: string; rows: { legacyId: string; name: string; balance: number }[]; negative?: boolean }) {
  const max = Math.max(1, ...rows.map((row) => Math.abs(row.balance)));
  return <section className="border border-slate-200 bg-white p-5"><h2 className="font-semibold text-slate-900">{title}</h2><div className="mt-4 space-y-3">{rows.map((row) => <a href={`/clientes/${encodeURIComponent(row.legacyId)}`} key={row.legacyId} className="block hover:bg-slate-50"><div className="flex justify-between gap-4 text-sm"><span className="truncate underline decoration-slate-300 underline-offset-2">{row.name}</span><strong className={negative ? 'text-rose-700' : 'text-emerald-700'}>{usd(row.balance)}</strong></div><div className="mt-1 h-1.5 bg-slate-100"><div className={`h-full ${negative ? 'bg-rose-500' : 'bg-emerald-600'}`} style={{ width: `${Math.abs(row.balance) / max * 100}%` }} /></div></a>)}</div></section>;
}

function Metric({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return <div className="border border-slate-200 bg-white p-4"><div className="text-xs uppercase text-slate-400">{label}</div><div className={`mt-1 text-xl font-semibold tabular-nums ${tone}`}>{value}</div>{sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}</div>;
}
