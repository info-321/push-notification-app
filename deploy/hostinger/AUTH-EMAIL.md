# Cookie sessions and password recovery

The dashboard uses a host-only `Secure; HttpOnly; SameSite=Lax` session cookie on
HTTPS. Browser session credentials are no longer returned in login JSON or saved
in localStorage. Existing localStorage tokens are removed; users must sign in once
after this deployment. Saved accounts, passwords, website keys and subscribers
are preserved. Previous interactive sessions are marked ended (`cookie_upgrade`);
only new cookie sessions and short-lived internal probes are accepted. Cookies retain the existing 12-hour server session expiry.

CSRF tokens remain in page memory. Mutations require a session-bound HMAC token
and an allowed Origin. Login and recovery also require a pre-login CSRF token.
The public SDK and WordPress sender-key integration continue using their existing
interfaces. Short-lived, tracked deployment probes use a separate internal bearer
exception (source `deployment`, maximum remaining lifetime two minutes, no Origin).

The dashboard and API should use the same HTTPS origin. If using a separate
dashboard on the same site, configure its exact origin in `DASHBOARD_ORIGINS` and
its URL in `PUBLIC_DASHBOARD_BASE`. Wildcards are rejected. For an explicitly
allowed local dashboard, add `http://localhost:3000` to `DASHBOARD_ORIGINS`; browser
third-party-cookie restrictions can still block cross-site cookies. Prefer the
hosted dashboard. Local HTTP development uses a non-Secure development cookie.

## One-time live upgrade

The installed deployment helper intentionally rejects changes to `compose.yml` or
`server/db/schema.sql`. This release adds optional mail environment variables and
additive recovery/session storage. A failed automatic run stops before changing
running containers. Do not remove that deployment guard or import schema.sql over
an existing database.

After GitHub's **Test and build** job succeeds for this release, connect through
your personal Hostinger SSH terminal and run this block once:

```bash
bash <<'NOTIZO_UPGRADE'
set -Eeuo pipefail
cd /opt/push-notification-app
git diff --quiet
git diff --cached --quiet
bash deploy/hostinger/backup.sh
git pull --ff-only
/usr/local/sbin/deploy-push-notifications "$(git rev-parse HEAD)"
NOTIZO_UPGRADE
```

This is the coordinated manual upgrade: it backs up before accepting the changed
infrastructure files, then invokes the existing installed deployment command. That
command backs up again, retains previous app images, builds and replaces only
`api`/`web`, runs additive migrations, and verifies readiness. It does not replace
the MySQL volume, import subscriber data, or change DNS/WordPress. The shell block
stops on errors. If tracked server files differ or the branch cannot fast-forward,
resolve that instead of resetting or deleting files. On a readiness failure the
helper attempts to restore the previous app images; it does not undo database
migrations, which are additive here. Old interactive sessions intentionally end.

When it prints `Deployment passed for commit ...`, refresh the hosted dashboard
and sign in. You can rerun the GitHub workflow to confirm normal automatic app
deployments resume with the clean, updated checkout. Email remains disabled until
the following setup is complete.

## Enable recovery email on Hostinger

Email is **disabled by default**. The two access-help addresses are mailto contact
links, not SMTP credentials and not automatically assigned to every account.

1. Choose a sending mailbox you control and obtain its SMTP hostname, port,
   username and provider-issued SMTP/app password. Verify the sender with that
   provider, including its SPF/DKIM instructions. The VPS alone does not supply a
   mailbox or email password. Do not put credentials in GitHub or share them in chat.
2. In your Hostinger SSH terminal:

   ```bash
   cd /opt/push-notification-app/deploy/hostinger
   nano .env
   ```

3. Add these settings using the actual provider values (no angle brackets):

   ```dotenv
   MAIL_ENABLED=true
   SMTP_HOST=smtp.your-mail-provider.example
   SMTP_PORT=587
   SMTP_USER=your-sending-mailbox@example.com
   SMTP_PASSWORD='your-provider-issued-smtp-password'
   SMTP_FROM=your-verified-sending-mailbox@example.com
   PUBLIC_DASHBOARD_BASE=https://push.micetraveladvisor.com
   ```

   Use port 587 for required STARTTLS, or 465 for implicit TLS. Certificate
   validation stays enabled. SMTP_FROM must be an email address, without a display
   name. Avoid duplicate entries. Preserve all existing database and push secrets.

4. Save with Ctrl+O, Enter, Ctrl+X, then run:

   ```bash
   chmod 600 .env
   docker compose config --quiet
   docker compose run --rm --no-deps api node mail-check.js
   ```

   The check verifies TLS/authentication and sends no email. If it fails, confirm
   credentials and the VPS/provider's outbound SMTP access. Do not disable TLS to
   work around connection failures. Set MAIL_ENABLED=false and recreate `api` to
   disable email again while diagnosing a provider issue.

   Once the connection check passes, apply the new environment:

   ```bash
   docker compose up -d --no-deps api
   ```

5. Sign in to Notizo, open **Settings → Account → Recovery email**, enter your own
   address and current password, and click **Send verification email**. Open that
   email's link and click **Verify email address**. Each user must do this for
   their own account. Refresh Account to see the verified address. A replacement
   address does not replace the verified address until its verification succeeds.
6. Test **Forgot password?** with your account only. The public response never
   confirms whether a username exists. Check your inbox/spam folder, open the link,
   enter and confirm a new password, then sign in again. All prior sessions end.

Verification links last 30 minutes; reset links last 15 minutes. Links use a URL
fragment that is removed by the app immediately and is not sent to HTTP access
logs. Opening a link does not consume it: the explicit confirmation does. Only
hashed tokens are stored in MySQL; successful redemption is transactional and
single-use. A later request replaces earlier links of the same type. Password
changes, access changes and disabled accounts invalidate outstanding links.

Reset delivery is performed after the generic response so SMTP/account lookup
timing does not reveal account existence. A process restart during delivery may
require another request. MySQL-backed user/IP limits apply across restarts; failed
SMTP delivery invalidates that token. Expired tokens and rate-limit records are
removed by the existing daily maintenance job after a day. Recovery addresses are
retained with the account and are not inferred from subscriber data.

Implementation references: [OWASP sessions](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[OWASP CSRF](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
[OWASP recovery](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html),
[Nodemailer SMTP](https://nodemailer.com/smtp).
