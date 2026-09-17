#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
if [[ ! -f .env ]]; then
  echo 'Falta .env. Desde la raiz del repositorio ejecuta: cp .env.example .env' >&2
  exit 1
fi
docker compose --env-file .env -f compose.local.yml down
echo 'Entorno detenido. El volumen de PostgreSQL se conserva.'
