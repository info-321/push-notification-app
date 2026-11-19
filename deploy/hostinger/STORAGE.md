# Backups, retention and database indexes

The database and subscriber credentials stay in the existing MySQL volume. No
domain or active subscription is deleted by maintenance. Off-server storage is
not configured by default: preparing this integration does not create a bucket,
an external account or an upload destination.

## Activate the schedules once

The restricted SSH automation uses a separately installed deployment helper.
Updating its source in Git does not replace that installed copy. From your
personal Hostinger root SSH session, run this one-time activation after deployment:

```bash
cd /opt/push-notification-app/deploy/hostinger
python3 maintenance.py --preview
bash install-maintenance.sh
install -o root -g root -m 750 deploy.sh /usr/local/sbin/deploy-push-notifications
systemctl list-timers --all 'push-notification-*' --no-pager
```

This keeps the existing forced-command SSH restriction. The automation key cannot
perform this installation through an arbitrary shell command. See
[AUTO-DEPLOY.md](AUTO-DEPLOY.md#1-install-the-root-owned-deployment-command).
Subsequent successful deployments install/update these root-owned systemd units:

| Job | UTC schedule | India time |
| --- | --- | --- |
| Full local backup; optional encrypted upload | Daily 02:15 | 07:45 |
| Isolated restore of the latest local backup | Sunday 02:35 | 08:05 |
| Bounded database/local-backup retention | Daily 03:15 | 08:45 |
| Backup freshness and operator email retry | Every 30 minutes | Every 30 minutes |

Restore tests use a disposable MySQL container with no network, production mounts
or published ports. They verify the dump/configuration checksums, restore the
tables, check the original administrator and full-endpoint index, and write
`restore-verified.json` only after success. Existing older snapshots remain
restorable. A failed job sets the systemd service to failed and writes a
failure in the system journal. Host-side email alerts use the private
`/etc/notizo-backup/alerts.conf` SMTP configuration and run independently of
Docker/MySQL. Until that file is configured, incidents are retained locally and
the status command explicitly reports email alerts as not configured.

From the Hostinger SSH terminal:

```bash
cd /opt/push-notification-app/deploy/hostinger
systemctl list-timers --all 'push-notification-*' --no-pager
systemctl --failed --no-pager
journalctl -u push-notification-backup.service -n 30 --no-pager
journalctl -u push-notification-maintenance.service -n 30 --no-pager
```

## Retention policy and preview

The default policy is:

* Clear subscriber IP details and optional GPS details older than 90 days, using
  each field's own recording time. Keep the active subscription, push keys,
  device/browser metadata and coarse country/state/city. A new eligible visit
  can record an IP again; location sharing still requires a separate user action.
* Delete expired/ended dashboard sessions and login attempts older than 90 days.
  Keep active sessions. Keep dashboard activity and maintenance-run records for
  365 days.
* Archive prompt details older than 90 days into per-domain/day/template totals.
  Preserve views, clicks, dismissals and conversions in prompt-performance reports.
* Freeze recipient acceptance/acknowledgement/click totals for campaigns finished
  more than 90 days ago, then remove recipient-level rows in bounded batches.
  Keep campaign content, results and report/CSV totals. Active sends and valid
  telemetry windows are excluded. Late events cannot rewrite archived totals.
* Retain local snapshots for at least 30 days and always keep at least seven
  completed snapshots plus the latest successfully restore-tested snapshot.
  Pending off-server uploads are never pruned while off-server mode is enabled.
  Deployment rollback directories and incomplete snapshots are not pruned.
* Keep accounts, domain grants/settings, drafts and coarse subscription lifecycle
  events. Maintenance does not shorten the lifecycle tracking coverage.

No request body, endpoint, password, token, IP or coordinate is printed by the
maintenance tools. The CLI has no public HTTP deletion endpoint and defaults to
preview. The scheduled operator script explicitly uses apply mode. It requires a
checksum-verified local backup less than 36 hours old before making changes.
Each apply run has a database advisory lock, bounded batches and a persistent
`maintenance_runs` result. Failed runs can resume without double-counting rollups.

Preview the current database and local backup candidates without changing them:

```bash
python3 maintenance.py --preview
```

To override the defaults:

```bash
cp maintenance.conf.example maintenance.conf.local
chmod 600 maintenance.conf.local
nano maintenance.conf.local
python3 maintenance.py --preview
```

Set `mode` to `preview` to keep the scheduled job read-only, or `apply` to enable
cleanup. The tools reject detail periods below 90 days, audit periods below 365
days and unsafe batch sizes. Run the chosen policy once with:

```bash
python3 maintenance.py
```

Counts are saved in `maintenance_runs`; older backups can contain data that has
since aged out of the live database. Backup lifecycle policies must therefore
match the retention policy. Restoring an old backup can bring old detail back;
run preview/maintenance after recovery before reopening the application.

## Encrypted copies to the local Windows computer

The operator can use the local Windows computer as the off-server destination.
See [the Windows setup guide](../windows/BACKUPS.md). The prepared installer
creates protected local identities and exact public-key activation commands.
No private key is uploaded to Hostinger, and no incoming PC port is opened.

After setup, `backup.sh` also prepares an encrypted export. This is **not** an
off-server success until the PC downloads, decrypts, checks its inner manifest
and acknowledges the exact ciphertext checksum. Unacknowledged snapshots are
protected from local retention. The health timer alerts if no recent verified
PC copy is recorded. Losing the entire VPS still requires an independent
external outage monitor to generate an immediate alert.

```bash
python3 backup_health.py --status  # read-only, sends no email
python3 ops_alert.py check        # SMTP/TLS/authentication only, sends no email
python3 ops_alert.py test-email   # explicit operator delivery test
```

Email recipients are configured explicitly; this installation uses only
`ttwabhijit@gmail.com`. No database dumps, `.env` contents, raw logs or keys
appear in the emails. Keep an offline private recovery copy of the PC age
identity. Local PC copies are retained without automatic deletion.

## Optional cloud/SFTP destination

This uses [age](https://github.com/FiloSottile/age) public-key encryption and
[rclone](https://rclone.org/docs/) for S3-compatible storage or an SSH/SFTP remote.
Until a destination exists, leave this disabled. Daily local backups still run.

1. Once you have external storage, install `age` and `rclone` on the VPS using
   the operating system packages. Create a dedicated directory:

   ```bash
   install -d -m 700 /etc/notizo-backup
   ```

2. Generate an age identity on a separate, trusted machine using `age-keygen`.
   Keep the **private identity** outside the VPS, repository and uploaded backups.
   Save its recovery copy somewhere separate and secure. Transfer only its public
   `age1...` recipient to `/etc/notizo-backup/recipients.txt` on the VPS (mode 600).
   The VPS needs that public recipient to encrypt, not the decryption identity.

3. Configure a dedicated rclone remote interactively on the VPS:

   ```bash
   rclone config --config /etc/notizo-backup/rclone.conf
   chmod 600 /etc/notizo-backup/rclone.conf /etc/notizo-backup/recipients.txt
   cp backup-offsite.conf.example backup-offsite.conf.local
   chmod 600 backup-offsite.conf.local
   nano backup-offsite.conf.local
   ```

   Set `enabled` to true and replace `remote_dir` with your remote's dedicated
   bucket/directory. Keep credentials in the private rclone config, never GitHub
   source files or chat. Configure appropriate remote retention/immutability at
   the storage provider. This app never deletes remote objects.

4. Test a new backup:

   ```bash
   bash backup.sh
   ```

   The tool first validates the local snapshot, streams its dump/configuration
   into an age-encrypted archive, uploads only ciphertext, then reads back the
   entire remote ciphertext and checks SHA-256. It writes an offsite receipt only
   after this verification. A failed upload or checksum fails the backup service
   and retains the local snapshot. The rclone configuration and decryption
   identity are never placed in the archive. This readback check is not a remote
   restore test: also test decryption/recovery using the offline identity.

5. On the separate recovery machine, download one `.tar.age` object with rclone.
   Decrypt it using your offline identity:

   ```bash
   umask 077
   age --decrypt --identity /SAFE/PATH/age-identity.txt --output snapshot.tar snapshot.tar.age
   mkdir recovered-snapshot
   tar -xf snapshot.tar -C recovered-snapshot
   cd recovered-snapshot
   sha256sum --check SHA256SUMS
   gzip -t database.sql.gz
   ```

   Import the dump into a disposable MySQL database before a real recovery.
   `application.env` contains private production configuration; keep the recovered
   directory private. Preserve the original VAPID keys and `PUSH_API_SECRET`.

## Index and endpoint upgrade

Startup adds an automatically computed binary SHA-256 endpoint fingerprint and
its unique index **before** removing the legacy 255-character prefix index. This
lets different long endpoints with identical prefixes coexist. Exact endpoint
lookups also use that fingerprint, so case-distinct opaque URL paths cannot be
mistaken for each other. A fingerprint collision is rejected, never merged.
Old rows, IDs, URLs and VAPID keys are preserved. Older images can still insert
rows because MySQL computes the generated column automatically.

Additional indexes cover domain/date subscriber queries, domain/device/browser
filters, login IP/time checks, audit timestamps and retention candidates. The
analytics path avoids reading the live subscription table when lifecycle history
already supplies its addition totals. CI runs `EXPLAIN` on real MySQL to verify
fingerprint/index eligibility and tests restart safety, full-length uniqueness,
cleanup resumability and archived report/prompt totals. For a large imported
audience, measure query plans and migration time on staging before cutover.
