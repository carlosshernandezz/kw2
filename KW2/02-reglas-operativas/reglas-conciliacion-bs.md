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

## Identificación por banco

### BDV VENISUM y BDV SOLUCIONES

Las transferencias pueden incluir una descripción como:

```text
PAGO A PROVEEDORES BDV V028326817 LOTE 00394191
```

La cédula (`V028326817`) identifica al beneficiario. El sistema debe construir un
mapa histórico usando conciliaciones confirmadas:

```text
cédula normalizada -> cliente confirmado
```

Una cédula solo se considera una señal fuerte cuando históricamente identifica
de forma unívoca a un cliente. Los ceros iniciales y el prefijo `V` se conservan
como evidencia, pero se normalizan para comparar.

### NENEKA

El estado de cuenta se transcribe manualmente y la descripción contiene el
cliente o sus iniciales, por ejemplo:

```text
Daniel Conde
DL
BV
JC
```

El sistema debe aprender el mapa `descripción normalizada -> cliente` desde
conciliaciones confirmadas. Una descripción ambigua no puede producir una
conciliación automática.

## Niveles de confianza para sugerencias

### Confianza muy alta

Requiere todo lo siguiente:

- Mismo banco/cuenta.
- Misma dirección.
- Misma fecha.
- Monto exacto, o suma exacta 1:N incluyendo las filas de comisión.
- Identidad unívoca confirmada históricamente:
  - cédula para VENISUM/SOLUCIONES; o
  - nombre/iniciales para NENEKA.
- Solo existe una operación pendiente compatible.

Estas coincidencias pueden presentarse como candidatas para conciliación
automática. En la primera etapa se guardarán como `suggested` y requerirán
confirmación humana hasta medir falsos positivos.

### Confianza alta

- Banco, dirección, fecha y monto coinciden.
- La identidad coincide, pero hay más de una operación compatible o el mapa
  histórico todavía tiene poca evidencia.

Siempre requiere revisión humana.

### Confianza media

- Banco, dirección y monto coinciden.
- La fecha tiene diferencia máxima de un día.
- La identidad es probable, pero no unívoca.

Siempre requiere revisión humana.

### Confianza baja o descartada

- Coincidencia solo por monto.
- Coincidencia solo porque varias filas suman el monto.
- Banco o dirección diferentes.
- Cédula/descripción históricamente asociada a clientes distintos.

Una suma aritmética sin identidad consistente no debe sugerirse como
conciliación; ya produjo falsos positivos en Binance.

## Quién se concilia por columna D

- Solo los **egresos con número de operación** (columna O) participan del mecanismo principal de columna D. Los movimientos Bs **sin** número de operación no deben contarse automáticamente como pendientes.
- Los ingresos Bs que requieren conciliación ya están conciliados en el proceso
  actual. Los registros de control `A`, `SI`, `Ajuste BS` y `TS` pueden aparecer
  en `EDO CTA BS` sin una fila equivalente en MOVIMIENTOS; esto es correcto y no
  debe generar pendientes.

## Comisión bancaria (se modela como CORRECCIÓN PROPUESTA, no automática al Sheet)

Al conciliar, la comisión bancaria de esa operación se suma al egreso (y se recalcula la tasa). Tasas:

- **NENEKA: 0,3%** del egreso. **Excepción:** transferencias a una cuenta **Banesco (número de cuenta que empieza en 0134) NO cobran comisión** (0%). Es la única excepción.
- **VENISUM: 0,25%** del egreso.
- **SOLUCIONES: 0,25%** del egreso.

Decisión (17-jun-2026): el sistema **propondrá** la comisión como corrección a MOVIMIENTOS (Carlos la aplica a mano), no la escribe automáticamente. Pendiente al construir: detectar el destino Banesco 0134 (requiere el número de cuenta del beneficiario, verificar si está en los datos).

## Implementación

- `importer/src/reconstruct-bs-links.ts`: espeja la conciliación de columna D (re-ejecutable, soporta 1:N). Corre dentro de `scripts/kw2-sync.sh` después de `import-sources`.
- `importer/src/match-bs.ts`: aprende cédulas y descripciones desde conciliaciones confirmadas y genera sugerencias conservadoras para movimientos pendientes. No confirma automáticamente.
- Estado Bs: `reconciled` (tiene enlace) vs `posted`. "Pendiente real" = tiene operación y no está enlazado.
