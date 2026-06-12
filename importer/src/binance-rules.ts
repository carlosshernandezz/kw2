// Reglas confirmadas (12-jun-2026) para conciliar el estado de cuenta oficial
// de Binance contra la cuenta BINANCE CH. La estructura del export es siempre
// igual; estas reglas aplican a todos los estados de cuenta de Binance.
//
// 1. Solo se concilian movimientos de Coin USDT.
// 2. Se excluye todo el Account "USD-M Futures".
// 3. Se excluyen las Operation internas listadas abajo (movimientos entre
//    billeteras propias que no son operaciones de la mesa).
// 4. "Flexible Loan - Lending" y "Flexible Loan - Repayment" pertenecen al
//    cliente "Binance Loan".

const EXCLUDED_ACCOUNTS = new Set(['usd-m futures']);

const EXCLUDED_OPERATIONS = new Set([
  'binance convert',
  'transfer between main and funding wallet',
  'transfer between spot account and um futures account',
  'transfer funds to spot',
  'transfer funds to funding wallet',
]);

const BINANCE_LOAN_OPERATIONS = new Set([
  'flexible loan - lending',
  'flexible loan - repayment',
]);

export type BinanceRow = { account: string; operation: string; coin: string };

export function isRelevant(row: BinanceRow): boolean {
  if (row.coin.trim().toUpperCase() !== 'USDT') return false;
  if (EXCLUDED_ACCOUNTS.has(row.account.trim().toLowerCase())) return false;
  if (EXCLUDED_OPERATIONS.has(row.operation.trim().toLowerCase())) return false;
  return true;
}

// Devuelve el nombre del cliente fijo para la operacion, o null si el cliente
// debe identificarse por conciliacion normal.
export function fixedClientName(row: BinanceRow): string | null {
  return BINANCE_LOAN_OPERATIONS.has(row.operation.trim().toLowerCase()) ? 'Binance Loan' : null;
}
