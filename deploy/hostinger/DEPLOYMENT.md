# Hostinger KVM: existing Docker and Caddy server

This deployment uses the server's existing Caddy service. It creates a separate
Compose project, `push-notification-app`, with a private MySQL database, Node API
on `127.0.0.1:5000`, and compiled React dashboard on `127.0.0.1:3001`.
Caddy serves both at `https://push.micetraveladvisor.com`.

The existing TTW similarity project uses `/opt/ttw-similarity`, port 8000, and
Caddy ports 80/443. Run the commands below only from the new project's directory.
No Coolify installation, Caddy replacement, or OS reinstallation is needed.

## 1. Prepare the new deployment

After cloning/updating the repository:

```bash
cd /opt/push-notification-app/deploy/hostinger
ss -lnt '( sport = :5000 or sport = :3001 )'
```

If either port is occupied, stop here and choose unused ports in compose.yml
and Caddyfile.example together. Do not stop an unknown service to free a port.

For the FIRST setup only:

```bash
cp -n .env.example .env
chmod 600 .env
nano .env
```

Set distinct, strong DB_PASSWORD and MYSQL_ROOT_PASSWORD for the NEW database.
Generate each with `openssl rand -hex 32`. Set ADMIN_USERNAME and ADMIN_PASSWORD.
Copy the exact PUSH_API_SECRET from the DEPLOYED Cloudways server/.env, not from
a different local environment. Preserve this secret, the imported domain rows,
their VAPID private/public keys, and the subscriptions to retain the integration.
Set your real VAPID_SUBJECT contact and keep the public API address as above.
Do not paste passwords, this file, or SQL exports into chat or GitHub.

Compose reads deploy/hostinger/.env automatically. The container environment is
passed directly to Node; server/.env is not copied into either image. The React
API address is a public build argument; changing it requires rebuilding web.

Validate configuration without printing resolved secrets, then build sequentially:

```bash
docker compose config --quiet
docker compose build api
docker compose build web
docker compose up -d db
docker compose ps
```

Wait for db to be healthy. Use `docker compose logs --tail=50 db` if it fails.
MySQL is stored in a named volume and has no public port. The schema is created
on its first empty-volume initialization only. Changing .env database passwords
later does not change users in an existing database; use MySQL ALTER USER instead.

## 2. Copy the Cloudways database

Coordinate the migration with your mentor. Use a first export to test the new
installation. Keep Cloudways serving the existing hostname until local checks
pass. The export contains private VAPID keys and browser subscription data.

On CLOUDWAYS, substitute the deployed source database details (no --databases
flag, so the export imports into the dedicated new database):

```bash
umask 077
mysqldump --single-transaction --quick --no-tablespaces \
  -h SOURCE_DB_HOST -P SOURCE_DB_PORT -u SOURCE_DB_USER -p SOURCE_DB_NAME \
  > "$HOME/push-notifications-export.sql"
```

Use your mentor's SFTP access to transfer that private file to Hostinger at
`/opt/push-notification-app/deploy/hostinger/backups/cloudways.sql`.
Create that directory with `mkdir -p backups && chmod 700 backups`, then set
`chmod 600 backups/cloudways.sql` after upload. These exports are Git-ignored.
Only export the push application's database, not the WordPress database.

On HOSTINGER, from deploy/hostinger, import into the NEW database:

```bash
docker compose exec -T db sh -c 'MYSQL_PWD="$MYSQL_PASSWORD" exec mysql --user="$MYSQL_USER" "$MYSQL_DATABASE"' < backups/cloudways.sql
docker compose up -d api web
docker compose ps
```

Run the read-only application check (Node executes inside the API container):

```bash
docker compose exec -T api node --input-type=module < check.mjs
curl -I http://127.0.0.1:3001/
```

The check tests login, protected database access, downloadable assets, and prints
domain/subscription/key counts. Compare the counts and domain identities with
Cloudways. It never sends notifications. A successful check alone is not proof
that the imported keys match; they must come from the original export and secret.

## 3. Add the new Caddy site

Back up the existing Caddyfile outside the repository:

```bash
cp -p /etc/caddy/Caddyfile /etc/caddy/Caddyfile.before-push
nano /etc/caddy/Caddyfile
```

Append the site block in Caddyfile.example, preserving every existing site and
global option. If the hostname already exists in this Caddyfile, update its block
instead of adding a duplicate. Validate before applying:

```bash
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

Coordinate the following cutover with your mentor before reloading or changing
DNS. Caddy obtains HTTPS certificates when the hostname points to this server.

## 4. Cut over without discarding new subscriptions

1. Record the existing Cloudflare DNS A/AAAA records, proxy status, and TTL for
   push.micetraveladvisor.com so the origin can be restored if necessary.
2. Schedule a short push-service maintenance window: pause sending and new
   subscription writes to the OLD API. On the existing Cloudways PM2 deployment,
   stop only `push-notifications-api`, never all PM2 apps. The WordPress website
   stays running, but push subscription requests may fail briefly during cutover.
3. Take a FINAL source export with writes paused. Stop only the NEW API with
   `docker compose stop api`, import the final export as above, then run
   `docker compose up -d api web` and the read-only check again. Initial test
   exports are not sufficient if new subscriptions arrived afterward.
4. Reload the validated configuration with `systemctl reload caddy`. Point the
   hostname's DNS A record to the Hostinger VPS (currently 147.93.43.76). Update
   any AAAA record to this VPS's IPv6 or remove the stale record after recording
   it. For initial public certificate issuance, DNS-only mode is the simplest
   option; wait for HTTPS to work before enabling Cloudflare proxy with Full
   (strict). Preserve existing firewall/SSH access and the TTW site's DNS.
5. Check `curl -I https://push.micetraveladvisor.com/sdk/push.js` returns JavaScript
   with HTTP 200. Check the dashboard opens at the hostname root and login shows
   the imported domains. If Cloudflare cached the old SDK, purge that URL.
6. Since the public API URL, keys, and secret are preserved, the WordPress
   integration should keep its existing settings. Verify one browser subscription
   and, when explicitly ready to notify subscribers, send one test. The dashboard
   sends to ALL subscribers of the selected domain.
7. Keep the source database and deployment available through the verification
   period. DNS rollback after Hostinger has accepted new writes needs a reverse
   data migration; switching DNS alone would discard those new subscriptions.

## 5. Updates and backups

For subsequent code deployments, keep .env, the volume, and backups in place:

```bash
cd /opt/push-notification-app
git pull --ff-only
cd deploy/hostinger
docker compose build api
docker compose build web
docker compose up -d
docker compose exec -T api node --input-type=module < check.mjs
```

Use `docker compose logs --tail=50 api` for errors. Never use `docker compose
down -v` on this deployment: it deletes the database volume. Configure scheduled
database backups to separate storage and verify restoring a copy before relying
on them. Hostinger server snapshots alone are not the application's backup plan.
