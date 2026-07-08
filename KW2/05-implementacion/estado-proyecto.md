# KW2 - Estado Del Proyecto

Actualizado: 8 de julio de 2026 (America/Caracas).

Documento vivo para retomar el trabajo desde cualquier maquina o sesion nueva. Leerlo junto con el resto de `KW2/` da el contexto completo.

## Negocio (resumen)

KW2 es una mesa de cambio (USD cash, Zelle, USDT/Binance, Bs en varios bancos). El Google Sheet `2026 KW2` sigue siendo la fuente operativa que Carlos modifica a mano (`MOVIMIENTOS` = libro mayor; `DATA` = maestro de clientes/cuentas/saldos). La app KW2 replica esa información en PostgreSQL, ayuda a conciliar, audita decisiones y prepara el camino para automatizar registro/WhatsApp sin escribir en el Sheet.

## Fases y dónde estamos

- **0 Servidor local**: Docker + PostgreSQL 17 + Ollama. ✅
- **1 Documentación + modelo**: docs en `KW2/`, migraciones 001-007. ✅
- **2 App espejo**: importa el Sheet, reproduce saldos (372/372 clientes, 17/17 cuentas), ID estable `kw2_id`, reimport seguro. ✅
- **3 Conciliación asistida**: BINANCE CH completo. Bancos Bs ya tienen reconstrucción histórica, matcher por identidad, revisión de sugerencias, conciliación manual, reglas revisadas y correcciones de comisión. Faltan: importar/actualizar diariamente `EDO CTA BS`, cash, Zelle y el **año pasado**. 🔶
- **4 Reportes/dashboard**: saldos de clientes, saldos por cuenta, KPIs, utilidad, ficha de cliente con evidencia. ✅ (falta cierre diario, comisiones operador/Jorge/Mileng, ajuste Bs)
- **5 Agente IA local**: Q&A solo lectura (8 herramientas) sobre qwen3:8b + modo razonamiento con deepseek-r1:8b. ✅
- **6 Operación principal**: recepcion por WhatsApp iniciada (migracion 008, webhook firmado y bandeja compartida). Falta activar Meta, OCR, interpretacion y aprobacion. 🔶
- **7 Publicación web**: GitHub privado + Supabase + Vercel funcionando con Basic Auth temporal. ✅ Falta reemplazar Basic Auth por login real con usuarios, roles, sesiones y logout.

## Infraestructura

- PostgreSQL 17 local en Docker (`compose.yaml`, contenedor `kw2-postgres`, 127.0.0.1:5432). Arrancar: `docker compose up -d`.
- PostgreSQL cloud en Supabase (`kw2-production`, project ref `qfogomlixwyqqxdoaeev`). En Vercel usar el **Transaction pooler** como `DATABASE_URL`, con password URL-encoded y `DATABASE_SSL=true`.
- Migraciones en `infra/postgres/init/` (001-008), se aplican con `psql`. La 008 agrega `whatsapp_reporters`, `whatsapp_messages` y `operation_intakes`.
- Importadores en `importer/src/` (Node+TS, service account Google solo-lectura, clave en `google-credentials.json` fuera de Git).
- App web en `web/` (Next.js 16 + Tailwind, localhost:3000 local; Vercel en producción; actor `app_web`). Correr local: `cd web && npm run dev`.
- Producción Vercel: proyecto `kw2`, Root Directory `web`, dominio esperado `https://kw2-six.vercel.app`. El deploy requiere `DATABASE_URL`, `DATABASE_SSL`, `KW2_BASIC_AUTH_USERS` y variables WhatsApp cuando se active.
- GitHub: repo privado `github.com/carlosshernandezz/kw2`. Último commit de despliegue base: `d576f8a Prepare KW2 web for cloud deployment`.
- Backup cloud inicial: `backups/kw2-cloud-20260707-2059.dump` (ignorado por Git). Supabase verificado con `select count(*) from clients;` = 374.
- Ollama con `qwen3:8b` (`ollama pull qwen3:8b`). El agente llama `http://127.0.0.1:11434`.

## Pipeline de datos (cadena de sincronización)

