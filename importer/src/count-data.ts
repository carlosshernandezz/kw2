// Paso 1b (solo lectura): cuenta clientes y cuentas reales en DATA.
import { readRange } from './sheets.js';

const rows = await readRange("'DATA'!A3:K2000");

const clients = rows.filter((r) => r[0] !== '' && r[0] != null && (r[2] ?? '') !== '');
const accounts = rows.filter((r) => (r[5] ?? '') !== '' && (r[6] ?? '') !== '');

console.log(`Filas leidas: ${rows.length}`);
console.log(`Clientes con nombre: ${clients.length} (IDs ${clients[0]?.[0]} a ${clients.at(-1)?.[0]})`);
console.log(`Cuentas con nombre: ${accounts.length}`);
console.log('\nCuentas:');
for (const r of accounts) console.log(` ${r[5]} | ${r[6]} | saldo ${r[7]}`);

const dupNames = new Map<string, number>();
for (const c of clients) {
  const n = String(c[2]).trim().toLowerCase();
  dupNames.set(n, (dupNames.get(n) ?? 0) + 1);
}
const dups = [...dupNames].filter(([, n]) => n > 1);
console.log(`\nNombres de cliente duplicados: ${dups.length}`);
for (const [n, c] of dups) console.log(` "${n}" x${c}`);
