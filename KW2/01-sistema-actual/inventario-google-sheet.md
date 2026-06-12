# KW2 - Inventario Del Google Sheet 2026 KW2

Fecha de revision: 12 de junio de 2026.

Fuente:

- Google Sheet `2026 KW2`.
- ID: `1bVhtBhS_cEDAnET8q5t4d4tT3pDE_bvEFD0oYjWaNWo`.
- Zona horaria: `America/Caracas`.
- Configuracion regional: `es_VE`.

## Resumen

El archivo contiene 64 hojas. Hay cuatro grupos funcionales:

1. Libro mayor: `MOVIMIENTOS`.
2. Fuentes y conciliacion: `EDO CTA BS`, `EDO CTA CASH`, `Mapeo Zelle` y `Edo cuenta binance`.
3. Maestros y calculos: `DATA`, `Datos` y `Datos 2`.
4. Vistas: `DASHBOARD`, `REPORTE CLIENTE`, `REPORTE BANCO`, reportes por operador y reportes bancarios ocultos.

Tambien existen hojas auxiliares para operaciones especificas, copias historicas y pruebas. Esto hace dificil distinguir que informacion es oficial.

## MOVIMIENTOS

Es el libro mayor operativo y la fuente de casi todos los reportes.

| Columna | Campo actual | Uso observado |
| --- | --- | --- |
| A | Fecha | Fecha efectiva |
| B | Semana del ano | Calculada con `WEEKNUM` |
| C | Type | Columna innecesaria, sin significado operativo |
| D | ID_Banco | Buscado desde `DATA` |
| E | Bank | Cuenta o banco |
| F | ID_Cliente | Buscado desde `DATA` |
| G | Name | Cliente, cuenta especial o concepto |
| H | Tipo | `Ingreso` o `Egreso` |
| I | Monto Credito | Importe positivo |
| J | Monto Debito | Importe negativo |
| K | Porcentaje | Comision o diferencial |
| L | Emisor/Beneficiario | Identidad observada |
| M | Tasa | Tasa Bs/USD |
| N | Monto Bs | Importe en bolivares |
| O | Operacion | Secuencia calculada para filas con tasa |
| P | x | Indicador de conciliacion |
| Q | Conciliacion | Importe encontrado en estado de cuenta |
| R | Sin encabezado | Alerta entre BDV VENISUM y BDV SOLUCIONES |

### Dependencias

- Banco y cliente se seleccionan por nombre; sus IDs se calculan con `XLOOKUP`.
- `O` usa una cuenta acumulada de filas con monto/tasa en Bs.
- `P` suma movimientos de `EDO CTA BS` cuyo enlace en D coincide con `O`.
- `R` intenta detectar confusiones entre `BDV VENISUM` y `BDV SOLUCIONES`.
- Una operacion economica puede ocupar varias filas contables.
- Una deuda puede recibir abonos futuros por medios distintos.

### Riesgos

- El numero de operacion depende del orden de las filas.
- La columna `Type` contiene valores heredados sin significado operativo.
- Nombres especiales como `Ajuste BS`, `Comisiones Jorge` o `2025` se comportan como clientes.
- Una conciliacion incorrecta puede marcar una fila equivocada como conciliada.
- Las formulas permiten filas incompletas y criterios diferentes entre operadores.

## EDO CTA BS

Cumple dos funciones.

### Estado De Cuenta

Columnas A:G:

- Banco.
- Fecha.
- Descripcion.
- Enlace manual a `MOVIMIENTOS`.
- Credito.
- Debito.
- Saldo acumulado.

La columna D contiene formulas como:

```text
=MOVIMIENTOS!O70
```

### Cierre Diario

Columnas I:O:

- Fecha.
- Banco/cuenta.
- Saldo Bs.
- Tasa usada.
- Equivalente USD.
- Saldo del reporte bancario.
- Diferencia.

Tambien calcula las comisiones de Jorge y Mileng y la diferencia que origina el ajuste de Bs.

Riesgos:

- Se mezclan transacciones importadas con herramientas de cierre.
- La conciliacion requiere editar una formula manualmente.
- El cierre depende de reportes ocultos y exclusiones por nombre.

## Otras Fuentes

### EDO CTA CASH

Registra fecha, abono, cargo, descripcion y saldo acumulado. El control depende principalmente de comparar el saldo final con el efectivo real.

### Mapeo Zelle

La zona A:B relaciona clientes con nombres de emisores o beneficiarios observados. Es el origen del futuro catalogo de alias.

La misma hoja contiene otra tabla de movimientos desde J:N. Mezclar ambas funciones dificulta automatizar importaciones.

### Edo Cuenta Binance

Contiene transacciones individuales y sirve para comprobar el saldo de USDT. Debe convertirse en una fuente externa importable e inmutable.

## Maestros Y Reportes

`DATA` funciona como maestro de clientes, bancos/cuentas, IDs y saldos calculados.

`REPORTE CLIENTE` filtra `MOVIMIENTOS` para reconstruir el saldo de un cliente.

`REPORTE BANCO` filtra `MOVIMIENTOS` para una cuenta y calcula su saldo. Hay versiones ocultas por banco.

`DASHBOARD` presenta utilidad diaria, semanal y mensual, proyecciones, deudores, acreedores, retiros, saldos bancarios y graficos.

## Traduccion Al Nuevo Sistema

| Google Sheet | Nuevo modelo |
| --- | --- |
| Una o varias filas de MOVIMIENTOS | Operacion, movimientos de fondos y obligaciones |
| DATA clientes | `clients` |
| Mapeo Zelle | `client_aliases` |
| DATA bancos | `accounts` |
| EDO CTA BS A:G | `external_transactions` |
| Formula EDO CTA BS D | `reconciliations` |
| EDO CTA BS I:O | Cierres diarios y ajustes calculados |
| EDO CTA CASH | Movimientos externos y cierres de caja |
| Edo cuenta binance | Movimientos externos de USDT |
| REPORTE CLIENTE | Vista de saldo del cliente |
| REPORTE BANCO | Vista de movimientos y saldo por cuenta |
| DASHBOARD | Indicadores calculados desde la base de datos |

## Decisiones Confirmadas

1. El ID de operacion sera numerico, unico y estable.
2. El ID no cambiara al insertar, ordenar o corregir registros.
3. Una deuda se cierra cuando su saldo economico llega a cero.
4. Un pago puede aplicarse parcialmente a una deuda.
5. Un pago puede distribuirse entre varias deudas o clientes.
6. La transaccion externa original no se divide; se distribuye mediante relaciones.
7. La conciliacion bancaria y la liquidacion de deuda son procesos distintos.
8. Los cierres diarios deben guardar el saldo declarado y la diferencia calculada.
9. Toda correccion, confirmacion y rechazo debe quedar auditado.

## Pendientes De Confirmacion

1. Regla exacta de utilidad por operacion y operador.
2. Fuente oficial diaria de Zelle.
3. Fuente oficial diaria de Binance y formato de exportacion.
4. Metodo de conteo y aprobacion del cash.
5. Tolerancias de fecha, tasa y monto por tipo de conciliacion.
6. Quien puede aprobar una sugerencia con banco distinto.

## Campos Descartados

### MOVIMIENTOS - Type

La columna C no tiene significado operativo ni una lista valida de valores.

- No aparecera en la nueva interfaz.
- No participara en reglas, saldos, conciliaciones ni reportes.
- Durante la migracion historica solo se conservara dentro del registro crudo de origen para auditoria.
- Sus valores no se usaran para inferir automaticamente el tipo de operacion.
