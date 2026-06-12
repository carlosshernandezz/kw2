# KW2 - Reglas Contables Por Tipo De Operacion v0

Este documento convierte la operativa de KW2 en reglas que luego pueda ejecutar una app o agente.

Estado: borrador inicial. Requiere validacion operativa.

## Campo Type Descartado

La columna `Type` de `MOVIMIENTOS` no representa el tipo de operacion ni el medio de pago.

- No se migrara como campo funcional.
- No se utilizara para clasificar movimientos.
- Su contenido original solo podra conservarse como evidencia cruda de importacion.

## 1. Convencion Basica

En `MOVIMIENTOS`, cada fila representa un impacto sobre una cuenta o sobre un cliente.

Convencion actual:

- `Ingreso`: aumenta el saldo de la cuenta/cliente seleccionado.
- `Egreso`: disminuye el saldo de la cuenta/cliente seleccionado.

Campos minimos esperados por asiento:

- Fecha.
- Operacion economica ID.
- Tipo de operacion.
- Cliente.
- Banco/cuenta.
- Tipo: Ingreso o Egreso.
- Monto USD.
- Tasa, si hay Bs.
- Monto Bs, si hay Bs.
- Emisor/beneficiario o referencia cuando aplique.
- Operador, si aplica.

## 2. Compra

Definicion:

- KW2 le compra dolares al cliente.
- El cliente entrega USD en algun medio.
- KW2 entrega otra cosa al cliente, normalmente Bs u otro medio.

### 2.1 Compra Cash

Interpretacion:

- Cliente entrega cash.
- KW2 recibe cash.
- KW2 entrega contraparte al cliente, normalmente Bs/Zelle/USDT segun la operacion real.

Asientos esperados, caso cash contra Bs:

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | CASH | Cliente | Ingreso | monto USD | | | Entra cash a KW2 |
| 2 | Banco Bs | Cliente | Egreso | monto USD | tasa | monto Bs | Sale Bs al cliente |

Pendiente:

- Confirmar si el cliente tambien queda reflejado en una fila separada o si el cliente se refleja dentro de cada fila.

### 2.2 Compra Zelle

Interpretacion:

- Cliente entrega Zelle.
- KW2 recibe Zelle.
- KW2 entrega contraparte al cliente, normalmente Bs/cash/USDT.

Asientos esperados, caso Zelle contra Bs:

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ZELLE | Cliente | Ingreso | monto USD | | | Entra Zelle a KW2 |
| 2 | Banco Bs | Cliente | Egreso | monto USD | tasa | monto Bs | Sale Bs al cliente |

Regla Zelle:

- Si el emisor Zelle no coincide con el cliente, buscar en `Mapeo Zelle`.
- Si no hay match, registrar contra `Sin Identificar` y crear alerta.

## 3. Venta

Definicion:

- KW2 le vende dolares al cliente.
- KW2 entrega USD en algun medio.
- El cliente entrega contraparte, normalmente Bs u otro medio.

### 3.1 Venta Cash

Asientos esperados, caso Bs contra cash:

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Banco Bs | Cliente | Ingreso | monto USD | tasa | monto Bs | Entran Bs a KW2 |
| 2 | CASH | Cliente | Egreso | monto USD | | | Sale cash al cliente |

### 3.2 Venta Zelle

Asientos esperados, caso Bs contra Zelle:

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Banco Bs | Cliente | Ingreso | monto USD | tasa | monto Bs | Entran Bs a KW2 |
| 2 | ZELLE | Cliente | Egreso | monto USD | | | Sale Zelle al cliente |

## 4. Cambios Entre Medios

Estos movimientos no necesariamente involucran Bs ni tasa Bs/USD. Pueden requerir una tasa o fee implicito entre medios si hay diferencial.

Convencion confirmada:

- En operaciones `A x B`, el primer medio (`A`) es lo que KW2 recibe.
- El segundo medio (`B`) es lo que KW2 entrega.
- Visto desde el cliente: el cliente entrega `A` y recibe `B`.

### 4.1 Cash x USDT

Interpretacion:

