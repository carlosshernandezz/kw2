'use client';

import { useState } from 'react';

export default function SyncButton() {
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState<string | null>(null);
  const [ok, setOk] = useState(true);

  async function sync() {
    setBusy(true);
    setOutput(null);
    try {
      const r = await fetch('/api/sync', { method: 'POST' });
      const d = await r.json();
      setOk(d.ok);
      setOutput(d.output || '(sin salida)');
    } catch (e) {
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
      {busy && <p className="mt-2 text-sm text-slate-500">Esto puede tardar ~30–60 segundos.</p>}
      {output && (
        <pre className={'mt-3 max-h-80 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap ' + (ok ? 'border-slate-200 bg-slate-50 text-slate-700' : 'border-rose-200 bg-rose-50 text-rose-700')}>
          {output}
        </pre>
      )}
    </div>
  );
}
