# KW2 - Documentacion Del Sistema Actual

## 1. Proposito Del Sistema

KW2 opera una mesa de cambio donde se conectan clientes que tienen una forma de valor con clientes que necesitan otra.

La operativa incluye:

- USD en efectivo.
- Zelle.
- USDT.
- Bolivares en distintos bancos.

El sistema actual vive principalmente en el Google Sheet `2026 KW2`. La hoja central es `MOVIMIENTOS`, que funciona como libro mayor. Las demas hojas son auxiliares, informativas o de control: estados de cuenta, reportes por cliente, reportes por banco, dashboard, mapeos y hojas historicas.

El objetivo futuro es documentar, automatizar, reducir errores y redisenar el sistema para que sea mas autonomo, preciso y autosuficiente.

## 2. Unidad Principal: Operacion Economica

La unidad real del negocio no es una fila del Sheet. La unidad real es la operacion economica.

Una operacion economica puede generar varias filas contables en `MOVIMIENTOS`.

Ejemplo conceptual:

- Un cliente entrega Bs.
- KW2 entrega Zelle.
- Puede existir una comision.
- Puede existir un gasto bancario.
- Puede existir un ajuste posterior.

Cada uno de esos efectos puede terminar representado como una o mas filas en el libro mayor.

## 3. Libro Mayor: MOVIMIENTOS

`MOVIMIENTOS` es la fuente operativa principal del sistema actual.

En esta hoja se registran:

- Movimientos de clientes.
- Movimientos entre bancos/cuentas.
- Compras y ventas.
- Cambios entre medios.
- Comisiones.
- Gastos.
- Ajustes.
- Retiros.
- Saldos traidos del ano anterior.

Columnas observadas y rol actual:

- Fecha.
- Semana del ano.
- `Type`: identificador interno/historico usado para clasificar registros, especialmente saldos del ano anterior.
- `ID_Banco`: ID calculado desde `DATA`.
- `Bank`: banco/cuenta afectada.
- `ID_Cliente`: ID calculado desde `DATA`.
- `Name`: cliente o contraparte.
- `Tipo`: solo puede ser `Ingreso` o `Egreso`.
- `Monto Credito`.
- `Monto Debito`.
- `Porcentaje`.
- `Emisor/Beneficiario`.
- `Tasa`: tasa Bs/USD.
- `Monto Bs`.
- `Operacion`: numero automatico de operacion cuando hay tasa.
- `x`: conciliacion Bs.
- `Conciliacion` u otras columnas auxiliares.

## 4. Tipos De Operacion Economica

Los tipos conocidos son:

- Compra cash.
- Venta cash.
- Compra zelle.
- Venta zelle.
- Cash x USDT.
- USDT x cash.
- Cash x zelle.
- Zelle x cash.
- USDT x zelle.
- Zelle x USDT.
- Gasto.
- Comision.
- Ajuste.
- Retiro.

Definicion confirmada:

- `Compra`: KW2 le compra dolares al cliente.
- `Venta`: KW2 le vende dolares al cliente.

Pendiente por documentar:

- Para cada tipo, definir medio que entra, medio que sale, cuenta afectada, cliente afectado, tasa aplicable, y asientos contables esperados.

## 5. Captura Actual De Informacion

La informacion nace principalmente en un grupo de WhatsApp.

En el grupo se envian:

- Capturas de pagos.
- Identificaciones de clientes.
- Comisiones.
- Gastos.
- Mensajes cortos explicando operaciones.

Ejemplo actual:

```text
compra $200 susana
```

Problemas actuales:

- El formato no es disciplinado.
- El banco muchas veces no se especifica.
- La persona que transcribe debe interpretar la captura.
- La tasa se deduce dividiendo el monto Bs entre el monto USD mencionado.
- El cliente puede pagar desde cuentas de terceros.
- Puede haber pagos sin identificar.

## 6. Propuesta Inicial De Captura Estructurada

Para automatizar, el nuevo sistema debe empujar la captura hacia mensajes mas estructurados.

Formato corto sugerido:

```text
compra | Susana | 200 | paga Bs BDV | recibe Zelle | tasa pendiente
```

Formato detallado sugerido:

```text
OPERACION
tipo: compra zelle
cliente: Susana
monto_usd: 200
cliente_entrega: Bs
banco_cliente: BDV
kw2_entrega: Zelle
cuenta_kw2: ZELLE CH
tasa: pendiente
referencia: opcional
nota: opcional
```

El sistema debe poder aceptar informacion incompleta, pero debe marcar campos faltantes y sugerirlos desde la evidencia disponible.

## 7. Maestro DATA

