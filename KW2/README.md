# KW2 - Documentacion Del Proyecto

Esta carpeta organiza la documentacion del redisenio operativo y tecnico de KW2. Al 8-jul-2026 el sistema ya existe como app local y como despliegue web en Vercel/Supabase; el Google Sheet sigue siendo la fuente operativa que se corrige manualmente.

## Estructura

- `01-sistema-actual/`: como funciona KW2 hoy, flujo operativo, hojas actuales, riesgos y controles existentes.
- `02-reglas-operativas/`: reglas contables, reglas de conciliacion, cierre diario, comisiones y validaciones.
- `03-diseno-nuevo/`: modelo de datos, arquitectura de app, pantallas, permisos y migracion desde Google Sheets.
- `04-agente-ia/`: memoria del agente, reglas de aprendizaje, sugerencias, aprobaciones y auditoria.
- `05-implementacion/`: backlog, decisiones tecnicas, setup de Mac mini, pruebas y despliegue.

## Documentos Iniciales

- `01-sistema-actual/sistema-actual.md`
- `01-sistema-actual/inventario-google-sheet.md`
- `02-reglas-operativas/reglas-contables-v0.md`
- `03-diseno-nuevo/modelo-de-datos-v0.md`
- `04-agente-ia/arquitectura-agente-local-v0.md`
- `05-implementacion/puesta-en-marcha-mac-mini.md`
- `05-implementacion/docker-postgresql.md`
- `05-implementacion/estado-proyecto.md`
- `05-implementacion/prompt-continuar-nueva-conversacion.md`

Para retomar el proyecto, comenzar por `05-implementacion/estado-proyecto.md`:
contiene el estado operativo y técnico actualizado, las migraciones aplicadas,
las pantallas disponibles, el despliegue cloud y los riesgos pendientes.

## Estado Actual Corto

- Fuente operativa: Google Sheet `2026 KW2`; la app no escribe en `MOVIMIENTOS`.
- App local: Next.js + PostgreSQL Docker en la Mac mini.
- App web: Vercel con Supabase PostgreSQL y Basic Auth temporal.
- Agente local: solo lectura; consulta herramientas deterministas y no inventa cifras.
- WhatsApp: base técnica creada; falta activar producción, almacenamiento durable, OCR e interpretación.
- Siguiente prioridad: estabilizar producción, agregar login real y definir sincronización local/cloud.

## Convencion

Los documentos deben escribirse como especificaciones vivas:

- Claros para operacion.
- Precisos para desarrollo.
- Faciles de convertir en reglas, tablas, pantallas o tareas.

Cuando algo no este confirmado, marcarlo como `Pendiente` o `Borrador`.
