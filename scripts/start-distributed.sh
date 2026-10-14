#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Inicio del sistema completo distribuido en dos computadores, desde UNO solo.
#
#   Maquina A (datos)      : PostgreSQL            -> compose.data.yml
#   Maquina B (aplicacion) : API + PWA             -> compose.app.yml
#
# Este script corre en la maquina B y arranca las dos. La maquina A se controla
# con un contexto remoto de Docker sobre SSH, asi que no hay que tocarla.
#
#   ./scripts/start-distributed.sh
#
# Requisitos en la maquina B: docker, docker compose v2, cliente ssh y una llave
# autorizada en la maquina A. Requisito en la maquina A: docker corriendo.
# ---------------------------------------------------------------------------
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"

env_file=".env.distributed"
context_name="fixup-data"
evidence_dir="evidencia/despliegue-$(date +%Y%m%d-%H%M%S)"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

# Modo simulado: los dos "computadores" son dos entornos Docker aislados en ESTA misma maquina
# (proyectos Compose fixup-dist-data y fixup-dist-app, el trafico viaja por la IP de la red local,
# no por una red interna de Compose). Se activa con:  ./scripts/start-distributed.sh --simulado
simulado=0
[[ "${1:-}" == "--simulado" ]] && simulado=1

[[ -f "$env_file" ]] || die "Falta $env_file. Ejecuta: cp config/distributed.env.example $env_file y edita las IP."
set -a; # shellcheck disable=SC1090
source "$env_file"; set +a

if [[ "$simulado" == 1 ]]; then
  lan_ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}' || true)"
  [[ -n "$lan_ip" ]] || die "No pude detectar la IP de la red local. Conecta el equipo a una red o define DATA_HOST y APP_HOST."
  DATA_HOST="${DATA_HOST:-$lan_ip}"
  # El SDK de Auth0 exige origen seguro (HTTPS o localhost): por HTTP con una IP el login
  # no completa. En modo simulado el navegador esta en este mismo equipo, asi que localhost.
  APP_HOST="${APP_HOST:-localhost}"
  DATA_SSH="${DATA_SSH:-local}"
  # Un contenedor no siempre llega a la IP LAN de su propio anfitrion (Docker Desktop);
  # host.docker.internal es la via estandar hacia el otro entorno del mismo equipo.
  DB_HOST="${DB_HOST:-host.docker.internal}"
  # El navegador sube las fotos directo al almacen con URLs firmadas: desde este mismo equipo, localhost.
  STORAGE_PUBLIC_ENDPOINT="${STORAGE_PUBLIC_ENDPOINT:-http://localhost:${STORAGE_PORT:-9000}}"
  export DATA_HOST APP_HOST DB_HOST STORAGE_PUBLIC_ENDPOINT
fi
export DB_HOST="${DB_HOST:-$DATA_HOST}"
: "${DATA_HOST:?DATA_HOST no esta definido en $env_file}"
: "${DATA_SSH:?DATA_SSH no esta definido en $env_file}"
: "${APP_HOST:?APP_HOST no esta definido en $env_file}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD no esta definido en $env_file}"

export CORS_ALLOWED_ORIGINS="${CORS_ALLOWED_ORIGINS:-http://${APP_HOST}:${FRONTEND_PORT:-4200}}"
api_origin="http://${APP_HOST}:${BACKEND_PORT:-8080}"
frontend_ctx="${FRONTEND_CONTEXT:-../fixup-frontend}"

command -v docker >/dev/null || die "Docker no esta instalado en esta maquina."
docker info >/dev/null 2>&1 || die "El motor de Docker no responde en esta maquina."
[[ "$simulado" == 1 ]] || command -v ssh >/dev/null || die "Falta el cliente ssh, necesario para controlar la maquina A."

mkdir -p "$evidence_dir"

# --- 0. Cordura: DATA_HOST no puede ser esta misma maquina -------------------
case "$DATA_HOST" in
  localhost|127.0.0.1|::1) [[ "$simulado" == 1 ]] || die "DATA_HOST es $DATA_HOST: eso es la misma maquina. La entrega exige dos computadores." ;;
esac

# --- 1. Contexto remoto hacia la maquina A -----------------------------------
say "1/6 Entorno de datos (maquina A)"
if [[ "$simulado" == 1 ]]; then
  data_docker=(docker)
  echo "MODO SIMULADO: la maquina A es un entorno Docker aparte en este mismo equipo ($DATA_HOST)." \
    | tee "$evidence_dir/01-maquina-A-info.txt"
else
  if docker context inspect "$context_name" >/dev/null 2>&1; then
    docker context update "$context_name" --docker "host=ssh://${DATA_SSH}" >/dev/null
  else
    docker context create "$context_name" --docker "host=ssh://${DATA_SSH}" >/dev/null
  fi
  data_docker=(docker --context "$context_name")
  "${data_docker[@]}" info --format 'Maquina A alcanzable. Servidor: {{.Name}} | SO: {{.OperatingSystem}} | CPUs: {{.NCPU}}' \
    | tee "$evidence_dir/01-maquina-A-info.txt" \
    || die "No se pudo hablar con el Docker de la maquina A por SSH. Revisa DATA_SSH y la llave autorizada."
fi

