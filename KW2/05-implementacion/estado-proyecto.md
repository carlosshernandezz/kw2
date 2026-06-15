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

## Conciliacion BINANCE CH (en curso)

- `match-binance.ts`: cruza fund_movements de BINANCE CH contra el estado de cuenta relevante. 1:1 exacto, 1:1 con tolerancia de fee (<=0.02), y por suma (divididos en ambos sentidos). Genera reconciliations status 'suggested'. Regenera las 'suggested' sin tocar confirmed/rejected.
- `report-binance.ts`: resumen + pendientes a revisar.
- `confirm-binance.ts`: aprobacion humana. Subcomandos: `confirm-high` (confirma confianza >=0.99), `review` (lista dudosas <0.99), `confirm <id...>`, `reject <id...>`. Al confirmar recalcula fund_movements.status (reconciled/partially) y audita.
- Estado al 15-jun-2026: 1271 reconciliaciones confirmed (confianza 0.99), 115 suggested por revisar (<0.99, mezcla de fecha +-1/3 dias y divididos, todas con suma integra). 131 movimientos del libro y ~842 filas del estado de cuenta sin pareja (montos grandes / agregados / diciembre 2025 = año pasado).
- Integridad verificada: ningun match por suma descuadra (tolerancia 0.02).

## App web (Next.js en web/)

- Pantalla de conciliación BINANCE CH (`/conciliacion/binance`): confirmar/rechazar sugerencias, confirmar 0.99 en bloque, y botones "+ corregir fecha/monto" que generan cambios para la hoja.
- Conciliación manual (`/conciliacion/binance/manual`): dos paneles (libro vs estado de cuenta sin conciliar). Acciones: match manual 1:1 / N:1 / 1:N (valida totales y direccion), "Libro: sin contraparte" (mov. del libro no esta en el estado de cuenta) y "Estado: falta en MOVIMIENTOS" (crea correccion add_row para agregar la fila).
- Cambios para la hoja (`/correcciones`): worklist de correcciones (update / add_row / split) para aplicar a mano en el Sheet. El sistema nunca escribe en el Sheet.
- Sin login (localhost, actor app_web). Corre con `cd web && npm run dev`.

## Modelo de conciliacion (tablas)

- reconciliations: sugerencias y confirmaciones (suggested/confirmed/rejected). Manual = confidence 1.0, reasons ["conciliación manual"].
- sheet_corrections (migr. 004, +kind en 005): cambios propuestos a MOVIMIENTOS (update/add_row/split).
- reconciliation_marks (migr. 005): discrepancias 'no_statement_counterpart' (libro sin contraparte) y 'missing_in_sheet' (falta en la hoja).
- Migraciones aplicadas: 001-005.

## Aprendizaje clave de conciliacion Binance

Las sugerencias automaticas de baja confianza (0.75 fecha lejana, 0.80 por suma) son poco confiables: Carlos reviso varias y estaban mal (suma aritmeticamente valida pero economicamente falsa, p.ej. Andres-100 metido en un grupo de 400; BitHash 200 vs Jochiwi). Solo las 0.99 (monto+fecha exactos) son solidas para confirmar en bloque. El resto va por conciliacion manual.

## ID estable y reimport seguro (LISTO)

- Cada fila de MOVIMIENTOS tiene un `kw2_id` opaco y estable (ej. KW2-7FH3K9Q), asignado por un Apps Script dentro del Sheet (infra/apps-script/kw2-id.gs) con triggers "On change" + time-driven. La cuenta de servicio sigue siendo solo lectura. Backup del Sheet creado antes del cambio.
- `import-movimientos.ts` ahora captura la columna kw2_id (S).
- migracion 006: `fund_movements.kw2_id` + indice unico parcial. Los 14.503 movimientos quedaron anclados a su kw2_id (puente por row_number, 1:1, sin duplicados).
- `reimport-movimientos.ts` = reimport SEGURO (reemplaza el viejo transform delete+recreate): upsert por kw2_id. Inserta filas nuevas, actualiza las cambiadas conservando ID y conciliaciones, marca 'voided' las borradas del Sheet, y deja 'needs_review' las conciliaciones que ya no cuadran tras una edicion. Verificado: 372/372 y 17/17, conciliaciones intactas.
- Cadena de refresco nueva: import-data -> import-movimientos -> reimport-movimientos -> verify-model. (transform-movimientos.ts queda obsoleto.)
- Fees de Binance Pay: el 0,01 va como fila aparte con la misma referencia; se ligan al envio principal (fix-binance-fees.ts), MOVIMIENTOS no se baja.

## Siguiente Paso Acordado

Motor de matching para conciliar BINANCE CH: cruzar las transacciones relevantes del estado de cuenta oficial (external_transactions, source_type binance_statement, payload->relevant = true) contra fund_movements de la cuenta BINANCE CH por fecha/monto/referencia, generando sugerencias con confianza en `reconciliations` (status suggested) para aprobacion humana. Objetivos del usuario: conciliar clientes no cuadrados, BINANCE CH, y el ano pasado (misma estructura).
