#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Despliega la entrega 1 completa en la VM de la universidad.
#
#   ./scripts/desplegar-entrega1-vm.sh [IP-de-la-VM] [--tunel] [--solo-preparar]
#
# 1. Respalda la base anterior (fixup) en ../../backups con pg_dump.
# 2. Crea la base fixup_entrega1 si no existe: las migraciones nuevas no se mezclan
#    con las de la base anterior, que queda intacta para volver atrás.
# 3. Liga las cuentas protagonistas de los datos de demostración a los usuarios
#    reales de Auth0 que ya existen en la base anterior (propietario, arrendatario,
#    técnico verificado con más cotizaciones, inmobiliaria y soporte). Un subject ya
#    escrito en .env.vm se respeta.
# 4. Escribe POSTGRES_DB y FIXUP_SEED_* en .env.vm y arranca todo con start-vm.sh;
#    el backend carga los datos de Colombia la primera vez que arranca.
# 5. Comprueba en la base nueva que los datos y las cuentas quedaron cargados.
#
# --solo-preparar hace los pasos 1 a 4 sin arrancar nada (para revisar el .env.vm).
# Para volver a la base anterior: POSTGRES_DB=fixup en .env.vm y ./scripts/start-vm.sh.
# ---------------------------------------------------------------------------
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd -- "$repo_root"
env_file=".env.vm"
old_db="${OLD_DB:-fixup}"
new_db="fixup_entrega1"
db_container="fixup-dist-data-database-1"
backup_dir="${BACKUP_DIR:-$repo_root/../../backups}"

say() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
die() { printf '\n\033[31mERROR: %s\033[0m\n' "$1" >&2; exit 1; }

[[ -f "$env_file" ]] || die "Falta $env_file (copia .env.vm.example y complétalo)."

