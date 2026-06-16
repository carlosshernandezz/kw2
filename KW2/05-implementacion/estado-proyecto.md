# KW2 - Estado Del Proyecto

Actualizado: 16 de junio de 2026.

Documento vivo para retomar el trabajo desde cualquier maquina o sesion nueva. Leerlo junto con el resto de `KW2/` da el contexto completo.

## Negocio (resumen)

KW2 es una mesa de cambio (USD cash, Zelle, USDT/Binance, Bs en varios bancos). Hoy opera sobre el Google Sheet `2026 KW2` (hoja central `MOVIMIENTOS` = libro mayor; `DATA` = maestro de clientes/cuentas/saldos). El objetivo es un sistema local en la Mac mini que replique, concilie y automatice, con un agente de IA de solo lectura.

## Fases y dónde estamos

- **0 Servidor local**: Docker + PostgreSQL 17 + Ollama. ✅
- **1 Documentación + modelo**: docs en `KW2/`, migraciones 001-006. ✅
- **2 App espejo**: importa el Sheet, reproduce saldos (372/372 clientes, 17/17 cuentas), ID estable `kw2_id`, reimport seguro. ✅
- **3 Conciliación asistida**: BINANCE CH completo (auto + manual + correcciones + needs_review + fees). Faltan: bancos Bs (EDO CTA BS), cash, Zelle, y el **año pasado**. 🔶
- **4 Reportes/dashboard**: saldos de clientes, saldos por cuenta, KPIs, utilidad, ficha de cliente con evidencia. ✅ (falta cierre diario, comisiones operador/Jorge/Mileng, ajuste Bs)
- **5 Agente IA local**: Q&A solo lectura con evidencia sobre qwen3:8b. ✅ v1 (1 herramienta; faltan más)
- **6 Operación principal**: captura desde la app, app como fuente de verdad, 24/7. ⬜

## Infraestructura

- PostgreSQL 17 en Docker (`compose.yaml`, contenedor `kw2-postgres`, 127.0.0.1:5432). Arrancar: `docker compose up -d`.
- Migraciones en `infra/postgres/init/` (001-006), se aplican con `psql`. Tablas: clients, client_aliases, operators, accounts, operations, obligations, fund_movements, obligation_allocations, external_transactions, reconciliations, daily_account_closures, audit_events, sheet_corrections (004), reconciliation_marks (005). 006 = `fund_movements.kw2_id`.
- Importadores en `importer/src/` (Node+TS, service account Google solo-lectura, clave en `google-credentials.json` fuera de Git).
- App web en `web/` (Next.js 16 + Tailwind, sin login, localhost:3000, actor `app_web`). Correr: `cd web && npm run dev`.
- Ollama con `qwen3:8b` (`ollama pull qwen3:8b`). El agente llama `http://127.0.0.1:11434`.

## Pipeline de datos (cadena de sincronización)

`import-data` → `import-movimientos` → `reimport-movimientos` → `verify-model`.
- Atajo: botón **"Sincronizar con el Sheet"** en la app (Inicio) o `bash scripts/kw2-sync.sh`.
- `import-data.ts`: DATA → clients + accounts (idempotente por legacy_id).
- `import-movimientos.ts`: snapshot crudo de MOVIMIENTOS (incluye columna kw2_id) → external_transactions.
- `reimport-movimientos.ts`: **reimport SEGURO** por kw2_id (upsert): inserta nuevas, actualiza cambiadas conservando ID y conciliaciones, marca 'voided' las borradas, y deja 'needs_review' las conciliaciones que ya no cuadran tras una edición. Detecta y NO procesa kw2_id duplicados. Reemplazó al viejo `transform-movimientos.ts` (obsoleto).
- `verify-model.ts`: cuadre fund_movements vs DATA en vivo (372/372, 17/17 cuando no se está editando el Sheet).
- Otros: `import-sources.ts` (EDO CTA BS/CASH/Binance), `import-binance-file.ts <xlsx>`, `import-zelle-aliases.ts`.

## ID estable kw2_id (clave del sistema)

- Cada fila de MOVIMIENTOS tiene un `kw2_id` opaco y estable (ej. `KW2-7FH3K9Q`) en la **columna S**, asignado por un **Apps Script dentro del Sheet** (`infra/apps-script/kw2-id.gs`) con triggers "On change" + time-driven. La cuenta de servicio sigue solo-lectura (el Apps Script escribe como Carlos).
- Si se copia/pega una fila (duplica el código), el Apps Script reasigna a la copia un código nuevo (la primera aparición se queda con el código). El reimport además ignora duplicados como red de seguridad.
- Las conciliaciones se anclan a kw2_id → sobreviven a cualquier reimport.

## Conciliación BINANCE CH

- `match-binance.ts`: motor determinista. 1:1 exacto (conf 0.99), tolerancia de fee, P2P del día completo, y por suma (divididos). Genera `reconciliations` 'suggested'.
- Reglas Binance: `KW2/02-reglas-operativas/reglas-conciliacion-binance.md` + `importer/src/binance-rules.ts` (solo USDT; excluir USD-M Futures, transfers internos, Simple Earn; Flexible Loan → cliente "Binance Loan").
- Fees de Binance Pay: el 0,01 es fila aparte con la misma referencia; se liga al envío principal (`fix-binance-fees.ts`). MOVIMIENTOS NO se baja.
- Web: `/conciliacion/binance` (confirmar/rechazar, confirmar 0.99 en bloque, "+ corregir fecha/monto"), `/conciliacion/binance/manual` (dos paneles, match 1:1/N:1/1:N con ajuste de monto, "sin contraparte", "falta en MOVIMIENTOS"), `/conciliacion/binance/estado` (conciliadas, sin conciliar, discrepancias, **necesitan revisión** con "deshacer").
- CLI equivalente: `report-binance.ts`, `confirm-binance.ts`.
- **Aprendizaje**: solo las sugerencias 0.99 son confiables para confirmar en bloque. Las de baja confianza (0.75/0.80) la suma es aritméticamente válida pero a veces económicamente falsa → van por conciliación manual.

