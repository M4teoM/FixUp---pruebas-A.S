# Solución de problemas

Ejecuta los comandos de Compose desde la raíz de infraestructura. Los scripts resuelven
esa raíz automáticamente. No publiques tu `.env`, cuerpos HTTP ni logs sin revisarlos.

## Docker no está disponible

Ejecuta `docker info`. Inicia Docker Desktop y espera a que el motor esté listo; en
Linux verifica que Docker Engine esté instalado, iniciado y accesible para tu usuario.
Usa contenedores Linux y comprueba `docker compose version` para confirmar Compose V2.
Si falla, el entorno no se puede construir ni probar aunque `config --quiet` funcione.

## Puerto 4200, 8080 o 5432 ocupado

Identifica el proceso con `Get-NetTCPConnection -LocalPort 4200` en PowerShell o
`lsof -i :4200` donde esté disponible; sustituye el puerto según el error. No detengas
procesos ajenos sin identificar su función. Cambia `FRONTEND_PORT`, `BACKEND_PORT` o
`POSTGRES_PORT` en `.env` y vuelve a iniciar. Si cambia el origen web, actualiza
`CORS_ALLOWED_ORIGINS`; si cambia la URL de la API, ajusta la configuración del frontend
en su propio repositorio. Los puertos internos de Docker permanecen iguales.

## Falta .env

Desde la raíz, ejecuta `Copy-Item .env.example .env` en PowerShell o
`cp .env.example .env` en Bash. No sobrescribas una configuración existente sin revisarla.
El archivo queda ignorado por Git; cada integrante mantiene su copia local.

## Frontend o backend no encontrado

Confirma que los repositorios son hermanos y se llaman `fixup-frontend` y
`fixup-backend`. Verifica los `Dockerfile` en sus raíces. Corrige `FRONTEND_CONTEXT`
o `BACKEND_CONTEXT` en `.env` si las carpetas tienen otros nombres. Las rutas relativas
se interpretan desde la raíz de infraestructura. No copies fuentes a este repositorio.

## Error de construcción de imágenes

Ejecuta `docker compose --env-file .env -f compose.local.yml build` y revisa la etapa
que falla. Comprueba conectividad al registro y a los repositorios de dependencias,
espacio disponible y compatibilidad del Dockerfile de la aplicación. Los fallos de
npm, Maven o Gradle se resuelven en la aplicación correspondiente. Una construcción
fallida no implica que el servicio esté actualizado o utilizable.

## PostgreSQL no saludable

```sh
docker compose --env-file .env -f compose.local.yml ps --all
docker compose --env-file .env -f compose.local.yml logs --tail 100 database
docker compose --env-file .env -f compose.local.yml exec -T database pg_isready
```

Revisa errores de almacenamiento, inicialización y permisos. El script de verificación
añade el usuario y base del contenedor a `pg_isready` para evitar usar el usuario del
sistema por defecto. Las variables de inicialización no actualizan las credenciales
de un volumen existente. Restaura una configuración compatible o administra esa base
explícitamente; no borres el volumen para silenciar un error. El backend espera al
healthcheck antes de iniciar.

## Backend sin /actuator/health

Un 404 se reporta como `NO DISPONIBLE`, no como salud confirmada. Un 401 o 403 indica
que no se puede consultar el endpoint sin la configuración o autorización necesaria.
Una respuesta 5xx o una conexión fallida se reporta como `FALLIDA` tras reintentos
limitados. Consulta los logs del backend y comprueba Actuator y su exposición en ese
repositorio. No se implementa ni se altera aquí el endpoint para hacer pasar la prueba.

## Auth0 con placeholders

Los valores de `.env.example` no permiten autenticación real. Un backend puede fallar
al arrancar si intenta resolver el issuer ficticio. Revisa la configuración Auth0 de
las aplicaciones con el equipo; los cambios necesarios pertenecen a cada repositorio.
No agregues credenciales al código ni inventes resultados de login. Compose no
transfiere automáticamente configuración de Auth0 al bundle estático del frontend.

## Finales de línea

Un error de Bash como `bash\r` o `$'\r': command not found` suele indicar CRLF.
`.gitattributes` fija LF para Bash/YAML/Markdown y CRLF para PowerShell. Guarda el
archivo con el final de línea correcto en tu editor y valida con `bash -n`.
Usa `git ls-files --eol scripts` para inspeccionar; conserva cualquier cambio local
antes de volver a obtener archivos. En Windows puedes validar Bash con Git Bash.

## PowerShell bloquea scripts

Revisa los scripts y, solo para la sesión actual, ejecuta:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\scripts\start-local.ps1
```

El ajuste termina al cerrar esa sesión. No hace falta cambiar políticas globales o
permanentes. Una política administrada por tu organización puede requerir asistencia
del administrador. Los scripts comprueban también los códigos de salida de Docker:
un error de un comando nativo debe detener inicio, estado o detención.
