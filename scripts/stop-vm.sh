#!/usr/bin/env bash
# Apaga FixUp en las dos maquinas (PWA en este Mac; API y datos en la VM).
# Con --purge borra tambien la base de datos y las fotos de la VM.
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
env_file=".env.vm"
[[ -f "$env_file" ]] || { echo "Falta $env_file" >&2; exit 1; }
set -a; # shellcheck disable=SC1090
source "$env_file"; set +a
extra=()
[[ "${1:-}" == "--purge" ]] && extra=(--volumes)
export DATA_HOST="$VM_IP" DB_HOST="$VM_IP"
tunnel_socket="${TMPDIR:-/tmp}/fixup-vm-tunel.sock"

docker compose --env-file "$env_file" -f compose.app.yml down ${extra[@]+"${extra[@]}"} || true
docker --context fixup-vm compose --env-file "$env_file" -f compose.app.yml down ${extra[@]+"${extra[@]}"} || true
VM_CONFIG_DIR="$(ssh -o BatchMode=yes "${VM_USER}@${VM_IP}" 'echo $HOME')/fixup-config"; export VM_CONFIG_DIR
docker --context fixup-vm compose --env-file "$env_file" -f compose.data.yml -f compose.vm-data.yml down ${extra[@]+"${extra[@]}"} || true
[[ -S "$tunnel_socket" ]] && { ssh -S "$tunnel_socket" -O exit "${VM_USER}@${VM_IP}" >/dev/null 2>&1 || true; }
echo "FixUp detenido en este Mac y en la VM ${VM_IP}."
