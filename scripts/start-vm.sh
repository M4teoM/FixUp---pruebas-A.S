#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# FixUp en dos computadores, arrancado desde ESTE Mac con un solo comando.
#
#   VM Ubuntu (universidad) : PostgreSQL + almacen de fotos + API Spring Boot
#   Este Mac                : PWA Angular  -> http://localhost:4200
#
#   ./scripts/start-vm.sh [IP-de-la-VM] [--tunel]
#
# La VM se controla con un contexto remoto de Docker sobre SSH: no hay que copiar
# el codigo alla, el contexto de construccion viaja por SSH y la imagen del backend
# se compila EN la VM (amd64). No se modifica codigo: solo se inyecta el origen del
# API en environment.ts mientras se construye la PWA y se restaura al terminar.
#
# --tunel: si la red solo deja pasar SSH (puerto 22), el Mac llega a la API, a las
# fotos y a la base por un tunel SSH en localhost:8080/9000/5432. Todo sigue
# corriendo en la VM.
# ---------------------------------------------------------------------------
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"

env_file=".env.vm"
context_name="fixup-vm"
tunnel_socket="${TMPDIR:-/tmp}/fixup-vm-tunel.sock"
evidence_dir="evidencia/despliegue-vm-$(date +%Y%m%d-%H%M%S)"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ -f "$env_file" ]] || die "Falta $env_file en $repo_root."
set -a; # shellcheck disable=SC1090
source "$env_file"; set +a

tunel=0
for arg in "$@"; do
  case "$arg" in
    --tunel) tunel=1 ;;
    *) VM_IP="$arg" ;;
  esac
done
: "${VM_IP:?VM_IP no esta definido}"; : "${VM_USER:?VM_USER no esta definido}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD no esta definido en $env_file}"

vm_ssh="${VM_USER}@${VM_IP}"
backend_port="${BACKEND_PORT:-8080}"; storage_port="${STORAGE_PORT:-9000}"; frontend_port="${FRONTEND_PORT:-4200}"

# Variables que leen compose.data.yml y compose.app.yml (los mismos del despliegue simulado).
export DATA_HOST="$VM_IP"          # extra_hosts del backend
export DB_HOST="$VM_IP"            # el backend llega a PostgreSQL y al almacen por la IP de su propia VM
# El SDK de Auth0 exige origen seguro: la PWA se abre siempre como localhost en este Mac.
export CORS_ALLOWED_ORIGINS="http://localhost:${frontend_port}"
if [[ "$tunel" == 1 ]]; then
  api_origin="http://localhost:${backend_port}"
  export STORAGE_PUBLIC_ENDPOINT="http://localhost:${storage_port}"
else
  api_origin="http://${VM_IP}:${backend_port}"
  export STORAGE_PUBLIC_ENDPOINT="http://${VM_IP}:${storage_port}"
fi

vm_docker=(docker --context "$context_name")
data_files=(-f compose.data.yml -f compose.vm-data.yml)
on_vm() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$vm_ssh" "$@"; }
# Peticion HTTP hecha DENTRO de la VM (no depende de que la red deje pasar 8080).
vm_http_code() {
  on_vm "bash -c 'exec 3<>/dev/tcp/127.0.0.1/$1 && printf \"GET $2 HTTP/1.0\r\nHost: localhost\r\n\r\n\" >&3 && head -1 <&3'" 2>/dev/null \
    | awk '{print $2}' || true
}

command -v docker >/dev/null || die "Docker no esta instalado en este Mac."
docker info >/dev/null 2>&1 || die "Docker Desktop no esta corriendo en este Mac (lo necesita la PWA)."
mkdir -p "$evidence_dir"

# --- 1. Acceso a la VM ------------------------------------------------------
say "1/6 Conectando con la VM ($vm_ssh)"
nc -z -G 5 "$VM_IP" 22 >/dev/null 2>&1 \
  || die "La VM $VM_IP no responde en el puerto 22. Estas en la red de la universidad? La IP cambio? (en la VM: hostname -I)"
ssh -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=accept-new "$vm_ssh" true 2>/dev/null \
  || die "SSH pide contrasena o rechaza la llave. Ejecuta una vez: ./fixup-vm.command preparar $VM_IP"
on_vm docker info >/dev/null 2>&1 \
  || die "En la VM, '$VM_USER' no puede usar Docker. En la VM: sudo usermod -aG docker $VM_USER y vuelve a iniciar sesion (ver guia)."
