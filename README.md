# FixUp — infraestructura local

FixUp reúne una aplicación Angular/Ionic/PWA y un backend modular Spring Boot.
Este repositorio permite al equipo, docentes, evaluadores y nuevos colaboradores
levantar y verificar sus componentes disponibles en un entorno local reproducible.
Solo contiene orquestación, scripts, documentación y comprobaciones de infraestructura;
el código de las aplicaciones permanece en sus repositorios independientes.

## Componentes y repositorios

| Componente | Repositorio | Contenedor |
| --- | --- | --- |
| Aplicación web Angular/Ionic/PWA | [fixup-frontend](https://github.com/Seb-233/fixup-frontend) | `frontend`, servido por Nginx en el puerto interno 80 |
| API modular Spring Boot | [fixup-backend](https://github.com/Seb-233/fixup-backend) | `backend`, puerto interno 8080 |
| Orquestación y pruebas | [FixUp---pruebas-A.S](https://github.com/M4teoM/FixUp---pruebas-A.S) | Define los tres servicios con Compose |
| Base de datos | Imagen `postgres:17-alpine` | `database`, puerto interno 5432 |

El navegador accede al frontend y a la API por los puertos publicados en el equipo.
Dentro de la red de Compose, el backend se conecta a `database:5432`. Los tres
servicios comparten la red `fixup-local-network` con los valores de ejemplo.

## Requisitos y workspace

- Git.
- Docker Desktop o Docker Engine con Compose V2 y soporte para contenedores Linux.
- PowerShell en Windows, o Bash en Linux/macOS; `curl` para la verificación HTTP en Bash.
- Los repositorios frontend y backend deben incluir sus propios `Dockerfile` compatibles
  con los puertos internos y variables descritos en [el contrato local](docs/local-environment.md).

Los tres repositorios deben ser directorios hermanos:

```text
fixup-workspace/
├── fixup-frontend/
├── fixup-backend/
└── FixUp---pruebas-A.S/
```

Desde la carpeta que contendrá el workspace, en PowerShell o Bash:

```sh
mkdir fixup-workspace
cd fixup-workspace
git clone https://github.com/Seb-233/fixup-frontend.git
git clone https://github.com/Seb-233/fixup-backend.git
git clone https://github.com/M4teoM/FixUp---pruebas-A.S.git
cd FixUp---pruebas-A.S
git switch develop
```

Para revisar una propuesta aún sin integrar, cambia a la rama indicada por su autor.
No copies el código de las aplicaciones dentro de este repositorio.

## Configuración e inicio

Cada integrante debe crear su propio `.env`. Solo `.env.example` se versiona;
`.env` está ignorado. Los valores del ejemplo son exclusivamente locales y ficticios.
Los valores de Auth0 son placeholders: la autenticación real no funcionará con ellos.
No agregues Client Secrets, Management API Tokens ni credenciales reales al repositorio.

Windows, desde la raíz del repositorio:

```powershell
Copy-Item .env.example .env
.\scripts\start-local.ps1
```

Linux/macOS:

```bash
cp .env.example .env
./scripts/start-local.sh
```

La copia se hace una sola vez; conserva tu `.env` en los siguientes inicios.
Después, basta el comando de inicio para validar Compose, construir las imágenes y
levantar los tres servicios. Los scripts también funcionan invocados desde otro directorio.

| Acceso desde el equipo | Dirección predeterminada |
| --- | --- |
| Frontend | http://localhost:4200 |
| Backend | http://localhost:8080 |
| Salud del backend, si está implementada y expuesta | http://localhost:8080/actuator/health |
| PostgreSQL | `localhost:5432`, base local definida en `.env` |

Todos los puertos se publican exclusivamente en `127.0.0.1`. La raíz del backend
puede responder 404 aunque el proceso esté iniciado. Los scripts muestran o consultan
los puertos publicados efectivos si cambias los valores de `.env`.

## Estado, verificación y detención

Windows:

```powershell
.\scripts\status-local.ps1
.\scripts\verify-local.ps1
.\scripts\stop-local.ps1
```

Linux/macOS:

```bash
./scripts/status-local.sh
./scripts/verify-local.sh
./scripts/stop-local.sh
```

Estado muestra los contenedores y las últimas 100 líneas de logs por servicio, sin
seguirlos indefinidamente. Verificación informa `EXITOSA`, `FALLIDA` o `NO DISPONIBLE`;
el código de salida es 0 si todas pasan, 1 si hay fallos y 2 si solo hay comprobaciones
no disponibles. HTTP usa hasta tres intentos acotados por endpoint. Una salud ausente
o protegida no se presenta como éxito. Revisa los logs localmente antes de compartirlos,
ya que las aplicaciones pueden incluir información sensible en ellos.

La detención ejecuta `docker compose down` conservando el volumen nombrado
`fixup-local-postgres-data`. La siguiente puesta en marcha reutiliza sus datos con
el mismo nombre de proyecto. Los scripts no borran volúmenes ni imágenes.

## Alcance y límites

Docker levanta los componentes disponibles. La contenerización no convierte
automáticamente funcionalidades todavía no implementadas en funcionalidades completas.
Un contenedor iniciado o una respuesta HTTP no valida los casos de uso.

- La autenticación real depende de una configuración válida de Auth0 en las aplicaciones.
- La persistencia real del backend depende de que habilite y configure JPA, Flyway y
  PostgreSQL, y consuma las variables acordadas. Un volumen persistente no prueba esto.
- La disponibilidad de `/actuator/health` depende del backend. El inicio del frontend
  solo espera que el proceso del backend arranque, no que la API esté lista.
- El frontend estático debe usar una URL de API alcanzable desde el navegador.
  Las variables del backend en Compose no reconfiguran automáticamente un bundle Angular.
- Android se compila como APK mediante Capacitor/Gradle y no se ejecuta como contenedor.
- Este entorno no incluye despliegue distribuido, nube, HTTPS, dominio ni entrega continua.

## Documentación y contribuciones

- [Arquitectura, variables y operación local](docs/local-environment.md).
- [Solución de problemas](docs/troubleshooting.md).
- [Pruebas de humo y persistencia](tests/smoke/README.md).

Crea ramas de trabajo desde `develop` actualizado mediante fast-forward. Envía los
pull requests hacia `develop`, con commits atómicos y Conventional Commits; no hagas
force push ni merges directos a `develop` o `main`. Los cambios en cada aplicación se
proponen en su propio repositorio.

Antes de publicar, valida Compose, la sintaxis de los scripts y `git diff --check`.
`scripts/check-sensitive-files.ps1` (PowerShell; `pwsh` en Linux/macOS) revisa los archivos
del índice Git y muestra únicamente `.env.example` cuando pasa. La comprobación detecta
extensiones prohibidas y patrones conocidos; no sustituye la revisión del contenido.

El workflow `infrastructure-ci.yml` valida la configuración, las sintaxis Bash/PowerShell
y los archivos rastreados en pushes y pull requests hacia `develop` que afecten a la
infraestructura. No necesita secretos, no compila las aplicaciones ni despliega servicios.
