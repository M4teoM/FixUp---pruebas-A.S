#!/usr/bin/env bash
# Orquesta la corrida completa sobre el stack de compose.local.yml + compose.perf.yml.
# Lo usa el workflow de GitHub Actions y sirve igual en un equipo con Docker (Git Bash en Windows).
#
#   PERF_SCALE=full RATE_FACTOR=1 perf/run.sh
#
# Deja en perf/.work los resúmenes de k6, availability.json, docker-stats.jsonl, report.md y
# results.json. Termina con código distinto de cero si algún umbral o verificación falló, pero
# siempre después de escribir el informe.
set -uo pipefail

cd "$(dirname "$0")/.."
export PERF_WORK="$PWD/perf/.work"
export OUT_DIR="$PERF_WORK"
export BASE_URL="${BASE_URL:-http://127.0.0.1:8080}"
export PERF_SCALE="${PERF_SCALE:-full}"
export RATE_FACTOR="${RATE_FACTOR:-1}"
export PERF_ISSUER="http://jwks:8081/"
export PERF_AUDIENCE="https://api.fixup.perf"

COMPOSE=(docker compose --env-file .env -f compose.local.yml -f compose.perf.yml)
failures=()

step() { echo; echo "==== $* ===="; }

step "Llaves y configuración"
mkdir -p "$PERF_WORK"
node perf/lib/jwt.mjs init "$PERF_WORK"
grep -vE '^(COMPOSE_PROJECT_NAME|POSTGRES_PASSWORD|AUTH0_ISSUER_URI|AUTH0_AUDIENCE)=' .env.example > .env
{
  echo "COMPOSE_PROJECT_NAME=fixup-perf"
  echo "POSTGRES_PASSWORD=perf-only"
  echo "AUTH0_ISSUER_URI=$PERF_ISSUER"
  echo "AUTH0_AUDIENCE=$PERF_AUDIENCE"
} >> .env

step "Levantar PostgreSQL, JWKS y backend"
"${COMPOSE[@]}" up -d --build database jwks backend || exit 1
boot_start=$(date +%s.%N)
for _ in $(seq 1 180); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE_URL/auth/me" || true)
  [ "$code" = "401" ] && break
  sleep 1
done
if [ "$code" != "401" ]; then
  echo "el backend no respondió"; "${COMPOSE[@]}" logs backend | tail -80; exit 1
fi
boot_seconds=$(awk "BEGIN { printf \"%.1f\", $(date +%s.%N) - $boot_start }")
echo "backend listo en ${boot_seconds}s"

step "Siembra (volumen $PERF_SCALE)"
export PERF_PSQL="${COMPOSE[*]} exec -T database psql -q -U fixup -d fixup -v ON_ERROR_STOP=1"
node perf/seed.mjs || exit 1

step "Muestreo de recursos"
( while true; do
    docker stats --no-stream --format '{{json .}}' | while read -r line; do
      echo "{\"t\":$(date +%s),\"s\":$line}"
    done
    sleep 2
  done ) > "$PERF_WORK/docker-stats.jsonl" 2>/dev/null &
sampler=$!

for scenario in uc21-auth uc18-quotations uc20-earnings; do
  step "k6: $scenario"
  k6 run --quiet "perf/k6/$scenario.js" || failures+=("$scenario")
done

kill "$sampler" 2>/dev/null

step "Disponibilidad bajo fallas"
backend_id=$("${COMPOSE[@]}" ps -q backend)
export DURATION=200 INTERVAL_MS=100
export PLAN="[
  {\"at\":20,\"name\":\"backend_crash\",\"label\":\"Caída abrupta del backend (SIGKILL; la política restart: unless-stopped lo levanta)\",
   \"cmd\":\"sudo kill -9 \$(docker inspect -f '{{.State.Pid}}' $backend_id)\"},
  {\"at\":80,\"name\":\"backend_restart\",\"label\":\"Reinicio planificado del backend (equivale a un despliegue sin réplicas)\",
   \"cmd\":\"${COMPOSE[*]} restart backend\"},
  {\"at\":140,\"name\":\"database_restart\",\"label\":\"Reinicio de PostgreSQL con el backend en marcha\",
   \"cmd\":\"${COMPOSE[*]} restart database\"}
]"
node perf/availability.mjs || failures+=("availability")

curl -s http://127.0.0.1:8081/stats > "$PERF_WORK/jwks-stats.json" || true
echo "{\"bootSeconds\": $boot_seconds}" > "$PERF_WORK/boot.json"
"${COMPOSE[@]}" logs --no-color backend > "$PERF_WORK/backend.log" 2>&1 || true

step "Informe"
node perf/report.mjs

if [ ${#failures[@]} -gt 0 ]; then
  echo "Escenarios con umbrales o verificaciones fallidas: ${failures[*]}"
  exit 1
fi