`import-data` → `import-movimientos` → `reimport-movimientos` → `verify-model`.
- Atajo: botón **"Sincronizar con el Sheet"** en la app (Inicio) o `bash scripts/kw2-sync.sh`.
- `import-data.ts`: DATA → clients + accounts (idempotente por legacy_id).
- `import-movimientos.ts`: snapshot crudo de MOVIMIENTOS (incluye columna kw2_id) → external_transactions.
- `reimport-movimientos.ts`: **reimport SEGURO** por kw2_id (upsert): inserta nuevas, actualiza cambiadas conservando ID y conciliaciones, marca 'voided' las borradas, y deja 'needs_review' las conciliaciones que ya no cuadran tras una edición. Detecta y NO procesa kw2_id duplicados. Reemplazó al viejo `transform-movimientos.ts` (obsoleto).
- `verify-model.ts`: cuadre fund_movements vs DATA en vivo (372/372, 17/17 cuando no se está editando el Sheet).
- Otros: `import-sources.ts` (EDO CTA BS/CASH/Binance), `import-binance-file.ts <xlsx>`, `import-zelle-aliases.ts`.

## Conciliación bancaria Bs

- Reglas completas: `KW2/02-reglas-operativas/reglas-conciliacion-bs.md`.
- `reconstruct-bs-links.ts` reconstruye los enlaces históricos de columna D.
- `match-bs.ts` aprende identidades confirmadas y genera sugerencias conservadoras por banco, fecha, dirección, cliente y monto. VENISUM/SOLUCIONES extraen cédula; NENEKA usa descripción normalizada.
- Pantalla `/conciliacion/bs`: cobertura, sugerencias, comisión bancaria, detalle clicable de evidencia histórica e identidades ambiguas.
- Cada nombre histórico es clicable y muestra fecha, USD, Bs, fila de MOVIMIENTOS y kw2_id de todas las conciliaciones que forman su evidencia.
- La tarjeta `Pendientes reales` enlaza a `/conciliacion/bs/pendientes`: dos paneles (MOVIMIENTOS vs EDO CTA BS), filtros, selección y conciliación manual 1:1/N:1/1:N. Exige mismo banco, fecha y dirección; admite comisión conocida y propone correcciones de `Monto Bs`/`Tasa`.
- Estado al 18-jun-2026: 5.962 movimientos Bs conciliados, 19 pendientes reales, 0 sugerencias. La bandeja muestra 0 filas compatibles del estado porque todavía no se ha importado/transcrito el `EDO CTA BS` correspondiente a esos movimientos del 18-jun.
- Migración 007 crea `bs_identity_rules`. En una identidad ambigua, `Marcar como revisado` obliga a elegir:
  - `preferred_client`: cliente esperado desde ahora.
  - `bridge_account`: cuenta puente, solo habilitada para el cliente indicado y monto exacto.
- La explicación del operador se guarda en PostgreSQL, audit_events y las razones de futuras sugerencias. La regla revisada tiene prioridad sobre la historia; nunca modifica conciliaciones anteriores ni escribe el Sheet.
- Ejemplos conversados pero **todavía no guardados**: cédula `10335114` como Karen (Jochiwi) desde ahora; cédula `27187469` como cuenta puente, solo CJHP con monto exacto. Deben confirmarse mediante el formulario.
- Comisiones: NENEKA 0,3%; VENISUM/SOLUCIONES 0,25%. La app solo genera correcciones propuestas para el Sheet.

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

## Agente local (Fase 5) — operativo en dos modos

- `web/lib/agent.ts`: orquestador. Nivel 1, solo lectura. NUNCA inventa cifras (todo número viene de herramientas deterministas en `web/lib/agent-tools.ts`). Pantalla `/agente`.
- **Modo normal (qwen3:8b, rápido)** — tool-calling. Herramientas (tools): `consultar_saldo_cliente`, `que_falta_conciliar`, `zelles_sin_identificar`, `utilidad_mesa` (total), `utilidad_periodo` (día o mes; ej. "utilidad del 8 de junio"), `estado_conciliacion` (% Binance), `buscar_duplicados`, `top_deudores_acreedores`. El cuadro de texto SIEMPRE usa este modo.
- **Modo razonamiento (deepseek-r1:8b, lento)** — botón "🔍 Revisar inconsistencias". NO usa tools: pre-consulta los posibles problemas (duplicados + conciliaciones que no cuadran + estado) y se los da a R1 para que distinga errores reales de casos normales. `askReasoning` en agent.ts.
- Respuestas de saldo SIN ejemplos de movimientos (decisión de Carlos), salvo que se pidan. Prompt refuerza no agregar datos fuera del resultado de la herramienta (modelos 8B a veces adornan; las cifras centrales son correctas y auditables con "Ver datos consultados").
- Ambos modelos descargados (`ollama list`: qwen3:8b, deepseek-r1:8b, ~5.2 GB c/u). Para análisis complejo (tipo el de estas sesiones) se escala a la API de Claude — el local pequeño NO iguala a un modelo de frontera.
- Las consultas relativas de utilidad (`hoy`, `ayer`) ya no dependen del LLM: `agent.ts` resuelve la fecha en `America/Caracas`, consulta PostgreSQL y redacta una respuesta determinista. Verificado el 18-jun: `ayer` = 17-jun-2026.

