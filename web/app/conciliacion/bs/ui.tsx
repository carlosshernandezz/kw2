'use client';

import { useMemo, useState } from 'react';
import type { AmbiguousIdentity, AmbiguousIdentityOperation, BsSuggestion } from '@/lib/bs-reconciliation';

const money = (value: number) => value.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default function BsClient({ initialSummary, initialSuggestions, initialAmbiguous }: {
  initialSummary: any; initialSuggestions: BsSuggestion[]; initialAmbiguous: AmbiguousIdentity[];
}) {
  const [summary, setSummary] = useState(initialSummary);
  const [suggestions, setSuggestions] = useState(initialSuggestions);
  const [ambiguous, setAmbiguous] = useState(initialAmbiguous);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [openEvidence, setOpenEvidence] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, AmbiguousIdentityOperation[]>>({});
  const [evidenceError, setEvidenceError] = useState('');
  const [reviewing, setReviewing] = useState<string | null>(null);
  const [ruleStrategy, setRuleStrategy] = useState<'preferred_client' | 'bridge_account'>('preferred_client');
  const [ruleClientId, setRuleClientId] = useState<number>(0);
  const [ruleInstruction, setRuleInstruction] = useState('');
  const [identityFilters, setIdentityFilters] = useState({ bank: '', type: '', identity: '', clients: '' });

  const filteredIdentities = useMemo(() => ambiguous.filter((item) => {
    const clients = item.clients.map((client) => client.name).join(' ');
    return item.bank.toLowerCase().includes(identityFilters.bank.toLowerCase())
      && item.type.toLowerCase().includes(identityFilters.type.toLowerCase())
      && item.identity.toLowerCase().includes(identityFilters.identity.toLowerCase())
      && clients.toLowerCase().includes(identityFilters.clients.toLowerCase());
  }), [ambiguous, identityFilters]);
  const ambiguousPending = filteredIdentities.filter((item) => !item.rule);
  const verifiedIdentities = filteredIdentities.filter((item) => item.rule);

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

  async function showEvidence(item: AmbiguousIdentity, clientId: number) {
    const key = `${item.bank}|${item.type}|${item.identity}|${clientId}`;
    if (openEvidence === key) {
      setOpenEvidence(null);
      return;
    }
    setOpenEvidence(key);
    setEvidenceError('');
    if (evidence[key]) return;
    try {
      const query = new URLSearchParams({ bank: item.bank, type: item.type, identity: item.identity, clientId: String(clientId) });
      const response = await fetch(`/api/bs/operations?${query}`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'No se pudo cargar el detalle');
      setEvidence((current) => ({ ...current, [key]: data.operations }));
    } catch (error: any) {
      setEvidenceError(error.message);
    }
  }

  function startReview(item: AmbiguousIdentity) {
    const key = `${item.bank}|${item.type}|${item.identity}`;
    if (reviewing === key) { setReviewing(null); return; }
    setReviewing(key);
    setRuleStrategy(item.rule?.strategy ?? 'preferred_client');
    setRuleClientId(item.rule?.clientId ?? item.clients[0]?.id ?? 0);
    setRuleInstruction(item.rule?.instruction ?? '');
    setMessage('');
  }

  async function saveRule(item: AmbiguousIdentity) {
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/bs/identity-rule', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bank: item.bank, type: item.type, identity: item.identity, strategy: ruleStrategy, clientId: ruleClientId, instruction: ruleInstruction }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'No se pudo guardar la regla.');
      setMessage(`Identidad ${item.identity} revisada. El matcher usará la regla en la próxima ejecución.`);
      setReviewing(null);
      await refresh();
    } catch (error: any) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  function identityTable(items: AmbiguousIdentity[], emptyText: string) {
    return <div className="mt-3 overflow-x-auto border-y border-slate-200 bg-white">
      <table className="w-full min-w-[1050px] text-sm"><thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Banco</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Identidad</th><th className="px-3 py-2">Clientes históricos</th><th className="px-3 py-2">Regla</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{!items.length && <tr><td colSpan={5} className="px-3 py-8 text-center text-slate-400">{emptyText}</td></tr>}{items.map((item) => {
          const itemKey = `${item.bank}-${item.type}-${item.identity}`;
          const selectedClient = item.clients.find((client) => openEvidence === `${item.bank}|${item.type}|${item.identity}|${client.id}`);
          const selectedKey = selectedClient ? `${item.bank}|${item.type}|${item.identity}|${selectedClient.id}` : null;
          return <tr key={itemKey}>
            <td className="px-3 py-2">{item.bank}</td>
            <td className="px-3 py-2 text-slate-500">{item.type}</td>
            <td className="px-3 py-2 font-medium">{item.identity}</td>
            <td className="px-3 py-2"><div>{item.clients.map((client, index) => {
              const key = `${item.bank}|${item.type}|${item.identity}|${client.id}`;
              return <span key={key}>{index > 0 && <span className="text-slate-400"> · </span>}<button type="button" onClick={() => showEvidence(item, client.id)} className={`text-left underline decoration-slate-400 underline-offset-2 hover:text-sky-700 ${openEvidence === key ? 'font-semibold text-sky-700' : ''}`}>{client.name} ({client.evidence})</button></span>;
            })}</div>{selectedClient && selectedKey && <div className="mt-3 bg-slate-50 p-3"><EvidenceDetail clientName={selectedClient.name} operations={evidence[selectedKey]} error={evidenceError} /></div>}</td>
            <td className="min-w-[240px] px-3 py-2 align-top">
              {item.rule && <div className="mb-2"><div className="text-xs font-semibold text-emerald-700">Verificado · {item.rule.strategy === 'preferred_client' ? 'cliente preferido' : 'cuenta puente'}</div><div className="mt-1 text-xs text-slate-600">{item.rule.clientName} · monto exacto</div><div className="mt-1 text-xs text-slate-500">{item.rule.instruction}</div></div>}
              <button type="button" onClick={() => startReview(item)} className="text-sm font-medium text-sky-700 underline underline-offset-2">{item.rule ? 'Editar verificación' : 'Marcar como revisado'}</button>
              {reviewing === `${item.bank}|${item.type}|${item.identity}` && <RuleEditor item={item} strategy={ruleStrategy} setStrategy={setRuleStrategy} clientId={ruleClientId} setClientId={setRuleClientId} instruction={ruleInstruction} setInstruction={setRuleInstruction} busy={busy} save={() => saveRule(item)} />}
            </td>
          </tr>;
        })}</tbody></table>
    </div>;
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
        <Card label="Conciliados" value={summary.reconciled} href="/conciliacion/bs/movimientos?status=reconciled" />
        <Card label="Sugerencias" value={summary.suggested} href="/conciliacion/bs/movimientos?status=suggested" />
        <Card label="Pendientes reales" value={summary.pending} href="/conciliacion/bs/pendientes" />
        <Card label="No aplica" value={summary.not_applicable} href="/conciliacion/bs/movimientos?status=not-applicable" />
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
        <h2 className="text-lg font-semibold text-slate-900">Identidades</h2>
        <p className="mt-1 text-sm text-slate-500">Filtra la evidencia histórica y revisa cómo debe procesarse cada identidad.</p>
        <div className="mt-3 grid gap-3 border-y border-slate-200 bg-white p-3 md:grid-cols-4">
          <Filter label="Banco" value={identityFilters.bank} onChange={(value) => setIdentityFilters((current) => ({ ...current, bank: value }))} />
          <Filter label="Tipo" value={identityFilters.type} onChange={(value) => setIdentityFilters((current) => ({ ...current, type: value }))} />
          <Filter label="Identidad" value={identityFilters.identity} onChange={(value) => setIdentityFilters((current) => ({ ...current, identity: value }))} />
          <Filter label="Clientes históricos" value={identityFilters.clients} onChange={(value) => setIdentityFilters((current) => ({ ...current, clients: value }))} />
        </div>
        <h3 className="mt-6 text-base font-semibold text-slate-900">Identidades ambiguas ({ambiguousPending.length})</h3>
        <p className="mt-1 text-sm text-slate-500">No producen sugerencias hasta que un operador defina una regla.</p>
        {identityTable(ambiguousPending, 'No hay identidades ambiguas con estos filtros.')}
        <h3 className="mt-8 text-base font-semibold text-slate-900">Identidades verificadas ({verifiedIdentities.length})</h3>
        <p className="mt-1 text-sm text-slate-500">Tienen una regla activa y pueden editarse si cambia el comportamiento.</p>
        {identityTable(verifiedIdentities, 'Todavía no hay identidades verificadas con estos filtros.')}
      </section>
    </div>
  );
}

