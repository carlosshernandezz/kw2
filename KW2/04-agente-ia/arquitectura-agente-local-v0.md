# KW2 - Arquitectura Del Agente Local v0

## Principio

El modelo de IA no sera la fuente de verdad financiera.

La fuente de verdad sera:

- Base de datos.
- Motor contable determinista.
- Reglas de negocio versionadas.
- Historial de auditoria.

El agente sera una interfaz inteligente para consultar, clasificar, sugerir y explicar.

## Componentes

### 1. Orquestador

Recibe una solicitud y decide que herramienta usar.

Ejemplos:

- Consultar saldo de cliente.
- Buscar operaciones abiertas.
- Comparar transacciones.
- Preparar cierre diario.

### 2. Herramientas Deterministas

Funciones controladas:

- `get_client_balance`
- `list_open_operations`
- `list_unreconciled_transactions`
- `find_reconciliation_candidates`
- `calculate_daily_commissions`
- `calculate_bs_adjustment`

El modelo no inventa resultados: llama herramientas que consultan o calculan.

### 3. Memoria Operativa

Debe guardar:

- Alias confirmados.
- Correcciones de cliente.
- Correcciones de banco.
- Sugerencias aceptadas o rechazadas.
- Motivo de decisiones.
- Patrones por operador.

La memoria no reemplaza las reglas. Solo mejora sugerencias futuras.

### 4. Politica De Permisos

Nivel 1:

- Lectura y explicacion.

Nivel 2:

- Crear sugerencias.

Nivel 3:

- Preparar cambios reversibles para aprobacion.

Nivel 4:

- Ejecutar acciones de bajo riesgo expresamente autorizadas.

KW2 comenzara en nivel 1.

## Modelo Local Inicial

Con 16 GB:

- Un modelo cuantizado pequeno.
- Una solicitud intensiva a la vez.
- Contexto limitado a los datos necesarios.
- Procesamiento mediante cola.
- API externa opcional para casos complejos.

La seleccion final del modelo se hara mediante pruebas con tareas reales de KW2, no solo benchmarks generales.

## Operacion 24/7

El agente debe ejecutarse como servicio:

- Inicio automatico al encender.
- Health check.
- Reinicio automatico ante fallos.
- Logs rotativos.
- Cola de trabajos.
- Alertas cuando un proceso falla.
- Sin sesiones graficas abiertas obligatoriamente.

## Primera Prueba De Aceptacion

Con una copia conocida de los datos, el agente debe responder:

1. Saldo de un cliente.
2. Operaciones que forman ese saldo.
3. Abonos parciales relacionados.
4. Medios por los que se recibieron esos abonos.
5. Evidencia de cada respuesta.

Si no puede citar los registros utilizados, la respuesta no se considera confiable.

