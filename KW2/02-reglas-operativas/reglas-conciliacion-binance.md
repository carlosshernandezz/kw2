# KW2 - Reglas De Conciliacion Binance CH

Estado: confirmado por operacion el 12 de junio de 2026.

## Fuente

El estado de cuenta oficial se descarga de binance.com como `Binance-Transaction-History-...xlsx` (zona horaria UTC-4). La estructura es siempre igual:

- Encabezados en la fila 10: `User ID`, `Time`, `Account`, `Operation`, `Coin`, `Change`, `Remark`.
- Datos desde la fila 11.

## Reglas De Filtrado

Para conciliar contra la cuenta `BINANCE CH` solo se consideran movimientos que cumplan todo lo siguiente:

1. `Coin` = `USDT`. Todo lo demas (BTC, etc.) se excluye.
2. `Account` distinto de `USD-M Futures`.
3. `Operation` no incluida en esta lista de movimientos internos:
   - `Binance Convert`
   - `Transfer Between Main and Funding Wallet`
   - `Transfer Between Spot Account and UM Futures Account`
   - `Transfer Funds to Spot`
   - `Transfer Funds to Funding Wallet`

## Asignacion Fija De Cliente

- `Flexible Loan - Lending` y `Flexible Loan - Repayment` pertenecen siempre al cliente `Binance Loan`.

## Implementacion

- Reglas ejecutables: `importer/src/binance-rules.ts`.
- Importador: `importer/src/import-binance-file.ts <ruta-al-xlsx>`.
- Cada fila se guarda cruda en `external_transactions` (source_type `binance_statement`, source_account `BINANCE CH`) con su marca `relevant` y `fixed_client`.

## Automatizacion Futura

Hoy el proceso es manual: entrar a Binance, descargar el export y procesarlo. Binance ofrece API REST con claves de solo lectura que cubre gran parte de estos datos (Pay, P2P, transferencias). Pendiente de decision: crear una API key de solo lectura con restriccion de IP para que el servidor importe automaticamente.