## Acceso local para los tres operadores

- Next.js permite los orígenes de desarrollo `127.0.0.1` y `192.168.68.54` en `web/next.config.ts`.
- En la red de la oficina: `http://192.168.68.54:3000` mientras la Mac mini, Docker y `npm run dev` estén activos.
- En Internet: usar Vercel, no abrir el puerto local. URL esperada de producción: `https://kw2-six.vercel.app`.
- Autenticación actual: Basic Auth vía `KW2_BASIC_AUTH_USERS`. Es una barrera temporal; el navegador recuerda credenciales por dominio y no existe logout real. Próximo paso recomendado: login propio con usuarios, roles, sesiones, auditoría por operador y cierre de sesión.

## Recepcion por WhatsApp

- Canal acordado: un numero WhatsApp Business exclusivo de KW2 recibe por privado; dos operadores autorizados reportan y el tercero no reporta directamente.
- Migracion `008_whatsapp_intake` aplicada el 22-jun-2026. Los dos reportantes quedaron registrados localmente en PostgreSQL; sus telefonos no viven en Git.
- Cada mensaje queda asociado al remitente por numero, con ID original, fecha, texto, tipo, payload y archivo privado.
- Webhook: `GET/POST /api/whatsapp/webhook`; valida token de alta y firma HMAC de Meta.
- Bandeja: `/operaciones/recibidas`. Por ahora solo recibe y audita; no ejecuta OCR, no genera asientos y no escribe el Sheet.
- Instrucciones y seguridad: `KW2/05-implementacion/whatsapp-cloud-api.md`.
- Meta Cloud API fue probada con número de prueba y webhook por túnel Cloudflare. Para producción, el callback debe apuntar al dominio Vercel: `https://kw2-six.vercel.app/api/whatsapp/webhook`.
- El webhook está exento de Basic Auth para que Meta pueda llamarlo, pero valida verify token/firma.
- En local los adjuntos van a `data/whatsapp/`; en Vercel el fallback actual usa `/tmp/kw2-whatsapp`, que es temporal. Antes de operar evidencia real en producción se debe agregar almacenamiento durable (Supabase Storage, S3 o R2).
- No migrar el numero definitivo hasta respaldar/exportar el historial, confirmar coexistencia con Meta y completar la prueba de producción.

## Cómo corre el agente (RAM en la Mac mini M4 16GB)

- Cadena local (nada sale a internet): app web (Next, ~220 MB) → orquestador (agent.ts) → herramientas → PostgreSQL (los números) → Ollama (puerto 11434, ~20 MB en reposo) → el modelo.
- Los modelos viven en disco; al preguntar, Ollama carga ~5.3 GB a la **memoria unificada** (corre 100% en la GPU del M4). Primera pregunta en frío ~6 s; luego ~1 s mientras está caliente. Se descarga solo a los ~5 min (keep_alive por defecto).
- Presupuesto: macOS+apps 4-6 GB, Postgres+app <1 GB, un modelo ~5.5 GB → cabe con UN modelo a la vez. Los dos juntos no caben cómodos; Ollama carga uno y al cambiar de modo descarga el otro.
- Comandos útiles: `ollama ps` (qué está cargado), `ollama stop <modelo>`, `ollama run qwen3:8b "..."`. Ajustar permanencia: `keep_alive` por petición o `OLLAMA_KEEP_ALIVE` global (no configurado aún; queda por defecto 5 min).

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
- Producción cloud: Supabase es una copia importada para Vercel. Todavía no hay sincronización bidireccional automática entre la base local y cloud. Decisión pendiente: si el trabajo diario se muda a Supabase o si local sigue siendo maestro y se publica por dumps controlados.
- El botón **"Sincronizar con el Sheet"** ejecuta `scripts/kw2-sync.sh` en local. En Vercel ejecuta una sincronización cloud directa contra Google Sheets usando `GOOGLE_SERVICE_ACCOUNT_JSON`: importa `DATA`, toma snapshot de `MOVIMIENTOS` y hace reimport seguro por `kw2_id` en Supabase. Todavía no reconstruye todo el pipeline extendido local (`EDO CTA BS`, cash/Binance desde hojas auxiliares, sugerencias Bs); esa ampliación queda pendiente.

## Siguiente paso recomendado

