# KW2 - Prompt Para Continuar En Una Nueva Conversacion

Copia este prompt en una conversacion nueva abierta desde `/Users/pc/Documents/Kw2`.

```text
Quiero continuar el proyecto KW2 desde este workspace.

Primero no hagas cambios. Lee:

1. KW2/README.md
2. KW2/05-implementacion/estado-proyecto.md
3. Todos los documentos dentro de KW2/
4. compose.yaml
5. infra/postgres/init/
6. infra/postgres/tests/
7. importer/src/
8. web/README.md
9. web/AGENTS.md
10. web/lib/agent.ts
11. web/lib/agent-tools.ts
12. web/lib/reconciliation.ts
13. web/lib/reports.ts

Luego revisa:

- git status
- estado de Docker/PostgreSQL
- migraciones aplicadas
- scripts disponibles en scripts/
- package.json de importer y web

Despues resume:

1. Que entiendes del negocio KW2.
2. Que esta construido.
3. Que decisiones ya estan confirmadas.
4. Que cambios hay pendientes en git.
5. Que esta pendiente o riesgoso.
6. Cual seria el siguiente paso tecnico mas razonable.

No modifiques Google Sheets. No inventes reglas.

Distingue siempre entre:

- Operacion economica.
- Deuda/obligacion del cliente.
- Movimiento real de fondos.
- Aplicacion de pagos a deudas.
- Conciliacion contra estados externos.
- Cierre diario.
- Correccion propuesta para aplicar manualmente en el Sheet.

Reglas confirmadas:

- El primer medio de una operacion es lo que recibe KW2.
- El segundo medio es lo que entrega KW2.
- Una deuda termina cuando su saldo llega a cero.
- El cliente puede pagar parcialmente mediante varios medios.
- El ID de operacion debe ser numerico, unico y estable.
- Cada fila de MOVIMIENTOS tiene un kw2_id opaco y estable.
- La columna Type de MOVIMIENTOS es innecesaria.
- El Google Sheet no se modifica desde la app; Carlos aplica correcciones a mano y luego se reimporta.
- No se reconstruyen operations/obligations del historico; fund_movements queda 1:1 y luego se crean obligaciones de arranque por saldos.
- Las sugerencias Binance con confianza 0.99 son confiables para confirmar en bloque.
- Las sugerencias Binance de baja confianza van por conciliacion manual.
- El agente local es Nivel 1, solo lectura.
- El agente debe consultar herramientas deterministas y no inventar cifras.
- En respuestas de saldo, no quiero que incluya ejemplos de movimientos salvo que yo lo pida.

Contexto tecnico:

- Proyecto local: /Users/pc/Documents/Kw2
- App web: cd web && npm run dev
- PostgreSQL: Docker Compose, contenedor kw2-postgres
- Ollama local: http://127.0.0.1:11434
- Modelo local principal: qwen3:8b
- Para hablar directo con el modelo: ollama run qwen3:8b
- Para probar API: usar POST a /api/generate; no se chatea abriendo esa URL en navegador.

Antes de proponer cambios, dime si entiendes el estado y hazme solo las preguntas indispensables.
```
