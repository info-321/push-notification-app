# GitHub Actions deployment to the existing Hostinger VPS

The workflow is `.github/workflows/deploy.yml`. Pull requests run tests and the
dashboard build. Pushes to main and manual runs on main deploy only after those
checks pass. A first run without the two SSH secrets is skipped with a notice.
That does not mean automatic deployment is already configured.

## 1. Install the deployment command on HOSTINGER

Connect with your existing personal SSH key, then run:

```bash
cd /opt/push-notification-app
git pull --ff-only
install -o root -g root -m 750 deploy/hostinger/deploy.sh /usr/local/sbin/deploy-push-notifications
bash -n /usr/local/sbin/deploy-push-notifications
```

This installs a separate copy outside the checkout. Later changes to deploy.sh
need the install command repeated through your personal SSH connection. The
automation key cannot replace this entry point through a shell command.

## 2. Create a dedicated automation key on WINDOWS

In a LOCAL VS Code PowerShell terminal:

```powershell
ssh-keygen -t ed25519 -f "$env:USERPROFILE\.ssh\hostinger_actions" -C "github-actions-push-deploy"
```

For this dedicated unattended key, leave the passphrase empty by pressing Enter
twice. If the filename already exists, decline overwriting it and reuse it only
if it is the deployment key you intended. Your personal SSH key is separate.

Copy the PUBLIC key:

```powershell
Get-Content "$env:USERPROFILE\.ssh\hostinger_actions.pub" | Set-Clipboard
```

## 3. Authorize only the deployment command on HOSTINGER

In the HOSTINGER SSH terminal:

```bash
nano /root/.ssh/authorized_keys
```

Preserve every existing key. Add ONE new line containing this exact prefix,
followed by the full public key you copied:

```text
restrict,command="/usr/local/sbin/deploy-push-notifications" ssh-ed25519 YOUR_PUBLIC_KEY github-actions-push-deploy
```

Save, exit, and ensure the permissions:

```bash
chmod 700 /root/.ssh
chmod 600 /root/.ssh/authorized_keys
```

The new key accepts only `deploy FULL_40_CHARACTER_SHA`; it cannot request an
interactive shell, SFTP, or SSH forwarding. The command still operates as root
and deploys repository code, so access to main and this deployment secret grants
powerful production access. Use it only for this trusted repository.

## 4. Add TWO GitHub repository secrets

Open your repository's Settings -> Secrets and variables -> Actions -> New
repository secret. Use these exact names:

### HOSTINGER_SSH_KEY

In the LOCAL Windows terminal, copy the private deployment key directly to your
clipboard:

```powershell
Get-Content "$env:USERPROFILE\.ssh\hostinger_actions" -Raw | Set-Clipboard
```

Paste it into this GitHub secret, including its BEGIN/END lines. Never paste it
into chat, commit it, or upload it as a workflow artifact.

### HOSTINGER_KNOWN_HOSTS

In the already trusted HOSTINGER SSH session, print the server's PUBLIC host key
with its IP address:

```bash
awk '{print "147.93.43.76 " $1 " " $2}' /etc/ssh/ssh_host_ed25519_key.pub
```

Copy that entire line into the secret. This pins the server identity; the
workflow does not trust a fresh unverified ssh-keyscan result. These are the only
two GitHub secrets required. Database passwords, administrator credentials, and
PUSH_API_SECRET stay in the existing private Hostinger .env.

## 5. Run the first deployment

In GitHub, open Actions -> Deploy to Hostinger -> Run workflow. Select main and
run it. Successful tests should be followed by the Deploy production job.
Missing secrets cause a skip notice, not a production update. If setup was
completed while another run was active, start a new manual run afterward.

The command fetches origin, confirms the requested SHA is still the newest main
commit, and fast-forwards a clean checkout. Stale runs skip rather than deploying
an older revision over a newer push. Uncommitted tracked files or a diverged VPS
branch stop the deployment; it never uses git reset or deletes local data.

Before changing code, it backs up the database and .env. It records the current
app image IDs as rollback tags, builds api then web while the old containers
remain running, and replaces only those two services with --no-deps. It waits
for their health checks, tests SDK/plugin downloads, login, database access, and
the local dashboard. It never sends a notification.

There may be a short interruption while a single app container is replaced;
this is not a blue/green or zero-downtime deployment. A failed build leaves the
running containers alone. A failed cutover/check attempts to restore the saved
running app images and old Compose configuration, then fails the Actions job.
It does not rewind the Git checkout or restore the database. A subsequent fix
commit can fast-forward from the failed checkout.

## Scope and maintenance

- Caddy, DNS, WordPress installation, database container/volume, and systemd
  backup units are not automatically replaced. WordPress plugin source updates
  still need a rebuilt plugin ZIP and installation in WordPress.
- Changes to compose.yml or server/db/schema.sql require a manual coordinated
  deployment. The helper refuses those changes instead of silently skipping a
  migration. After applying and verifying them manually, pull/install as needed
  and rerun the workflow with a clean main checkout.
- Backward-incompatible application/database changes require a planned migration
  even if the schema.sql file was not edited; image rollback cannot undo data
  transformations performed by application code.
- Keep the app's server .env unchanged across deployments unless intentionally
  updating configuration. GitHub cannot edit it through the fixed SSH command.
- GitHub serializes production jobs, and a server-side flock also prevents
  overlapping helper runs. Do not manually edit tracked files during deployment.
- Rollback tags and recovery files in backups/deployments are retained. Monitor
  disk usage; arrange an appropriate retention policy before frequent deployments.
- This workflow expects the existing public Git origin. A private repository
  needs separate Git credentials on the VPS; the server fetch fails safely until
  that is configured. No Hostinger API token or third-party SSH action is needed.

For a deployment error, start with the failed Actions step. If SSH succeeded,
the logs include the path of private rollback files on the VPS. Use the existing
personal SSH key to inspect `docker compose ps` and app logs. Do not rerun
database exports or restore old subscriptions to fix a code deployment failure.
