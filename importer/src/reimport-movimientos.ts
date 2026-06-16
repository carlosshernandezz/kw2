// Reimport SEGURO de MOVIMIENTOS: empareja cada fila del snapshot con su
// fund_movement por kw2_id (ancla estable), sin borrar ni recrear.
//   - kw2_id nuevo  -> inserta un fund_movement nuevo.
//   - kw2_id existe -> actualiza sus campos (monto, fecha, etc.) conservando el
//                      ID y sus conciliaciones.
//   - fund_movement cuyo kw2_id ya no esta en el Sheet -> se marca 'voided'.
// Tras actualizar, recalcula el estado; si una conciliacion confirmada ya no
// cuadra con el nuevo monto, el movimiento queda 'needs_review' para revisarlo.
import { dbClient } from './db.js';

const SOURCE = 'google_sheet_movimientos';
const TOL = 0.02;

function serialToDate(serial: number): string {
  return new Date(Math.round((serial - 25569) * 86400 * 1000)).toISOString().slice(0, 10);
}

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

    const skipped: { rn: number; reason: string }[] = [];
    const rows: any[] = [];
    const snapshotKw2 = new Set<string>();

    // Red de seguridad: kw2_id duplicados (ej. fila copiada/pegada antes de que
    // el Apps Script reasigne). No se procesan, para no corromper datos.
    const kw2Count = new Map<string, number>();
    for (const { p } of snap.rows) {
      const k = String(p.kw2_id ?? '').trim();
      if (k) kw2Count.set(k, (kw2Count.get(k) ?? 0) + 1);
    }
    const dupSet = new Set([...kw2Count].filter(([, c]) => c > 1).map(([k]) => k));

    for (const { p } of snap.rows) {
      const rn = Number(p.row_number);
      const kw2 = String(p.kw2_id ?? '').trim();
      if (!kw2) { skipped.push({ rn, reason: 'sin kw2_id' }); continue; }
      snapshotKw2.add(kw2); // presente en el Sheet: no anular su movimiento
      if (dupSet.has(kw2)) { skipped.push({ rn, reason: `kw2_id duplicado: ${kw2}` }); continue; }

      const account = accountByName.get(String(p.banco ?? '').trim());
      if (!account) { skipped.push({ rn, reason: `banco desconocido: ${p.banco}` }); continue; }
      const credito = typeof p.monto_credito === 'number' ? p.monto_credito : null;
      const debito = typeof p.monto_debito === 'number' ? p.monto_debito : null;
      const usd = Math.abs(credito ?? debito ?? 0);
      if (usd === 0) { skipped.push({ rn, reason: 'monto cero' }); continue; }
      const tipo = String(p.tipo ?? '').trim();
      if (tipo !== 'Ingreso' && tipo !== 'Egreso') { skipped.push({ rn, reason: `tipo invalido: ${tipo}` }); continue; }
      if (tipo === 'Ingreso' && (credito == null || credito < 0)) { skipped.push({ rn, reason: 'signo inconsistente con Ingreso' }); continue; }
      if (tipo === 'Egreso' && (debito == null || debito > 0)) { skipped.push({ rn, reason: 'signo inconsistente con Egreso' }); continue; }

      const clientId = clientByLegacy.get(String(p.id_cliente ?? '')) ?? null;
      const tasa = typeof p.tasa === 'number' && p.tasa > 0 ? p.tasa : null;
      const montoBs = typeof p.monto_bs === 'number' ? Math.abs(p.monto_bs) : null;
      const useBs = account.medium === 'bs' && montoBs != null && montoBs > 0;

      rows.push({
        kw2, accountId: account.id, clientId,
        direction: tipo === 'Ingreso' ? 'inflow' : 'outflow',
        medium: account.medium, currency: useBs ? 'VES' : 'USD',
        native: useBs ? montoBs : usd, usd, rate: tasa,
        date: serialToDate(Number(p.fecha)),
        sender: String(p.emisor_beneficiario ?? '').trim() || null, payload: p,
      });
    }

    await db.query('BEGIN');
    let inserted = 0, updated = 0;
    for (const r of rows) {
      const res = await db.query(
        `INSERT INTO fund_movements
           (kw2_id, account_id, client_id, direction, medium, native_currency, native_amount,
            usd_amount, exchange_rate, effective_at, sender_or_recipient, source, source_payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,($10::date)::timestamptz,$11,$12,$13)
         ON CONFLICT (kw2_id) WHERE kw2_id IS NOT NULL DO UPDATE SET
           account_id=EXCLUDED.account_id, client_id=EXCLUDED.client_id, direction=EXCLUDED.direction,
           medium=EXCLUDED.medium, native_currency=EXCLUDED.native_currency, native_amount=EXCLUDED.native_amount,
           usd_amount=EXCLUDED.usd_amount, exchange_rate=EXCLUDED.exchange_rate, effective_at=EXCLUDED.effective_at,
           sender_or_recipient=EXCLUDED.sender_or_recipient, source_payload=EXCLUDED.source_payload, updated_at=now()
         RETURNING (xmax = 0) AS inserted`,
        [r.kw2, r.accountId, r.clientId, r.direction, r.medium, r.currency, r.native, r.usd, r.rate, r.date, r.sender, SOURCE, JSON.stringify(r.payload)],
      );
      res.rows[0].inserted ? inserted++ : updated++;
    }

    // Filas borradas en el Sheet: kw2_id que ya no aparece.
    const voidRes = await db.query(
      `UPDATE fund_movements SET status='voided', updated_at=now()
       WHERE source=$1 AND status<>'voided' AND kw2_id IS NOT NULL AND NOT (kw2_id = ANY($2::text[]))
       RETURNING id, kw2_id,
         (SELECT count(*) FROM reconciliations r WHERE r.fund_movement_id=fund_movements.id AND r.status<>'rejected') AS recon`,
      [SOURCE, [...snapshotKw2]],
    );
    const voidedWithRecon = voidRes.rows.filter((r: any) => Number(r.recon) > 0);

    // Recalcular estado y marcar needs_review si una conciliacion ya no cuadra.
    const flagged = await db.query(
      `UPDATE fund_movements f SET status = CASE
         WHEN s.c = 0 THEN 'posted'
         WHEN abs(s.c - f.usd_amount) <= $2 THEN 'reconciled'
         ELSE 'needs_review' END, updated_at=now()
       FROM (SELECT fund_movement_id, COALESCE(SUM(allocated_native_amount),0) c
             FROM reconciliations WHERE status='confirmed' GROUP BY fund_movement_id) s
       WHERE f.id=s.fund_movement_id AND f.source=$1 AND f.status<>'voided'
       RETURNING f.id, f.status, f.kw2_id, f.usd_amount, s.c`,
      [SOURCE, TOL],
    );
    const needsReview = flagged.rows.filter((r: any) => r.status === 'needs_review');

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('importer','reimport-movimientos','safe_reimport','account','MOVIMIENTOS',$1)`,
      [JSON.stringify({ inserted, updated, voided: voidRes.rowCount, voided_with_recon: voidedWithRecon.length, needs_review: needsReview.length, skipped: skipped.length })],
    );
    await db.query('COMMIT');

    console.log(`Insertados: ${inserted} | Actualizados: ${updated} | Anulados (borrados en Sheet): ${voidRes.rowCount}`);
    console.log(`Omitidos: ${skipped.length}`);
    if (dupSet.size > 0) {
      console.log(`\n⚠ kw2_id DUPLICADOS en el Sheet (no procesados, corregir): ${[...dupSet].join(', ')}`);
      console.log('  Suele pasar al copiar/pegar una fila. El Apps Script los reasigna solo en unos segundos; vuelve a sincronizar.');
    }
    if (voidedWithRecon.length) console.log(`  ⚠ ${voidedWithRecon.length} anulados TENIAN conciliaciones (revisar): ${voidedWithRecon.map((r:any)=>r.kw2_id).join(', ')}`);
    if (needsReview.length) {
      console.log(`\n⚠ ${needsReview.length} movimientos quedaron 'needs_review' (su conciliacion ya no cuadra con el nuevo monto):`);
      for (const r of needsReview) console.log(`   ${r.kw2_id}: libro ${Number(r.usd_amount).toFixed(2)} vs conciliado ${Number(r.c).toFixed(2)}`);
    }
  } catch (e: any) {
    await db.query('ROLLBACK');
    throw e;
  } finally {
    await db.end();
  }
}

main().catch((err) => { console.error('Error:', err.message ?? err); process.exit(1); });
