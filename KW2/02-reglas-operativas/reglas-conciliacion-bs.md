# KW2 - Reglas De Conciliación Bs (EDO CTA BS)

Confirmado por operación el 17 de junio de 2026.

## Proceso actual

1. La operación se reporta por WhatsApp; ~2-3 h después se anota en `MOVIMIENTOS` (antes de que se actualice el estado de cuenta).
2. Al colocar el egreso $ y el monto Bs, una fórmula calcula la **tasa** (Monto Bs / Monto $). Con la tasa, la columna **O** asigna un **número de operación**. La columna **P** queda en 0 (sin conciliar: Q ≠ O).
3. Al día siguiente se baja el estado de cuenta Bs de cada banco y se pega en `EDO CTA BS`.
4. Se concilia poniendo en la **columna D** de EDO CTA BS la referencia `=MOVIMIENTOS!Oxxx` (enlaza la fila del banco con el número de operación).

## Criterios de conciliación

- Montos iguales.
- Beneficiario identificado (cédula/nombre).
- Un movimiento de MOVIMIENTOS puede tener **varios egresos** en EDO CTA BS (1:N), típico en Binance P2P de egreso.

## Quién se concilia por columna D

- Solo los **egresos con número de operación** (columna O). Los movimientos Bs **sin** número de operación (la mayoría de los **ingresos**) NO se concilian por columna D; no son "pendientes", no participan de ese mecanismo. (Pendiente confirmar con Carlos si los ingresos Bs requieren otra forma de conciliación.)

## Comisión bancaria (se modela como CORRECCIÓN PROPUESTA, no automática al Sheet)

Al conciliar, la comisión bancaria de esa operación se suma al egreso (y se recalcula la tasa). Tasas:

- **NENEKA: 0,3%** del egreso. **Excepción:** transferencias a una cuenta **Banesco (número de cuenta que empieza en 0134) NO cobran comisión** (0%). Es la única excepción.
- **VENISUM: 0,25%** del egreso.
- **SOLUCIONES: 0,25%** del egreso.

Decisión (17-jun-2026): el sistema **propondrá** la comisión como corrección a MOVIMIENTOS (Carlos la aplica a mano), no la escribe automáticamente. Pendiente al construir: detectar el destino Banesco 0134 (requiere el número de cuenta del beneficiario, verificar si está en los datos).

## Implementación

- `importer/src/reconstruct-bs-links.ts`: espeja la conciliación de columna D (re-ejecutable, soporta 1:N). Corre dentro de `scripts/kw2-sync.sh` después de `import-sources`.
- Estado Bs: `reconciled` (tiene enlace) vs `posted`. "Pendiente real" = tiene operación y no está enlazado.