- KW2 recibe cash.
- KW2 entrega USDT.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Comentario |
| --- | --- | --- | --- | --- | --- |
| 1 | CASH | Cliente | Ingreso | monto USD | Entra cash |
| 2 | BINANCE/USDT | Cliente | Egreso | monto USD | Sale USDT |

### 4.2 USDT x Cash

Interpretacion:

- KW2 recibe USDT.
- KW2 entrega cash.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Comentario |
| --- | --- | --- | --- | --- | --- |
| 1 | BINANCE/USDT | Cliente | Ingreso | monto USD | Entra USDT |
| 2 | CASH | Cliente | Egreso | monto USD | Sale cash |

### 4.3 Cash x Zelle

Interpretacion:

- KW2 recibe cash.
- KW2 entrega Zelle.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Comentario |
| --- | --- | --- | --- | --- | --- |
| 1 | CASH | Cliente | Ingreso | monto USD | Entra cash |
| 2 | ZELLE | Cliente | Egreso | monto USD | Sale Zelle |

### 4.4 Zelle x Cash

Interpretacion:

- KW2 recibe Zelle.
- KW2 entrega cash.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Comentario |
| --- | --- | --- | --- | --- | --- |
| 1 | ZELLE | Cliente | Ingreso | monto USD | Entra Zelle |
| 2 | CASH | Cliente | Egreso | monto USD | Sale cash |

### 4.5 USDT x Zelle

Interpretacion:

- KW2 recibe USDT.
- KW2 entrega Zelle.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Comentario |
| --- | --- | --- | --- | --- | --- |
| 1 | BINANCE/USDT | Cliente | Ingreso | monto USD | Entra USDT |
| 2 | ZELLE | Cliente | Egreso | monto USD | Sale Zelle |

### 4.6 Zelle x USDT

Interpretacion:

- KW2 recibe Zelle.
- KW2 entrega USDT.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Comentario |
| --- | --- | --- | --- | --- | --- |
| 1 | ZELLE | Cliente | Ingreso | monto USD | Entra Zelle |
| 2 | BINANCE/USDT | Cliente | Egreso | monto USD | Sale USDT |

### 4.7 Bs x Zelle

Interpretacion:

- KW2 recibe Bs.
- KW2 entrega Zelle.
- Requiere tasa Bs/USD.
- Requiere conciliacion contra `EDO CTA BS`.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Banco Bs | Cliente | Ingreso | monto USD | tasa | monto Bs | Entran Bs a KW2 |
| 2 | ZELLE | Cliente | Egreso | monto USD | | | Sale Zelle |

Reglas:

- Debe generar numero de operacion Bs.
- La transaccion bancaria de entrada debe conciliarse por fecha, banco, monto y cliente.
- Si el Zelle sale desde un emisor/beneficiario distinto, debe quedar referencia en el asiento o en el soporte.

### 4.8 Zelle x Bs

Interpretacion:

- KW2 recibe Zelle.
- KW2 entrega Bs.
- Requiere tasa Bs/USD.
- Requiere conciliacion contra `EDO CTA BS`.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | ZELLE | Cliente | Ingreso | monto USD | | | Entra Zelle |
| 2 | Banco Bs | Cliente | Egreso | monto USD | tasa | monto Bs | Salen Bs de KW2 |

Reglas:

- Debe generar numero de operacion Bs.
- La transaccion bancaria de salida debe conciliarse por fecha, banco, monto y cliente.
- Si el pago Bs sale a otro banco, el sistema debe evaluar comision bancaria segun la cuenta usada.

### 4.9 Bs x Cash

Interpretacion:

- KW2 recibe Bs.
- KW2 entrega cash.
- Requiere tasa Bs/USD.
- Requiere conciliacion contra `EDO CTA BS`.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Banco Bs | Cliente | Ingreso | monto USD | tasa | monto Bs | Entran Bs a KW2 |
| 2 | CASH | Cliente | Egreso | monto USD | | | Sale cash |

Reglas:

- Debe generar numero de operacion Bs.
- La transaccion bancaria de entrada debe conciliarse por fecha, banco, monto y cliente.

### 4.10 Cash x Bs

Interpretacion:

