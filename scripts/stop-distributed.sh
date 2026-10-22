#!/usr/bin/env bash
# Apaga las dos maquinas desde esta. Con --purge borra tambien el volumen de datos.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
env_file=".env.distributed"
[[ -f "$env_file" ]] || { echo "Falta $env_file" >&2; exit 1; }
simulado=0
[[ "${1:-}" == "--simulado" ]] && { simulado=1; shift; }
extra=()
[[ "${1:-}" == "--purge" ]] && extra=(--volumes)
if [[ "$simulado" == 1 ]]; then data_docker=(docker); else data_docker=(docker --context fixup-data); fi
export DATA_HOST="${DATA_HOST:-x}" 
docker compose --env-file "$env_file" -f compose.app.yml down ${extra[@]+"${extra[@]}"} || true
"${data_docker[@]}" compose --env-file "$env_file" -f compose.data.yml down ${extra[@]+"${extra[@]}"} || true
echo "Detenido en las dos maquinas."
