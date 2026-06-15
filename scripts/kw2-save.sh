#!/usr/bin/env bash
# Ejecutar en la Mac donde ESTUVISTE trabajando, ANTES de irte.
# Sube el codigo a GitHub y genera un dump de la base listo para AirDrop.
set -e
cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "AVISO: tienes cambios sin commitear. Pidele a Claude que los confirme,"
  echo "       o haz commit antes de continuar. (El dump SI incluye todo.)"
  echo
fi

echo "==> Subiendo codigo a GitHub..."
git push || echo "(nada que subir o ya estaba al dia)"

echo "==> Generando dump de la base..."
mkdir -p backups
STAMP=$(date +%Y-%m-%d-%H%M)
DUMP="backups/kw2-$STAMP.sql"
docker compose exec -T postgres pg_dump -U kw2_app -d kw2 > "$DUMP"

ZIP="$HOME/Desktop/kw2-dump-$STAMP.zip"
zip -j "$ZIP" "$DUMP" >/dev/null

echo
echo "==> LISTO. AirDropea este archivo a la otra Mac:"
echo "    $ZIP"
echo "    (en la otra Mac, corre: bash scripts/kw2-load.sh)"
