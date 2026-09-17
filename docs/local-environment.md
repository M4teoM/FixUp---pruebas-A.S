# Entorno local

## Arquitectura y contrato entre repositorios

`compose.local.yml` es el único orquestador. Construye `fixup-frontend:local` y
`fixup-backend:local` desde los `Dockerfile` de los repositorios hermanos, sin copiar
código fuente a infraestructura. PostgreSQL usa `postgres:17-alpine`.

El frontend debe servir su compilación Angular/Ionic/PWA con Nginx en el puerto 80.
El backend debe escuchar en 8080, aceptar el perfil indicado y consumir las variables
de conexión, Auth0 y CORS. Estos son requisitos de integración, no afirmaciones de
que los repositorios actuales ya los cumplan. Cualquier ajuste de aplicación se realiza
en su repositorio correspondiente, fuera del alcance de esta infraestructura.

## DNS, puertos y localhost

| Contexto | Dirección | Significado |
| --- | --- | --- |
| Navegador del equipo | `http://localhost:4200` | Puerto publicado del frontend |
| Navegador del equipo | `http://localhost:8080` | Puerto publicado del backend |
| Backend dentro de Docker | `database:5432` | Servicio PostgreSQL en la red de Compose |
| Contenedor de la misma red | `backend:8080` o `frontend:80` | DNS interno de los otros servicios |
| Cualquier contenedor | `localhost` | El propio contenedor, no el equipo ni los otros servicios |

Compose resuelve `database`, `backend` y `frontend` dentro de su red. El navegador
no resuelve esos nombres: ejecuta el JavaScript del frontend en el equipo y usa las
URLs publicadas. No se configura aquí un proxy Nginx ni la URL de API del bundle Angular;
esa configuración pertenece al frontend. Publicar puertos en `127.0.0.1` limita el
acceso al equipo local, no a otros equipos ni teléfonos.

## Variables

Copia `.env.example` a `.env` antes de iniciar; nunca lo agregues a Git. Los scripts
usan `--env-file .env`. Compose también puede recibir variables exportadas en la sesión,
que tienen precedencia sobre ese archivo; evita exportaciones antiguas al diagnosticar.
No ejecutes `.env` con `source`: es configuración de Compose, no un script de shell.

| Variable | Función |
| --- | --- |
| `COMPOSE_PROJECT_NAME` | Agrupa los recursos; por defecto `fixup-local` |
| `FRONTEND_CONTEXT`, `BACKEND_CONTEXT` | Rutas de build relativas a la raíz de infraestructura; por defecto los hermanos `../fixup-frontend` y `../fixup-backend` |
| `FRONTEND_PORT`, `BACKEND_PORT`, `POSTGRES_PORT` | Puertos del equipo; los internos siguen siendo 80, 8080 y 5432 |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Inicialización local de PostgreSQL; obligatorias |
| `SPRING_PROFILES_ACTIVE` | Perfil Spring Boot, `dev` por defecto |
| `AUTH0_ISSUER_URI`, `AUTH0_AUDIENCE` | Placeholders de Auth0; no habilitan autenticación real |
| `CORS_ALLOWED_ORIGINS` | Origen del navegador permitido por el backend si lo implementa |

Compose deriva `DATABASE_URL=jdbc:postgresql://database:5432/<base>` y pasa
`DATABASE_USERNAME` y `DATABASE_PASSWORD` al backend. Publicar PostgreSQL en otro
puerto del equipo no cambia esta URL interna. No se suministra ningún Client Secret.

Para cambiar puertos sin editar Compose, por ejemplo:

```dotenv
FRONTEND_PORT=4300
BACKEND_PORT=8090
POSTGRES_PORT=5433
CORS_ALLOWED_ORIGINS=http://localhost:4300
```

Vuelve a ejecutar el script de inicio. Si cambia el puerto de la API, ajusta también
la configuración correspondiente en el repositorio del frontend y reconstruye su
imagen. Los scripts obtienen las URLs desde los puertos publicados por Compose.

## Secuencia de inicio

1. El script ubica la raíz, exige `.env` y comprueba `docker info`.
2. Valida el modelo con `config --quiet` sin imprimir valores de configuración.
3. `up --build -d` construye las aplicaciones desde sus contextos y arranca PostgreSQL.
4. El healthcheck usa `pg_isready`. El backend espera a que `database` esté saludable.
5. El frontend espera que `backend` esté iniciado; esa condición no garantiza salud de la API.
6. Se muestran el estado y las URLs. Ejecuta la verificación para comprobar disponibilidad.

Los procesos tienen `restart: unless-stopped`. No se fijan nombres de contenedor:
utiliza los nombres de servicio en los comandos de Compose.

## Persistencia

PostgreSQL monta el volumen `<proyecto>-postgres-data` en `/var/lib/postgresql/data`.
El script de detención conserva el volumen. Reiniciar o recrear contenedores con el
mismo proyecto vuelve a montar esos datos. Cambiar `COMPOSE_PROJECT_NAME` selecciona
otro volumen y puede dar la impresión de pérdida de datos; el anterior permanece.

Las variables de inicialización de PostgreSQL solo se aplican a un directorio de datos
nuevo. Cambiar usuario, base o contraseña en `.env` no modifica una base ya inicializada.
Conserva los valores compatibles o realiza una administración explícita de la base.
No se automatiza ningún borrado de datos.

La persistencia del volumen no confirma que el backend guarde datos: esa integración
requiere JPA/Flyway/PostgreSQL habilitados y configurados en el backend. Consulta la
[comprobación de persistencia](../tests/smoke/README.md) para verificar infraestructura.

## Trabajo cotidiano y validación

Actualiza cada repositorio mediante su propio flujo de Git. Ejecuta el script de inicio
para reconstruir tras cambios de aplicación; este entorno no monta código fuente ni
ofrece recarga automática. No hay monorepositorio ni submódulos.

La validación de Compose puede hacerse sin motor Docker ni repositorios hermanos:

```sh
docker compose --env-file .env.example -f compose.local.yml config --quiet
bash -n scripts/start-local.sh
bash -n scripts/stop-local.sh
bash -n scripts/status-local.sh
bash -n scripts/verify-local.sh
git diff --check
```

Solo con el motor disponible y ambos repositorios presentes, comprueba construcción:

```sh
docker compose --env-file .env.example -f compose.local.yml build
```

Después usa tu `.env`, inicia, verifica, consulta logs y detén con los scripts. El
workflow realiza validaciones estáticas y no sustituye esta ejecución local.