if docker context inspect "$context_name" >/dev/null 2>&1; then
  docker context update "$context_name" --docker "host=ssh://${vm_ssh}" >/dev/null
else
  docker context create "$context_name" --docker "host=ssh://${vm_ssh}" >/dev/null
fi
{
  echo "VM: $vm_ssh"
  on_vm 'echo "hostname: $(hostname) | IPs: $(hostname -I) | $(. /etc/os-release; echo $PRETTY_NAME)"'
  "${vm_docker[@]}" info --format 'Docker {{.ServerVersion}} | {{.OperatingSystem}} | {{.Architecture}} | CPUs {{.NCPU}} | RAM {{.MemTotal}}'
} | tee "$evidence_dir/01-vm-info.txt"

# --- 2. Que nada de FixUp quede corriendo en el Mac salvo la PWA --------------
say "2/6 Apagando en este Mac cualquier base o backend de FixUp (los datos locales se conservan)"
[[ -f .env ]] && docker compose --env-file .env -f compose.local.yml down >/dev/null 2>&1 || true
for f in compose.app.yml compose.data.yml; do
  docker compose --env-file "$env_file" -f "$f" down >/dev/null 2>&1 || true
done
if [[ -S "$tunnel_socket" ]]; then ssh -S "$tunnel_socket" -O exit "$vm_ssh" >/dev/null 2>&1 || true; fi

# --- 3. PostgreSQL y almacen de fotos en la VM ---------------------------------
say "3/6 Levantando PostgreSQL y el almacen de fotos en la VM"
VM_CONFIG_DIR="$(on_vm 'echo $HOME')/fixup-config"; export VM_CONFIG_DIR
on_vm "mkdir -p '$VM_CONFIG_DIR' && chmod 700 '$VM_CONFIG_DIR'"
scp -q -o BatchMode=yes config/seaweedfs-s3.json "${vm_ssh}:${VM_CONFIG_DIR}/seaweedfs-s3.json"
on_vm "chmod 644 '$VM_CONFIG_DIR/seaweedfs-s3.json'"
"${vm_docker[@]}" compose --env-file "$env_file" "${data_files[@]}" up -d
for attempt in $(seq 1 24); do
  if "${vm_docker[@]}" compose --env-file "$env_file" "${data_files[@]}" \
      exec -T database sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    echo "PostgreSQL listo en la VM (intento $attempt)."; break
  fi
  [[ "$attempt" -lt 24 ]] || die "PostgreSQL no quedo listo en la VM."
  sleep 5
done
for attempt in $(seq 1 24); do
  [[ -n "$(vm_http_code "$storage_port" /)" ]] && { echo "Almacen de fotos listo en la VM (intento $attempt)."; break; }
  [[ "$attempt" -lt 24 ]] || die "El almacen de fotos no respondio en la VM."
  sleep 5
done

# La red de la universidad (VPN) solo deja pasar algunos puertos hacia la VM (22, 3389, 8080).
# Si el almacen (9000) no es alcanzable desde este Mac, las fotos viajan por un tunel SSH: el
# navegador sube a localhost:9000 y el tunel lo entrega al almacen de la VM. La API sigue directa.
storage_tunnel=0
if [[ "$tunel" == 0 ]] && ! nc -z -G 5 "$VM_IP" "$storage_port" >/dev/null 2>&1; then
  storage_tunnel=1
  export STORAGE_PUBLIC_ENDPOINT="http://localhost:${storage_port}"
  echo "La red no deja pasar el puerto ${storage_port} hacia la VM: las fotos usaran un tunel SSH."
fi

# --- 4. API en la VM ---------------------------------------------------------------
say "4/6 Compilando y levantando la API EN LA VM (la primera vez tarda varios minutos)"
"${vm_docker[@]}" compose --env-file "$env_file" -f compose.app.yml up -d --build --no-deps backend
backend_up=0
for attempt in $(seq 1 48); do
  if [[ "$(vm_http_code "$backend_port" /actuator/health)" == 200 ]]; then
    backend_up=1; echo "API lista en la VM (intento $attempt)."; break
  fi
  sleep 5
done
[[ "$backend_up" == 1 ]] || die "La API no respondio en 4 minutos. Revisa: ./fixup-vm.command logs"
"${vm_docker[@]}" ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}' | tee "$evidence_dir/02-vm-contenedores.txt"

