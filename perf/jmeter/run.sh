#!/usr/bin/env bash
# Corrida de JMeter sin interfaz gráfica, contra el mismo stack que usa el arnés de k6.
#
#   perf/jmeter/run.sh
#
# Supone que el stack ya está arriba y que la siembra ya corrió (perf/.work/fixtures.json
# existe). Si no, corre primero los pasos de perf/run.sh hasta la siembra.
#
# Deja en perf/.work/jmeter:
#   resultados.jtl   el detalle crudo de cada petición
#   informe/         el panel HTML con los percentiles por operación
#   jmeter.log       el registro de la corrida
set -uo pipefail

cd "$(dirname "$0")/../.."
WORK="$PWD/perf/.work/jmeter"
PLAN="$PWD/perf/jmeter/fixup.jmx"

HOST="${HOST:-127.0.0.1}"
PORT="${PORT:-8080}"
PROTOCOL="${PROTOCOL:-http}"
DURATION="${DURATION:-60}"

command -v jmeter >/dev/null || { echo "jmeter no está en el PATH"; exit 1; }
[ -f "$PWD/perf/.work/fixtures.json" ] || { echo "falta perf/.work/fixtures.json: corre la siembra primero"; exit 1; }

echo "==== CSV para JMeter ===="
node perf/jmeter/fixtures-a-csv.mjs "$PWD/perf/.work" || exit 1

echo "==== Comprobando que el backend responde ===="
code=$(curl -s -o /dev/null -w '%{http_code}' "$PROTOCOL://$HOST:$PORT/auth/me" || true)
[ "$code" = "401" ] || { echo "el backend no respondió 401 en /auth/me (dio '$code')"; exit 1; }

echo "==== Corrida ===="
# El informe se regenera cada vez; JMeter se niega a escribir sobre una carpeta que ya existe.
rm -rf "$WORK/informe" "$WORK/resultados.jtl" "$WORK/jmeter.log"
mkdir -p "$WORK"

jmeter -n -t "$PLAN" \
  -l "$WORK/resultados.jtl" \
  -j "$WORK/jmeter.log" \
  -e -o "$WORK/informe" \
  -Jprotocol="$PROTOCOL" -Jhost="$HOST" -Jport="$PORT" \
  -JcsvDir="$PWD/perf/.work/jmeter" \
  -Jduration="$DURATION" \
  "$@"
estado=$?

echo
echo "==== Resultado ===="
echo "informe:     $WORK/informe/index.html"
echo "crudo:       $WORK/resultados.jtl"
if [ -f "$WORK/resultados.jtl" ]; then
  total=$(( $(wc -l < "$WORK/resultados.jtl") - 1 ))
  fallos=$(awk -F',' 'NR>1 && $8=="false"' "$WORK/resultados.jtl" | wc -l)
  echo "peticiones:  $total"
  echo "con fallo:   $fallos"
  [ "$fallos" -gt 0 ] && estado=1
fi
exit $estado
