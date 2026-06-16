import { accountBalances } from '@/lib/reports';
import { usd } from '@/lib/format';

export const dynamic = 'force-dynamic';

const MEDIO: Record<string, string> = {
  cash: 'Efectivo', zelle: 'Zelle', usdt: 'USDT', bs: 'Bolívares',
  transitory: 'Transitoria', commission: 'Comisión', expense: 'Gasto', other: 'Otro',
};

export default async function Page() {
  const accts = await accountBalances();
  const groups = new Map<string, typeof accts>();
  for (const a of accts) {
    if (!groups.has(a.medium)) groups.set(a.medium, []);
    groups.get(a.medium)!.push(a);
  }
  const total = accts.reduce((s, a) => s + a.balance, 0);

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Saldos por cuenta</h1>
      <p className="mt-1 text-slate-500">Saldo de cada cuenta en USD, agrupado por medio. Calculado desde el libro.</p>

      <div className="mt-5 space-y-4">
        {[...groups.entries()].map(([medium, list]) => {
          const sub = list.reduce((s, a) => s + a.balance, 0);
          return (
            <div key={medium} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50 px-3 py-2">
                <span className="text-sm font-medium text-slate-900">{MEDIO[medium] ?? medium}</span>
                <span className="text-sm font-semibold tabular-nums text-slate-700">{usd(sub)}</span>
              </div>
              <table className="w-full text-sm">
                <tbody className="divide-y divide-slate-100">
                  {list.map((a) => (
                    <tr key={a.legacyId}>
                      <td className="px-3 py-2">{a.name}</td>
                      <td className={'px-3 py-2 text-right tabular-nums ' + (a.balance < 0 ? 'text-rose-600' : 'text-slate-700')}>{usd(a.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </div>
  );
}
