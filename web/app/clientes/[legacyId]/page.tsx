import { clientDetail } from '@/lib/agent-tools';
import { usd } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Page({ params }: { params: Promise<{ legacyId: string }> }) {
  const { legacyId } = await params;
  const d = await clientDetail(legacyId);
  if (!d) return <div className="mx-auto max-w-3xl"><p className="text-slate-500">Cliente no encontrado.</p></div>;

  const rol = d.balance < 0 ? 'Deudor (debe a KW2)' : d.balance > 0 ? 'Acreedor (KW2 le debe)' : 'En cero';
  return (
    <div className="mx-auto max-w-4xl">
      <a href="/saldos/clientes" className="text-sm text-slate-500 hover:underline">← Saldos de clientes</a>
      <h1 className="mt-2 text-2xl font-semibold text-slate-900">{d.name}</h1>
      <div className="mt-1 flex items-center gap-4 text-sm">
        <span className={d.balance < 0 ? 'text-rose-600' : d.balance > 0 ? 'text-emerald-600' : 'text-slate-500'}>
          Saldo: <strong>{usd(d.balance)}</strong> · {rol}
        </span>
        <span className="text-slate-400">{d.movimientos.length} movimientos</span>
        {d.kind === 'system' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">concepto de control</span>}
      </div>

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Fecha</th>
              <th className="px-3 py-2">Cuenta</th>
              <th className="px-3 py-2">Movimiento</th>
              <th className="px-3 py-2">Evidencia (kw2_id)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {d.movimientos.map((m, i) => (
              <tr key={i}>
                <td className="px-3 py-2 whitespace-nowrap">{m.date}</td>
                <td className="px-3 py-2">{m.account}</td>
                <td className={'px-3 py-2 tabular-nums ' + (m.direction === 'inflow' ? 'text-emerald-600' : 'text-rose-600')}>
                  {m.direction === 'inflow' ? '↓ entra ' : '↑ sale '}{usd(m.usd)}
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  <span className="font-mono">{m.kw2id ?? '—'}</span>
                  {m.medium === 'usdt' && (m.reconciled ? <span className="ml-2 text-emerald-600">✓ conciliado</span> : <span className="ml-2 text-amber-600">sin conciliar</span>)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