function EvidenceDetail({ clientName, operations, error }: { clientName: string; operations?: AmbiguousIdentityOperation[]; error: string }) {
  if (error) return <div className="text-sm text-rose-700">{error}</div>;
  if (!operations) return <div className="text-sm text-slate-500">Cargando operaciones de {clientName}...</div>;
  return <div>
    <div className="mb-2 text-sm font-semibold text-slate-800">Operaciones conciliadas de {clientName}</div>
    <div className="overflow-x-auto border border-slate-200 bg-white">
      <table className="w-full min-w-[620px] text-sm">
        <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500"><tr><th className="px-3 py-2">Fecha</th><th className="px-3 py-2 text-right">Monto USD</th><th className="px-3 py-2 text-right">Monto Bs</th><th className="px-3 py-2 text-right">Fila MOVIMIENTOS</th><th className="px-3 py-2">ID</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{operations.map((operation) => <tr key={operation.reconciliationId}><td className="px-3 py-2">{operation.date}</td><td className="px-3 py-2 text-right">{operation.usdAmount == null ? '—' : money(operation.usdAmount)}</td><td className="px-3 py-2 text-right">{money(operation.bsAmount)}</td><td className="px-3 py-2 text-right">{operation.row ?? '—'}</td><td className="px-3 py-2 text-xs text-slate-500">{operation.kw2Id ?? '—'}</td></tr>)}</tbody>
      </table>
    </div>
  </div>;
}