1. Estabilizar producción: revisar `/`, `/dashboard`, `/conciliacion/bs`, `/conciliacion/binance`, `/operaciones/recibidas`, `/agente` y confirmar que todas leen Supabase sin errores.
2. Reemplazar Basic Auth por login real: usuarios individuales, roles, sesiones, logout y `actor` correcto en auditoría.
3. Definir flujo de sincronización cloud: quién es maestro (Sheet/local/Supabase), cuándo se reimporta y cómo se evita pisar decisiones de conciliación.
4. Activar WhatsApp en producción: webhook Vercel, variables privadas, prueba real, almacenamiento durable de evidencias y luego OCR/interpretación/aprobación.
5. Importar/transcribir `EDO CTA BS` pendiente y validar conciliación manual de Bs; guardar desde la interfaz las reglas confirmadas de `10335114` y `27187469` si Carlos las confirma.
6. Extender conciliación a cash y Zelle, consolidar año pasado (`2025` debe quedar en 0) y construir cierre diario + comisiones Jorge/Mileng/operador + ajuste Bs.

## Cambios locales pendientes de versionar

Antes de esta actualización de documentación, `git status` estaba limpio en `main...origin/main`. Los cambios pendientes actuales son documentación interna para reflejar Vercel/Supabase/Basic Auth y el plan de estabilización.

## Cómo retomar en una conversación nueva

Abrir desde `/Users/pc/Documents/Kw2`. Prompt sugerido:

```text
Quiero continuar el proyecto KW2 desde este workspace.

Primero NO hagas cambios. Lee en orden:
- KW2/README.md
- KW2/05-implementacion/estado-proyecto.md   (resume TODO el estado actual)
- Todos los documentos dentro de KW2/
- compose.yaml, infra/postgres/init/, infra/postgres/tests/
- importer/src/
- web/README.md, web/AGENTS.md y web/lib/ (agent.ts, agent-tools.ts, reconciliation.ts, bs-reconciliation.ts, bs-manual.ts, reports.ts, manual.ts, corrections.ts)
- web/app/conciliacion/bs/ y web/app/api/bs/

Luego comprueba: git status, Docker/PostgreSQL (docker compose ps), migraciones aplicadas (debe incluir 007_bs_identity_rules y 008_whatsapp_intake), variables de entorno necesarias, y que Ollama tenga qwen3:8b y deepseek-r1:8b (ollama list).

Resume: (1) negocio, (2) qué está construido, (3) decisiones confirmadas, (4) pendiente, (5) siguiente paso recomendado.

Reglas que NO debes romper:
- No modificar el Google Sheet desde la app; Carlos corrige a mano y se reimporta. Lo único que se escribe en el Sheet es la columna kw2_id vía Apps Script.
- No inventes reglas. Distingue: operación económica, deuda/obligación, movimiento de fondos, conciliación, cierre diario, corrección propuesta.
- kw2_id es el ancla estable de cada fila; reimport-movimientos.ts es el reimport seguro que preserva conciliaciones.
- Solo Ajuste BS, Binance P2P y TS son conceptos de control (kind='system', deben dar 0); el resto son clientes reales.
- Utilidad de la mesa = Comisiones − Gastos.
- El agente es Nivel 1 (solo lectura), responde con datos de herramientas; en respuestas de saldo no incluye ejemplos de movimientos salvo que se pidan. El cuadro de texto usa qwen3 (modo normal); el botón "Revisar inconsistencias" usa deepseek-r1.
- Las sugerencias Binance 0.99 son confiables para confirmar en bloque; las de baja confianza van por conciliación manual.
- La conciliación Bs usa identidad + banco + misma fecha + dirección + monto. Las reglas revisadas `preferred_client`/`bridge_account` prevalecen sobre la historia.
- Estado Bs al 18-jun: 5962 conciliados, 19 pendientes, 0 sugerencias y 0 filas compatibles de EDO CTA hasta importar el estado del día.
- Producción ya existe: GitHub privado + Supabase `kw2-production` + Vercel proyecto `kw2`, Root Directory `web`, dominio esperado `https://kw2-six.vercel.app`.
- En Vercel, `DATABASE_URL` debe usar Supabase Transaction pooler con password URL-encoded y `DATABASE_SSL=true`.
- Basic Auth (`KW2_BASIC_AUTH_USERS`) es temporal; el navegador recuerda credenciales y no hay logout real. Siguiente paso: login propio con usuarios/roles/sesiones.
- El webhook WhatsApp `/api/whatsapp/webhook` queda sin Basic Auth, pero valida verify token y firma de Meta.
- La base cloud fue cargada con `backups/kw2-cloud-20260707-2059.dump`; Supabase verificó 374 clientes.

El flujo de trabajo diario: editar el Sheet → botón "Sincronizar con el Sheet" en la app → revisar "Necesitan revisión" → conciliar en "Conciliación manual".
```
