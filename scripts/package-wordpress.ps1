$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$projectRoot = Split-Path -Parent $PSScriptRoot
$pluginRoot = [System.IO.Path]::GetFullPath((Join-Path $projectRoot 'wordpress/push-notifications-plugin'))
Copy-Item -LiteralPath (Join-Path $projectRoot 'client/public/push-sw.js') -Destination (Join-Path $pluginRoot 'push-sw.js') -Force
$destination = Join-Path $projectRoot 'client/public/downloads/push-notifications-plugin.zip'
$temporaryArchive = Join-Path $projectRoot 'client/public/downloads/push-notifications-plugin.next.zip'
if (Test-Path -LiteralPath $temporaryArchive) { Remove-Item -LiteralPath $temporaryArchive }
# Windows PowerShell's .NET Framework CreateFromDirectory writes backslashes.
# ZIP paths must use forward slashes so Linux hosts extract actual directories.
$archive = [System.IO.Compression.ZipFile]::Open($temporaryArchive, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    $null = $archive.CreateEntry('push-notifications-plugin/')
    foreach ($pluginFile in (Get-ChildItem -LiteralPath $pluginRoot -File -Recurse | Sort-Object FullName)) {
        $relativePath = $pluginFile.FullName.Substring($pluginRoot.Length).TrimStart([char[]]@('\', '/')).Replace('\', '/')
        $entryName = 'push-notifications-plugin/' + $relativePath
        $null = [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $pluginFile.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    }
} finally {
    $archive.Dispose()
}

$verification = [System.IO.Compression.ZipFile]::OpenRead($temporaryArchive)
try {
    foreach ($entry in $verification.Entries) {
        if ($entry.FullName.Contains('\')) { throw "Invalid ZIP path separator: $($entry.FullName)" }
    }
    if ($null -eq $verification.GetEntry('push-notifications-plugin/push-notifications.php')) {
        throw 'The archive is missing the main plugin file at its expected path.'
    }
} finally {
    $verification.Dispose()
}
Move-Item -LiteralPath $temporaryArchive -Destination $destination -Force
Write-Output "Packaged WordPress plugin: $destination"
