$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $repoRoot
if (-not (Test-Path -LiteralPath '.env' -PathType Leaf)) {
    throw 'Falta .env. Desde la raiz del repositorio ejecuta: Copy-Item .env.example .env'
}
docker compose --env-file .env -f compose.local.yml down
if ($LASTEXITCODE -ne 0) { throw 'No se pudo detener el entorno.' }
Write-Host 'Entorno detenido. El volumen de PostgreSQL se conserva.'
