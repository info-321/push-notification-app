param(
    [string]$Destination = (Join-Path $env:USERPROFILE 'NotizoBackups'),
    [switch]$EnableSchedule
)
$ErrorActionPreference = 'Stop'
$installDirectory = Join-Path $env:LOCALAPPDATA 'NotizoBackup'
$sourceDirectory = $PSScriptRoot
$pythonCommand = (Get-Command python.exe -ErrorAction Stop).Source
$sshCommand = (Get-Command ssh.exe -ErrorAction Stop).Source
$keygenCommand = (Get-Command ssh-keygen.exe -ErrorAction Stop).Source

function Protect-Directory([string]$Path) {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
    # Persist only the DACL. Replacing owner/audit sections can demand elevated
    # SeSecurityPrivilege even when the current user owns this private folder.
    $acl = (Get-Item -LiteralPath $Path).GetAccessControl([System.Security.AccessControl.AccessControlSections]::Access)
    $acl.SetAccessRuleProtection($true, $false)
    foreach ($existingRule in @($acl.Access)) { $acl.RemoveAccessRuleAll($existingRule) }
    foreach ($sid in @($identity, (New-Object System.Security.Principal.SecurityIdentifier('S-1-5-18')))) {
        $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    [System.IO.Directory]::SetAccessControl($Path, $acl)
}

foreach ($directory in @($installDirectory, $Destination)) {
    if (Test-Path -LiteralPath $directory) {
        $item = Get-Item -LiteralPath $directory -Force
        if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -or -not (Test-Path -LiteralPath (Join-Path $directory '.notizo-backup'))) {
            throw 'Use a new dedicated Notizo backup directory; existing unrelated directories are not modified.'
        }
    } else {
        New-Item -ItemType Directory -Path $directory | Out-Null
        New-Item -ItemType File -Path (Join-Path $directory '.notizo-backup') | Out-Null
    }
    Protect-Directory $directory
}
$Destination = (Resolve-Path -LiteralPath $Destination).Path
$toolsDirectory = Join-Path $installDirectory 'tools'
New-Item -ItemType Directory -Path $toolsDirectory -Force | Out-Null
$age = Join-Path $toolsDirectory 'age.exe'
$ageKeygen = Join-Path $toolsDirectory 'age-keygen.exe'
if (-not (Test-Path -LiteralPath $age) -or -not (Test-Path -LiteralPath $ageKeygen)) {
    # Pinned official release, verified against its GitHub release-asset digest.
    if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') { throw 'This package targets Windows x64. Install the matching official age binaries before continuing.' }
    $zip = Join-Path $toolsDirectory 'age-v1.3.2.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-windows-amd64.zip' -OutFile $zip
    if ((Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant() -ne 'f48d8f8f9ebe903ab5027ed067652f2cc1db94bc206976430133b905dcd8e8c7') { throw 'The official age download checksum did not match.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zip)
    try {
        foreach ($name in @('age.exe', 'age-keygen.exe')) {
            $entries = @($archive.Entries | Where-Object { $_.Name -eq $name })
            if ($entries.Count -ne 1) { throw 'Unexpected official age archive layout.' }
            [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], (Join-Path $toolsDirectory $name), $true)
        }
    } finally { $archive.Dispose() }
}
$sshKey = Join-Path $installDirectory 'backup_ed25519'
if (-not (Test-Path -LiteralPath $sshKey)) {
    & $pythonCommand (Join-Path $sourceDirectory 'prepare-key.py') $keygenCommand $sshKey
    if ($LASTEXITCODE -ne 0) { throw 'Dedicated backup SSH key generation failed.' }
}
$ageIdentity = Join-Path $installDirectory 'age-identity.txt'
if (-not (Test-Path -LiteralPath $ageIdentity)) {
    & $ageKeygen -o $ageIdentity 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Backup encryption key generation failed.' }
}
$recipient = (& $ageKeygen -y $ageIdentity).Trim()
if ($LASTEXITCODE -ne 0 -or $recipient -notmatch '^age1[0-9a-z]{58}$') { throw 'Could not read the public backup recipient.' }
$publicKey = (Get-Content -LiteralPath ($sshKey + '.pub') -Raw).Trim()
$knownHosts = Join-Path $installDirectory 'known_hosts'
$existingKnownHosts = Join-Path $env:USERPROFILE '.ssh\known_hosts'
if (-not (Test-Path -LiteralPath $knownHosts)) {
    if (-not (Test-Path -LiteralPath $existingKnownHosts)) { throw 'Connect to Hostinger using your administrator key first and verify its SSH host fingerprint.' }
    $entries = @(& $keygenCommand -F '147.93.43.76' -f $existingKnownHosts | Where-Object { $_ -and -not $_.StartsWith('#') })
    if ($LASTEXITCODE -ne 0 -or $entries.Count -eq 0) { throw 'No previously trusted Hostinger SSH host key was found. Verify it in your administrator SSH session first.' }
    [System.IO.File]::WriteAllText($knownHosts, (($entries -join "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
}
Copy-Item -LiteralPath (Join-Path $sourceDirectory 'pull-backups.py') -Destination (Join-Path $installDirectory 'pull-backups.py') -Force
Copy-Item -LiteralPath (Join-Path $sourceDirectory 'run-backups.ps1') -Destination (Join-Path $installDirectory 'run-backups.ps1') -Force
$config = @{host='147.93.43.76';user='root';ssh_key=$sshKey;known_hosts=$knownHosts;age_identity=$ageIdentity;age_binary=$age;ssh_binary=$sshCommand;destination=$Destination}
[System.IO.File]::WriteAllText((Join-Path $installDirectory 'config.json'), ($config | ConvertTo-Json), (New-Object System.Text.UTF8Encoding($false)))
$bootstrap = @"
set -euo pipefail
cd /opt/push-notification-app/deploy/hostinger
apt-get update -qq
apt-get install -y age
install -d -m 700 /etc/notizo-backup
cat > /etc/notizo-backup/pc-backup.pub <<'NOTIZO_PUBLIC_SSH'
$publicKey
NOTIZO_PUBLIC_SSH
cat > /etc/notizo-backup/pc-age.pub <<'NOTIZO_PUBLIC_AGE'
$recipient
NOTIZO_PUBLIC_AGE
chmod 600 /etc/notizo-backup/pc-backup.pub /etc/notizo-backup/pc-age.pub
bash install-local-backup.sh /etc/notizo-backup/pc-backup.pub /etc/notizo-backup/pc-age.pub
python3 setup-backup-alerts.py --to ttwabhijit@gmail.com --require-offsite
systemctl start push-notification-backup.service
systemctl start push-notification-restore.service
python3 ops_alert.py test-email
"@
[System.IO.File]::WriteAllText((Join-Path $installDirectory 'host-setup.sh'), ($bootstrap.Replace("`r`n", "`n") + "`n"), (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Encrypted backup folder: $Destination"
Write-Host "One-time Hostinger setup commands: $(Join-Path $installDirectory 'host-setup.sh')"
Write-Host 'Private SSH and age identity files stay on this PC. Keep an additional private offline copy of age-identity.txt.'
if ($EnableSchedule) {
    & $pythonCommand (Join-Path $installDirectory 'pull-backups.py') --config (Join-Path $installDirectory 'config.json')
    if ($LASTEXITCODE -ne 0) { throw 'The first download has not verified successfully. No scheduled task was enabled.' }
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $action = New-ScheduledTaskAction -Execute (Join-Path $PSHOME 'powershell.exe') -Argument ('-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $installDirectory 'run-backups.ps1') + '" -PythonPath "' + $pythonCommand + '"')
    $hourly = New-ScheduledTaskTrigger -Once -At ((Get-Date).AddMinutes(5)) -RepetitionInterval (New-TimeSpan -Hours 1)
    $logon = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 50)
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    Register-ScheduledTask -TaskName 'Notizo encrypted backups' -Action $action -Trigger @($hourly, $logon) -Settings $settings -Principal $principal -Description 'Download and verify encrypted Notizo snapshots hourly while this user is signed in.' -Force | Out-Null
    Write-Host 'Verified download complete. Hourly local backups and a sign-in catch-up task are enabled.'
} else {
    Write-Host 'Preparation complete. Run the Hostinger setup first, then re-run this script with -EnableSchedule.'
}