- KW2 recibe cash.
- KW2 entrega Bs.
- Requiere tasa Bs/USD.
- Requiere conciliacion contra `EDO CTA BS`.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | CASH | Cliente | Ingreso | monto USD | | | Entra cash |
| 2 | Banco Bs | Cliente | Egreso | monto USD | tasa | monto Bs | Salen Bs de KW2 |

Reglas:

- Debe generar numero de operacion Bs.
- La transaccion bancaria de salida debe conciliarse por fecha, banco, monto y cliente.
- Si el pago Bs sale a otro banco, el sistema debe evaluar comision bancaria segun la cuenta usada.

### 4.11 Bs x USDT

Interpretacion:

- KW2 recibe Bs.
- KW2 entrega USDT.
- Requiere tasa Bs/USD.
- Requiere conciliacion contra `EDO CTA BS`.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Banco Bs | Cliente | Ingreso | monto USD | tasa | monto Bs | Entran Bs a KW2 |
| 2 | BINANCE/USDT | Cliente | Egreso | monto USD | | | Sale USDT |

Reglas:

- Debe generar numero de operacion Bs.
- La transaccion bancaria de entrada debe conciliarse por fecha, banco, monto y cliente.
- La salida USDT debe conciliarse luego contra Binance por transaccion individual.

### 4.12 USDT x Bs

Interpretacion:

- KW2 recibe USDT.
- KW2 entrega Bs.
- Requiere tasa Bs/USD.
- Requiere conciliacion contra `EDO CTA BS`.

| Linea | Cuenta/Banco | Cliente | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | BINANCE/USDT | Cliente | Ingreso | monto USD | | | Entra USDT |
| 2 | Banco Bs | Cliente | Egreso | monto USD | tasa | monto Bs | Salen Bs de KW2 |

Reglas:

- Debe generar numero de operacion Bs.
- La entrada USDT debe conciliarse luego contra Binance por transaccion individual.
- La transaccion bancaria de salida debe conciliarse por fecha, banco, monto y cliente.
- Si el pago Bs sale a otro banco, el sistema debe evaluar comision bancaria segun la cuenta usada.

## 5. Gasto

Regla conocida:

- `GASTO` funciona como banco/cuenta en el sistema actual.

Borrador:

| Linea | Cuenta/Banco | Cliente/Concepto | Tipo | Monto USD | Tasa | Monto Bs | Comentario |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Banco/Cuenta que paga | GASTO | Egreso | monto | tasa si aplica | monto Bs si aplica | Sale dinero |
| 2 | GASTO | Concepto | Ingreso | monto | | | Se reconoce el gasto |

Pendiente:

- Confirmar si todo gasto debe tener contrapartida contra `GASTO`.

## 6. Comision

Las comisiones pueden venir de:

- Operadores.
- Jorge.
- Mileng.
- Comisiones bancarias.
- Ajuste Bs contra comision.

### 6.1 Comision Bancaria

Reglas conocidas:

- NENEKA: 0,3%.
- VENISUM: 0,25%.
- SOLUCIONES: 0,25%.

Debe usar el mismo numero de operacion que el pago principal.

### 6.2 Comision Jorge

Regla:

- 0,25% del monto de ingreso en USD por VENISUM y SOLUCIONES.
- Calculo diario por banco/cuenta.

### 6.3 Comision Mileng

Regla:

- 0,5% del monto de ingreso en USD por NENEKA.
- Calculo diario por banco/cuenta.

### 6.4 Comision Operador

Regla conceptual:

- Se calcula por diferencial entre tasa de mesa y tasa final del operador.
- Se lleva a dolares.

Pendiente:

- Formula exacta.
- Quien paga la comision.
- En que banco/cuenta queda registrada.

## 7. Ajuste Bs

El ajuste Bs se calcula obligatoriamente en el cierre diario.

Objetivo:

- Ajustar el saldo USD teorico del banco al saldo real convertido desde Bs usando tasa promedio de compra.

Asiento conceptual:

| Linea | Cuenta/Banco | Cliente/Concepto | Tipo | Monto USD | Comentario |
| --- | --- | --- | --- | --- | --- |
| 1 | Banco Bs | Ajuste Bs | Ingreso | diferencia positiva | Aumenta saldo de banco |
| 2 | COMISION | Ajuste Bs | Egreso | diferencia positiva | Contrapartida para cerrar en cero |

