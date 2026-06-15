import { summary } from '@/lib/reconciliation';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const s = await summary();
  const pct = s.ledgerTotal ? Math.round((s.ledgerMatched / s.ledgerTotal) * 100) : 0;
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Inicio</h1>
      <p className="mt-1 text-slate-500">Sistema interno de la mesa KW2.</p>

      <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="font-medium text-slate-900">Conciliación BINANCE CH</h2>
        <p className="mt-1 text-sm text-slate-500">
          {s.ledgerMatched} de {s.ledgerTotal} movimientos del libro con sugerencia ({pct}%).
        </p>
        <div className="mt-4 flex gap-6 text-sm">
          <span className="text-emerald-600">Confirmadas: {s.confirmed}</span>
          <span className="text-amber-600">Por revisar: {s.suggested}</span>
          <span className="text-slate-400">Rechazadas: {s.rejected}</span>
        </div>
        <a
          href="/conciliacion/binance"
          className="mt-4 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
        >
          Ir a conciliación →
        </a>
      </div>
    </div>
  );
}