## Correcciones a la hoja (sheet_corrections)

- El sistema NUNCA escribe en MOVIMIENTOS (salvo la columna kw2_id vía Apps Script). Genera una **lista de cambios** (`/correcciones`) para aplicar a mano: tipo `update` (cambiar valor: fecha/monto), `add_row` (agregar fila faltante), `split` (dividir fila). Carlos los aplica en el Sheet y reimporta.

## Reportes / dashboard (Fase 4)

- `web/lib/reports.ts`: `clientBalances`, `accountBalances`, `kpis`, `utilidad`.
- Pantallas: `/saldos/clientes` (deudores/acreedores + conceptos de control aparte, nombres enlazan a ficha), `/saldos/cuentas` (por medio), `/kpis` (utilidad, clientes, saldo por medio, controles).
- **Saldo de cliente** = entradas − salidas (USD) desde fund_movements. Negativo = deudor (debe a KW2); positivo = acreedor (KW2 le debe).
- **Utilidad de la mesa = Comisiones − Gastos**. En el libro: comisiones = débitos en cuenta COMISION (saldo negativo → comisiones = −saldo); gastos = saldo de cuenta GASTO. utilidad = (−saldo_COMISION) − saldo_GASTO. Verificado ≈ "UTILIDAD CH" del DASHBOARD. El dashboard del Sheet se ancla a hojas "Datos" y "Datos 2".

## Agente local (Fase 5)

- `web/lib/agent.ts`: orquestador sobre Ollama `qwen3:8b`. Nivel 1, solo lectura. Interpreta la pregunta, llama herramientas deterministas, responde en español citando evidencia, NUNCA inventa cifras.
- Herramientas en `web/lib/agent-tools.ts`: `findClients`, `clientDetail` (= get_client_balance, con resumen compacto: saldo, rol, totales). Tool del agente: `consultar_saldo_cliente`.
- Pantalla `/agente` (chat). Las respuestas de saldo NO incluyen ejemplos de movimientos (decisión de Carlos), salvo que se pidan.
- Plan: más herramientas (sin conciliar, Zelles sin identificar, utilidad del mes, top deudores/acreedores), modo razonamiento con `deepseek-r1:8b` para revisar conciliaciones/inconsistencias, y opción de escalar a la API de Claude para análisis complejo (el modelo local pequeño NO iguala el análisis de un modelo de frontera).

## Decisiones confirmadas (no re-preguntar)

- Cuentas no importadas: LEDCH, GREEN BLOCK, RETIRO. `TRANSITORIA BS` es medio bs; la única transitoria USD es `TRANSITORIA`.
- Clientes duplicados consolidados: Chato canónico 75 (334 descartado); `Prestamo Binance` (145) = `Binance Loan` (346), 145 descartado. Mapas en `import-data.ts`.
- **Clasificación de clientes**: SOLO `Ajuste BS`, `Binance P2P`, `TS` son `kind='system'` (controles que deben dar 0; hay alerta si no). TODO lo demás es cliente real, incluidos `Comisiones *`, `Binance Loan`, `Sin Identificar`, `CH` (cliente mesa), `2025` (puente entre años, debe quedar 0 al consolidar). COMISION y GASTO son cuentas (YYY/ZZZ), no clientes.
- Nómina = gasto al cliente-empleado (reduce utilidad), no sale de CH. Estructura confirmada OK.
- No se reconstruyen operations/obligations del histórico. fund_movements 1:1; obligaciones de arranque por cliente al corte.
- Alias Zelle resueltos: "Luis Garcia" → Cesar Garcia antes del 2-abr-2026, Luis Garcia (Jochiwi) desde esa fecha (en audit_events; el modelo aún no tiene vigencia por fecha). "Rene" → Rene (Jochiwi). "Carolina Sotillo" → Carlos Manuel.
- La columna Type de MOVIMIENTOS es innecesaria (solo en payload crudo).
- El Google Sheet no se modifica desde la app; Carlos corrige a mano y se reimporta.

## Sincronización entre máquinas

- Código y docs: Git (github.com/carlosshernandezz/kw2, privado).
- Secretos (`.env`, `google-credentials.json`): a mano (AirDrop/USB), nunca por Git.
- Base de datos: pg_dump/restore (las decisiones en base no se reproducen del Sheet). Scripts: `scripts/kw2-save.sh` (al salir) y `scripts/kw2-load.sh` (al llegar). Futuro: Tailscale cuando la Mac mini quede fija.

## Siguiente paso (a elegir)

1. Más herramientas para el agente (sin conciliar, Zelles sin identificar, utilidad del mes, top deudores/acreedores) + modo razonamiento deepseek-r1.
2. Extender conciliación a bancos Bs (EDO CTA BS), cash y Zelle (cerrar Fase 3).
3. Conciliación del año pasado (misma estructura).
4. Cierre diario + comisiones (Jorge/Mileng/operador) + ajuste Bs (revisar el Ajuste BS = 1.000 que no netea).
