$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
$script:failed = $false
$script:unavailable = $false

function Report([string]$State, [string]$Message) {
    Write-Host "[$State] $Message"
    if ($State -eq 'FALLIDA') { $script:failed = $true }
    if ($State -eq 'NO DISPONIBLE') { $script:unavailable = $true }
}

function Test-HttpEndpoint([string]$Label, [string]$Url, [bool]$IsHealth) {
    $code = 0
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10 -MaximumRedirection 0
            $code = [int]$response.StatusCode
        } catch {
            $code = 0
            if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
            # Solo estado y tipo de error; nunca imprimir el cuerpo HTTP.
            Write-Host "$Label intento $attempt/3: HTTP $code ($($_.Exception.GetType().Name))."
        }
        if ($code -ge 200 -and $code -lt 300) {
            Report 'EXITOSA' "$Label responde HTTP $code en $Url."
            return
        }
        if ($IsHealth -and $code -in @(401, 403, 404)) {
            Report 'NO DISPONIBLE' "$Label devuelve HTTP ${code}: endpoint ausente o protegido; no confirma salud del backend."
            return
        }
        if ($attempt -lt 3) { Start-Sleep -Seconds 2 }
    }
    Report 'FALLIDA' "$Label no responde con HTTP 2xx tras 3 intentos (ultimo HTTP $code)."
}

$hasDocker = $null -ne (Get-Command docker -ErrorAction SilentlyContinue)
$dockerReady = $false
if ($hasDocker) {
    docker info > $null
    $dockerReady = $LASTEXITCODE -eq 0
}
if ($dockerReady) { Report 'EXITOSA' 'Docker disponible.' }
else { Report 'FALLIDA' 'Docker no disponible. Comprueba la instalacion y el motor.' }

$configReady = $false
if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
    Report 'FALLIDA' 'Falta .env. Desde la raiz ejecuta: Copy-Item .env.example .env'
} elseif ($hasDocker) {
    docker compose --env-file .env -f compose.local.yml config --quiet
    $configReady = $LASTEXITCODE -eq 0
    if ($configReady) { Report 'EXITOSA' 'Configuracion de Compose valida.' }
    else { Report 'FALLIDA' 'Configuracion de Compose invalida.' }
} else { Report 'NO DISPONIBLE' 'Validacion de Compose: falta Docker CLI.' }

if (-not ($dockerReady -and $configReady)) {
    foreach ($check in @('Estado de servicios', 'PostgreSQL', 'Frontend HTTP', 'Backend /actuator/health')) {
        Report 'NO DISPONIBLE' "$check requiere Docker y una configuracion valida."
    }
    exit 1
}

docker compose --env-file .env -f compose.local.yml ps --all
if ($LASTEXITCODE -eq 0) { Report 'EXITOSA' 'Consulta de estado de servicios.' }
else { Report 'FALLIDA' 'No se pudo consultar el estado de servicios.' }
$running = @(docker compose --env-file .env -f compose.local.yml ps --status running --services)
if ($LASTEXITCODE -ne 0) {
    Report 'FALLIDA' 'No se pudieron obtener los servicios en ejecucion.'
    $running = @()
}
foreach ($service in @('database', 'backend', 'frontend')) {
    if ($running -contains $service) { Report 'EXITOSA' "Contenedor $service iniciado (no prueba funcionalidad)." }
    else { Report 'FALLIDA' "Contenedor $service no iniciado." }
}

if ($running -contains 'database') {
    # Las variables se resuelven dentro del contenedor sin exponer la clave.
    docker compose --env-file .env -f compose.local.yml exec -T database sh -c 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
    if ($LASTEXITCODE -eq 0) { Report 'EXITOSA' 'PostgreSQL acepta conexiones segun pg_isready.' }
    else { Report 'FALLIDA' 'PostgreSQL no acepta conexiones segun pg_isready.' }
} else { Report 'NO DISPONIBLE' 'pg_isready requiere database iniciado.' }

foreach ($endpoint in @(@('frontend', '80', '/'), @('backend', '8080', '/actuator/health'))) {
    $service = $endpoint[0]
    if ($running -notcontains $service) {
        Report 'NO DISPONIBLE' "HTTP $service requiere el contenedor iniciado."
        continue
    }
    $binding = docker compose --env-file .env -f compose.local.yml port $service $endpoint[1]
    if ($LASTEXITCODE -ne 0 -or -not $binding) {
        Report 'FALLIDA' "No se pudo obtener el puerto publicado de $service."
        continue
    }
    $port = ($binding.Trim() -split ':')[-1]
    Test-HttpEndpoint "$service HTTP" "http://127.0.0.1:$port$($endpoint[2])" ($service -eq 'backend')
}

Write-Host 'Estas comprobaciones no validan Auth0, persistencia de negocio ni casos de uso.'
if ($script:failed) { exit 1 }
if ($script:unavailable) { exit 2 }
exit 0
