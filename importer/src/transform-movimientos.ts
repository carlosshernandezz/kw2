// Transforma el snapshot crudo de MOVIMIENTOS en fund_movements (1:1 por fila).
// Mecanico y fiel: no agrupa ni interpreta operaciones economicas.
// Re-ejecutable: reemplaza los fund_movements generados desde este origen.
import { dbClient } from './db.js';

const SOURCE = 'google_sheet_movimientos';

async function main() {
  const db = dbClient();
  await db.connect();

  try {
    const accounts = await db.query(`SELECT id, name, medium FROM accounts`);
    const accountByName = new Map(accounts.rows.map((a) => [a.name, a]));
    const clients = await db.query(`SELECT id, legacy_id FROM clients WHERE legacy_id IS NOT NULL`);
    const clientByLegacy = new Map(clients.rows.map((c) => [c.legacy_id, c.id]));

    const snap = await db.query(
      `SELECT raw_payload p FROM external_transactions
       WHERE source_type='google_sheet' AND source_account='MOVIMIENTOS'
       ORDER BY (raw_payload->>'row_number')::int`,
    );

    type Skip = { rn: number; reason: string };
    const skipped: Skip[] = [];
    const rows: {
      accountId: number; clientId: number | null; direction: string; medium: string;
      currency: string; native: number; usd: number; rate: number | null;
      date: string; sender: string | null; payload: unknown;
    }[] = [];

    for (const { p } of snap.rows) {
      const rn = Number(p.row_number);
      const account = accountByName.get(String(p.banco ?? '').trim());
      if (!account) { skipped.push({ rn, reason: `banco desconocido: ${p.banco}` }); continue; }

      const credito = typeof p.monto_credito === 'number' ? p.monto_credito : null;
      const debito = typeof p.monto_debito === 'number' ? p.monto_debito : null;
      const usd = Math.abs(credito ?? debito ?? 0);
      if (usd === 0) { skipped.push({ rn, reason: 'monto cero' }); continue; }

      const tipo = String(p.tipo ?? '').trim();
      if (tipo !== 'Ingreso' && tipo !== 'Egreso') { skipped.push({ rn, reason: `tipo invalido: ${tipo}` }); continue; }

      // El signo y la columna deben ser coherentes con el Tipo; si no,
      // la fila se excluye y se reporta para corregirla en el Sheet.
      if (tipo === 'Ingreso' && (credito == null || credito < 0)) {
        skipped.push({ rn, reason: `signo/columna inconsistente con Ingreso (cr=${credito}, db=${debito})` });
        continue;
      }
      if (tipo === 'Egreso' && (debito == null || debito > 0)) {
        skipped.push({ rn, reason: `signo/columna inconsistente con Egreso (cr=${credito}, db=${debito})` });
        continue;
      }

      const clientId = clientByLegacy.get(String(p.id_cliente ?? '')) ?? null;
      const tasa = typeof p.tasa === 'number' && p.tasa > 0 ? p.tasa : null;
      const montoBs = typeof p.monto_bs === 'number' ? Math.abs(p.monto_bs) : null;
      const useBs = account.medium === 'bs' && montoBs != null && montoBs > 0;

      // El serial ya viene convertido? No: payload.fecha es serial numerico.
      const fecha = new Date(Math.round((Number(p.fecha) - 25569) * 86400 * 1000))
        .toISOString().slice(0, 10);

      rows.push({
        accountId: account.id,
        clientId,
        direction: tipo === 'Ingreso' ? 'inflow' : 'outflow',
        medium: account.medium,
        currency: useBs ? 'VES' : 'USD',
        native: useBs ? montoBs : usd,
        usd,
        rate: tasa,
        date: fecha,
        sender: String(p.emisor_beneficiario ?? '').trim() || null,
        payload: p,
      });
    }

    await db.query('BEGIN');
    const del = await db.query(`DELETE FROM fund_movements WHERE source = $1`, [SOURCE]);

    const CHUNK = 300;
    let inserted = 0;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((r, j) => {
        const b = j * 11;
        values.push(
          r.accountId, r.clientId, r.direction, r.medium, r.currency,
          r.native, r.usd, r.rate, r.date, r.sender, JSON.stringify(r.payload),
        );
        return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6}, $${b + 7}, $${b + 8}, ($${b + 9}::date)::timestamptz, $${b + 10}, '${SOURCE}', $${b + 11})`;
      });
      const res = await db.query(
        `INSERT INTO fund_movements
           (account_id, client_id, direction, medium, native_currency, native_amount,
            usd_amount, exchange_rate, effective_at, sender_or_recipient, source, source_payload)
         VALUES ${tuples.join(', ')}`,
        values,
      );
      inserted += res.rowCount ?? 0;
    }

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('importer', 'transform-movimientos', 'transform_to_fund_movements', 'import_run',
               to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), $1)`,
      [JSON.stringify({ snapshot_rows: snap.rows.length, inserted, deleted_previous: del.rowCount, skipped })],
    );
    await db.query('COMMIT');

    console.log(`Snapshot: ${snap.rows.length} filas | fund_movements insertados: ${inserted} | reemplazados: ${del.rowCount}`);
    console.log(`Omitidas: ${skipped.length}`);
    const byReason = new Map<string, number>();
    for (const s of skipped) byReason.set(s.reason.split(':')[0], (byReason.get(s.reason.split(':')[0]) ?? 0) + 1);
    for (const [r, n] of byReason) console.log(`  ${r}: ${n}`);
  } catch (err) {
    await db.query('ROLLBACK');
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
