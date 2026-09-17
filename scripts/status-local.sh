#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
if [[ ! -f .env ]]; then
  echo 'Falta .env. Desde la raiz del repositorio ejecuta: cp .env.example .env' >&2
  exit 1
fi
docker compose --env-file .env -f compose.local.yml ps --all
docker compose --env-file .env -f compose.local.yml logs --tail 100 database backend frontend