`DATA` funciona como maestro de clientes, bancos/cuentas y saldos.

Incluye:

- ID de cliente.
- Alias o iniciales.
- Nombre de cliente.
- Saldo de cliente.
- ID de banco/cuenta.
- Nombre de banco/cuenta.
- Saldo de banco/cuenta.

Ejemplos de bancos/cuentas:

- CASH CH.
- BINANCE CH.
- NENEKA.
- TRANSITORIA.
- BS BANESCO.
- BS BDV.
- ZELLE CH.
- BDV VENISUM.
- BS MERCANTIL.
- BDV SOLUCIONES.
- ZELLE MANUEL.
- RETIRO.
- COMISION.
- GASTO.

Nota importante:

- `GASTO` funciona como banco/cuenta dentro del sistema actual.

## 8. Conciliacion De Bolivares

La hoja `EDO CTA BS` recibe estados de cuenta bancarios en bolivares.

Proceso actual:

1. Una persona descarga estados de cuenta bancarios.
2. Copia o carga los movimientos en `EDO CTA BS`.
3. Busca el movimiento equivalente en `MOVIMIENTOS`.
4. En la columna D de `EDO CTA BS`, escribe una formula que apunta al numero de operacion correspondiente:

```text
=MOVIMIENTOS!O70
```

5. `MOVIMIENTOS` usa esa referencia para marcar la conciliacion.

Regla clave:

- La columna D debe guardar una referencia a la celda de `MOVIMIENTOS`, no solo el numero como valor.
- Esto permite que si se insertan filas y cambia el numero de operacion, la conciliacion siga apuntando al movimiento correcto.

## 9. Numero De Operacion Bs

En `MOVIMIENTOS`, la columna `Operacion` asigna un numero automatico cuando hay tasa.

La tasa representa el tipo de cambio Bs/USD.

Regla actual:

- Si hay tasa, se considera que la operacion tiene componente Bs.
- Esa operacion recibe numero de operacion.
- Ese numero se usa para conciliar contra `EDO CTA BS`.

Pendiente por revisar:

- Confirmar si toda operacion con tasa necesariamente tiene `Monto Bs`.
- Confirmar si el sistema nuevo debe separar `operation_id` general de `bs_reconciliation_id`.

Recomendacion inicial:

- Toda operacion economica debe tener un ID unico numerico.
- Las conciliaciones Bs pueden tener un identificador o grupo adicional, pero no deben ser el unico ID de operacion.

## 10. Reglas De Conciliacion Bs

Condiciones deseadas para conciliar:

- Monto.
- Banco.
- Fecha.
- Cliente.

La fecha debe coincidir exactamente entre `EDO CTA BS` y `MOVIMIENTOS` para movimientos en Bs.

El sistema debe sugerir conciliaciones cuando:

- Monto coincide.
- Fecha coincide.
- Banco coincide.
- Cliente coincide o es altamente probable.

El sistema tambien debe detectar casos dudosos:

- Monto coincide pero banco difiere.
- Fecha coincide pero cliente no.
- Cliente probable por historial pero descripcion distinta.
- Pago dividido en multiples movimientos.
- Movimiento bancario con comision.
- Posible duplicado.

Caso especial:

- Si en `MOVIMIENTOS` se registro el banco equivocado, por ejemplo `BDV VENISUM` en vez de `BDV SOLUCIONES`, el sistema debe avisar:

```text
Sugerencia de conciliacion: monto y fecha coinciden, pero el banco difiere.
MOVIMIENTOS: BDV VENISUM
EDO CTA BS: BDV SOLUCIONES
Accion sugerida: confirmar si el banco en MOVIMIENTOS esta mal registrado.
```

## 11. Pagos Divididos Y Agrupados

Caso: una operacion Bs se paga en multiples movimientos bancarios.

Regla actual:

- Todos los movimientos bancarios relacionados se enlazan al mismo numero de operacion.

Caso: una sola transferencia cubre varias distribuciones internas.

Ejemplo:

- Pago de estacionamiento dividido entre CH, Constructora y JAC.

Regla actual:

- El movimiento del estado de cuenta se divide manualmente en las distribuciones que corresponden a cada cliente.

El sistema nuevo debe soportar:

- Una operacion con multiples transacciones bancarias.
- Una transaccion bancaria dividida en multiples asignaciones internas.
- Auditoria de la division.

## 11.1 Deudas Abiertas Y Abonos Por Varios Medios

Una operacion puede quedar abierta si KW2 ya entrego valor al cliente, pero el cliente todavia no ha cancelado completamente.

Ejemplo:

