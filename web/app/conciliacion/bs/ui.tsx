'use client';

import { useState } from 'react';
import type { AmbiguousIdentity, BsSuggestion } from '@/lib/bs-reconciliation';

const money = (value: number) => value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BsClient({ initialSummary, initialSuggestions, initialAmbiguous }: {
  initialSummary: any; initialSuggestions: BsSuggestion[]; initialAmbiguous: AmbiguousIdentity[];
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [ambiguous, setAmbiguous] = useState(initialAmbiguous);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refresh() {
    const response = await fetch('/api/bs', { cache: 'no-store' });
    const data = await response.json();
    setSummary(data.summary); setSuggestions(data.suggestions); setAmbiguous(data.ambiguous);
  }

  async function decide(row: BsSuggestion, action: 'confirm' | 'reject') {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/bs/decide', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ids: row.reconciliationIds }),
      });
      const data = await response.json();
      if (!data.ok) throw new Error(data.error ?? 'No se pudo guardar la decisión');
      setMessage(action === 'confirm'
        ? `Conciliación confirmada.${data.corrections ? ` Se generaron ${data.corrections} correcciones de comisión.` : ''}`
        : 'Sugerencia rechazada.');
      await refresh();
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Conciliación Bs</h1>
          <p className="mt-1 text-sm text-slate-500">Sugerencias por identidad histórica, fecha, banco y monto.</p>
        </div>
        <a href="/correcciones" className="text-sm font-medium text-sky-700 hover:underline">Ver correcciones propuestas</a>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card label="Conciliados" value={summary.reconciled} />
        <Card label="Sugerencias" value={summary.suggested} />
        <Card label="Pendientes reales" value={summary.pending} />
        <Card label="No aplica" value={summary.not_applicable} />
      </div>
      {message && <div className="mt-4 border-l-4 border-sky-500 bg-sky-50 px-4 py-3 text-sm text-sky-900">{message}</div>}

      <section className="mt-7">
        <h2 className="text-lg font-semibold text-slate-900">Por revisar</h2>
        <div className="mt-3 overflow-x-auto border-y border-slate-200 bg-white">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
              <th className="px-3 py-2">Conf.</th><th className="px-3 py-2">MOVIMIENTOS</th>
              <th className="px-3 py-2">EDO CTA BS</th><th className="px-3 py-2">Comisión</th><th className="px-3 py-2"></th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!suggestions.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">No hay sugerencias pendientes.</td></tr>}
              {suggestions.map((row) => <tr key={row.movementId}>
                <td className="px-3 py-3"><span className="bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">{row.confidence.toFixed(2)}</span></td>
                <td className="px-3 py-3"><div className="font-medium">{row.ledger.client} · {money(row.ledger.amount)} Bs</div><div className="text-xs text-slate-500">{row.ledger.date} · {row.ledger.bank} · {row.ledger.kw2Id}</div></td>
                <td className="px-3 py-3"><div className="font-medium">{money(row.statementTotal)} Bs en {row.statement.length} fila(s)</div><div className="text-xs text-slate-500">{row.statement.map((item) => item.description || 'Sin descripción').join(' · ')}</div></td>
                <td className="px-3 py-3">{row.commission > 0 ? <><div className="font-medium text-amber-700">{money(row.commission)} Bs</div><div className="text-xs text-slate-500">Propondrá Monto Bs y Tasa</div></> : <span className="text-slate-400">Sin comisión</span>}</td>
                <td className="whitespace-nowrap px-3 py-3 text-right"><button disabled={busy} onClick={() => decide(row, 'confirm')} className="mr-3 text-sm font-medium text-emerald-700 hover:underline disabled:opacity-40">Confirmar</button><button disabled={busy} onClick={() => decide(row, 'reject')} className="text-sm font-medium text-rose-700 hover:underline disabled:opacity-40">Rechazar</button></td>
              </tr>)}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-9">
        <h2 className="text-lg font-semibold text-slate-900">Identidades ambiguas</h2>
        <p className="mt-1 text-sm text-slate-500">No se usan para sugerencias hasta aclarar a qué cliente pertenecen.</p>
        <div className="mt-3 overflow-x-auto border-y border-slate-200 bg-white">
          <table className="w-full text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Banco</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Identidad</th><th className="px-3 py-2">Clientes históricos</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{ambiguous.map((item) => <tr key={`${item.bank}-${item.type}-${item.identity}`}><td className="px-3 py-2">{item.bank}</td><td className="px-3 py-2 text-slate-500">{item.type}</td><td className="px-3 py-2 font-medium">{item.identity}</td><td className="px-3 py-2">{item.clients.map((client) => `${client.name} (${client.evidence})`).join(' · ')}</td></tr>)}</tbody></table>
        </div>
      </section>
    </div>
  );
}

function Card({ label, value }: { label: string; value: number }) {
  return <div className="border border-slate-200 bg-white p-4"><div className="text-xs uppercase text-slate-400">{label}</div><div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div></div>;
}
