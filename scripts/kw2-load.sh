#!/usr/bin/env bash
# Ejecutar en la Mac a la que LLEGAS. Trae el codigo, restaura la base desde el
# dump mas reciente (lo busca en backups/ o lo descomprime de ~/Downloads),
# instala dependencias y verifica los saldos.
set -e
cd "$(dirname "$0")/.."

echo "==> Trayendo codigo de GitHub..."
git stash --include-untracked >/dev/null 2>&1 && echo "   (se guardaron cambios locales en un stash)" || true
git pull

echo "==> Verificando Docker..."
if ! docker info >/dev/null 2>&1; then
  echo "ERROR: Docker Desktop no esta corriendo. Abrelo y vuelve a correr este script."
  exit 1
fi

echo "==> Levantando PostgreSQL..."
docker compose up -d
until docker compose exec -T postgres pg_isready -U kw2_app -d kw2 >/dev/null 2>&1; do sleep 1; done

# Buscar el dump: primero en backups/, si no, descomprimir el zip mas nuevo de ~/Downloads.
DUMP=$(ls -t backups/*.sql 2>/dev/null | head -1 || true)
if [ -z "$DUMP" ]; then
  ZIP=$(ls -t "$HOME/Downloads"/kw2-dump-*.zip 2>/dev/null | head -1 || true)
  if [ -n "$ZIP" ]; then
    echo "==> Descomprimiendo $ZIP"
    mkdir -p backups
    unzip -o "$ZIP" -d backups/ >/dev/null
    DUMP=$(ls -t backups/*.sql | head -1)
  fi
fi
if [ -z "$DUMP" ]; then
  echo "ERROR: no encontre ningun dump. AirDropea el zip a ~/Downloads y reintenta."
  exit 1
fi

echo "==> Restaurando base desde $DUMP ..."
docker compose exec -T postgres psql -U kw2_app -d kw2 -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;" >/dev/null
docker compose exec -T postgres psql -U kw2_app -d kw2 < "$DUMP" >/dev/null

echo "==> Instalando dependencias..."
( cd importer && npm install >/dev/null 2>&1 ) || true
( cd web && npm install >/dev/null 2>&1 ) || true

echo "==> Verificando saldos (debe dar 372/372 y 17/17)..."
( cd importer && npx tsx src/verify-model.ts ) || true

echo
echo "==> LISTO. Arranca la app con:  cd web && npm run dev"