start_args=(); solo_preparar=0
for arg in "$@"; do
  case "$arg" in
    --solo-preparar) solo_preparar=1 ;;
    --tunel) start_args+=("--tunel") ;;
    *) [[ "$arg" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && sed -i '' -E "s/^VM_IP=.*/VM_IP=$arg/" "$env_file" ;;
  esac
done
set -a; # shellcheck disable=SC1090
source "$env_file"; set +a
: "${VM_IP:?}"; : "${VM_USER:?}"; : "${POSTGRES_USER:?}"
vm_ssh="${VM_USER}@${VM_IP}"
on_vm() { ssh -o BatchMode=yes -o ConnectTimeout=10 "$vm_ssh" "$@"; }
# sql <base> <consulta> [separador]: la consulta viaja por stdin porque ssh vuelve a partir los
# argumentos en la VM; los que sí van en la línea de comandos se citan con printf %q.
sql() {
  local db="$1" query="$2" sep="${3:-|}"
  printf '%s\n' "$query" | on_vm "docker exec -i $db_container psql -U $(printf %q "$POSTGRES_USER") \
    -v ON_ERROR_STOP=1 -At -F $(printf %q "$sep") -d $(printf %q "$db")"
}

# Los valores van entre comillas simples: .env.vm se carga con "source" y un subject de Auth0
# ("auth0|abc") sin comillas se leería como una tubería. Docker Compose también acepta comillas.
set_env() {
  local key="$1" value="$2"
  if grep -q "^${key}=" "$env_file"; then
    # "#" como delimitador de sed por la misma razón.
    sed -i '' -E "s#^${key}=.*#${key}='${value}'#" "$env_file"
  else
    printf "%s='%s'\n" "$key" "$value" >>"$env_file"
  fi
}

say "1/5 Conectando con la VM ($vm_ssh)"
nc -z -G 5 "$VM_IP" 22 >/dev/null 2>&1 \
  || die "La VM $VM_IP no responde en el puerto 22. ¿Estás en la red o la VPN de la universidad?"
on_vm true || die "SSH no entra sin contraseña. Ejecuta una vez: ./fixup-vm.command preparar $VM_IP"
if ! on_vm docker ps --format '{{.Names}}' | grep -qx "$db_container"; then
  on_vm docker start "$db_container" >/dev/null 2>&1 \
    || die "No existe el contenedor $db_container en la VM. Arranca primero el despliegue anterior con ./scripts/start-vm.sh."
  sleep 5
fi

say "2/5 Respaldando la base anterior ($old_db)"
mkdir -p "$backup_dir"
backup="$backup_dir/vm-${old_db}-$(date +%Y%m%d-%H%M%S).dump"
if [[ "$(sql postgres "SELECT 1 FROM pg_database WHERE datname = '$old_db'")" == 1 ]]; then
  on_vm docker exec "$db_container" pg_dump -U "$POSTGRES_USER" -d "$old_db" -Fc >"$backup"
  [[ -s "$backup" ]] || die "El respaldo quedó vacío: $backup"
  echo "Respaldo: $backup ($(du -h "$backup" | cut -f1))"
else
  echo "No hay base $old_db en la VM: no hay nada que respaldar."
fi

say "3/5 Base nueva $new_db"
if [[ "$(sql postgres "SELECT 1 FROM pg_database WHERE datname = '$new_db'")" == 1 ]]; then
  echo "La base $new_db ya existe: se conserva (los datos de demostración no se cargan dos veces)."
else
  sql postgres "CREATE DATABASE $new_db OWNER $POSTGRES_USER" >/dev/null
  echo "Base $new_db creada."
fi

say "4/5 Cuentas protagonistas de la demostración"
# Una fila por usuario real de Auth0 de la base anterior: subject;roles;verificación;cotizaciones;nombre
# (los subjects de Auth0 llevan "|", por eso el separador es ";").
candidates="$(sql "$old_db" "
  SELECT u.auth0_subject,
         string_agg(DISTINCT r.role, ',' ORDER BY r.role),
         coalesce(max(f.verification_status), ''),
         (SELECT count(*) FROM quotations q WHERE q.fixer_user_id = u.id),
         coalesce(u.display_name, '')
    FROM users u
    JOIN user_roles r ON r.user_id = u.id
    LEFT JOIN fixer_profiles f ON f.user_id = u.id
   WHERE u.status = 'ACTIVE' AND u.auth0_subject NOT LIKE 'seed|%' AND u.auth0_subject NOT LIKE 'auth0|demo-%'
   GROUP BY u.id, u.auth0_subject, u.display_name" ';' 2>/dev/null || true)"
[[ -n "$candidates" ]] || echo "No se pudieron leer usuarios de la base anterior; se usarán los subjects de $env_file."

chosen=""
pick() {
  # pick <rol> <regla awk adicional> : primer candidato con el rol que no se haya elegido ya
  local role="$1" extra="$2"
  printf '%s\n' "$candidates" | awk -F';' -v role="$role" -v chosen="$chosen" "
    BEGIN { n = split(chosen, c, \" \"); for (i = 1; i <= n; i++) used[c[i]] = 1 }
    \$1 != \"\" && !(\$1 in used) && index(\",\" \$2 \",\", \",\" role \",\") ${extra} { print \$4 \"\\t\" \$1 }" \
    | sort -t$'\t' -k1,1nr | head -1 | cut -f2
}
resolve() {
  # resolve <variable> <rol> <regla> : respeta el valor del .env.vm si ya es un subject real
  local var="$1" role="$2" extra="$3" current
  current="$(sed -n "s/^${var}=//p" "$env_file" | tr -d "'\"")"
  if [[ -n "$current" && "$current" != *"..."* ]]; then
    printf '%s' "$current"
  else
    pick "$role" "$extra"
  fi
}
fixer="$(resolve FIXUP_SEED_FIXER_SUBJECT FIXER '&& $3 == "VERIFIED"')"; chosen="$chosen $fixer"
admin="$(resolve FIXUP_SEED_ADMIN_SUBJECT PLATFORM_ADMIN '')"; chosen="$chosen $admin"
manager="$(resolve FIXUP_SEED_MANAGER_SUBJECT REAL_ESTATE_MANAGER '')"; chosen="$chosen $manager"
owner="$(resolve FIXUP_SEED_OWNER_SUBJECT OWNER '')"; chosen="$chosen $owner"
tenant="$(resolve FIXUP_SEED_TENANT_SUBJECT TENANT '')"; chosen="$chosen $tenant"

printf '  %-12s %s\n' "Propietario" "${owner:-(falta)}" "Arrendatario" "${tenant:-(falta)}" "Técnico" "${fixer:-(falta)}" \
  "Inmobiliaria" "${manager:-(falta)}" "Soporte" "${admin:-(falta)}"
for value in "$owner" "$tenant" "$fixer" "$manager" "$admin"; do
  [[ -n "$value" ]] || die "Falta al menos un subject. Escríbelo a mano en $env_file (FIXUP_SEED_*_SUBJECT) y vuelve a correr."
done

set_env POSTGRES_DB "$new_db"
set_env FIXUP_SEED_ENABLED true
set_env FIXUP_SEED_OWNER_SUBJECT "$owner"
set_env FIXUP_SEED_TENANT_SUBJECT "$tenant"
set_env FIXUP_SEED_FIXER_SUBJECT "$fixer"
set_env FIXUP_SEED_MANAGER_SUBJECT "$manager"
set_env FIXUP_SEED_ADMIN_SUBJECT "$admin"
echo "$env_file actualizado (POSTGRES_DB=$new_db y FIXUP_SEED_*)."

if [[ "$solo_preparar" == 1 ]]; then
  echo "Listo para desplegar: ./scripts/start-vm.sh ${start_args[*]:-}"
  exit 0
fi

say "5/5 Desplegando con start-vm.sh"
./scripts/start-vm.sh "$VM_IP" ${start_args[@]+"${start_args[@]}"}

echo
echo "--- Datos de demostración en $new_db:"
sql "$new_db" "
  SELECT 'usuarios', count(*) FROM users UNION ALL
  SELECT 'inmuebles', count(*) FROM properties UNION ALL
  SELECT 'solicitudes', count(*) FROM repair_requests UNION ALL
  SELECT 'cotizaciones', count(*) FROM quotations UNION ALL
  SELECT 'visitas', count(*) FROM technical_visits" ' '
echo "--- Cuentas protagonistas ligadas a Auth0:"
sql "$new_db" "
  SELECT u.display_name, string_agg(r.role, ',' ORDER BY r.role)
    FROM users u JOIN user_roles r ON r.user_id = u.id
   WHERE u.auth0_subject IN ('$owner', '$tenant', '$fixer', '$manager', '$admin')
   GROUP BY u.display_name" ' | '