- KW2 entrega Bs equivalentes a USD 1.000 a Pedro.
- Pedro paga USD 300 por Zelle.
- Pedro paga USD 200 en cash.
- Pedro todavia debe USD 500.
- No se sabe ni importa inicialmente si esos USD 500 restantes entraran por Zelle, cash o USDT.

Regla operativa:

- Lo importante es saber el saldo del cliente.
- La operacion se cierra economicamente cuando el cliente queda en 0.
- El medio de pago sirve para conciliar saldos de Zelle, cash, USDT o banco, pero no cambia la deuda total del cliente.

El sistema nuevo debe permitir abonos parciales por multiples medios contra una misma deuda de cliente.

## 12. Comisiones Bancarias En Bs

La captura no siempre muestra la comision bancaria.

El sistema o agente debe detectar cuando el pago se envio a un numero de cuenta que no corresponde con el banco de origen.

Reglas conocidas:

- NENEKA: comision bancaria 0,3%.
- VENISUM: comision bancaria 0,25%.
- SOLUCIONES: comision bancaria 0,25%.

La comision bancaria debe quedar asociada al mismo numero de operacion que el pago principal.

## 13. Ajuste Bs

El ajuste Bs nace por diferencias entre:

- El saldo teorico del banco expresado en USD segun el reporte banco.
- El saldo real del estado de cuenta en Bs convertido a USD usando la tasa promedio de compra.

Ejemplo conceptual:

- Ingresan Bs equivalentes a USD 10.000 a tasa 770.
- Durante el dia se recompran USD 9.000 a tasa promedio 730.
- El reporte banco puede mostrar saldo teorico de USD 1.000.
- El estado de cuenta en Bs, dividido entre la tasa promedio de compra, puede mostrar USD 1.547,94.
- La diferencia de USD 547,94 se registra como ajuste Bs.

Regla contable actual:

- El ajuste Bs aumenta el saldo de la cuenta.
- La contrapartida va contra comisiones para que el asiento de cero.

Ejemplo:

- Cuenta banco: +547,94.
- Comision: -547,94.

El cierre diario debe calcular y proponer este ajuste por banco.

## 14. Comisiones Jorge Y Mileng

Las comisiones se calculan diariamente por banco/cuenta.

Reglas conocidas:

- Mileng: 0,5% del monto de ingreso en USD por la cuenta NENEKA.
- Jorge: 0,25% del monto de ingreso en USD por las cuentas VENISUM y SOLUCIONES.

Actualmente, la hoja `EDO CTA BS`, columnas I hasta O, contiene herramientas para calcular:

- Saldos por banco.
- Diferencias.
- Ajustes Bs.
- Comisiones Jorge.
- Comisiones Mileng.

El sistema nuevo debe incluir un cierre diario obligatorio que calcule estas comisiones y permita aprobarlas.

## 15. Zelle

Zelle se maneja con apoyo de `Mapeo Zelle`.

Problema:

- Muchos clientes pagan desde Zelles que no son sus cuentas personales.
- El nombre del emisor puede no coincidir con el cliente real.

`Mapeo Zelle` se usa para identificar de quien pudo haber sido un pago recibido.

Regla actual:

- Si llega un Zelle no identificado, se registra contra `Sin Identificar`.
- Luego se reclasifica cuando se descubre el cliente correcto.

El sistema nuevo debe tener:

- Maestro de alias Zelle.
- Alias por cliente.
- Sugerencias automaticas de identificacion.
- Flujo para confirmar o rechazar sugerencias.
- Historial de reclasificaciones.

## 16. USDT / Binance

USDT se controla actualmente de forma manual contra Binance.

Objetivo futuro:

- Conciliar transacciones individuales, no solo saldo final.

El sistema debe importar o leer:

- Fecha/hora.
- Cuenta.
- Operacion.
- Coin.
- Cambio.
- Remark o referencia.

Debe poder distinguir:

- Binance Pay.
- P2P.
- Transferencias internas.
- Fees.
- Movimientos irrelevantes para la mesa.

## 17. Cash

Cash se controla por saldo visual/manual.

Pendiente por documentar:

- Como se registra entrada fisica.
- Como se registra salida fisica.
- Quien custodia.
- Como se hacen conteos.
- Como se manejan diferencias.

## 18. Operadores Y Tasas

Existen operadores que tienen sus propios clientes.

La mesa define una tasa base.

Los operadores pueden subir o bajar la tasa dependiendo de:

- Si es compra.
- Si es venta.
- Tipo de cliente.
- Medio usado: Zelle, cash, USDT, Bs.

La comision del operador se calcula por diferencial de tasas y se lleva a dolares.

Pendiente por documentar:

