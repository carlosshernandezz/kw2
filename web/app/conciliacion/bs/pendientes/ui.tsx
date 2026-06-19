'use client';

import { useMemo, useState } from 'react';
import type { BsLedgerPending, BsStatementPending } from '@/lib/bs-manual';

const money = (value: number) => value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const direction = (value: string) => value === 'inflow' ? 'Ingreso' : 'Egreso';

export default function BsPendingClient({ initialLedger, initialStatement }: {
  initialLedger: BsLedgerPending[]; initialStatement: BsStatementPending[];
}) {
  const [ledger, setLedger] = useState(initialLedger);
  const [statement, setStatement] = useState(initialStatement);
  const [selectedLedger, setSelectedLedger] = useState<Set<number>>(new Set());
  const [selectedStatement, setSelectedStatement] = useState<Set<number>>(new Set());
  const [ledgerQuery, setLedgerQuery] = useState('');
  const [statementQuery, setStatementQuery] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const filteredLedger = useMemo(() => ledger.filter((row) => `${row.date} ${row.client} ${row.bank} ${row.bs} ${row.row}`.toLowerCase().includes(ledgerQuery.toLowerCase())), [ledger, ledgerQuery]);
  const filteredStatement = useMemo(() => statement.filter((row) => `${row.date} ${row.bank} ${row.bs} ${row.description}`.toLowerCase().includes(statementQuery.toLowerCase())), [statement, statementQuery]);
  const ledgerTotal = [...selectedLedger].reduce((sum, id) => sum + (ledger.find((row) => row.id === id)?.bs ?? 0), 0);
  const statementTotal = [...selectedStatement].reduce((sum, id) => sum + (statement.find((row) => row.id === id)?.bs ?? 0), 0);
  const structureOk = selectedLedger.size > 0 && selectedStatement.size > 0 && (selectedLedger.size === 1 || selectedStatement.size === 1);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<number>>>, id: number) => setter((current) => {
    const next = new Set(current); next.has(id) ? next.delete(id) : next.add(id); return next;
  });
  async function refresh() {
    const response = await fetch('/api/bs/manual', { cache: 'no-store' });
    const data = await response.json();
    setLedger(data.ledger); setStatement(data.statement);
    setSelectedLedger(new Set()); setSelectedStatement(new Set());
  }
  async function reconcile() {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/bs/manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'match', ledgerIds: [...selectedLedger], statementIds: [...selectedStatement] }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'No se pudo conciliar.');
      setMessage(`Conciliación guardada.${data.corrections ? ` Se generaron ${data.corrections} correcciones.` : ''}`);
      await refresh();
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <div className="mx-auto max-w-7xl">
    <div className="flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold text-slate-900">Pendientes reales Bs</h1><p className="mt-1 text-sm text-slate-500">Compara MOVIMIENTOS con EDO CTA BS. Banco, fecha y dirección deben coincidir.</p></div><a href="/conciliacion/bs" className="text-sm font-medium text-sky-700 hover:underline">Volver</a></div>
    <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-3 border border-slate-200 bg-white p-3"><span className="text-sm text-slate-600">MOVIMIENTOS: <b>{money(ledgerTotal)}</b> ({selectedLedger.size}) · EDO CTA: <b>{money(statementTotal)}</b> ({selectedStatement.size})</span><button disabled={!structureOk || busy} onClick={reconcile} className="bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">Conciliar seleccionadas</button>{message && <span className="text-sm text-slate-700">{message}</span>}</div>
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <PendingPane title={`MOVIMIENTOS pendientes (${filteredLedger.length})`} query={ledgerQuery} setQuery={setLedgerQuery}>{filteredLedger.map((row) => <PendingRow key={row.id} checked={selectedLedger.has(row.id)} onChange={() => toggle(setSelectedLedger, row.id)} main={`${money(row.bs)} Bs · USD ${money(row.usd)}`} detail={`${row.date} · ${direction(row.direction)} · ${row.client} · ${row.bank} · fila ${row.row ?? '?'}`} />)}</PendingPane>
      <PendingPane title={`EDO CTA BS disponible (${filteredStatement.length})`} query={statementQuery} setQuery={setStatementQuery}>{filteredStatement.map((row) => <PendingRow key={row.id} checked={selectedStatement.has(row.id)} onChange={() => toggle(setSelectedStatement, row.id)} main={`${money(row.bs)} Bs · ${row.bank}`} detail={`${row.date} · ${direction(row.direction)} · ${row.description || 'Sin descripción'}`} />)}</PendingPane>
    </div>
  </div>;
}

function PendingPane({ title, query, setQuery, children }: { title: string; query: string; setQuery: (value: string) => void; children: React.ReactNode }) {
  return <section className="overflow-hidden border border-slate-200 bg-white"><div className="border-b border-slate-200 p-3"><h2 className="text-sm font-semibold text-slate-900">{title}</h2><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filtrar por fecha, monto, banco o cliente" className="mt-2 w-full border border-slate-300 px-3 py-2 text-sm outline-none focus:border-sky-500" /></div><div className="max-h-[65vh] divide-y divide-slate-100 overflow-y-auto">{children}</div></section>;
}
function PendingRow({ checked, onChange, main, detail }: { checked: boolean; onChange: () => void; main: string; detail: string }) {
  return <label className={`flex cursor-pointer gap-3 px-3 py-3 text-sm ${checked ? 'bg-amber-50' : 'hover:bg-slate-50'}`}><input type="checkbox" checked={checked} onChange={onChange} /><span><span className="font-medium text-slate-900">{main}</span><span className="mt-0.5 block text-xs text-slate-500">{detail}</span></span></label>;
}