# --- 2. Base de datos en la maquina A ----------------------------------------
say "2/6 Levantando PostgreSQL en la maquina A"
"${data_docker[@]}" compose --env-file "$env_file" -f compose.data.yml up -d
for attempt in $(seq 1 24); do
  if "${data_docker[@]}" compose --env-file "$env_file" -f compose.data.yml \
      exec -T database sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    echo "PostgreSQL acepta conexiones en la maquina A (intento $attempt)."
    break
  fi
  [[ "$attempt" -lt 24 ]] || die "PostgreSQL no quedo listo en la maquina A."
  sleep 5
done
storage_probe_host="$DATA_HOST"; [[ "$simulado" == 1 ]] && storage_probe_host="127.0.0.1"
for attempt in $(seq 1 24); do
  if curl -s -o /dev/null --max-time 3 "http://${storage_probe_host}:${STORAGE_PORT:-9000}/"; then
    echo "Almacen de fotos (SeaweedFS) responde en la maquina A (intento $attempt)."
    break
  fi
  [[ "$attempt" -lt 24 ]] || die "El almacen de fotos no respondio en ${storage_probe_host}:${STORAGE_PORT:-9000}."
  sleep 5
done
"${data_docker[@]}" compose --env-file "$env_file" -f compose.data.yml ps \
  | tee "$evidence_dir/02-maquina-A-contenedores.txt"

# --- 3. Origen del API dentro del bundle de la PWA ---------------------------
# environment.ts se resuelve al compilar Angular, asi que hay que inyectar la IP
# de la maquina B antes de construir la imagen. Se restaura siempre al salir.
say "3/6 Inyectando el origen del API ($api_origin) en la PWA"
env_ts="${frontend_ctx}/src/environments/environment.ts"
[[ -f "$env_ts" ]] || die "No se encontro $env_ts. Revisa FRONTEND_CONTEXT en $env_file."
cp -- "$env_ts" "${env_ts}.bak-dist"
restore_env_ts() {
  if [[ -f "${env_ts}.bak-dist" ]]; then
    mv -f -- "${env_ts}.bak-dist" "$env_ts"
    echo "environment.ts restaurado a su contenido original."
  fi
}
trap restore_env_ts EXIT
sed -i.tmp -E "s|(apiOrigin[[:space:]]*:[[:space:]]*)'[^']*'|\1'${api_origin}'|" "$env_ts"
rm -f -- "${env_ts}.tmp"
grep -n 'apiOrigin' "$env_ts" | tee "$evidence_dir/03-api-origin.txt"

# --- 4. API y PWA en la maquina B --------------------------------------------
say "4/6 Construyendo y levantando API y PWA en esta maquina (B)"
docker compose --env-file "$env_file" -f compose.app.yml config --quiet
docker compose --env-file "$env_file" -f compose.app.yml up --build -d
docker compose --env-file "$env_file" -f compose.app.yml ps \
  | tee "$evidence_dir/04-maquina-B-contenedores.txt"

# --- 4b. Esperar a que el backend termine de arrancar y migrar ---------------
say "Esperando a que el backend responda (migraciones Flyway incluidas)"
backend_up=0
for attempt in $(seq 1 36); do
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${BACKEND_PORT:-8080}/actuator/health" || true)"
  if [[ "$code" == "200" ]]; then backend_up=1; echo "Backend listo (intento $attempt)."; break; fi
  sleep 5
done
[[ "$backend_up" == 1 ]] || echo "AVISO: el backend no respondio 200 en 3 minutos; revisa: docker compose -f compose.app.yml logs backend"

# --- 5. Prueba de que el trafico cruza la red --------------------------------
say "5/6 Comprobando que el backend habla con la base de la OTRA maquina"
{
  echo "DATA_HOST=$DATA_HOST   APP_HOST=$APP_HOST"
  echo "--- El backend resuelve y alcanza el puerto de la maquina A:"
  docker compose --env-file "$env_file" -f compose.app.yml exec -T backend \
    bash -c "getent hosts ${DB_HOST} || true; (exec 3<>/dev/tcp/${DB_HOST}/${POSTGRES_PORT:-5432} && echo 'TCP ${DB_HOST}:${POSTGRES_PORT:-5432} ABIERTO') || echo 'TCP CERRADO'"
  echo "--- Migraciones aplicadas, leidas EN LA MAQUINA A:"
  "${data_docker[@]}" compose --env-file "$env_file" -f compose.data.yml \
    exec -T database sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version AS migracion, description, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 5;"' \
    || echo "(flyway_schema_history aun no existe: el backend no ha terminado de migrar)"
} 2>&1 | tee "$evidence_dir/05-trafico-entre-maquinas.txt"

# --- 6. Salud de los extremos -------------------------------------------------
say "6/6 Salud de los extremos publicados"
{
  for probe in "backend http://127.0.0.1:${BACKEND_PORT:-8080}/actuator/health" \
               "frontend http://127.0.0.1:${FRONTEND_PORT:-4200}/"; do
    set -- $probe
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$2" || echo 000)"
    echo "$1 -> HTTP $code en $2"
  done
  echo "Desde otro computador de la red, la PWA abre en: http://${APP_HOST}:${FRONTEND_PORT:-4200}"
} 2>&1 | tee "$evidence_dir/06-salud.txt"

say "Listo"
cat <<TXT
Sistema distribuido arriba:
  Maquina A ($DATA_HOST)  : PostgreSQL
  Maquina B ($APP_HOST)   : API en :${BACKEND_PORT:-8080} y PWA en :${FRONTEND_PORT:-4200}

Evidencia para la sustentacion guardada en: $evidence_dir
Para apagar todo:  ./scripts/stop-distributed.sh
TXT
