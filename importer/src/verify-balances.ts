// Cuadre Fase 1: recalcula saldos por cliente y por cuenta desde el snapshot
// crudo de MOVIMIENTOS y los compara contra los saldos publicados en DATA.
// Solo lectura: no modifica nada.
import pg from 'pg';
import { readRange } from './sheets.js';

const TOLERANCE = 0.01; // USD

async function main() {
  const dataRows = await readRange("'DATA'!A3:K2000");
  const sheetClientBalance = new Map<string, { name: string; balance: number }>();
  const sheetAccountBalance = new Map<string, { name: string; balance: number }>();
  for (const r of dataRows) {
    if (r[0] !== '' && r[0] != null && String(r[2] ?? '').trim() !== '') {
      sheetClientBalance.set(String(r[0]), { name: String(r[2]).trim(), balance: Number(r[3] ?? 0) });
    }
    if (String(r[5] ?? '').trim() !== '' && String(r[6] ?? '').trim() !== '') {
      // El Sheet agrega saldos de banco por nombre (columna Bank), no por ID.
      sheetAccountBalance.set(String(r[6]).trim(), { name: String(r[6]).trim(), balance: Number(r[7] ?? 0) });
    }
  }

  const db = new pg.Client({
    host: '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB ?? 'kw2',
    user: process.env.POSTGRES_USER ?? 'kw2_app',
    password: process.env.POSTGRES_PASSWORD,
  });
  await db.connect();

  const agg = async (key: string) =>
    (
      await db.query(
        `SELECT raw_payload->>'${key}' AS k,
                SUM(COALESCE(NULLIF(raw_payload->>'monto_credito', '')::numeric, 0)
                  + COALESCE(NULLIF(raw_payload->>'monto_debito', '')::numeric, 0)) AS balance
         FROM external_transactions
         WHERE source_type = 'google_sheet' AND source_account = 'MOVIMIENTOS'
           AND raw_payload->>'${key}' IS NOT NULL
         GROUP BY 1`,
      )
    ).rows as { k: string; balance: string }[];

  const compare = (
    label: string,
    calculated: { k: string; balance: string }[],
    expected: Map<string, { name: string; balance: number }>,
  ) => {
    const calcMap = new Map(calculated.map((r) => [r.k, Number(r.balance)]));
    let ok = 0;
    const diffs: { id: string; name: string; sheet: number; calc: number }[] = [];
    for (const [id, { name, balance }] of expected) {
      const calc = calcMap.get(id) ?? 0;
      if (Math.abs(calc - balance) <= TOLERANCE) ok++;
      else diffs.push({ id, name, sheet: balance, calc });
    }
    const extra = [...calcMap.keys()].filter((k) => !expected.has(k));
    console.log(`\n=== ${label}: ${ok}/${expected.size} cuadran (tolerancia $${TOLERANCE}) ===`);
    for (const d of diffs.sort((a, b) => Math.abs(b.sheet - b.calc) - Math.abs(a.sheet - a.calc))) {
      console.log(
        ` DIF ${d.id} ${d.name}: sheet ${d.sheet.toFixed(2)} | calculado ${d.calc.toFixed(2)} | dif ${(d.calc - d.sheet).toFixed(2)}`,
      );
    }
    if (extra.length > 0) console.log(` IDs en MOVIMIENTOS sin fila en DATA: ${extra.join(', ')}`);
  };

  compare('CLIENTES', await agg('id_cliente'), sheetClientBalance);
  compare('CUENTAS', await agg('banco'), sheetAccountBalance);

  await db.end();
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
