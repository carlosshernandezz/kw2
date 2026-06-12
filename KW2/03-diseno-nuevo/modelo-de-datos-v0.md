# KW2 - Modelo De Datos v0

## Objetivo

Representar con precision:

- Quien debe.
- A quien se le debe.
- Cuanto queda pendiente.
- Que entrego KW2.
- Que recibio KW2.
- Por cuales medios ocurrio.
- Que movimientos ya fueron conciliados.
- Quien registro, corrigio o aprobo cada dato.

## Principio Central

La operacion economica y el movimiento de fondos son conceptos separados.

Ejemplo:

1. KW2 entrega Bs equivalentes a USD 1.000 a Pedro.
2. Pedro queda debiendo USD 1.000.
3. Pedro paga USD 300 por Zelle.
4. Pedro paga USD 200 en cash.
5. Pedro sigue debiendo USD 500, sin importar el medio futuro.

La deuda se cierra cuando su saldo llega a cero.

## Entidades

### clients

Maestro de clientes.

Campos principales:

- ID numerico interno.
- ID legado del Google Sheet.
- Nombre.
- Alias corto.
- Estado.
- Notas.

### client_aliases

Nombres alternativos usados para identificar clientes.

Ejemplos:

- Emisor Zelle.
- Beneficiario.
- Nombre bancario.
- Nombre visto en Binance.
- Telefono o correo de pago.

Un alias puede comenzar sin cliente confirmado y luego asignarse.

### operators

Personas de KW2 que gestionan clientes u operaciones.

No representa todavia los usuarios de acceso a la app. Permite separar el concepto comercial del concepto de seguridad.

### accounts

Cuentas o cajas donde KW2 mantiene valor.

Ejemplos:

- CASH CH.
- ZELLE CH.
- BINANCE CH.
- NENEKA.
- BDV VENISUM.
- BDV SOLUCIONES.
- GASTO.
- COMISION.

Cada cuenta tiene:

- Medio: Bs, cash, Zelle, USDT u otro.
- Moneda nativa.
- Institucion.
- Titular.
- Porcentaje de comision bancaria, cuando aplique.

### operations

Acuerdo economico original.

Una operacion:

- Tiene ID numerico visible.
- Pertenece a un cliente.
- Puede pertenecer a un operador.
- Tiene fecha.
- Tiene tipo.
- Tiene estado operativo.
- Puede tener una tasa Bs/USD.
- Puede contener notas y referencia externa.

El tipo describe el acuerdo conocido inicialmente. No obliga a conocer todos los medios futuros de liquidacion.

### obligations

Deuda economica creada por una operacion.

Direccion:

- `client_owes_kw2`: el cliente debe pagar a KW2.
- `kw2_owes_client`: KW2 debe pagar al cliente.

Campos:

- Monto original USD.
- Estado calculable por saldo.
- Fecha de vencimiento opcional.

Una operacion puede generar mas de una obligacion si el caso real lo requiere, aunque el flujo normal tendra una.

### fund_movements

Movimiento real de valor.

Ejemplos:

- Salieron Bs de BDV VENISUM.
- Entro un Zelle.
- Entro cash.
- Salio USDT de Binance.
- Se cobro una comision bancaria.

Campos:

- Cuenta afectada.
- Direccion: ingreso o egreso.
- Medio.
- Monto nativo.
- Moneda nativa.
- Equivalente USD.
- Tasa aplicada.
- Fecha efectiva.
- Emisor o beneficiario.
- Referencia.
- Estado de conciliacion.

### obligation_allocations

Relaciona un movimiento real con una deuda.

Esta tabla permite:

- Un abono parcial.
- Varios abonos por medios distintos.
- Un movimiento aplicado a varias deudas.
- Una deuda pagada por varios movimientos.

Ejemplo Pedro:

| Obligacion | Movimiento | Medio | Aplicado USD |
| --- | --- | --- | --- |
| Pedro debe 1.000 | Zelle recibido | Zelle | 300 |
| Pedro debe 1.000 | Cash recibido | Cash | 200 |

Saldo:

```text
1.000 - 300 - 200 = 500
```

### external_transactions

Movimientos importados desde fuentes externas:

- Estado de cuenta Bs.
- Zelle.
- Binance.
- Conteo o registro de cash.

Se guardan sin modificarlos para conservar evidencia del origen.

### reconciliations

Relaciona `fund_movements` con `external_transactions`.

Permite:

- Conciliacion total.
- Conciliacion parcial.
- Varios movimientos externos para un movimiento interno.
- Una transaccion externa dividida entre varios movimientos internos.
- Confianza y razones de una sugerencia automatica.
- Confirmacion humana.

La conciliacion bancaria no liquida por si sola la deuda del cliente. Solo confirma que un movimiento interno corresponde con evidencia externa.

### daily_account_closures

Resultado del cierre obligatorio de cada cuenta al final del dia.

Debe guardar:

- Cuenta.
- Fecha.
- Saldo registrado por el sistema.
- Saldo observado en banco, Binance o caja.
- Tasa de cierre, cuando aplique.
- Diferencia.
- Estado.
- Usuario que confirmo.

El ajuste de Bs debe nacer de un cierre confirmado, no de una fila escrita libremente.

### audit_events

Historial inmutable de acciones importantes.

Debe guardar:

- Actor.
- Accion.
- Entidad.
- Estado anterior.
- Estado posterior.
- Fecha.
- Fuente: usuario, importador, regla o agente.

## Saldos

### Saldo De Obligacion

```text
monto original - suma de aplicaciones validas
```

Interpretacion:

- Mayor que 0: deuda abierta.
- Igual a 0: cerrada.
- Menor que 0: sobrepago o dato que requiere revision.

### Saldo De Cliente

Convencion inicial:

- Positivo: el cliente debe a KW2.
- Negativo: KW2 debe al cliente.
- Cero: cliente conciliado economicamente.

Formula:

```text
obligaciones client_owes_kw2 pendientes
-
obligaciones kw2_owes_client pendientes
```

## Estados

### Operacion

- `draft`
- `ready`
- `posted`
- `partially_settled`
- `settled`
- `needs_review`
- `voided`

### Movimiento

- `draft`
- `posted`
- `partially_reconciled`
- `reconciled`
- `needs_review`
- `voided`

### Conciliacion

- `suggested`
- `confirmed`
- `rejected`
- `voided`

## Decisiones De Diseno

1. Los IDs visibles son numericos.
2. Los montos USD usan decimales exactos, nunca punto flotante.
3. Las fechas efectivas se separan de las fechas de creacion.
4. Los datos importados se conservan crudos en JSON.
5. Borrar financieramente significa anular, no eliminar.
6. El saldo se calcula desde registros, no se escribe manualmente.
7. La IA no modifica saldos directamente.
8. Los reportes son consultas y no copias independientes del libro mayor.
9. Las transacciones externas importadas no se editan.
10. Las conciliaciones usan IDs estables y no referencias a posiciones de filas.
11. La columna historica `MOVIMIENTOS.Type` no se modela porque carece de significado operativo.

## Pendientes

- Formula exacta de comision por operador.
- Tratamiento final de utilidad/spread.
- Reglas contables de gasto y retiro.
- Politica para diferencias pequenas y redondeos.
- Definicion de vencimiento de una deuda.
