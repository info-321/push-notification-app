# Activate Notizo platform roles

This upgrade adds Superadmin, scoped Admins, authenticator-based two-factor authentication, one-use confirmations, platform policies, encrypted SMTP overrides, controlled exports, and sending pauses. The first owner username is **Superadmin**.

Existing administrators keep their current access until the trusted operator explicitly activates platform roles. No administrator is silently promoted. Activation does not change subscribers, domain IDs, VAPID key pairs, the existing `PUSH_API_SECRET`, or the existing SMTP environment settings.

## 1. Deploy the additive database upgrade

Use your unrestricted Hostinger SSH login, not the GitHub Actions deployment key. Automatic deployment deliberately refuses a change to `server/db/schema.sql`. Keep this guard in place.

Run these commands **separately**, checking each succeeds:

```bash
cd /opt/push-notification-app
git status --short
bash deploy/hostinger/backup.sh </dev/null
git pull --ff-only
/usr/local/sbin/deploy-push-notifications "$(git rev-parse HEAD)" </dev/null
```

Stop if Git reports tracked changes or the backup fails. The manual pull is the reviewed migration step: startup creates the six new platform tables without replacing existing data. The deployment helper builds the images and runs the readiness checks. Do not import `schema.sql` over a populated database.

The deployment check now chooses an active Superadmin after activation. Its tracked, two-minute deployment probe can read and heartbeat; it cannot send notifications, change permissions, or perform platform mutations. Interactive sign-ins still require the human authenticator.

## 2. Create or promote the selected owner

Keep your SSH session open throughout setup. In the deployed application:

```bash
cd /opt/push-notification-app/deploy/hostinger
docker compose exec api node platform-bootstrap.js Superadmin
```

If that username already exists, its existing password is preserved. If it is new, enter and confirm a unique password privately when prompted; password input is hidden. Do not put a password in a command argument, GitHub secret, screenshot or chat.

The command lists the existing websites and asks for explicit website assignments for **each other existing Admin**. Enter comma-separated website numbers, or `none`. An Admin with no assignments will have no website access. Existing Editors/Viewers keep their website grants; assign their team manager in the UI afterward.

Review the selections and type `ACTIVATE`. The command commits the role changes atomically and revokes affected administrator sessions. It refuses to repeat activation. It does not grant every website to every Admin.

## 3. Enroll two-factor authentication

1. Open the hosted dashboard in a fresh tab and sign in as **Superadmin**.
2. Enter the current password to start authenticator setup.
3. Scan the QR code using a trusted authenticator app, then enter its current six-digit code.
4. Save all ten recovery codes privately in a password manager. Check the acknowledgement and continue.
5. Open **Platform Administration**, then **Users & website access**. Review Admin grants and Editor/Viewer team assignments. Removing an Admin website also removes that website from their managed team grants and revokes affected sessions.
6. Existing verified recovery addresses and password-reset links remain supported. Recovery email and Login sessions are not displayed in Settings ? Account. Password resets preserve MFA; they do not bypass it.

The setup secret/QR and recovery codes are never stored in localStorage. Seeds and SMTP overrides are encrypted in MySQL using a key derived from `PUSH_API_SECRET`; recovery codes are stored only as keyed hashes. Back up the database **and** the protected deployment `.env`. Do not change `PUSH_API_SECRET` casually: it is needed to recover encrypted settings and preserve existing sending credentials.

A TOTP code can be used only once. Wait for the next code before confirming another protected action, or use a fresh recovery code. Action confirmations expire after five minutes, work once, and are bound to the exact request, account and session. The last active enrolled Superadmin cannot be disabled or demoted. Self role changes are blocked in the dashboard.

## Permissions

| Action | Superadmin | Admin | Editor | Viewer |
| --- | --- | --- | --- | --- |
| View websites/reports | All | Assigned | Assigned | Assigned |
| Send/configure campaigns | All | Assigned | Assigned | No |
| Add/delete websites | Yes; deletion needs confirmation | No | No | No |
| Edit existing Admin/Superadmin roles and website assignments | Yes, with confirmation | No | No | No |
| Create additional Admins | Any website | Subset of own assigned websites | No | No |
| Edit username/password or reset another account | All other accounts | Own team Editors/Viewers | No | No |
| Manage Editors/Viewers | All | Own team, within assigned websites | No | No |
| View login/session/activity records | Platform-wide | Own account and managed team | Own | Own |
| Global SMTP, security policy, exports and restore approvals | Yes, with confirmation | No | No | No |
| Pause sending | Platform-wide or a website | Assigned websites | No | No |

Use Settings → Website sending control for a website pause. The global pause takes priority. Pauses stop new batches; requests already in flight may finish their current batch. Interrupted schedules can require review rather than automatically sending again. Inspect Reports before retrying.

Subscriber exports are disabled by default. An owner must enable them in Security policy and confirm each export with a business reason. Exports contain push credentials and may optionally include saved personal location details; keep downloaded CSV files private. VAPID private keys are never included in the UI export.

Existing WordPress sender keys remain valid until explicitly rotated. Someone who previously copied one retains that external sending capability independently of their new dashboard role. If needed, reveal/rotate each affected website key in Platform Administration and immediately update its WordPress settings. Rotation preserves VAPID keys and browser subscriptions. Do not rotate keys without coordinating the website update.

## SMTP and backup operations

The working environment SMTP configuration remains the fallback. Saving an SMTP override verifies the connection before replacing it; no test email is sent by this connection test. A blank password retains the previous one only when the SMTP host and username are unchanged. The password is never returned to the dashboard.

