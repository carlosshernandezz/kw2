#!/usr/bin/env bash
# Sincroniza la base con el Google Sheet (lectura). Trae DATA y MOVIMIENTOS,
# hace el reimport seguro por kw2_id y verifica los saldos. No escribe en el Sheet.
set -e
cd "$(dirname "$0")/../importer"

echo "== DATA (clientes y cuentas) =="
npx tsx src/import-data.ts 2>/dev/null

echo "== MOVIMIENTOS (snapshot) =="
npx tsx src/import-movimientos.ts 2>/dev/null

echo "== Reimport seguro (por kw2_id) =="
npx tsx src/reimport-movimientos.ts 2>/dev/null

echo "== Verificacion de saldos =="
npx tsx src/verify-model.ts 2>/dev/null
