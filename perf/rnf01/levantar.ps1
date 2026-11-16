# RNF-01 — levanta el entorno de medición en Windows, sin depender de Git Bash.
#
#   cd C:\Users\DELLPHOTO\Documents\GitHub\FixUp---pruebas-A.S
#   .\perf\rnf01\levantar.ps1
#
# Hace lo mínimo para poder medir: la llave de firma, el archivo .env de la corrida, los tres
# contenedores (PostgreSQL, el emisor de llaves y el backend) y la espera a que el backend
# responda. No siembra nada: eso es el paso siguiente, con seed-catalogo.mjs.
#
# Si algo falla, el script se detiene y dice en qué paso.

$ErrorActionPreference = 'Stop'

# Raíz del repositorio de pruebas: dos niveles arriba de este archivo.
$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $raiz
Write-Host "Repositorio: $raiz" -ForegroundColor Cyan

$backendRepo = Join-Path (Split-Path -Parent $raiz) 'fixup-backend'
$work        = Join-Path $raiz 'perf\.work'
$jarDestino  = Join-Path $raiz 'perf\backend\app.jar'

function Paso($texto) { Write-Host "`n==== $texto ====" -ForegroundColor Yellow }

# ---------------------------------------------------------------- 1. Docker
Paso '1. Comprobando Docker'
docker ps | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Docker no responde. Abre Docker Desktop y espera a que diga Engine running.' }
Write-Host 'Docker responde.' -ForegroundColor Green

# ---------------------------------------------------------------- 2. El .jar
Paso '2. Buscando el .jar del backend'
if (-not (Test-Path $backendRepo)) { throw "No encuentro el repositorio del backend en $backendRepo" }

$jar = Get-ChildItem (Join-Path $backendRepo 'target') -Filter '*.jar' -ErrorAction SilentlyContinue |
       Where-Object { $_.Name -notlike '*sources*' -and $_.Name -notlike '*javadoc*' } |
       Sort-Object LastWriteTime -Descending | Select-Object -First 1

if (-not $jar) {
  throw "No hay .jar compilado. Corre primero en $backendRepo :  .\mvnw.cmd clean package -DskipTests"
}
New-Item -ItemType Directory -Force -Path (Split-Path $jarDestino) | Out-Null
Copy-Item $jar.FullName $jarDestino -Force
Write-Host "Usando $($jar.Name) (compilado $($jar.LastWriteTime))" -ForegroundColor Green

# ---------------------------------------------------------------- 3. La llave
# El emisor de llaves monta perf/.work/jwks.json como volumen, así que el archivo tiene que
# existir ANTES de levantar los contenedores. Si no, Docker crea una carpeta con ese nombre.
Paso '3. Generando la llave de firma'
New-Item -ItemType Directory -Force -Path $work | Out-Null
$jwks = Join-Path $work 'jwks.json'
# Se reutiliza si ya existe. Regenerarla en cada corrida invalida los tokens que la siembra dejó
# escritos y obliga a reiniciar el emisor; no hay ninguna ventaja en cambiarla cada vez.
if ((Test-Path $jwks) -and (Test-Path (Join-Path $work 'private.pem'))) {
  Write-Host 'Reutilizando la llave que ya estaba.' -ForegroundColor Green
} else {
  node perf/lib/jwt.mjs init $work
  if ($LASTEXITCODE -ne 0) { throw 'Falló la generación de la llave.' }
  if (-not (Test-Path $jwks)) { throw 'No se creó perf/.work/jwks.json' }
  Write-Host 'Llave nueva generada.' -ForegroundColor Green
}

# ---------------------------------------------------------------- 4. El .env
Paso '4. Escribiendo el .env de la corrida'
$lineas = Get-Content '.env.example' | Where-Object {
  $_ -notmatch '^(COMPOSE_PROJECT_NAME|POSTGRES_PASSWORD|AUTH0_ISSUER_URI|AUTH0_AUDIENCE|AUTH0_JWK_SET_URI)='
}
$lineas += 'COMPOSE_PROJECT_NAME=fixup-perf'
$lineas += 'POSTGRES_PASSWORD=perf-only'
# El backend valida los tokens contra el emisor local, no contra Auth0.
$lineas += 'AUTH0_ISSUER_URI=http://jwks:8081/'
$lineas += 'AUTH0_AUDIENCE=https://api.fixup.perf'
# El backend ya no deriva la ubicación de las llaves del emisor: la exige aparte. Apunta al
# emisor local, que publica el JWKS en esa ruta.
$lineas += 'AUTH0_JWK_SET_URI=http://jwks:8081/.well-known/jwks.json'
Set-Content -Path '.env' -Value $lineas -Encoding ascii
Write-Host 'Escrito .env (proyecto fixup-perf).' -ForegroundColor Green

# ---------------------------------------------------------------- 5. Contenedores
Paso '5. Levantando PostgreSQL, el emisor de llaves y el backend'
docker compose --env-file .env -f compose.local.yml -f compose.perf.yml up -d --build database jwks backend
if ($LASTEXITCODE -ne 0) { throw 'Falló docker compose up.' }

# ---------------------------------------------------------------- 6. Espera
Paso '6. Esperando a que el backend responda'
# /auth/me sin token debe dar 401: eso prueba que el servidor está arriba Y que la seguridad
# quedó configurada. Un 200 o un 500 aquí significan que algo quedó mal.
$listo = $false
foreach ($i in 1..180) {
  # Windows PowerShell 5.1 no conoce -SkipHttpErrorCheck y lanza excepción con cualquier 4xx,
  # así que el código hay que sacarlo también del error. Esta forma sirve en 5.1 y en 7.
  $codigo = 0
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/auth/me' -Method GET -TimeoutSec 3 -UseBasicParsing
    $codigo = [int]$r.StatusCode
  } catch {
    if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
  }
  if ($codigo -eq 401) { $listo = $true; break }
  Start-Sleep -Seconds 1
  if ($i % 10 -eq 0) { Write-Host "  esperando... ${i}s" }
}

if (-not $listo) {
  Write-Host 'El backend no respondió 401. Últimas líneas del registro:' -ForegroundColor Red
  docker compose --env-file .env -f compose.local.yml -f compose.perf.yml logs --tail 60 backend
  throw 'El backend no quedó arriba.'
}

Write-Host "`nEntorno listo." -ForegroundColor Green
Write-Host @"

Siguiente paso, la siembra de los 5.000 inmuebles:

    node perf\rnf01\seed-catalogo.mjs perf\.work

Y para bajar todo cuando termines:

    docker compose --env-file .env -f compose.local.yml -f compose.perf.yml down -v
"@
