// Importa Mapeo Zelle (columnas A:B) al maestro client_aliases.
// El alias se vincula al cliente por nombre exacto normalizado; los que no
// matcheen se importan sin cliente (status 'unidentified') para revision.
// Nota: la hoja no distingue emisor de beneficiario; se usa 'zelle_sender'
// porque el mapeo se usa para identificar de quien vino un pago.
import { readRange } from './sheets.js';
import { dbClient } from './db.js';

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

async function main() {
  const rows = await readRange("'Mapeo Zelle'!A2:B100000");
  const pairs = rows
    .map((r) => ({ clientName: String(r[0] ?? '').trim(), alias: String(r[1] ?? '').trim() }))
    .filter((p) => p.clientName !== '' && p.alias !== '');

  const db = dbClient();
  await db.connect();

  try {
    const clients = await db.query(`SELECT id, name FROM clients`);
    const byName = new Map<string, number>(clients.rows.map((c) => [normalize(c.name), c.id]));

    await db.query('BEGIN');
    let inserted = 0;
    let updated = 0;
    const unmatched = new Set<string>();
    for (const p of pairs) {
      const clientId = byName.get(normalize(p.clientName)) ?? null;
      if (clientId == null) unmatched.add(p.clientName);
      const res = await db.query(
        `INSERT INTO client_aliases (client_id, alias_type, alias_value, normalized_value, status, source)
         VALUES ($1, 'zelle_sender', $2, $3, $4, 'mapeo_zelle_sheet')
         ON CONFLICT (alias_type, normalized_value) DO UPDATE
           SET client_id = EXCLUDED.client_id,
               alias_value = EXCLUDED.alias_value,
               status = EXCLUDED.status,
               updated_at = now()
         RETURNING (xmax = 0) AS inserted`,
        [clientId, p.alias, normalize(p.alias), clientId != null ? 'confirmed' : 'unidentified'],
      );
      res.rows[0].inserted ? inserted++ : updated++;
    }

    await db.query(
      `INSERT INTO audit_events (actor_type, actor_id, action, entity_type, entity_id, after_state)
       VALUES ('importer', 'import-zelle-aliases', 'import_zelle_aliases', 'import_run', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'), $1)`,
      [JSON.stringify({ read: pairs.length, inserted, updated, unmatched: [...unmatched] })],
    );
    await db.query('COMMIT');

    console.log(`Alias leidos: ${pairs.length} | insertados: ${inserted} | actualizados: ${updated}`);
    if (unmatched.size > 0) {
      console.log(`\nNombres sin cliente en DATA (${unmatched.size}), importados como 'unidentified':`);
      for (const n of unmatched) console.log(` - ${n}`);
    }
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
