'use client';

import { useState } from 'react';
import type { Suggestion } from '@/lib/reconciliation';

type Sum = {
  confirmed: number; suggested: number; rejected: number; ledgerTotal: number; ledgerMatched: number;
};

function fmt(n: string) {
  return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function BinanceClient({
  initialSummary, initialSuggestions,
}: { initialSummary: Sum; initialSuggestions: Suggestion[] }) {
  const [summary, setSummary] = useState(initialSummary);
  const [rows, setRows] = useState(initialSuggestions);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  async function refresh() {
    const res = await fetch('/api/binance', { cache: 'no-store' });
    const data = await res.json();
    setSummary(data.summary);
    setRows(data.suggestions);
    setSelected(new Set());
  }

  async function act(action: string, ids?: number[], adjust?: 'date' | 'amount') {
    setBusy(true);
    try {
      await fetch('/api/binance/decide', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ids, adjust }),
      });
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const pct = summary.ledgerTotal ? Math.round((summary.ledgerMatched / summary.ledgerTotal) * 100) : 0;
  const selectedIds = [...selected];

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Conciliación BINANCE CH</h1>
      <p className="mt-1 text-slate-500">
        {summary.ledgerMatched} de {summary.ledgerTotal} movimientos del libro con sugerencia ({pct}%).
      </p>

      <div className="mt-5 grid grid-cols-3 gap-4">
        <Card label="Confirmadas" value={summary.confirmed} tone="text-emerald-600" />
        <Card label="Por revisar" value={summary.suggested} tone="text-amber-600" />
        <Card label="Rechazadas" value={summary.rejected} tone="text-slate-400" />
      </div>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          disabled={busy}
          onClick={() => act('confirm-high')}
          className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
        >
          Confirmar todas las de confianza 0,99
        </button>
        <button
          disabled={busy || selectedIds.length === 0}
          onClick={() => act('confirm', selectedIds)}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40"
        >
          Confirmar seleccionadas ({selectedIds.length})
        </button>
        <button
          disabled={busy || selectedIds.length === 0}
          onClick={() => act('reject', selectedIds)}
          className="rounded-md border border-rose-300 px-4 py-2 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-40"
        >
          Rechazar seleccionadas
        </button>
      </div>

      <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="w-10 px-3 py-2"></th>
              <th className="px-3 py-2">Conf.</th>
              <th className="px-3 py-2">Libro</th>
              <th className="px-3 py-2">Estado de cuenta</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  No hay sugerencias por revisar.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className={selected.has(r.id) ? 'bg-amber-50' : ''}>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
                </td>
                <td className="px-3 py-2">
                  <span
                    className={
                      'rounded px-1.5 py-0.5 text-xs font-medium ' +
                      (r.confidence >= 0.99
                        ? 'bg-emerald-100 text-emerald-700'
                        : r.confidence >= 0.8
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-rose-100 text-rose-700')
                    }
                  >
                    {r.confidence.toFixed(2)}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">{r.ledger.direction === 'inflow' ? '↓ entra' : '↑ sale'} {fmt(r.ledger.amount)}</div>
                  <div className="text-xs text-slate-500">{r.ledger.date} · {r.ledger.nombre ?? '—'}</div>
                </td>
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {fmt(r.statement.amount)}
                    {Number(r.statement.amount) !== Number(r.alloc) && (
                      <span className="text-xs text-slate-400"> (asigna {fmt(r.alloc)})</span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500">{r.statement.date} · {r.statement.operation}</div>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{r.reason}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    disabled={busy}
                    onClick={() => act('confirm', [r.id])}
                    className="mr-2 text-xs font-medium text-emerald-600 hover:underline disabled:opacity-40"
                  >
                    Confirmar
                  </button>
                  {r.ledger.date !== r.statement.date && (
                    <button
                      disabled={busy}
                      onClick={() => act('confirm', [r.id], 'date')}
                      title={`Confirmar y proponer cambiar la fecha en MOVIMIENTOS a ${r.statement.date}`}
                      className="mr-2 text-xs font-medium text-sky-600 hover:underline disabled:opacity-40"
                    >
                      + corregir fecha → {r.statement.date}
                    </button>
                  )}
                  <button
                    disabled={busy}
                    onClick={() => act('reject', [r.id])}
                    className="text-xs font-medium text-rose-600 hover:underline disabled:opacity-40"
                  >
                    Rechazar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className={'mt-1 text-2xl font-semibold ' + tone}>{value}</div>
    </div>
  );
}