# --- 5. Camino de red Mac -> VM ----------------------------------------------------
say "5/6 Comprobando que este Mac llega a la API de la VM"
if [[ "$tunel" == 1 ]]; then
  ssh -f -N -M -S "$tunnel_socket" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -L "${backend_port}:127.0.0.1:${backend_port}" \
    -L "${storage_port}:127.0.0.1:${storage_port}" \
    -L "${POSTGRES_PORT:-5432}:127.0.0.1:${POSTGRES_PORT:-5432}" "$vm_ssh" \
    || die "No se pudo abrir el tunel SSH (hay algo usando 8080, 9000 o 5432 en este Mac?)."
  echo "Tunel SSH abierto: localhost:${backend_port}/${storage_port}/${POSTGRES_PORT:-5432} -> VM $VM_IP"
elif [[ "$storage_tunnel" == 1 ]]; then
  ssh -f -N -M -S "$tunnel_socket" -o ExitOnForwardFailure=yes -o ServerAliveInterval=30 \
    -L "${storage_port}:127.0.0.1:${storage_port}" \
    -L "${POSTGRES_PORT:-5432}:127.0.0.1:${POSTGRES_PORT:-5432}" "$vm_ssh" \
    || die "No se pudo abrir el tunel SSH de fotos (hay algo usando ${storage_port} o ${POSTGRES_PORT:-5432} en este Mac?)."
  echo "Tunel SSH abierto: localhost:${storage_port} (fotos) y localhost:${POSTGRES_PORT:-5432} (base) -> VM $VM_IP"
fi
if [[ "$tunel" == 1 || "$storage_tunnel" == 1 ]]; then
  code_storage="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://localhost:${storage_port}/" || true)"
  echo "Mac -> almacen de fotos por tunel: HTTP ${code_storage}" | tee "$evidence_dir/03-mac-a-almacen.txt"
fi
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "${api_origin}/actuator/health" || true)"
if [[ "$code" != 200 ]]; then
  die "La API corre en la VM pero este Mac no llega a ${api_origin} (HTTP ${code:-000}). La red bloquea el puerto: vuelve a correr con --tunel."
fi
echo "Mac -> ${api_origin}/actuator/health : HTTP $code" | tee "$evidence_dir/03-mac-a-vm.txt"

# --- 6. PWA en este Mac -----------------------------------------------------------
say "6/6 Construyendo la PWA en este Mac con el API en $api_origin"
env_ts="${FRONTEND_CONTEXT:-../fixup-frontend}/src/environments/environment.ts"
[[ -f "$env_ts" ]] || die "No se encontro $env_ts."
cp -- "$env_ts" "${env_ts}.bak-vm"
restore_env_ts() { [[ -f "${env_ts}.bak-vm" ]] && mv -f -- "${env_ts}.bak-vm" "$env_ts" && echo "environment.ts restaurado."; }
trap restore_env_ts EXIT
sed -i.tmp -E "s|(apiOrigin[[:space:]]*:[[:space:]]*)'[^']*'|\1'${api_origin}'|" "$env_ts"
rm -f -- "${env_ts}.tmp"
docker compose --env-file "$env_file" -f compose.app.yml up -d --build --no-deps frontend
restore_env_ts; trap - EXIT

for attempt in $(seq 1 12); do
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${frontend_port}/" || true)" == 200 ]] && break
  sleep 2
done

{
  echo "--- Este Mac (solo la PWA):"
  docker ps --filter name=fixup --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo "--- La VM $VM_IP (API + datos):"
  "${vm_docker[@]}" ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
  echo "--- Migraciones aplicadas, leidas en la base de la VM:"
  "${vm_docker[@]}" compose --env-file "$env_file" "${data_files[@]}" exec -T database \
    sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "SELECT version AS migracion, description, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 5;"'
  echo "frontend -> HTTP $(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${frontend_port}/" || echo 000) en http://localhost:${frontend_port}"
  echo "backend  -> HTTP $code en ${api_origin}"
} 2>&1 | tee "$evidence_dir/04-estado-final.txt"

say "Listo"
cat <<TXT
  VM $VM_IP : PostgreSQL :${POSTGRES_PORT:-5432} | fotos :${storage_port} | API :${backend_port}
  Este Mac  : PWA en http://localhost:${frontend_port}   (abrela con localhost, no con la IP)
Evidencia: $evidence_dir
Ver datos : ./fixup-vm.command db usuarios      Apagar: ./fixup-vm.command stop
TXT
