param([Parameter(Mandatory=$true)][string]$PythonPath)
$ErrorActionPreference = 'Stop'
$logFile = Join-Path $PSScriptRoot 'last-run.log'
try {
    $output = & $PythonPath (Join-Path $PSScriptRoot 'pull-backups.py') --config (Join-Path $PSScriptRoot 'config.json') 2>&1
    $result = $LASTEXITCODE
    @((Get-Date).ToUniversalTime().ToString('o'), $output) | Set-Content -LiteralPath $logFile -Encoding UTF8
    exit $result
} catch {
    'Local backup task failed. Check the private configuration and Hostinger SSH access.' | Set-Content -LiteralPath $logFile -Encoding UTF8
    exit 1
}
