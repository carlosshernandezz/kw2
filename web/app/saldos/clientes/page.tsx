import { clientBalances } from '@/lib/reports';
import { usd } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function Page() {
  const all = await clientBalances();
  const real = all.filter((c) => c.kind === 'client');
  const deudores = real.filter((c) => c.balance < 0);
  const acreedores = real.filter((c) => c.balance > 0).sort((a, b) => b.balance - a.balance);
  const system = all.filter((c) => c.kind === 'system');
  const totalD = deudores.reduce((a, c) => a + c.balance, 0);
  const totalA = acreedores.reduce((a, c) => a + c.balance, 0);

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Saldos de clientes</h1>
      <p className="mt-1 text-slate-500">
        Negativo = deudor (debe a KW2). Positivo = acreedor (KW2 le debe). Calculado desde el libro.
      </p>

      <div className="mt-5 grid grid-cols-2 gap-4">
        <Col title="Deudores" total={totalD} rows={deudores} tone="text-rose-600" />
        <Col title="Acreedores" total={totalA} rows={acreedores} tone="text-emerald-600" />
      </div>

      {system.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-400">
            Conceptos de sistema (no son clientes reales)
          </h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {system.sort((a, b) => a.balance - b.balance).map((c) => (
                  <tr key={c.legacyId}>
                    <td className="px-3 py-2">{c.name}</td>
                    <td className={'px-3 py-2 text-right tabular-nums ' + (c.balance < 0 ? 'text-rose-600' : 'text-emerald-600')}>{usd(c.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function Col({ title, total, rows, tone }: { title: string; total: number; rows: { legacyId: string; name: string; balance: number }[]; tone: string }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
        <span className="font-medium text-slate-900">{title} <span className="text-slate-400">({rows.length})</span></span>
        <span className={'font-semibold tabular-nums ' + tone}>{usd(total)}</span>
      </div>
      <div className="max-h-[65vh] overflow-y-auto">
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {rows.map((c) => (
              <tr key={c.legacyId}>
                <td className="px-3 py-2">{c.name}</td>
                <td className={'px-3 py-2 text-right tabular-nums ' + tone}>{usd(c.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
