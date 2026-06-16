import { kpis } from '@/lib/reports';
import { usd } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MEDIO: Record<string, string> = {
  cash: 'Efectivo', zelle: 'Zelle', usdt: 'USDT', bs: 'Bolívares',
  transitory: 'Transitoria', commission: 'Comisión', expense: 'Gasto', other: 'Otro',
};

export default async function Page() {
  const k = await kpis();
  return (
    <div className="mx-auto max-w-4xl">
      <h1 className="text-2xl font-semibold text-slate-900">KPIs</h1>
      <p className="mt-1 text-slate-500">Indicadores calculados desde el libro.</p>

      <h2 className="mt-5 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Utilidad de la mesa</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card label="Comisiones cobradas" value={usd(k.comisiones)} tone="text-emerald-600" />
        <Card label="Gastos pagados" value={usd(k.gastos)} tone="text-rose-600" />
        <Card label="Utilidad (comisiones − gastos)" value={usd(k.utilidad)} tone={k.utilidad >= 0 ? 'text-emerald-700' : 'text-rose-700'} />
      </div>

      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Clientes</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <Card label="Total deudores" value={usd(k.totalDeudores)} sub={`${k.clientesDeudores} clientes`} tone="text-rose-600" />
        <Card label="Total acreedores" value={usd(k.totalAcreedores)} sub={`${k.clientesAcreedores} clientes`} tone="text-emerald-600" />
        <Card label="Movimientos" value={k.movimientos.toLocaleString('es-VE')} sub="en el libro" tone="text-slate-700" />
      </div>

      <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">Saldo por medio</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {k.porMedio.map((m) => (
          <Card key={m.medium} label={MEDIO[m.medium] ?? m.medium} value={usd(m.balance)} tone={m.balance < 0 ? 'text-rose-600' : 'text-slate-700'} />
        ))}
      </div>

      {k.controlCero.length > 0 && (
        <>
          <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Controles (deben dar 0)
          </h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {k.controlCero.map((c) => {
              const ok = Math.abs(c.balance) < 0.005;
              return <Card key={c.name} label={c.name} value={usd(c.balance)} sub={ok ? '✓ en cero' : '⚠ revisar'} tone={ok ? 'text-emerald-600' : 'text-amber-600'} />;
            })}
          </div>
        </>
      )}

      <div className="mt-8 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
        La <strong>utilidad</strong> se calcula como comisiones cobradas − gastos pagados (cuentas COMISION y
        GASTO). Compárala con la "UTILIDAD CH" de tu hoja; si difiere, dime y ajusto la fórmula.
      </div>
    </div>
  );
}

function Card({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={'mt-1 text-xl font-semibold tabular-nums ' + tone}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
