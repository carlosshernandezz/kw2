import { listIntakes } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

const statusLabel: Record<string, string> = {
  received: 'Recibida', interpreting: 'Interpretando', needs_information: 'Falta información',
  ready_for_review: 'Lista para revisar', approved: 'Aprobada', rejected: 'Rechazada', failed: 'Error',
};

export default async function Page() {
  const rows = await listIntakes();
  return <div className="mx-auto max-w-6xl">
    <div className="flex items-end justify-between gap-4">
      <div><h1 className="text-2xl font-semibold text-slate-900">Operaciones recibidas</h1><p className="mt-1 text-slate-500">Bandeja central de reportes enviados al WhatsApp de KW2.</p></div>
      <div className="text-sm text-slate-500">{rows.length} recepciones</div>
    </div>

    <div className="mt-6 overflow-x-auto border-y border-slate-200 bg-white">
      <table className="w-full min-w-[900px] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr>
          <th className="px-3 py-3">Recepción</th><th className="px-3 py-3">Reportado por</th>
          <th className="px-3 py-3">Mensaje</th><th className="px-3 py-3">Comprobante</th><th className="px-3 py-3">Estado</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {!rows.length && <tr><td colSpan={5} className="px-3 py-14 text-center text-slate-400">Todavía no se han recibido operaciones por WhatsApp.</td></tr>}
          {rows.map((row) => <tr key={row.id} className="align-top">
            <td className="px-3 py-3"><div className="font-medium text-slate-800">REP-{row.id}</div><div className="mt-1 text-xs text-slate-500">{new Date(row.receivedAt).toLocaleString('es-VE', { timeZone: 'America/Caracas' })}</div></td>
            <td className="px-3 py-3"><div className={row.reporterKnown ? 'font-medium text-slate-800' : 'font-medium text-amber-700'}>{row.reporter}</div>{!row.reporterKnown && <div className="mt-1 text-xs text-amber-600">Número no autorizado</div>}</td>
            <td className="max-w-md px-3 py-3"><div className="whitespace-pre-wrap text-slate-700">{row.text || 'Sin descripción'}</div><div className="mt-1 text-xs text-slate-400">Tipo: {row.type}</div></td>
            <td className="px-3 py-3">{row.hasMedia ? <span className="font-medium text-sky-700">Archivo recibido</span> : <span className="text-amber-600">Sin archivo</span>}{row.error && <div className="mt-1 max-w-xs text-xs text-rose-600">{row.error}</div>}</td>
            <td className="px-3 py-3"><span className="inline-block border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700">{statusLabel[row.status] ?? row.status}</span></td>
          </tr>)}
        </tbody>
      </table>
    </div>
  </div>;
}
