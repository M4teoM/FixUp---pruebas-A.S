#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
if [[ ! -f .env ]]; then
  echo 'Falta .env. Desde la raiz del repositorio ejecuta: cp .env.example .env' >&2
  exit 1
fi
if ! command -v docker >/dev/null; then
  echo 'Docker no esta instalado o no esta en PATH.' >&2
  exit 1
fi
if ! docker info >/dev/null; then
  echo 'Docker no esta disponible. Inicia Docker Desktop o Docker Engine.' >&2
  exit 1
fi
docker compose --env-file .env -f compose.local.yml config --quiet
docker compose --env-file .env -f compose.local.yml up --build -d
docker compose --env-file .env -f compose.local.yml ps
for service in frontend backend; do
  target_port=80
  [[ "$service" != backend ]] || target_port=8080
  binding="$(docker compose --env-file .env -f compose.local.yml port "$service" "$target_port")"
  [[ -n "$binding" ]] || { echo "No se pudo consultar el puerto de $service." >&2; exit 1; }
  echo "$service: http://localhost:${binding##*:}"
done
echo 'Los contenedores iniciados no prueban funcionalidad de negocio. Ejecuta ./scripts/verify-local.sh.'
