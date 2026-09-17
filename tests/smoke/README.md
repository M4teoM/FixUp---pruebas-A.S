# Pruebas de humo de infraestructura

Estas comprobaciones requieren Docker en ejecución, los repositorios hermanos con sus
Dockerfile y `.env` local. No son pruebas E2E ni validan Auth0 o casos de uso de FixUp.
Registra fecha, ramas de los tres repositorios y resultado real de cada comprobación,
sin adjuntar valores sensibles. Si falta un requisito, registra la prueba como bloqueada.

## Verificación automática

Inicia con `scripts/start-local.ps1` o `./scripts/start-local.sh`, y ejecuta
`scripts/verify-local.ps1` o `./scripts/verify-local.sh`.

| Comprobación | Evidencia y alcance |
| --- | --- |
| Docker y Compose | Motor accesible y `config --quiet` válido |
| Contenedores iniciados | `ps --all` y consulta de servicios en estado `running`, incluido `backend` |
| PostgreSQL acepta conexiones | `exec -T database` ejecuta `pg_isready` con el usuario y base del contenedor; no prueba escrituras del backend |
| Frontend HTTP | Respuesta 2xx en su puerto publicado; no prueba JavaScript ni flujos de usuario |
| Salud del backend | HTTP 2xx de `/actuator/health` si está disponible; no prueba todos los módulos |

Cada endpoint HTTP tiene hasta tres intentos con diez segundos de espera máxima por
solicitud y pausas de dos segundos. Se informan errores de transporte o estado HTTP;
no se imprimen cuerpos de respuesta. Un endpoint de salud ausente (404) o protegido
(401/403) se informa como `NO DISPONIBLE`, nunca como éxito. Otros errores HTTP y
contenedores detenidos son fallos.

Los códigos de salida son 0 (todas las comprobaciones realizadas pasan), 1 (hay fallos)
y 2 (sin fallos, pero hay comprobaciones no disponibles). El código 0 no certifica
casos de uso. Consulta además las últimas 100 líneas por servicio mediante el script
de estado; no compartas información sensible que pudiera aparecer en los logs.

## Red común

Con el nombre de proyecto del ejemplo:

```sh
docker network inspect fixup-local-network --format '{{range .Containers}}{{println .Name}}{{end}}'
```

Compara con `docker compose --env-file .env -f compose.local.yml ps`: los tres
contenedores deben aparecer en esa red. Si cambiaste `COMPOSE_PROJECT_NAME`, sustituye
el nombre por `<proyecto>-network`. Usa el filtro indicado para mostrar solo nombres,
sin volcar la configuración completa de los contenedores.

## Persistencia sin borrar datos

1. Inspecciona `docker volume inspect fixup-local-postgres-data --format '{{.Name}}'`
   (ajusta el prefijo si cambió el proyecto).
2. Abre una sesión SQL con `docker compose --env-file .env -f compose.local.yml exec database psql -U fixup -d fixup`;
   sustituye el usuario y base por los configurados. En una base local de pruebas,
   crea un marcador sintético, sin datos personales:

   ```sql
   CREATE SCHEMA IF NOT EXISTS infra_smoke;
   CREATE TABLE IF NOT EXISTS infra_smoke.persistence_probe (
       marker text PRIMARY KEY
   );
   INSERT INTO infra_smoke.persistence_probe (marker)
   VALUES ('local-volume-check') ON CONFLICT DO NOTHING;
   SELECT marker FROM infra_smoke.persistence_probe;
   ```

3. Sal de `psql` con `\q`, ejecuta `docker compose --env-file .env -f compose.local.yml restart`
   y espera a que PostgreSQL acepte conexiones. Repite la consulta del marcador.
4. Ejecuta el script de detención. Repite la inspección del volumen: debe seguir existiendo.
5. Ejecuta el script de inicio con el mismo proyecto y configuración. Repite `SELECT`
   en `psql`: debe devolver `local-volume-check` también tras recrear los contenedores.
6. Registra los resultados de ambos ciclos. Puedes retirar únicamente el marcador
   sintético con `DELETE FROM infra_smoke.persistence_probe WHERE marker = 'local-volume-check';`.

Esta prueba comprueba PostgreSQL y el volumen; no confirma persistencia del backend.
No ejecuta eliminación de volúmenes ni necesita dumps. Si no puedes realizarla,
registra persistencia como no verificada, aunque la definición de Compose sea correcta.
