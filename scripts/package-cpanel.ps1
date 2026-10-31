param([ValidateSet('cpanel', 'cloudways')][string]$Target = 'cpanel')
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path -Parent $PSScriptRoot
$artifactsRoot = Join-Path $projectRoot 'artifacts'
$null = New-Item -ItemType Directory -Path $artifactsRoot -Force
$destination = Join-Path $artifactsRoot "push-api-$Target.zip"
$temporaryArchive = Join-Path $artifactsRoot "push-api-$Target.next.zip"
if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive }

$serverPackage = Get-Content -LiteralPath (Join-Path $projectRoot 'server/package.json') -Raw | ConvertFrom-Json
$rootPackage = [ordered]@{
    name = "push-notification-$Target"
    version = '1.0.0'
    private = $true
    type = 'commonjs'
    scripts = @{ start = 'node app.js' }
    dependencies = $serverPackage.dependencies
}
$files = [ordered]@{
    'app.js' = 'deploy/cpanel/app.js'
    'DEPLOYMENT.txt' = "deploy/$Target/DEPLOYMENT.txt"
    'server/index.js' = 'server/index.js'
    'server/app.js' = 'server/app.js'
    'server/push.js' = 'server/push.js'
    'server/domain-configuration.js' = 'server/domain-configuration.js'
    'server/domain-schema.js' = 'server/domain-schema.js'
    'server/domain-management.js' = 'server/domain-management.js'
    'server/domain-settings.js' = 'server/domain-settings.js'
    'server/accounts.js' = 'server/accounts.js'
    'server/pwa.js' = 'server/pwa.js'
    'server/audience.js' = 'server/audience.js'
    'server/analytics.js' = 'server/analytics.js'
    'server/subscriber-device.js' = 'server/subscriber-device.js'
    'server/push-audience.js' = 'server/push-audience.js'
    'server/push-content.js' = 'server/push-content.js'
    'server/subscription-prompts.js' = 'server/subscription-prompts.js'
    'server/notification-delivery.js' = 'server/notification-delivery.js'
    'server/schedule-time.js' = 'server/schedule-time.js'
    'server/schedules.js' = 'server/schedules.js'
    'server/reports.js' = 'server/reports.js'
    'client/public/sdk/prompt-ui.js' = 'client/public/sdk/prompt-ui.js'
    'server/package.json' = 'server/package.json'
    'server/.env.example' = 'server/.env.example'
    'server/db/schema.sql' = 'server/db/schema.sql'
    'client/public/sdk/push.js' = 'client/public/sdk/push.js'
    'client/public/push-sw.js' = 'client/public/push-sw.js'
    'client/public/downloads/push-notifications-plugin.zip' = 'client/public/downloads/push-notifications-plugin.zip'
}
if ($Target -eq 'cloudways') {
    $files['ecosystem.config.cjs'] = 'deploy/cloudways/ecosystem.config.cjs'
    $files['cloudways-proxy.htaccess.example'] = 'deploy/cloudways/proxy.htaccess.example'
}

$archive = [System.IO.Compression.ZipFile]::Open($temporaryArchive, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $null = $archive.CreateEntry('push-api/')
    $manifestEntry = $archive.CreateEntry('push-api/package.json')
    $writer = New-Object System.IO.StreamWriter($manifestEntry.Open(), (New-Object System.Text.UTF8Encoding($false)))
    try { $writer.Write(($rootPackage | ConvertTo-Json -Depth 6)) } finally { $writer.Dispose() }
    foreach ($relativePath in $files.Keys) {
        $sourcePath = Join-Path $projectRoot $files[$relativePath]
        $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $sourcePath, ('push-api/' + $relativePath), [System.IO.Compression.CompressionLevel]::Optimal)
    }
} finally { $archive.Dispose() }

$verification = [System.IO.Compression.ZipFile]::OpenRead($temporaryArchive)
try {
    foreach ($entry in $verification.Entries) {
        if ($entry.FullName.Contains('\') -or $entry.FullName.EndsWith('/.env')) {
            throw "Unexpected deployment archive entry: $($entry.FullName)"
        }
    }
    if ($null -eq $verification.GetEntry('push-api/app.js')) { throw 'Missing Passenger startup file.' }
} finally { $verification.Dispose() }
Move-Item -LiteralPath $temporaryArchive -Destination $destination -Force
Write-Output "$Target deployment package: $destination"
