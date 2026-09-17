# INFRA-000-V1 — validación real del entorno local

Ejecución: 16 de septiembre de 2026, zona America/Bogota; finalización de las pruebas
el 17 de septiembre de 2026 a las 02:11 UTC.

**Resultado:** construcción, inicio, PostgreSQL, frontend HTTP, red, persistencia y
detención segura comprobados. La salud del backend no pudo confirmarse:
`/actuator/health` respondió HTTP 403. Los verificadores PowerShell y Bash terminaron
con código 2, conforme al estado `NO DISPONIBLE`; no fue una verificación íntegramente exitosa.

## Revisiones y entorno

| Repositorio | Rama | Commit de la ejecución |
| --- | --- | --- |
| Infraestructura | `setup/local-environment` | `ffe2e896041df0f2883d959fc22e455c9755b667` |
| Frontend | `setup/frontend-base` | `e40968722dd41b5ec92050de86dc23d2fed8a82b` |
| Backend | `setup/backend-base` | `4effc69db39d35775b3cb41f0970001faab662f8` |

Docker Desktop con motor Linux amd64, cliente y servidor Docker 28.3.3 y
Compose v2.39.2-desktop.1. Los scripts Bash se ejecutaron con Git Bash en Windows;
esta ejecución no sustituye una validación en equipos Linux o macOS nativos.

Los contextos locales resueltos desde infraestructura fueron
`../../fixup-frontend/fixup-frontend` y `../../fixup-backend/fixup-backend`.
Se usó el `.env` local existente; no se copió ni versionó su contenido.

## Resultados observados

| Comprobación | Resultado | Evidencia |
| --- | --- | --- |
| Configuración Compose | Exitosa | `config --quiet`, código 0 |
| Construcción de ambas imágenes | Exitosa | `docker compose --progress plain --env-file .env -f compose.local.yml build`, código 0 |
| Pruebas incluidas por el Dockerfile del backend | Exitosas | Maven `clean verify`: 4 pruebas, 0 fallos, 0 errores, 0 omitidas; `BUILD SUCCESS` |
| Primer inicio PowerShell | Fallido | Docker no pudo publicar `127.0.0.1:5432`; el puerto estaba ocupado por un proceso del equipo |
| Inicio PowerShell con puerto alternativo | Exitoso | Puerto local PostgreSQL 15432; código 0 y los tres contenedores iniciados |
| Inicio Bash tras detención | Exitoso | Reconstrucción con caché y recreación de los tres contenedores; código 0 |
| PostgreSQL | Exitosa | Estado `healthy`, `pg_isready` acepta conexiones e inserción/consulta SQL del marcador |
| Frontend | Exitosa | HTTP 200 en `http://127.0.0.1:4200/` |
| Proceso del backend | Iniciado | Contenedor `running`; Tomcat inició en 8080 con perfil `dev` |
| Salud del backend | No disponible | HTTP 403 en `/actuator/health`; los logs informaron cero endpoints expuestos bajo `/actuator` |
| Verificadores PowerShell y Bash | Comprobación incompleta | Ambos devolvieron código 2 por la salud no disponible; PowerShell repitió el mismo resultado tras recrear los contenedores |
| Estado y últimas 100 líneas de logs | Exitosa | Ambos scripts de estado finalizaron con código 0, sin seguimiento indefinido |
| Red compartida | Exitosa | Los tres identificadores de contenedor pertenecían a `fixup-local-network` |
| DNS interno | Exitosa | Desde frontend, `getent hosts` resolvió `database`, `backend` y `frontend` |
| Persistencia tras reinicio | Exitosa | El mismo marcador se recuperó después de `docker compose restart` |
| Persistencia tras recreación | Exitosa | El marcador sobrevivió a `down` y al inicio posterior; tres identificadores de contenedor nuevos, mismo volumen y fecha de creación |
| Detención PowerShell y Bash | Exitosa | Ambos scripts finalizaron con código 0; el volumen permaneció |
| Sintaxis y formato | Exitosos | Sintaxis de los cinco scripts PowerShell y cuatro Bash; `git diff --check` |
| Archivos sensibles rastreados | Sin hallazgos | El comprobador mostró únicamente `.env.example`; `.env` permaneció ignorado |

## Ajuste local del puerto

El intento con 5432 falló de forma real y quedó registrado antes del reintento.
Windows tenía un proceso escuchando en ese puerto. Se comprobó que 15432 admitía
una conexión de escucha local y se cambió únicamente `POSTGRES_PORT` de 5432 a 15432
en `.env`. Una comparación de hashes, revirtiendo ese valor solo en memoria, confirmó
que el resto del archivo permaneció idéntico.

No se detuvo el proceso que ocupaba 5432 ni se cambió Compose. Los puertos publicados
durante la ejecución fueron exclusivamente `127.0.0.1:4200`, `127.0.0.1:8080` y
`127.0.0.1:15432`; PostgreSQL conservó el puerto interno `database:5432`.

## Prueba de persistencia y estado final

Se creó un marcador sintético único en `infra_smoke.persistence_probe`. La consulta
recuperó exactamente ese marcador antes del reinicio, después del reinicio y después
de retirar y recrear los contenedores. No se utilizaron datos personales ni datos de negocio.

El volumen `fixup-local-postgres-data`, creado el `2026-09-17T02:05:05Z`, conservó
nombre y fecha de creación durante los ciclos y después de la detención final.
La recreación produjo tres identificadores de contenedor distintos de los originales.
Los logs de PostgreSQL confirmaron la reutilización del directorio de datos existente.

Al terminar se retiró únicamente la fila sintética de esta ejecución (`DELETE 1`).
El esquema y la tabla de prueba permanecen. El script Bash de detención dejó
`docker compose ps --all` vacío: frontend, backend y database quedaron detenidos y
sus contenedores retirados; la red del proyecto fue retirada por Compose.
El volumen y las imágenes permanecieron. No se eliminó ningún volumen.

Los registros de ejecución permanecen localmente en `deployment-state/infra000-v1/`,
ignorado por Git. Los logs de servicios se revisaron con valores sensibles ocultos.

## Límites y advertencias observadas

- El contenedor del backend inició, pero HTTP 403 no acredita salud ni acceso a la API.
  No se modificó seguridad ni Actuator para cambiar el resultado.
- Las cuatro pruebas de Maven son las pruebas existentes ejecutadas por el Dockerfile;
  no demuestran que todos los casos de uso funcionen.
- La persistencia verificada es la de PostgreSQL. No se comprobó que el backend
  guarde datos mediante JPA/Flyway ni se validó autenticación real con Auth0.
- `npm ci` informó tres vulnerabilidades moderadas. No se actualizaron dependencias
  ni se ejecutaron correcciones automáticas en el frontend.
- PostgreSQL Alpine emitió advertencias de locales durante la inicialización;
  posteriormente pasó su healthcheck y las consultas de persistencia.
- Esta ejecución local no acredita una ejecución de GitHub Actions.

La comparación final confirmó que frontend y backend mantuvieron sus ramas, commits
y árboles limpios originales. No se modificó su código, no se copiaron fuentes entre
repositorios, no se publicó `.env` y no se realizó ningún merge.
