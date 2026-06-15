'use client';

import { useMemo, useState } from 'react';
import type { LedgerRow, StmtRow } from '@/lib/manual';

function fmt(n: string) {
  return Number(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
const dir = (d: string) => (d === 'inflow' ? '↓ entra' : '↑ sale');

export default function ManualClient({
  initialLedger, initialStatement,
}: { initialLedger: LedgerRow[]; initialStatement: StmtRow[] }) {
  const [ledger, setLedger] = useState(initialLedger);
  const [statement, setStatement] = useState(initialStatement);
  const [selL, setSelL] = useState<Set<number>>(new Set());
  const [selS, setSelS] = useState<Set<number>>(new Set());
  const [qL, setQL] = useState('');
  const [qS, setQS] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const fL = useMemo(
    () => ledger.filter((r) => `${r.date} ${r.amount} ${r.nombre ?? ''} ${r.row ?? ''}`.toLowerCase().includes(qL.toLowerCase())),
    [ledger, qL],
  );
  const fS = useMemo(
    () => statement.filter((r) => `${r.date} ${r.amount} ${r.operation} ${r.remark ?? ''}`.toLowerCase().includes(qS.toLowerCase())),
    [statement, qS],
  );

  const sumL = [...selL].reduce((a, id) => a + Number(ledger.find((r) => r.id === id)?.amount ?? 0), 0);
  const sumS = [...selS].reduce((a, id) => a + Number(statement.find((r) => r.id === id)?.amount ?? 0), 0);
  const diff = Math.round((sumS - sumL) * 100) / 100;
  const structureOk = selL.size > 0 && selS.size > 0 && (selL.size === 1 || selS.size === 1);
  const matchReady = structureOk && Math.abs(diff) <= 0.02;
  // Diferencia de monto: solo se puede ajustar si el lado del libro es una fila.
  const adjustReady = structureOk && Math.abs(diff) > 0.02 && selL.size === 1;

  async function refresh() {
    const r = await fetch('/api/binance/manual', { cache: 'no-store' });
    const d = await r.json();
    setLedger(d.ledger); setStatement(d.statement);
    setSelL(new Set()); setSelS(new Set());
  }

  async function post(body: any) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/binance/manual', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!d.ok) setMsg({ ok: false, text: d.error ?? 'Error' });
      else { setMsg({ ok: true, text: 'Listo.' }); await refresh(); }
    } finally { setBusy(false); }
  }

  const tg = (set: React.Dispatch<React.SetStateAction<Set<number>>>) => (id: number) =>
    set((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  return (
    <div className="mx-auto max-w-6xl">
      <h1 className="text-2xl font-semibold text-slate-900">Conciliación manual BINANCE CH</h1>
      <p className="mt-1 text-slate-500">
        Selecciona filas en cada lado y conciliálas (1:1, varias→1 o 1→varias). O marca las que no
        tienen contraparte.
      </p>

      <div className="sticky top-0 z-10 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <span className="text-sm text-slate-500">
          Libro: <b>{fmt(String(sumL))}</b> ({selL.size}) · Estado: <b>{fmt(String(sumS))}</b> ({selS.size})
          {structureOk && Math.abs(diff) > 0.02 && (
            <span className="ml-1 text-amber-600">· dif {diff > 0 ? '+' : ''}{fmt(String(diff))}</span>
          )}
        </span>
        <button disabled={busy || !matchReady} onClick={() => post({ action: 'match', ledgerIds: [...selL], stmtIds: [...selS] })}
          className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-40">
          Conciliar seleccionadas
        </button>
        {adjustReady && (
          <button disabled={busy} onClick={() => post({ action: 'match', ledgerIds: [...selL], stmtIds: [...selS], adjustAmount: true })}
            title={`Concilia y propone cambiar el monto del libro a ${fmt(String(sumS))} en MOVIMIENTOS`}
            className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-40">
            Conciliar y corregir monto → {fmt(String(sumS))}
          </button>
        )}
        <button disabled={busy || selL.size === 0} onClick={() => post({ action: 'mark-ledger-no-counterpart', ledgerIds: [...selL] })}
          className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40">
          Libro: sin contraparte
        </button>
        <button disabled={busy || selS.size === 0} onClick={() => post({ action: 'mark-statement-missing', stmtIds: [...selS] })}
          className="rounded-md border border-sky-300 px-3 py-1.5 text-sm font-medium text-sky-700 hover:bg-sky-50 disabled:opacity-40">
          Estado: falta en MOVIMIENTOS
        </button>
        {msg && <span className={'text-sm ' + (msg.ok ? 'text-emerald-600' : 'text-rose-600')}>{msg.text}</span>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <Pane title={`Libro sin conciliar (${fL.length})`} q={qL} setQ={setQL}>
          {fL.map((r) => (
            <Row key={r.id} checked={selL.has(r.id)} onToggle={() => tg(setSelL)(r.id)}
              main={`${dir(r.direction)} ${fmt(r.amount)}`} sub={`${r.date} · ${r.nombre ?? '—'} · fila ${r.row ?? '?'}`} />
          ))}
        </Pane>
        <Pane title={`Estado de cuenta sin conciliar (${fS.length})`} q={qS} setQ={setQS}>
          {fS.map((r) => (
            <Row key={r.id} checked={selS.has(r.id)} onToggle={() => tg(setSelS)(r.id)}
              main={`${dir(r.direction)} ${fmt(r.amount)}`} sub={`${r.date} · ${r.operation}${r.remark ? ' · ' + r.remark : ''}`} />
          ))}
        </Pane>
      </div>
    </div>
  );
}

function Pane({ title, q, setQ, children }: { title: string; q: string; setQ: (s: string) => void; children: React.ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 p-3">
        <div className="text-sm font-medium text-slate-900">{title}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por monto, fecha, nombre…"
          className="mt-2 w-full rounded-md border border-slate-200 px-2 py-1 text-sm outline-none focus:border-slate-400" />
      </div>
      <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">{children}</div>
    </div>
  );
}

function Row({ checked, onToggle, main, sub }: { checked: boolean; onToggle: () => void; main: string; sub: string }) {
  return (
    <label className={'flex cursor-pointer items-center gap-3 px-3 py-2 text-sm ' + (checked ? 'bg-amber-50' : 'hover:bg-slate-50')}>
      <input type="checkbox" checked={checked} onChange={onToggle} />
      <span className="flex-1">
        <span className="font-medium">{main}</span>
        <span className="block text-xs text-slate-500">{sub}</span>
      </span>
    </label>
  );
}
