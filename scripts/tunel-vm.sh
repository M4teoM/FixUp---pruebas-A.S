#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Tunel SSH Mac -> VM que se reabre solo si se cae la red.
#
#   ./scripts/tunel-vm.sh start  usuario@ip  puerto [puerto ...]
#   ./scripts/tunel-vm.sh stop
#   ./scripts/tunel-vm.sh status
#
# Un proceso vigilante corre en segundo plano y mantiene vivo un `ssh -N` con los
# reenvios localhost:<puerto> -> 127.0.0.1:<puerto> de la VM. ServerAlive detecta la
# caida en ~15 s; entonces ssh sale y el vigilante lo vuelve a abrir cada pocos
# segundos hasta que la red (y la VPN) vuelven. No hace falta tocar nada a mano.
# ---------------------------------------------------------------------------
set -euo pipefail

state_dir="${TMPDIR:-/tmp}/fixup-vm-tunel"
pid_file="$state_dir/vigilante.pid"
log_file="$state_dir/tunel.log"

running() { [[ -f "$pid_file" ]] && kill -0 "$(cat "$pid_file")" 2>/dev/null; }

stop() {
  if running; then
    local pid; pid="$(cat "$pid_file")"
    # Primero el vigilante (para que no reabra) y luego su ssh hijo.
    pkill -TERM -P "$pid" 2>/dev/null || true
    kill -TERM "$pid" 2>/dev/null || true
    echo "Tunel detenido."
  fi
  rm -f "$pid_file"
}

watch_loop() {
  local target="$1"; shift
  local forwards=()
  for port in "$@"; do forwards+=(-L "${port}:127.0.0.1:${port}"); done
  local child=""
  trap '[[ -n "$child" ]] && kill -TERM "$child" 2>/dev/null; exit 0' TERM INT
  while true; do
    echo "$(date '+%F %T') abriendo tunel a $target (puertos $*)"
    ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes -o ConnectTimeout=5 \
      -o ServerAliveInterval=5 -o ServerAliveCountMax=3 -o TCPKeepAlive=yes \
      "${forwards[@]}" "$target" &
    child=$!
    wait "$child" || true
    child=""
    echo "$(date '+%F %T') tunel caido; reintento en 3 s"
    sleep 3
  done
}

case "${1:-}" in
  start)
    shift
    [[ $# -ge 2 ]] || { echo "Uso: $0 start usuario@ip puerto [puerto ...]" >&2; exit 2; }
    stop >/dev/null
    mkdir -p "$state_dir"
    nohup "$0" __vigilar "$@" >>"$log_file" 2>&1 &
    echo $! >"$pid_file"
    disown 2>/dev/null || true
    target="$1"; shift
    # Espera a que el primer puerto conteste por el tunel antes de devolver el control.
    for _ in $(seq 1 20); do
      if nc -z -G 2 127.0.0.1 "$1" >/dev/null 2>&1; then
        echo "Tunel vigilado abierto: localhost:{$(IFS=,; echo "$*")} -> $target (registro: $log_file)"
        exit 0
      fi
      sleep 1
    done
    echo "El tunel no contesto en 20 s (registro: $log_file)." >&2
    exit 1
    ;;
  __vigilar) shift; watch_loop "$@" ;;
  stop) stop ;;
  status)
    if running; then echo "Tunel vigilado activo (pid $(cat "$pid_file")). Ultimas lineas:"; tail -5 "$log_file"
    else echo "Tunel vigilado detenido."; fi
    ;;
  *) echo "Uso: $0 start usuario@ip puerto [puerto ...] | stop | status" >&2; exit 2 ;;
esac
