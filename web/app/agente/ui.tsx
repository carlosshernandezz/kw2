'use client';

import { useState } from 'react';

type Turn = { q: string; answer?: string; tools?: { name: string; result: unknown }[]; error?: string };

const EJEMPLOS = ['¿Cuánto debe Sergio?', '¿Cuánto se le debe a Ramon?', 'Saldo de Binance Loan'];

export default function AgentClient() {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [reasoning, setReasoning] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);

  async function ask(question: string) {
    if (!question.trim() || busy) return;
    setBusy(true);
    setQ('');
    const idx = turns.length;
    setTurns((t) => [...t, { q: question }]);
    try {
      const r = await fetch('/api/agent', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question, mode: reasoning ? 'reasoning' : 'normal' }),
      });
      const d = await r.json();
      setTurns((t) => t.map((x, i) => i === idx ? (d.ok ? { ...x, answer: d.answer, tools: d.toolCalls } : { ...x, error: d.error }) : x));
    } catch (e) {
      setTurns((t) => t.map((x, i) => i === idx ? { ...x, error: String(e) } : x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold text-slate-900">Agente KW2</h1>
      <p className="mt-1 text-slate-500">
        Pregunta en lenguaje natural. El agente consulta la base y responde con evidencia — no inventa cifras. Solo lectura.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
        <input type="checkbox" checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} />
        Modo razonamiento (DeepSeek-R1): analiza inconsistencias y duplicados. Más lento.
      </label>

      <div className="mt-4 flex flex-wrap gap-2">
        {EJEMPLOS.map((e) => (
          <button key={e} onClick={() => ask(e)} disabled={busy}
            className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-40">
            {e}
          </button>
        ))}
      </div>

      <div className="mt-4 space-y-4">
        {turns.map((t, i) => (
          <div key={i} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="text-sm font-medium text-slate-900">{t.q}</div>
            {!t.answer && !t.error && <div className="mt-2 text-sm text-slate-400">Pensando…</div>}
            {t.error && <div className="mt-2 text-sm text-rose-600">{t.error}</div>}
            {t.answer && <div className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{t.answer}</div>}
            {t.tools && t.tools.length > 0 && (
              <details className="mt-3">
                <summary className="cursor-pointer text-xs text-slate-400">Ver datos consultados ({t.tools.length})</summary>
                <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-50 p-2 text-xs text-slate-600">{JSON.stringify(t.tools, null, 2)}</pre>
              </details>
            )}
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); ask(q); }}
        className="mt-4 flex gap-2"
      >
        <input
          value={q} onChange={(e) => setQ(e.target.value)} disabled={busy}
          placeholder="Escribe tu pregunta…"
          className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
        />
        <button type="submit" disabled={busy || !q.trim()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-40">
          {busy ? '…' : 'Preguntar'}
        </button>
      </form>
    </div>
  );
}
