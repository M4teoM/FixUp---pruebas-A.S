#!/usr/bin/env bash
set -euo pipefail
repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
failed=0
unavailable=0

report() {
  echo "[$1] $2"
  case "$1" in
    FALLIDA) failed=1 ;;
    'NO DISPONIBLE') unavailable=1 ;;
  esac
}

check_http() {
  local label="$1" url="$2" is_health="$3" code=000 attempt
  for attempt in 1 2 3; do
    # No mostrar cuerpos HTTP; curl conserva sus errores de transporte en stderr.
    code="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
      --connect-timeout 3 --max-time 10 "$url")" || code=000
    if [[ "$code" == 2?? ]]; then
      report EXITOSA "$label responde HTTP $code en $url."
      return
    fi
    if [[ "$is_health" == yes && "$code" =~ ^(401|403|404)$ ]]; then
      report 'NO DISPONIBLE' "$label devuelve HTTP $code: endpoint ausente o protegido; no confirma salud del backend."
      return
    fi
    echo "$label intento $attempt/3: HTTP $code."
    if [[ "$attempt" -lt 3 ]]; then sleep 2; fi
  done
  report FALLIDA "$label no responde con HTTP 2xx tras 3 intentos (ultimo HTTP $code)."
}

has_docker=0
docker_ready=0
if command -v docker >/dev/null; then
  has_docker=1
  if docker info >/dev/null; then docker_ready=1; fi
fi
if [[ "$docker_ready" == 1 ]]; then report EXITOSA 'Docker disponible.'
else report FALLIDA 'Docker no disponible. Comprueba la instalacion y el motor.'; fi

config_ready=0
if [[ ! -f .env ]]; then
  report FALLIDA 'Falta .env. Desde la raiz ejecuta: cp .env.example .env'
elif [[ "$has_docker" == 1 ]]; then
  if docker compose --env-file .env -f compose.local.yml config --quiet; then
    config_ready=1
    report EXITOSA 'Configuracion de Compose valida.'
  else report FALLIDA 'Configuracion de Compose invalida.'; fi
else report 'NO DISPONIBLE' 'Validacion de Compose: falta Docker CLI.'; fi

if [[ "$docker_ready" != 1 || "$config_ready" != 1 ]]; then
  for check in 'Estado de servicios' PostgreSQL 'Frontend HTTP' 'Backend /actuator/health'; do
    report 'NO DISPONIBLE' "$check requiere Docker y una configuracion valida."
  done
  exit 1
fi

if docker compose --env-file .env -f compose.local.yml ps --all; then
  report EXITOSA 'Consulta de estado de servicios.'
else report FALLIDA 'No se pudo consultar el estado de servicios.'; fi
if ! running="$(docker compose --env-file .env -f compose.local.yml ps --status running --services)"; then
  report FALLIDA 'No se pudieron obtener los servicios en ejecucion.'
  running=''
fi
running="${running//$'\r'/}"
is_running() { [[ " ${running//$'\n'/ } " == *" $1 "* ]]; }
for service in database backend frontend; do
  if is_running "$service"; then report EXITOSA "Contenedor $service iniciado (no prueba funcionalidad)."
  else report FALLIDA "Contenedor $service no iniciado."; fi
done

if is_running database; then
  if docker compose --env-file .env -f compose.local.yml exec -T database \
    sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'; then
    report EXITOSA 'PostgreSQL acepta conexiones segun pg_isready.'
  else report FALLIDA 'PostgreSQL no acepta conexiones segun pg_isready.'; fi
else report 'NO DISPONIBLE' 'pg_isready requiere database iniciado.'; fi

for service in frontend backend; do
  if ! is_running "$service"; then
    report 'NO DISPONIBLE' "HTTP $service requiere el contenedor iniciado."
    continue
  fi
  if ! command -v curl >/dev/null; then
    report 'NO DISPONIBLE' "HTTP $service requiere curl instalado."
    continue
  fi
  target_port=80
  path=/
  is_health=no
  if [[ "$service" == backend ]]; then target_port=8080; path=/actuator/health; is_health=yes; fi
  if ! binding="$(docker compose --env-file .env -f compose.local.yml port "$service" "$target_port")" || [[ -z "$binding" ]]; then
    report FALLIDA "No se pudo obtener el puerto publicado de $service."
    continue
  fi
  binding="${binding//$'\r'/}"
  check_http "$service HTTP" "http://127.0.0.1:${binding##*:}$path" "$is_health"
done

echo 'Estas comprobaciones no validan Auth0, persistencia de negocio ni casos de uso.'
if [[ "$failed" == 1 ]]; then exit 1; fi
if [[ "$unavailable" == 1 ]]; then exit 2; fi
exit 0