- Formula exacta de comision por operador.
- Donde se demuestra actualmente en la tabla.
- Si cada operador tiene clientes asignados.
- Si la tasa base diaria debe guardarse como dato independiente.

## 19. Riesgos Actuales

El riesgo principal no es solo contable, sino operativo:

- No tener clientes al dia.
- No saber quien debe.
- No saber a quien se le debe.
- No saber cuanto se debe.

Causas:

- Transcripcion manual desde WhatsApp.
- WhatsApp sin formato disciplinado.
- Conciliacion manual.
- Conciliar pagos a clientes equivocados.
- Duplicar operaciones.
- Olvidar comisiones.
- Olvidar gastos.
- Registrar banco equivocado.
- No identificar Zelles de terceros.
- No conciliar USDT por transaccion.
- Cierres diarios incompletos.

## 20. Controles Necesarios

El sistema nuevo debe incluir controles para:

- Operaciones incompletas.
- Operaciones sin contrapartida.
- Operaciones con tasa faltante.
- Tasa implicita fuera de rango.
- Banco no especificado.
- Banco probable distinto al registrado.
- Cliente probable distinto al registrado.
- Duplicados por monto/fecha/cliente.
- Pagos divididos no completamente conciliados.
- Comision bancaria no registrada.
- Ajuste Bs pendiente.
- Cierre diario no completado.
- Zelles no identificados.
- USDT no conciliado.
- Cambios manuales sin auditoria.

## 21. Agente De IA Deseado

El agente de IA debe aprender del sistema mediante memoria estructurada, no mediante decisiones invisibles.

Debe guardar:

- Sugerencias realizadas.
- Nivel de confianza.
- Razones de la sugerencia.
- Decision humana.
- Usuario que aprobo o rechazo.
- Motivo del rechazo.
- Cambios posteriores.

Ejemplo:

```text
sugerencia: Conciliar transaccion bancaria #123 con operacion #845
confianza: 93%
razones: misma fecha, mismo monto, banco coincide, cliente probable
decision: aceptada
usuario: backoffice_1
```

El agente debe mejorar sus sugerencias usando:

- Alias Zelle confirmados.
- Conciliaciones aceptadas.
- Conciliaciones rechazadas.
- Bancos corregidos.
- Clientes corregidos.
- Comisiones detectadas.
- Tasas historicas.
- Patrones por operador.

## 22. Mac Mini Como Servidor Local

La Mac mini puede funcionar como servidor local de la mesa.

Responsabilidades posibles:

- Base de datos local.
- App web interna.
- Jobs de importacion.
- Procesamiento de estados de cuenta.
- Conciliacion automatica.
- Agente IA.
- Backups.
- Auditoria.
- Reportes.

Recomendacion:

- Empezar con una version espejo.
- La app lee/importa el Sheet y reproduce saldos.
- Google Sheets sigue siendo la referencia mientras se valida.
- Cuando los numeros cuadren por varios dias, la app pasa a ser fuente principal.
- Google Sheets queda como reporte/exportacion.

## 23. Fases Recomendadas

### Fase 1 - Documentacion

- Documentar sistema actual.
- Definir glosario.
- Definir reglas por tipo de operacion.
- Definir reglas de conciliacion.
- Definir cierre diario.

### Fase 2 - Modelo Nuevo

- Disenar base de datos.
- Definir entidades.
- Definir IDs.
- Definir auditoria.
- Definir permisos.

### Fase 3 - App Espejo

- Importar datos desde Google Sheets.
- Reproducir saldos actuales.
- Mostrar diferencias.
- No reemplazar todavia la operacion actual.

### Fase 4 - Automatizacion Inicial

- Captura estructurada.
- Generacion automatica de asientos.
- Conciliacion Bs asistida.
- Cierre diario guiado.
- Alertas de errores.

### Fase 5 - Agente IA

- Sugerencias de conciliacion.
- Deteccion de duplicados.
- Identificacion de Zelle.
- Deteccion de comisiones bancarias.
- Aprendizaje supervisado por decisiones humanas.

## 24. Preguntas Pendientes

1. Para cada tipo de operacion, cuales son los asientos esperados?
2. Como se calcula exactamente la comision por operador?
3. Que hojas actuales contienen formulas criticas que deben preservarse?
4. Que campos son obligatorios en una operacion minima?
5. Que usuarios existen y que permisos debe tener cada uno?
6. Cual es el cierre diario ideal paso a paso?
7. Como se debe importar cada banco?
8. Como se debe importar Zelle?
9. Como se debe importar Binance?
10. Que reportes actuales son indispensables?
11. Que reportes nuevos deben existir?
12. Que errores deben bloquear operaciones y cuales solo alertar?