Si la diferencia es negativa, validar si el asiento se invierte.

## 8. Retiro

Pendiente por documentar.

Preguntas:

- Retiro de quien?
- Retiro desde que cuenta?
- Retiro hacia que cuenta?
- Es salida de utilidad, retiro de socio, retiro operativo o retiro de cliente?

## 9. Reglas Generales Para Automatizacion

El sistema debe generar asientos solo cuando tenga datos suficientes.

Si falta informacion, debe crear una operacion en estado `incompleta`.

Estados sugeridos:

- `draft`: capturada pero incompleta.
- `ready`: lista para generar asientos.
- `posted`: asientos generados.
- `partially_reconciled`: parcialmente conciliada.
- `reconciled`: conciliada.
- `needs_review`: requiere revision humana.
- `voided`: anulada.

## 10. Operaciones Abiertas Y Abonos Parciales

Regla central:

- La conciliacion economica del cliente se cierra cuando el saldo del cliente llega a 0.
- No importa si el cliente paga por un solo medio o por varios medios.
- El medio de pago explica como se liquida la deuda, pero no define por si solo si la operacion esta cerrada.

Ejemplo:

KW2 entrega Bs a Pedro por USD 1.000 equivalentes.

En ese momento:

| Cliente | Debe entregar | Medio esperado | Estado |
| --- | --- | --- | --- |
| Pedro | USD 1.000 | Pendiente | Abierta |

Luego Pedro paga parcialmente:

| Medio recibido | Monto USD | Estado |
| --- | --- | --- |
| Zelle | 300 | Recibido |
| Cash | 200 | Recibido |
| Pendiente | 500 | Por cobrar |

Resultado:

| Cliente | Saldo |
| --- | --- |
| Pedro | -500 |

La operacion sigue abierta aunque ya existan abonos parciales.

Si despues Pedro paga el restante:

| Medio recibido | Monto USD | Estado |
| --- | --- | --- |
| USDT | 500 | Recibido |

Resultado:

| Cliente | Saldo |
| --- | --- |
| Pedro | 0 |

La operacion queda cerrada economicamente.

### Implicacion Para El Sistema Nuevo

Una operacion no debe depender de saber desde el inicio el medio exacto por el cual el cliente va a pagar.

El sistema debe separar:

- `Operacion`: acuerdo economico y saldo esperado del cliente.
- `Entrega`: lo que KW2 ya entrego.
- `Abonos`: pagos parciales del cliente por cualquier medio.
- `Saldo cliente`: diferencia pendiente.
- `Conciliacion de medio`: validacion de cada abono contra Zelle, Cash, USDT o banco.
- `Conciliacion economica`: cierre cuando el saldo del cliente es 0.

Estados sugeridos para una operacion abierta:

- `abierta`: existe saldo pendiente.
- `parcialmente_pagada`: hay abonos, pero saldo distinto de 0.
- `cerrada`: saldo cliente en 0.
- `sobregirada`: el cliente pago de mas.
- `needs_review`: hay diferencia o datos dudosos.

### Regla De Prioridad

La pregunta principal del backoffice debe ser:

```text
Cuanto debe este cliente o cuanto le debemos?
```

La pregunta secundaria es:

```text
Por cuales medios se ha movido ese saldo?
```

Por eso, para KW2, la conciliacion de cliente es mas importante que la clasificacion inicial del medio pendiente.

## 11. Preguntas Para Validar Esta Matriz

1. Cada operacion normal siempre debe tener exactamente dos lineas principales?
2. El cliente se refleja solo como `Name` dentro de cada linea o tambien como saldo separado?
3. Como se registra una ganancia por spread cuando no hay Bs?
4. Las operaciones entre medios sin Bs llevan tasa?
5. Que cuenta se usa para utilidad/spread?
6. Que diferencia hay entre `COMISION`, `GASTO` y utilidad?
7. El ajuste Bs siempre va contra `COMISION`?
8. Que casos generan mas de dos lineas ademas de comisiones?
9. Como se anula/corrige una operacion mal registrada hoy?
