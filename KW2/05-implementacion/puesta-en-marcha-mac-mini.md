# KW2 - Puesta En Marcha De La Mac Mini

## Equipo Disponible

- Mac mini M4.
- CPU de 10 nucleos.
- 16 GB de memoria unificada.
- macOS 26.4.
- Homebrew instalado.
- Node.js 25 y npm instalados.
- Git instalado.
- Docker Desktop 4.77 instalado y verificado.
- Docker Engine 29.5.3.
- Docker Compose 5.1.4.
- Ollama 0.30.7 instalado como servicio local.

## Objetivo Inicial

Construir un laboratorio local de KW2 que pueda permanecer activo 24/7 sin modificar la operativa real.

La primera version debe:

1. Importar una copia de los datos de `2026 KW2`.
2. Guardarlos en una base de datos local.
3. Reproducir saldos de clientes y cuentas.
4. Detectar operaciones abiertas y abonos parciales.
5. Permitir consultas de solo lectura mediante un agente local.
6. Registrar toda consulta, sugerencia y error.

La primera version no debe:

- Escribir en el Google Sheet.
- Conciliar automaticamente movimientos reales.
- Corregir saldos sin aprobacion.
- Borrar datos.
- Tener acceso directo a cuentas bancarias.

## Fases

### Fase 0 - Preparar El Servidor

- Crear usuario de sistema dedicado si la Mac se usara tambien personalmente.
- Activar FileVault.
- Configurar reinicio automatico despues de una falla electrica.
- Instalar Docker Desktop o un runtime compatible.
- Instalar Ollama.
- Preparar respaldos externos.
- Configurar acceso remoto privado mas adelante.

### Fase 1 - Datos Espejo

- Exportar o leer `MOVIMIENTOS`, `DATA` y hojas auxiliares.
- Importar la informacion sin alterar el origen.
- Normalizar fechas, montos, clientes, cuentas y operaciones.
- Comparar saldos calculados contra Google Sheets.

Resultado esperado:

```text
Saldo calculado por el sistema = saldo mostrado por la hoja
```

Las diferencias deben quedar explicadas y auditadas.

### Fase 2 - Agente Local De Solo Lectura

Consultas iniciales:

- Quien le debe a KW2?
- A quien le debe KW2?
- Cuanto debe cada cliente?
- Que operaciones estan parcialmente pagadas?
- Que movimientos Bs no estan conciliados?
- Que posibles duplicados existen?
- Que datos faltan para cerrar el dia?

El agente consulta datos estructurados. No calcula saldos mediante texto libre.

### Fase 3 - Conciliacion Asistida

- Importar movimientos bancarios.
- Generar candidatos por fecha, monto, banco y cliente.
- Asignar nivel de confianza.
- Conciliar automaticamente solo casos autorizados de confianza alta.
- Enviar diferencias a revision humana.

### Fase 4 - Captura Estructurada

- Registrar nuevas operaciones desde la app.
- Generar asientos automaticamente.
- Permitir abonos parciales por varios medios.
- Mantener saldo de cliente hasta llegar a cero.
- Exportar resultados a Google Sheets durante la transicion.

### Fase 5 - Operacion Principal

Solo despues de varias semanas de comparacion correcta:

- La app pasa a ser la fuente principal.
- Google Sheets queda como reporte y exportacion.
- Se habilitan automatizaciones con aprobacion y reversibilidad.

## Servicios Iniciales

```text
App web interna
API de KW2
PostgreSQL
Worker de importacion
Motor contable
Agente local
Ollama
Backups
```

Con 16 GB se ejecutara un solo modelo local pequeno a la vez. La base de datos y el codigo realizan los calculos exactos; el modelo interpreta preguntas y explica resultados.

## Seguridad Minima

- Nada sensible dentro del repositorio Git.
- Variables secretas en `.env`.
- Base de datos con respaldos diarios.
- Copia externa cifrada.
- Usuarios individuales para el backoffice.
- Auditoria de toda modificacion.
- Acciones financieras con aprobacion humana.

## Primer Hito

El primer hito no es "tener una IA".

Es demostrar que, usando una copia del Sheet, el sistema puede responder correctamente:

```text
Quien debe, a quien se le debe y cuanto?
```