function RuleEditor({ item, strategy, setStrategy, clientId, setClientId, instruction, setInstruction, busy, save }: {
  item: AmbiguousIdentity; strategy: 'preferred_client' | 'bridge_account';
  setStrategy: (value: 'preferred_client' | 'bridge_account') => void;
  clientId: number; setClientId: (value: number) => void;
  instruction: string; setInstruction: (value: string) => void; busy: boolean; save: () => void;
}) {
  return <div className="mt-3 border border-slate-200 bg-slate-50 p-3">
    <label className="block text-xs font-medium text-slate-700">Comportamiento<select value={strategy} onChange={(event) => setStrategy(event.target.value as 'preferred_client' | 'bridge_account')} className="mt-1 w-full border border-slate-300 bg-white px-2 py-1.5 text-sm"><option value="preferred_client">Cliente preferido desde ahora</option><option value="bridge_account">Cuenta puente</option></select></label>
    <label className="mt-2 block text-xs font-medium text-slate-700">{strategy === 'bridge_account' ? 'Único cliente permitido' : 'Cliente esperado'}<select value={clientId} onChange={(event) => setClientId(Number(event.target.value))} className="mt-1 w-full border border-slate-300 bg-white px-2 py-1.5 text-sm">{item.clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
    <div className="mt-2 text-xs text-slate-500">La fecha, banco, dirección y monto exacto también deberán coincidir.</div>
    <label className="mt-2 block text-xs font-medium text-slate-700">Instrucción para el sistema<textarea value={instruction} onChange={(event) => setInstruction(event.target.value)} rows={4} placeholder="Explica qué ocurrió históricamente y cómo debe procesarse en adelante." className="mt-1 w-full resize-y border border-slate-300 bg-white px-2 py-1.5 text-sm" /></label>
    <button type="button" disabled={busy || !clientId || instruction.trim().length < 12} onClick={save} className="mt-2 bg-sky-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-40">Guardar revisión</button>
  </div>;
}

function Filter({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block text-xs font-medium text-slate-600">{label}<input value={value} onChange={(event) => onChange(event.target.value)} placeholder={`Filtrar ${label.toLowerCase()}`} className="mt-1 w-full border border-slate-300 px-3 py-2 text-sm font-normal text-slate-900 outline-none focus:border-sky-500" /></label>;
}

function Card({ label, value, href }: { label: string; value: number; href?: string }) {
  const content = <><div className="text-xs uppercase text-slate-400">{label}</div><div className="mt-1 text-2xl font-semibold text-slate-900">{value}</div></>;
  return href ? <a href={href} className="border border-slate-200 bg-white p-4 hover:border-sky-400 hover:bg-sky-50">{content}</a> : <div className="border border-slate-200 bg-white p-4">{content}</div>;
}
