'use client';

import { useState } from 'react';

export default function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  async function runPhase(
    chunks: string[],
    phase: string,
    label: string,
    extraBody: Record<string, unknown> = {},
  ): Promise<{ done?: boolean; nextOffset?: number; batchId?: string; totalRows?: number }> {
    chunks.push(`\n## ${label}`);
    setOutput(chunks.join('\n').trim());

    const r = await fetch('/api/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phase, ...extraBody }),
    });
    const text = await r.text();
    let d: { ok?: boolean; output?: string; done?: boolean; nextOffset?: number; batchId?: string; totalRows?: number };
    try {
      d = JSON.parse(text);
    } catch {
      throw new Error(`La fase "${label}" no devolvio JSON. HTTP ${r.status}: ${text.slice(0, 300)}`);
    }
    if (!r.ok || !d.ok) {
      chunks.push(d.output || `Error HTTP ${r.status}`);
      setOk(false);
      setOutput(chunks.join('\n').trim());
      throw new Error('__KW2_SYNC_STOP__');
    }

    chunks.push(d.output || '(sin salida)');
    setOutput(chunks.join('\n').trim());
    return { done: d.done, nextOffset: d.nextOffset, batchId: d.batchId, totalRows: d.totalRows };
  }

  async function sync() {
    setBusy(true);
    setOutput(null);
    try {
      const chunks: string[] = [];
      await runPhase(chunks, 'data', 'DATA: clientes y cuentas');
      const snapshot = await runPhase(chunks, 'movimientos-snapshot', 'MOVIMIENTOS: snapshot del Sheet');
      if (!snapshot.batchId) throw new Error('El servidor no devolvio el identificador del snapshot. No se puede continuar con seguridad.');

      let offset = 0;
      const limit = 500;
      let completed = false;
      for (let lote = 1; lote <= 1000; lote++) {
        const progress = await runPhase(
          chunks,
          'movimientos-reimport',
          `MOVIMIENTOS: reimport lote ${lote}`,
          { batchId: snapshot.batchId, offset, limit },
        );
        if (progress.done) {
          completed = true;
          break;
        }
        offset = progress.nextOffset ?? offset + limit;
      }
      if (!completed) throw new Error('La sincronizacion supero 1.000 lotes sin terminar. No se aplico el cierre por seguridad.');

      await runPhase(chunks, 'movimientos-finalize', 'MOVIMIENTOS: finalizar', { batchId: snapshot.batchId });
      await runPhase(chunks, 'sources', 'Estados externos');
      await runPhase(chunks, 'bs', 'Conciliacion Bs');
      await runPhase(chunks, 'suggestions', 'Sugerencias Bs');
      setOk(true);
    } catch (e) {
      if (e instanceof Error && e.message === '__KW2_SYNC_STOP__') return;
      setOk(false);
      setOutput(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        onClick={sync}
        disabled={busy}
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50"
      >
        {busy ? 'Sincronizando con el Sheet…' : 'Sincronizar con el Sheet'}
      </button>
      {busy && <p className="mt-2 text-sm text-slate-500">Esto corre por etapas para evitar cortes de Vercel. Puede tardar varios minutos.</p>}
      {output && (
        <pre className={'mt-3 max-h-80 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap ' + (ok ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-rose-200 bg-rose-50 text-rose-700')}>
          {output}
        </pre>
      )}
    </div>
  );
}
