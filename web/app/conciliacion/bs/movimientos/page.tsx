import { bsMovements, type BsMovementList } from '@/lib/bs-reconciliation';

export const dynamic = 'force-dynamic';

const labels = {
  reconciled: { title: 'Movimientos Bs conciliados', help: 'Tienen al menos una conciliación confirmada contra EDO CTA BS.' },
  suggested: { title: 'Sugerencias Bs', help: 'Tienen una sugerencia pendiente de confirmación o rechazo.' },
  'not-applicable': { title: 'Movimientos Bs donde no aplica', help: 'No tienen número de operación en MOVIMIENTOS; por eso no participan en la conciliación principal de columna O/D.' },
};

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const params = await searchParams;
  const status = (['reconciled', 'suggested', 'not-applicable'].includes(params.status ?? '') ? params.status : 'reconciled') as BsMovementList['status'];
  const data = await bsMovements(status, Number(params.page ?? 1));
  const copy = labels[status];
  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
  return <div className="mx-auto max-w-7xl">
    <div className="flex items-end justify-between gap-4"><div><h1 className="text-2xl font-semibold text-slate-900">{copy.title}</h1><p className="mt-1 text-sm text-slate-500">{copy.help}</p></div><a href="/conciliacion/bs" className="text-sm font-medium text-sky-700 hover:underline">Volver</a></div>
    <div className="mt-5 flex items-center justify-between text-sm text-slate-600"><span>{data.total.toLocaleString('es-VE')} movimientos</span><span>Página {data.page} de {pages}</span></div>
    <div className="mt-3 overflow-x-auto border-y border-slate-200 bg-white"><table className="w-full min-w-[980px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2">Banco</th><th className="px-3 py-2">Cliente</th><th className="px-3 py-2">Dirección</th><th className="px-3 py-2 text-right">USD</th><th className="px-3 py-2 text-right">Bs</th><th className="px-3 py-2 text-right">Operación</th><th className="px-3 py-2 text-right">Fila</th><th className="px-3 py-2">ID</th></tr></thead><tbody className="divide-y divide-slate-100">{data.rows.map((row) => <tr key={row.id}><td className="px-3 py-2">{row.date}</td><td className="px-3 py-2">{row.bank}</td><td className="px-3 py-2">{row.client}</td><td className="px-3 py-2">{row.direction === 'inflow' ? 'Ingreso' : 'Egreso'}</td><td className="px-3 py-2 text-right">{row.usdAmount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td><td className="px-3 py-2 text-right">{row.bsAmount.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</td><td className="px-3 py-2 text-right">{row.operation ?? '—'}</td><td className="px-3 py-2 text-right">{row.row ?? '—'}</td><td className="px-3 py-2 text-xs text-slate-500">{row.kw2Id ?? '—'}</td></tr>)}</tbody></table></div>
    <div className="mt-4 flex justify-between">{data.page > 1 ? <a className="text-sm font-medium text-sky-700 hover:underline" href={`?status=${status}&page=${data.page - 1}`}>Anterior</a> : <span />}{data.page < pages && <a className="text-sm font-medium text-sky-700 hover:underline" href={`?status=${status}&page=${data.page + 1}`}>Siguiente</a>}</div>
  </div>;
}
