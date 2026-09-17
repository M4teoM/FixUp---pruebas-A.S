# Comprueba el indice Git sin mostrar contenidos ni valores sensibles.
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)

$tracked = (git ls-files -z) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'No se pudo consultar el indice Git.' }
$paths = @($tracked.Split([char]0) | Where-Object { $_ })
$blocked = @()
foreach ($path in $paths) {
    $name = ($path -split '/')[-1].ToLowerInvariant()
    $forbidden = $path -cne '.env.example' -and (
        $name -eq '.env' -or $name.StartsWith('.env.') -or
        $name -match '\.(pem|key|p12|pfx|jks|keystore|crt|cer|apk|aab|jar|dump|sql)$' -or
        $name -match 'service[-_]?account' -or
        $name -match '^id_(rsa|ed25519|ecdsa|dsa)'
    )
    if ($forbidden) {
        $blocked += $path
        continue
    }
    $content = (git show (':' + $path)) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo revisar el archivo: $path" }
    $suspicious = (
        $content -cmatch '-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----' -or
        $content -cmatch '"type"\s*:\s*"service_account"' -or
        $content -cmatch 'gh[pousr]_[A-Za-z0-9]{36,}' -or
        $content -cmatch 'github_pat_[A-Za-z0-9_]{60,}' -or
        $content -cmatch 'AKIA[0-9A-Z]{16}'
    )
    if ($suspicious) { $blocked += $path }
}
if ($blocked.Count -gt 0) {
    Write-Output 'FALLIDA: archivos sensibles o patrones de credenciales detectados:'
    $blocked | ForEach-Object { Write-Output $_ }
    exit 1
}
if ($paths -cnotcontains '.env.example') { throw 'Falta .env.example en el indice Git.' }
Write-Output '.env.example'
