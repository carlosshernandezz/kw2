'use client';

import { useMemo, useState } from 'react';
import type { ReconciledRow, LedgerRow, StmtRow, MarkRow, ReviewRow } from '@/lib/manual';

function fmt(n: string) {
  return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const dir = (d: string) => (d === 'inflow' ? '↓ entra' : '↑ sale');

type Tab = 'conciliadas' | 'review' | 'libro' | 'estado' | 'discrepancias';

export default function EstadoClient({
  reconciled, pendingLedger, pendingStatement, discrepancies, review,
}: {
  reconciled: ReconciledRow[]; pendingLedger: LedgerRow[]; pendingStatement: StmtRow[];
  discrepancies: MarkRow[]; review: ReviewRow[];
}) {
  const [tab, setTab] = useState<Tab>(review.length > 0 ? 'review' : 'conciliadas');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);

  async function undo(fundMovementId: number) {
    setBusy(true);
    try {
      await fetch('/api/binance/manual', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action: 'undo', fundMovementId }),
      });
      location.reload();
    } finally { setBusy(false); }
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'conciliadas', label: 'Conciliadas', count: reconciled.length },
    { key: 'review', label: 'Necesitan revisión', count: review.length },
    { key: 'libro', label: 'Sin conciliar (libro)', count: pendingLedger.length },
    { key: 'estado', label: 'Sin conciliar (estado)', count: pendingStatement.length },
    { key: 'discrepancias', label: 'Discrepancias', count: discrepancies.length },
  ];

  const filtered = useMemo(() => {
    const t = q.toLowerCase();
    if (tab === 'conciliadas') return reconciled.filter((r) => `${r.date} ${r.amount} ${r.nombre ?? ''}`.toLowerCase().includes(t));
    if (tab === 'review') return review.filter((r) => `${r.date} ${r.amount} ${r.nombre ?? ''}`.toLowerCase().includes(t));
    if (tab === 'libro') return pendingLedger.filter((r) => `${r.date} ${r.amount} ${r.nombre ?? ''}`.toLowerCase().includes(t));
    if (tab === 'estado') return pendingStatement.filter((r) => `${r.date} ${r.amount} ${r.operation} ${r.remark ?? ''}`.toLowerCase().includes(t));
    return discrepancies.filter((r) => `${r.date} ${r.amount} ${r.label} ${r.mark}`.toLowerCase().includes(t));
  }, [tab, q, reconciled, review, pendingLedger, pendingStatement, discrepancies]);

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900">Estado de conciliación BINANCE CH</h1>
      <p className="mt-1 text-slate-500">Todas las operaciones conciliadas y las que faltan, en tabla.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setQ(''); }}
            className={'rounded-md px-3 py-1.5 text-sm font-medium ' + (tab === t.key ? 'bg-slate-900 text-white' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')}>
            {t.label} <span className="opacity-70">({t.count})</span>
          </button>
        ))}
      </div>

      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por monto, fecha, nombre…"
        className="mt-3 w-full max-w-md rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-slate-400" />

      <div className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            {tab === 'conciliadas' && <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Mov.</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Ops estado</th><th className="px-3 py-2">Tipo</th></tr>}
            {tab === 'review' && <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Libro</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Conciliado contra</th><th className="px-3 py-2"></th></tr>}
            {tab === 'libro' && <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Mov.</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Fila</th></tr>}
            {tab === 'estado' && <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Mov.</th><th className="px-3 py-2">Operación</th><th className="px-3 py-2">Referencia</th></tr>}
            {tab === 'discrepancias' && <tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Monto</th><th className="px-3 py-2">Origen</th><th className="px-3 py-2">Marca</th></tr>}
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.length === 0 && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">Sin resultados.</td></tr>}
            {tab === 'conciliadas' && (filtered as ReconciledRow[]).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2 font-medium">{dir(r.direction)} {fmt(r.amount)}</td>
                <td className="px-3 py-2">{r.nombre ?? '—'}</td>
                <td className="px-3 py-2">{r.nOps}</td>
                <td className="px-3 py-2">
                  <span className={'rounded px-1.5 py-0.5 text-xs ' + (r.manual ? 'bg-sky-100 text-sky-700' : 'bg-emerald-100 text-emerald-700')}>
                    {r.manual ? 'manual' : `auto ${r.confidence?.toFixed(2)}`}
                  </span>
                </td>
              </tr>
            ))}
            {tab === 'review' && (filtered as ReviewRow[]).map((r) => (
              <tr key={r.id} className="bg-amber-50/50">
                <td className="px-3 py-2">{r.date}</td>
                <td className="px-3 py-2 font-medium">{dir(r.direction)} {fmt(r.amount)}</td>
                <td className="px-3 py-2">{r.nombre ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-600">
                  <span className="font-medium text-amber-700">conciliado {fmt(r.conciliado)}</span>
                  {r.links.map((l, i) => (
                    <span key={i} className="block text-slate-500">{l.date} · {l.operation} · {fmt(l.amount)}</span>
                  ))}
                </td>
                <td className="px-3 py-2 text-right">
                  <button disabled={busy} onClick={() => undo(r.id)}
                    className="rounded-md border border-rose-300 px-2 py-1 text-xs font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40">
                    Deshacer conciliación
                  </button>
                </td>
              </tr>
            ))}
            {tab === 'libro' && (filtered as LedgerRow[]).map((r) => (
              <tr key={r.id}><td className="px-3 py-2">{r.date}</td><td className="px-3 py-2 font-medium">{dir(r.direction)} {fmt(r.amount)}</td><td className="px-3 py-2">{r.nombre ?? '—'}</td><td className="px-3 py-2 text-slate-500">{r.row ?? '?'}</td></tr>
            ))}
            {tab === 'estado' && (filtered as StmtRow[]).map((r) => (
              <tr key={r.id}><td className="px-3 py-2">{r.date}</td><td className="px-3 py-2 font-medium">{dir(r.direction)} {fmt(r.amount)}</td><td className="px-3 py-2">{r.operation}</td><td className="px-3 py-2 text-xs text-slate-500">{r.remark ?? ''}</td></tr>
            ))}
            {tab === 'discrepancias' && (filtered as MarkRow[]).map((r) => (
              <tr key={r.id}>
                <td className="px-3 py-2">{r.date}</td><td className="px-3 py-2 font-medium">{fmt(r.amount)}</td>
                <td className="px-3 py-2">{r.type === 'fund_movement' ? 'Libro' : 'Estado de cuenta'}</td>
                <td className="px-3 py-2 text-xs">{r.mark === 'no_statement_counterpart' ? 'Sin contraparte en estado' : 'Falta en MOVIMIENTOS'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
