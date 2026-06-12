# KW2 - Estado Del Proyecto

Actualizado: 12 de junio de 2026 (sesion Mac mini).

Este documento existe para retomar el trabajo desde cualquier maquina o sesion nueva de Claude Code. Leerlo junto con el resto de `KW2/` da el contexto completo.

## Hecho Y Verificado

- PostgreSQL 17 en Docker (`compose.yaml`, contenedor `kw2-postgres`). Migraciones aplicadas: `001_bootstrap`, `002_core_model`, `003_clients_kind` (en `infra/postgres/init/`, se aplican manualmente con psql).
- Importadores en `importer/` (Node + TypeScript, service account de Google con clave en `google-credentials.json`, fuera de Git):
  - `import-data.ts`: DATA -> clients (371) + accounts (14). Idempotente por legacy_id.
  - `import-movimientos.ts`: snapshot crudo de MOVIMIENTOS -> external_transactions (reemplazo por batch).
  - `transform-movimientos.ts`: snapshot -> fund_movements 1:1 (mecanico, sin agrupar operaciones). Excluye monto cero y filas con signo inconsistente, reportandolas.
  - `import-sources.ts`: snapshots de EDO CTA BS, EDO CTA CASH y hoja Edo cuenta binance.
  - `import-binance-file.ts <xlsx>`: estado de cuenta oficial de Binance -> external_transactions (source_account BINANCE CH) aplicando `binance-rules.ts`.
  - `import-zelle-aliases.ts`: Mapeo Zelle -> client_aliases (193 alias).
  - `verify-balances.ts` (cuadre del snapshot crudo) y `verify-model.ts` (cuadre desde fund_movements). Ambos contra DATA en vivo.
- Cuadre logrado: 371/371 clientes y 17/17 cuentas al centavo desde fund_movements.
- Cadena tipica de refresco: `import-data` -> `import-movimientos` -> `transform-movimientos` -> `verify-model`.

## Decisiones Confirmadas (no re-preguntar)

- LEDCH, GREEN BLOCK y RETIRO no se importan. Chato canonico = ID 75 (334 descartado).
- Conceptos no-cliente llevan `clients.kind = 'system'` (2025, Binance P2P, Binance Loan, Prestamo Binance, Sin Identificar, TS, CH, Ajuste BS, Comisiones *).
- No se reconstruyen operations/obligations del historico. fund_movements 1:1; al momento del corte se crearan obligaciones de arranque por cliente con saldo distinto de cero.
- Reglas Binance: ver `KW2/02-reglas-operativas/reglas-conciliacion-binance.md` y `importer/src/binance-rules.ts`.
- Alias Zelle resueltos: "Luis Garcia" -> Cesar Garcia antes del 2-abr-2026, Luis Garcia (Jochiwi) desde esa fecha (regla temporal en audit_events; el modelo aun no tiene vigencia por fecha). "Rene" -> Rene (Jochiwi). "Carolina Sotillo" -> Carlos Manuel.
- El Google Sheet no se modifica; correcciones las hace Carlos a mano y se reimporta.

## Sincronizacion Entre Maquinas

- Codigo y docs: Git (github.com/carlosshernandezz/kw2, privado).
- Secretos (`.env`, `google-credentials.json`): a mano, nunca por Git.
- Base de datos: pg_dump/restore (las decisiones en base — alias, conciliaciones, auditoria — no son reproducibles desde el Sheet). Futuro: Tailscale cuando la Mac mini quede fija.

## Siguiente Paso Acordado

Motor de matching para conciliar BINANCE CH: cruzar las transacciones relevantes del estado de cuenta oficial (external_transactions, source_type binance_statement, payload->relevant = true) contra fund_movements de la cuenta BINANCE CH por fecha/monto/referencia, generando sugerencias con confianza en `reconciliations` (status suggested) para aprobacion humana. Objetivos del usuario: conciliar clientes no cuadrados, BINANCE CH, y el ano pasado (misma estructura).
