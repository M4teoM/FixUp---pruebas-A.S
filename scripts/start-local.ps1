$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot

if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
    throw 'Falta .env. Desde la raiz del repositorio ejecuta: Copy-Item .env.example .env'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'Docker no esta instalado o no esta en PATH.' }
docker info > $null
if ($LASTEXITCODE -ne 0) { throw 'Docker no esta disponible. Inicia Docker Desktop o Docker Engine.' }
docker compose --env-file .env -f compose.local.yml config --quiet
if ($LASTEXITCODE -ne 0) { throw 'La configuracion de Compose es invalida.' }
docker compose --env-file .env -f compose.local.yml up --build -d
if ($LASTEXITCODE -ne 0) { throw 'Fallo el inicio. Consulta scripts/status-local.ps1.' }
docker compose --env-file .env -f compose.local.yml ps
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar el estado.' }

foreach ($endpoint in @(@('frontend', '80'), @('backend', '8080'))) {
    $binding = docker compose --env-file .env -f compose.local.yml port $endpoint[0] $endpoint[1]
    if ($LASTEXITCODE -ne 0 -or -not $binding) { throw "No se pudo consultar el puerto de $($endpoint[0])." }
    $port = ($binding.Trim() -split ':')[-1]
    Write-Host "$($endpoint[0]): http://localhost:$port"
}
Write-Host 'Los contenedores iniciados no prueban funcionalidad de negocio. Ejecuta scripts/verify-local.ps1.'
