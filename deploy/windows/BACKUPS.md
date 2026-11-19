# Encrypted backups to the Windows computer

This destination is outside the Hostinger VPS. The computer initiates SSH
downloads; no incoming router port, database exposure, public download link or
cloud-storage account is needed. The dedicated SSH key permits only encrypted
snapshot listing, download and checksum receipts. It cannot start a shell,
forward ports, modify the app or read arbitrary server files.

Backups include the Notizo MySQL dump and deployment `.env`. They contain
subscriber credentials and must remain private. Only age-encrypted archives
reach the computer. During verification, decrypted data is streamed through
memory, never extracted onto disk. The key stays outside Git and the VPS.

## 1. Prepare the computer

Run in the local VS Code PowerShell terminal, from the project root:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\setup-backups.ps1
```

This prepares:

- `%USERPROFILE%\NotizoBackups`: encrypted copies and safe verification metadata.
- `%LOCALAPPDATA%\NotizoBackup`: private keys, pinned known-host entry, client and
  configuration. Its NTFS permissions allow only the current Windows user and
  SYSTEM.
- `%LOCALAPPDATA%\NotizoBackup\host-setup.sh`: the exact Hostinger activation
  commands using **public** SSH/encryption keys, never their private identities.

The installer downloads the official Windows x64 age v1.3.2 package and verifies
its pinned SHA-256 release digest before installing its two executables. It
does not alter global PowerShell policy, existing personal SSH keys, or unrelated
folders. Existing encryption and SSH identities are never overwritten. It copies
the Hostinger entry from your already trusted OpenSSH known-host file and never
accepts an unknown host key automatically.

If the existing trusted entry is missing, sign in using your administrator SSH
key once and verify the fingerprint against Hostinger before retrying setup.

## 2. Activate on Hostinger, once

Wait until the commit is deployed successfully. In the local terminal, display
the **public setup commands**:

```powershell
Get-Content "$env:LOCALAPPDATA\NotizoBackup\host-setup.sh" -Raw
```

Open your normal administrator Hostinger SSH session and paste that block.
The deployment automation key is intentionally restricted to deployments and
cannot substitute for this administrator setup.

The block installs age, installs the restricted encrypted export key, copies the
existing app SMTP environment into a root-only host configuration, creates a
fresh backup, verifies an isolated restore and sends one test email to
**ttwabhijit@gmail.com**. Confirm receipt, including the spam folder.

SMTP authentication/TLS is verified **without sending** during configuration.
The separate `test-email` command is the explicit delivery test. If SMTP is only
configured as a database override, copy the required SMTP values privately into
`/etc/notizo-backup/alerts.conf`; do not paste passwords into chat. A pre-existing
alerts file is not overwritten without the explicit `--replace` setup option.

## 3. Verify the first copy, then enable the hourly task

Back in the local computer terminal:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\deploy\windows\setup-backups.ps1 -EnableSchedule
```

The first download must pass ciphertext checksum, age authentication/decryption
and both inner manifest checksums **before** the task can be enabled. Existing
changed local archives are never silently overwritten. No production SQL is
executed by the PC client.

The task is called **Notizo encrypted backups**. It runs hourly and at Windows
sign-in, catches up when possible, and requires the computer to be online and
this Windows user to be signed in. It never wakes the computer. No Windows login
password is stored. A restricted key without a passphrase is used for unattended
downloads, protected by NTFS permissions.

Inspect the scheduled task and last result:

```powershell
Get-ScheduledTask -TaskName 'Notizo encrypted backups'
Get-ScheduledTaskInfo -TaskName 'Notizo encrypted backups'
Get-Content "$env:LOCALAPPDATA\NotizoBackup\last-run.log"
Get-Content "$env:USERPROFILE\NotizoBackups\status.json"
```

On Hostinger, check the actual verified destination status without sending email:

```bash
cd /opt/push-notification-app/deploy/hostinger
python3 backup_health.py --status
systemctl list-timers --all 'push-notification-*' --no-pager
```

The destination must say `local_computer` and offsite must say
`verified_recently`. A prepared/encrypted snapshot alone is never counted as an
off-server copy. Only the receipt sent after PC verification qualifies.

## Alerts and limitations

Host-side Python SMTP alerts do not depend on the app, MySQL or Docker running.
They notify the operator about failed backup/restore/retention jobs, no completed
backup within 36 hours, no verified PC copy within 36 hours, and no successful
isolated restore check within eight days. The health timer runs every 30 minutes.
Repeated unresolved alerts are limited to once daily; failed email delivery is
retained and retried. A recovery notice follows a previously delivered incident.
Email contains safe event names and instructions, never raw logs or credentials.

If the PC is asleep, offline or signed out, the next task run catches up. The
VPS retains snapshots waiting for the PC receipt rather than pruning them. Watch
storage if the PC stays offline. Local PC copies are not automatically deleted.
Archive verification proves the stored dump/configuration can be decrypted; the
weekly VPS job separately restores SQL into an isolated disposable database.

Keep a separate private offline copy of `age-identity.txt` (for example, an
encrypted USB). Losing both the PC and its only decryption identity makes the
encrypted archives unrecoverable. Never put that identity on Hostinger or GitHub.

The host cannot email while the entire VPS or its network is down. An independent
uptime/backup service would be required to detect that outage externally.

Sources: [age](https://github.com/FiloSottile/age),
[Windows task settings](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset).