After activation, run a backup to populate the safe metadata catalog:

```bash
bash backup.sh </dev/null
```

The catalog exposes snapshot names/checksums, not database dumps, passwords, `.env` contents or raw backup download links. Off-server storage still requires its own configured destination.

An owner can approve a completed catalog backup for a coordinated restore. An operator checks the resulting approval ID:

```bash
docker compose exec -T api node platform-ops.js restore-plan APPROVAL_ID </dev/null
bash verify-backup.sh backups/automatic/EXACT_SNAPSHOT_FROM_PLAN
```

The plan is valid for one hour and must still belong to an active Superadmin. Match the exact snapshot and the SHA-256 hash of its `SHA256SUMS` file, then verify the files using `sha256sum -c SHA256SUMS` inside that snapshot. A restore approval alone does **not** run SQL or overwrite production. Take a new backup, pause sending and coordinate downtime before an operator follows the existing production restore procedure. Retain the reviewed approval plan with your operator records before a restore, since restoring an older database also restores its earlier audit history.

Audit records have no dashboard edit/delete routes. The existing server retention policy still applies to old records. Host/database operators remain trusted; this is not tamper-proof storage against someone with unrestricted server access.

## Lost authenticator and all recovery codes

Use a remaining recovery code first. If none is available, a trusted operator with unrestricted Hostinger access can run:

```bash
docker compose exec api node platform-recover.js Superadmin
```

Enter an operator recovery reason and explicitly confirm. This records the recovery, revokes all of that owner's sessions, and requires new MFA enrollment on the next password sign-in. It does not reveal or reset the password and is unavailable through the website or restricted CI key.

## Verify before relying on the new roles

Check that the owner can access Platform Administration; each Admin sees only assigned websites; Editors/Viewers cannot manage users; and a protected action requests the password plus a fresh authenticator code. Confirm the existing WordPress integration and password-reset flow still work. Take and verify a new backup after setup.

## Account visibility

Admin, Editor and Viewer responses exclude Superadmin account identities, login attempts, sessions and activity. A private account registry preserves that protection after later role changes. Filtering happens before pagination, and direct user/session requests for hidden accounts return the same unavailable response as unknown accounts. Superadmins retain access to the full audit history. Audit and recovery records are preserved in MySQL; the Account screen hides Recovery email and Login sessions while retaining password changes, two-factor settings and permitted activity history.


## Account history and secure password resets

Platform Administration ? Account history and password resets is restricted to enrolled Superadmins. It records account creation, access changes, self-service password changes, email recovery completion, and managed reset requests/completions. Records include actor, target, timestamp, source and reset reason. New lifecycle events use the existing MySQL platform_operations table; per-account creation/latest-password summaries use platform_config. Existing accounts without recorded creation metadata display **Not recorded**. Older password-change timestamps may be available without an actor; these are not backfilled with guesses. Audit history has no dashboard edit/delete controls and contains no passwords, password hashes or raw reset tokens.

To reset another active account, choose **Reset password**, give a reason and confirm your own password and a fresh authenticator/recovery code. This immediately replaces the old password with an unusable random credential and revokes all sessions. A private, single-use link is returned once and expires after 15 minutes. Copy it and share it privately with the verified account holder; dismissing the link removes it from the page. The link is never stored in browser storage or audit history. MySQL stores only its SHA-256 digest with expiry and account-version binding. The user selects their new password using the existing reset page; their role, website grants and MFA enrollment remain unchanged. Requesting a newer managed reset supersedes older links. If the link expires before use, issue another reset.

An account cannot use this action to reset itself; use Account ? Change Password or the verified email recovery flow. Reset completion is attributed to a **Reset-link holder**, with the requesting Superadmin recorded separately, rather than claiming the link proves a person's identity. Forgotten MFA is a separate recovery operation. A password reset never disables it. An owner can reset another owner, but cannot change its own permissions or bypass last-owner safeguards.

Role help beside the user Role selector and in Account explains the current scope. Ordinary roles do not receive private Superadmin history or controls.


## Username/password editing and scoped Admin creation

Settings ? User ? **Edit user** lets a Superadmin edit another account's username, role, password and website grants. An Admin can edit these fields only for their managed Editors/Viewers. Leave **New password (optional)** blank to retain the current hash. Credential and access changes revoke existing sessions and pending reset links; 2FA, verified recovery email, user ID, campaign ownership and audit history are retained. Duplicate or reserved former privileged usernames are rejected. Privileged username aliases remain hidden from ordinary account and login-history responses after renaming. Use My account for your own password; self role/access changes remain protected.

**Reset password** is available in the same user table for active manageable accounts. Admin resets are checked against team membership and website grants again inside the database transaction. The private reset link expires after 15 minutes, works once, and is returned only to the initiating operator. Share it privately and verify the recipient. Passwords are never returned from MySQL or included in activity logs. The Superadmin-only account history records the operator, changed username/access and password changes/reset requests.

Admins may now **create** additional Admins with an explicit subset of their currently assigned websites. These are independent peers, not subordinate team members: the creator cannot edit, disable, reset or inspect the peer's sessions. A creator can see their directly created Admins while all of the peer's website assignments remain inside the creator's current scope; only a Superadmin can manage their account. A later reduction of the creator's own assignments does not change an independent peer's already assigned websites. Editors/Viewers retain the existing team grant cascade. Admins cannot promote an existing Editor/Viewer to Admin or grant platform privileges. Fresh password confirmation and an enabled second factor protect all these mutations.
