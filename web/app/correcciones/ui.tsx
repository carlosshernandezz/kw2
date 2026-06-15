'use client';

import { useState } from 'react';
import type { Correction } from '@/lib/corrections';

export default function CorrectionsClient({ initial }: { initial: Correction[] }) {
  const [rows, setRows] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function act(id: number, action: 'applied' | 'dismissed') {
    setBusy(true);
    try {
      await fetch('/api/corrections', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ action, ids: [id] }),
      });
      const res = await fetch('/api/corrections', { cache: 'no-store' });
      setRows((await res.json()).corrections);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="text-2xl font-semibold text-slate-900">Cambios para la hoja MOVIMIENTOS</h1>
      <p className="mt-1 text-slate-500">
        Lista de correcciones para aplicar <strong>a mano</strong> en el Google Sheet. El sistema no
        modifica la hoja. Cuando apliques un cambio, márcalo como aplicado y reimporta.
      </p>

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2">Fila</th>
              <th className="px-3 py-2">Ubicar la fila</th>
              <th className="px-3 py-2">Columna</th>
              <th className="px-3 py-2">Cambiar</th>
              <th className="px-3 py-2">Motivo</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  No hay cambios pendientes.
                </td>
              </tr>
            )}
            {rows.map((c) => (
              <tr key={c.id}>
                <td className="px-3 py-2 font-medium">{c.row ?? '—'}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {String(c.locator.fecha ?? '')} · {String(c.locator.banco ?? '')} ·{' '}
                  {String(c.locator.nombre ?? '')}
                  {c.locator.operacion ? ` · op ${c.locator.operacion}` : ''}
                </td>
                <td className="px-3 py-2">{c.column}</td>
                <td className="px-3 py-2">
                  <span className="text-rose-600 line-through">{c.current}</span>
                  <span className="mx-1 text-slate-400">→</span>
                  <span className="font-medium text-emerald-700">{c.proposed}</span>
                </td>
                <td className="px-3 py-2 text-xs text-slate-500">{c.reason}</td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    disabled={busy}
                    onClick={() => act(c.id, 'applied')}
                    className="mr-2 text-xs font-medium text-emerald-600 hover:underline disabled:opacity-40"
                  >
                    Marcar aplicada
                  </button>
                  <button
                    disabled={busy}
                    onClick={() => act(c.id, 'dismissed')}
                    className="text-xs font-medium text-slate-500 hover:underline disabled:opacity-40"
                  >
                    Descartar
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
