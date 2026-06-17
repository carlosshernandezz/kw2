// Matcher conservador para movimientos Bs pendientes.
// Aprende identidades desde conciliaciones confirmadas:
//   - VENISUM/SOLUCIONES: cedula incluida en la descripcion bancaria.
//   - NENEKA: nombre o iniciales transcritos manualmente.
// Solo sugiere cuando banco, fecha, direccion, cliente y monto cuadran.
// Soporta 1:N si existe una unica combinacion exacta con identidad consistente.
import { dbClient } from './db.js';

const REASON_TAG = 'matcher Bs por identidad historica';
const EPS = 0.01;

type Identity = { key: string; kind: 'cedula' | 'descripcion' };
type Ledger = {
  id: number;
  clientId: number;
  client: string;
  account: string;
  date: string;
  direction: 'inflow' | 'outflow';
  amount: number;
  kw2Id: string;
};
type Statement = {
  id: number;
  bank: string;
  date: string;
  direction: 'inflow' | 'outflow';
  amount: number;
  description: string;
  identity: Identity | null;
};
type IdentityOwner = { clientId: number; client: string; evidence: number };
type Suggestion = { ledger: Ledger; rows: Statement[]; confidence: number; identity: Identity; evidence: number };

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

const NENEKA_CONTROL_DESCRIPTIONS = new Set(['COMISION', 'A', 'SI', 'AJUSTE BS', 'TS']);

function identityFor(bank: string, description: string): Identity | null {
  const normalizedBank = normalizeText(bank);
  const normalizedDescription = normalizeText(description);
  if (!normalizedDescription) return null;

  if (normalizedBank === 'BDV VENISUM' || normalizedBank === 'BDV SOLUCIONES') {
    const match = normalizedDescription.match(/(?:^|\s)V\s*0*([0-9]{6,10})(?:\s|$)/);
    return match ? { kind: 'cedula', key: match[1] } : null;
  }

  if (normalizedBank === 'NENEKA') {
    if (NENEKA_CONTROL_DESCRIPTIONS.has(normalizedDescription)) return null;
    return { kind: 'descripcion', key: normalizedDescription };
  }

  return null;
}

function mapKey(bank: string, identity: Identity): string {
  return `${normalizeText(bank)}|${identity.kind}|${identity.key}`;
}

function isCommissionRow(row: Statement): boolean {
  return normalizeText(row.description).startsWith('COMISION PAGO A PROVEEDORES');
}

function feeRate(account: string): number | null {
  if (account === 'BDV VENISUM' || account === 'BDV SOLUCIONES') return 0.0025;
  if (account === 'NENEKA') return 0.003;
  return null;
}

// Devuelve una combinacion solo si es unica. Requiere al menos una fila cuya
// identidad pertenezca al cliente; las filas sin identidad solo pueden ser
// comisiones del mismo banco/dia.
function uniqueSubset(target: number, rows: Statement[], owner: IdentityOwner, identityMap: Map<string, IdentityOwner>): Statement[] | null {
  const pool = rows.slice(0, 14);
  const solutions = new Map<string, Statement[]>();
  const chosen: Statement[] = [];

  const validIdentity = (row: Statement) => {
    if (!row.identity) return false;
    return identityMap.get(mapKey(row.bank, row.identity))?.clientId === owner.clientId;
  };

  const walk = (start: number, sum: number) => {
    if (solutions.size > 1) return;
    if (Math.abs(sum - target) <= EPS) {
      if (chosen.some(validIdentity)) {
        const signature = chosen.map((r) => r.id).sort((a, b) => a - b).join(',');
        solutions.set(signature, [...chosen]);
      }
      return;
    }
    if (sum > target + EPS || chosen.length >= 6) return;
    for (let i = start; i < pool.length; i++) {
      const row = pool[i];
      if (!validIdentity(row) && !isCommissionRow(row)) continue;
      chosen.push(row);
      walk(i + 1, sum + row.amount);
      chosen.pop();
    }
  };

  walk(0, 0);
  return solutions.size === 1 ? [...solutions.values()][0] : null;
}

