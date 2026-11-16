# RNF-20 — corrida de caracterización de desempeño, desde PowerShell.
#
#   cd C:\...\FixUp---pruebas-A.S
#   .\perf\rnf20\medir.ps1
#
# Levanta el muestreo de CPU y memoria, corre k6 con la carga representativa, para el muestreo y
# arma la tabla de caracterización. No decide si el sistema "pasa": RNF-20 tiene los umbrales por
# aprobar, así que esto mide y reporta.
#
# Requiere el entorno arriba (perf\rnf01\levantar.ps1) y las dos siembras hechas.

param(
  [int]$Rps = 60,
  [string]$RampUp = '30s',
  [string]$Plateau = '120s',
  [string]$RampDown = '15s'
)

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $raiz

$work = Join-Path $raiz 'perf\.work'
$muestras = Join-Path $work 'recursos-rnf20.jsonl'

function Paso($t) { Write-Host "`n==== $t ====" -ForegroundColor Yellow }

Paso '1. Comprobaciones previas'
foreach ($f in @('fixtures.json', 'catalogo.json')) {
  if (-not (Test-Path (Join-Path $work $f))) {
    throw "Falta perf\.work\$f. Corre las dos siembras antes: perf\seed.mjs y perf\rnf01\seed-catalogo.mjs"
  }
}
$codigo = 0
try {
  $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8080/auth/me' -TimeoutSec 5 -UseBasicParsing
  $codigo = [int]$r.StatusCode
} catch {
  if ($_.Exception.Response) { $codigo = [int]$_.Exception.Response.StatusCode }
}
if ($codigo -ne 401) { throw "El backend no responde 401 en /auth/me (dio $codigo). Levanta el entorno primero." }

# k6 se comprueba ANTES de levantar el muestreo. Si falta, antes se caía en el paso 3 y el trabajo
# de docker stats quedaba corriendo en la sesión, llenando el archivo de muestras sin que nadie lo
# parara.
if (-not (Get-Command k6 -ErrorAction SilentlyContinue)) {
  throw 'k6 no está en el PATH. Instálalo con:  winget install --id GrafanaLabs.k6 -e   (y abre una ventana nueva)'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'node no está en el PATH.' }
Write-Host 'Entorno, datos y herramientas listos.' -ForegroundColor Green

# El informe tiene que declarar el tamaño REAL del catálogo, no el que dice catalogo.json. La base
# conserva lo sembrado en corridas anteriores mientras no se la baje con `down -v`, así que sembrar
# dos veces deja el doble de inmuebles. Medir contra 10.000 y escribir 5.000 invalida la
# caracterización: el número que acompaña al p95 es parte de la medición, no un adorno.
$cuenta = docker compose --env-file .env -f compose.local.yml -f compose.perf.yml `
  exec -T database psql -U fixup -d fixup -t -A -c 'SELECT count(*) FROM properties' 2>$null
$cuenta = ($cuenta | Where-Object { $_ -match '^\s*\d+\s*$' } | Select-Object -First 1)
if ($cuenta) {
  $env:RNF20_PROPIEDADES = $cuenta.Trim()
  Write-Host "Inmuebles en la base: $($env:RNF20_PROPIEDADES)" -ForegroundColor Green
} else {
  Remove-Item Env:\RNF20_PROPIEDADES -ErrorAction SilentlyContinue
  Write-Host 'No se pudo contar los inmuebles; el informe lo dirá en vez de inventar la cifra.' -ForegroundColor Yellow
}

Paso '2. Muestreo de CPU y memoria'
# Se muestrea desde fuera porque k6 mide la API, no la máquina. Las dos series se cruzan después
# por marca de tiempo: sin esto, la caracterización no tendría la mitad de lo que pide la métrica.
# Un trabajo huérfano de una corrida anterior seguiría escribiendo en el mismo archivo y mezclaría
# dos corridas. Se busca por nombre para no tocar otros trabajos de la sesión.
Get-Job -Name 'rnf20-muestreo' -ErrorAction SilentlyContinue | ForEach-Object {
  Stop-Job $_ -ErrorAction SilentlyContinue
  Remove-Job $_ -Force -ErrorAction SilentlyContinue
}
Remove-Item $muestras -ErrorAction SilentlyContinue
$muestreo = Start-Job -Name 'rnf20-muestreo' -ScriptBlock {
  param($salida)
  while ($true) {
    $t = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
    docker stats --no-stream --format '{{json .}}' | ForEach-Object {
      "{""t"":$t,""s"":$_}" | Add-Content -Path $salida -Encoding utf8
    }
    Start-Sleep -Seconds 2
  }
} -ArgumentList $muestras
Write-Host "Muestreando cada 2 s (job $($muestreo.Id))." -ForegroundColor Green

Paso '3. Carga representativa con k6'
$env:PERF_WORK = $work
$env:OUT_DIR = $work
$env:RNF20_RPS = $Rps
$env:RNF20_RAMP_UP = $RampUp
$env:RNF20_PLATEAU = $Plateau
$env:RNF20_RAMP_DOWN = $RampDown

$inicio = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
# El finally es lo que garantiza que el muestreo se detenga aunque k6 se caiga a media corrida.
try {
  k6 run perf/k6/rnf20-caracterizacion.js
  $codigoK6 = $LASTEXITCODE
} finally {
  $fin = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  Paso '4. Deteniendo el muestreo'
  Stop-Job $muestreo -ErrorAction SilentlyContinue
  Remove-Job $muestreo -Force -ErrorAction SilentlyContinue
  Write-Host "Muestras: $((Get-Content $muestras -ErrorAction SilentlyContinue | Measure-Object -Line).Lines)" -ForegroundColor Green
}

Paso '5. Tabla de caracterización'
node perf/rnf20/caracterizacion.mjs $work $inicio $fin
if ($LASTEXITCODE -ne 0) { throw 'Falló el armado del informe.' }

Write-Host "`nListo." -ForegroundColor Green
Write-Host "  tabla:  $work\caracterizacion-rnf20.md"
Write-Host "  crudo:  $work\summary-rnf20.json  y  $work\recursos-rnf20.jsonl"
if ($codigoK6 -ne 0) {
  # Las llaves alrededor del nombre no son adorno: sin ellas PowerShell lee "$codigoK6:" como una
  # referencia con calificador de unidad y el script ni siquiera compila.
  Write-Host "`nk6 terminó con código ${codigoK6}: se superó la tasa de errores o las lecturas vinieron vacías." -ForegroundColor Red
  Write-Host 'La latencia no reprueba la corrida: RNF-20 tiene los umbrales por aprobar.' -ForegroundColor Red
}
exit $codigoK6
