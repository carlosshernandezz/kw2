// Cuadre del modelo: saldos por cliente y cuenta calculados desde fund_movements
// comparados contra los saldos publicados en DATA. Solo lectura.
import { readRange } from './sheets.js';
import { dbClient } from './db.js';

const TOLERANCE = 0.01;

async function main() {
  const dataRows = await readRange("'DATA'!A3:K2000");
  const expectedClients = new Map<string, { name: string; balance: number }>();
  const expectedAccounts = new Map<string, { name: string; balance: number }>();
  for (const r of dataRows) {
    if (r[0] !== '' && r[0] != null && String(r[2] ?? '').trim() !== '')
      expectedClients.set(String(r[0]), { name: String(r[2]).trim(), balance: Number(r[3] ?? 0) });
    if (String(r[5] ?? '').trim() !== '' && String(r[6] ?? '').trim() !== '')
      expectedAccounts.set(String(r[6]).trim(), { name: String(r[6]).trim(), balance: Number(r[7] ?? 0) });
  }

  const db = dbClient();
  await db.connect();

  const clientCalc = await db.query(`
    SELECT c.legacy_id k, SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END) balance
    FROM fund_movements fm JOIN clients c ON c.id = fm.client_id
    WHERE fm.source = 'google_sheet_movimientos' AND fm.status <> 'voided'
    GROUP BY c.legacy_id`);
  const accountCalc = await db.query(`
    SELECT a.name k, SUM(CASE WHEN fm.direction='inflow' THEN fm.usd_amount ELSE -fm.usd_amount END) balance
    FROM fund_movements fm JOIN accounts a ON a.id = fm.account_id
    WHERE fm.source = 'google_sheet_movimientos' AND fm.status <> 'voided'
    GROUP BY a.name`);
  await db.end();

  const compare = (label: string, calc: { k: string; balance: string }[], expected: Map<string, { name: string; balance: number }>) => {
    const calcMap = new Map(calc.map((r) => [r.k, Number(r.balance)]));
    let ok = 0;
    const diffs: string[] = [];
    for (const [id, { name, balance }] of expected) {
      const c = calcMap.get(id) ?? 0;
      if (Math.abs(c - balance) <= TOLERANCE) ok++;
      else diffs.push(` DIF ${id} ${name}: sheet ${balance.toFixed(2)} | modelo ${c.toFixed(2)} | dif ${(c - balance).toFixed(2)}`);
    }
    console.log(`\n=== ${label}: ${ok}/${expected.size} cuadran ===`);
    diffs.forEach((d) => console.log(d));
  };

  compare('CLIENTES (fund_movements)', clientCalc.rows, expectedClients);
  compare('CUENTAS (fund_movements)', accountCalc.rows, expectedAccounts);
}

main().catch((err) => {
  console.error('Error:', err.message ?? err);
  process.exit(1);
});