async function main() {
  const db = dbClient();
  await db.connect();
  try {
    // Aprender alias solo de decisiones confirmadas. Si una identidad aparece
    // con clientes distintos queda excluida por ambigua.
    const history = await db.query(
      `SELECT et.raw_payload->>'banco' bank,
              COALESCE(et.raw_payload->>'descripcion','') description,
              fm.client_id, c.name client
       FROM reconciliations r
       JOIN external_transactions et ON et.id=r.external_transaction_id
       JOIN fund_movements fm ON fm.id=r.fund_movement_id
       JOIN clients c ON c.id=fm.client_id
       WHERE r.status='confirmed'
         AND et.source_type='bank_statement' AND et.source_account='EDO CTA BS'
         AND et.raw_payload->>'banco' IN ('BDV VENISUM','BDV SOLUCIONES','NENEKA')`,
    );

    const owners = new Map<string, Map<number, IdentityOwner>>();
    for (const row of history.rows) {
      const identity = identityFor(row.bank, row.description);
      if (!identity) continue;
      const key = mapKey(row.bank, identity);
      const candidates = owners.get(key) ?? new Map<number, IdentityOwner>();
      const current = candidates.get(Number(row.client_id));
      candidates.set(Number(row.client_id), {
        clientId: Number(row.client_id),
        client: row.client,
        evidence: (current?.evidence ?? 0) + 1,
      });
      owners.set(key, candidates);
    }
    const identityMap = new Map<string, IdentityOwner>();
    let ambiguousIdentities = 0;
    for (const [key, candidates] of owners) {
      if (candidates.size === 1) identityMap.set(key, [...candidates.values()][0]);
      else ambiguousIdentities++;
    }

    const ledgerResult = await db.query(
      `SELECT fm.id, fm.client_id, c.name client, a.name account,
              fm.effective_at::date::text date, fm.direction,
              fm.native_amount::float8 amount, fm.kw2_id
       FROM fund_movements fm
       JOIN accounts a ON a.id=fm.account_id
       JOIN clients c ON c.id=fm.client_id
       WHERE fm.source='google_sheet_movimientos' AND a.medium='bs'
         AND fm.status<>'voided'
         AND NULLIF(fm.source_payload->>'operacion','') IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM reconciliations r
           WHERE r.fund_movement_id=fm.id AND r.status IN ('confirmed','suggested')
         )
       ORDER BY fm.effective_at, fm.id`,
    );
    const ledger: Ledger[] = ledgerResult.rows.map((row) => ({
      id: Number(row.id), clientId: Number(row.client_id), client: row.client,
      account: row.account, date: row.date, direction: row.direction,
      amount: Number(row.amount), kw2Id: row.kw2_id,
    }));

    const statementResult = await db.query(
      `SELECT et.id, et.raw_payload->>'banco' bank,
              (et.effective_at AT TIME ZONE 'America/Caracas')::date::text date,
              et.direction, et.native_amount::float8 amount,
              COALESCE(et.raw_payload->>'descripcion','') description
       FROM external_transactions et
       WHERE et.source_type='bank_statement' AND et.source_account='EDO CTA BS'
         AND et.direction IS NOT NULL AND et.native_amount IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM reconciliations r
           WHERE r.external_transaction_id=et.id AND r.status IN ('confirmed','suggested')
         )
       ORDER BY et.effective_at, et.id`,
    );
    const statements: Statement[] = statementResult.rows.map((row) => ({
      id: Number(row.id), bank: row.bank, date: row.date, direction: row.direction,
      amount: Number(row.amount), description: row.description,
      identity: identityFor(row.bank, row.description),
    }));

    const suggestions: Suggestion[] = [];
    const usedStatements = new Set<number>();
    for (const movement of ledger) {
      const sameContext = statements.filter((row) =>
        !usedStatements.has(row.id)
        && row.bank === movement.account
        && row.date === movement.date
        && row.direction === movement.direction,
      );

      const identities = new Map<string, { identity: Identity; owner: IdentityOwner }>();
      for (const row of sameContext) {
        if (!row.identity) continue;
        const owner = identityMap.get(mapKey(row.bank, row.identity));
        if (owner?.clientId === movement.clientId) identities.set(mapKey(row.bank, row.identity), { identity: row.identity, owner });
      }

      const candidates: Suggestion[] = [];
      for (const { identity, owner } of identities.values()) {
        const compatible = sameContext.filter((row) => {
          if (isCommissionRow(row)) return true;
          if (!row.identity) return false;
          return identityMap.get(mapKey(row.bank, row.identity))?.clientId === movement.clientId;
        });
        let subset = uniqueSubset(movement.amount, compatible, owner, identityMap);
        if (!subset) continue;

        // Si el libro aun tiene solo el principal, adjuntar una fila real de
        // comision cuando sea unica y coincida con la tasa del banco. La
        // ausencia de fila implica 0% (incluye la excepcion NENEKA -> 0134).
        const rate = feeRate(movement.account);
        if (rate && subset.length === 1 && Math.abs(subset[0].amount - movement.amount) <= EPS) {
          const expectedFee = subset[0].amount * rate;
          const feeCandidates = sameContext.filter((row) => {
            if (subset!.some((selected) => selected.id === row.id)) return false;
            if (Math.abs(row.amount - expectedFee) > Math.max(EPS, expectedFee * 0.0001)) return false;
            if (movement.account !== 'NENEKA') return isCommissionRow(row);
            if (!row.identity) return false;
            return identityMap.get(mapKey(row.bank, row.identity))?.clientId === movement.clientId;
          });
          if (feeCandidates.length === 1) subset = [...subset, feeCandidates[0]];
        }
        candidates.push({
          ledger: movement,
          rows: subset,
          confidence: subset.length === 1 ? 0.99 : 0.98,
          identity,
          evidence: owner.evidence,
        });
      }

      // Una operacion solo se sugiere si hay una unica solucion compatible.
      const signatures = new Map(candidates.map((candidate) => [
        candidate.rows.map((row) => row.id).sort((a, b) => a - b).join(','), candidate,
      ]));
      if (signatures.size !== 1) continue;
      const suggestion = [...signatures.values()][0];
      suggestions.push(suggestion);
      suggestion.rows.forEach((row) => usedStatements.add(row.id));
    }

    await db.query('BEGIN');
    await db.query(
      `DELETE FROM reconciliations
       WHERE status='suggested' AND reasons @> $1::jsonb`,
      [JSON.stringify([REASON_TAG])],
    );
    let inserted = 0;
    for (const suggestion of suggestions) {
      for (const row of suggestion.rows) {
        const reason = [
          REASON_TAG,
          `banco, fecha, direccion e identidad coinciden`,
          `${suggestion.identity.kind}: ${suggestion.identity.key}`,
          `evidencia historica: ${suggestion.evidence}`,
          suggestion.rows.length === 1 ? 'monto exacto 1:1' : `suma exacta 1:${suggestion.rows.length}`,
        ];
        const result = await db.query(
          `INSERT INTO reconciliations
             (fund_movement_id, external_transaction_id, allocated_native_amount, status, confidence, reasons)
           VALUES ($1,$2,$3,'suggested',$4,$5)
           ON CONFLICT (fund_movement_id, external_transaction_id) DO NOTHING`,
          [suggestion.ledger.id, row.id, row.amount, suggestion.confidence, JSON.stringify(reason)],
        );
        inserted += result.rowCount ?? 0;
      }
    }
    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('agent','match-bs','suggest_reconciliations','account','EDO CTA BS',$1)`,
      [JSON.stringify({
        identities_univocas: identityMap.size,
        identities_ambiguas: ambiguousIdentities,
        movimientos_pendientes: ledger.length,
        filas_estado_disponibles: statements.length,
        operaciones_sugeridas: suggestions.length,
        enlaces_sugeridos: inserted,
      })],
    );
    await db.query('COMMIT');

    console.log(`Identidades historicas univocas: ${identityMap.size} | ambiguas: ${ambiguousIdentities}`);
    console.log(`Movimientos Bs pendientes con operacion: ${ledger.length}`);
    console.log(`Filas de estado disponibles: ${statements.length}`);
    console.log(`Operaciones sugeridas: ${suggestions.length} | enlaces sugeridos: ${inserted}`);
    for (const suggestion of suggestions.slice(0, 20)) {
      console.log(`  ${suggestion.ledger.kw2Id} ${suggestion.ledger.client} ${suggestion.ledger.account} ${suggestion.ledger.date}`
        + ` ${suggestion.ledger.amount.toFixed(2)} -> ${suggestion.rows.length} fila(s), confianza ${suggestion.confidence}`);
    }
  } catch (error) {
    await db.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await db.end();
  }
}

main().catch((error: any) => {
  console.error('Error:', error.message ?? error);
  process.exit(1);
});
