# KW2 - Docker Y PostgreSQL

## Archivos

- `compose.yaml`: define el servicio PostgreSQL.
- `.env`: credenciales locales; Git lo ignora.
- `.env.example`: plantilla sin secretos.
- `infra/postgres/init/`: scripts ejecutados al crear la base por primera vez.

## Levantar La Base

```bash
docker compose up -d
```

Docker:

1. Lee `compose.yaml`.
2. Lee las variables de `.env`.
3. Descarga `postgres:17-alpine` si hace falta.
4. Crea el volumen `kw2_postgres_data`.
5. Crea e inicia `kw2-postgres`.
6. Ejecuta los scripts de `infra/postgres/init/` solo al inicializar un volumen vacio.

## Ver Estado

```bash
docker compose ps
```

El estado esperado es `healthy`.

## Ver Logs

```bash
docker compose logs -f postgres
```

Salir de los logs con `Ctrl+C` no detiene PostgreSQL.

## Abrir La Consola SQL

```bash
docker compose exec postgres psql -U kw2_app -d kw2
```

Comandos utiles dentro de `psql`:

```text
\dt
\d schema_migrations
SELECT * FROM schema_migrations;
\q
```

## Detener Y Reiniciar

```bash
docker compose stop
docker compose start
docker compose restart
```

## Eliminar Contenedores

```bash
docker compose down
```

Esto elimina el contenedor y la red, pero conserva el volumen con los datos.

No ejecutar lo siguiente sin un respaldo:

```bash
docker compose down -v
```

La opcion `-v` elimina tambien el volumen persistente y la base de datos.

## Seguridad Actual

- PostgreSQL se publica solo en `127.0.0.1`.
- No puede recibir conexiones directas desde otros equipos.
- La clave local esta fuera de Git.
- Esta configuracion es de laboratorio; antes de produccion se rotara la clave.

## Verificacion Realizada

El 12 de junio de 2026 se verifico:

- Docker Engine 29.5.3.
- Docker Compose 5.1.4.
- PostgreSQL 17.10 para ARM64.
- Contenedor `kw2-postgres` en estado `healthy`.
- Puerto local `127.0.0.1:5432`.
- Migracion `001_bootstrap` aplicada.
- Persistencia confirmada despues de reiniciar el contenedor.

El volumen persistente se llama:

```text
kw2_postgres_data
```

## Siguiente Paso

Disenar el modelo de datos v0 antes de crear tablas financieras:

- Clientes.
- Cuentas y medios.
- Operaciones.
- Entregas de KW2.
- Abonos de clientes.
- Asientos contables.
- Conciliaciones.
- Auditoria.
