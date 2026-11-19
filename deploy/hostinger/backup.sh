#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
cd -- "$script_dir"
for tool in docker gzip sha256sum mktemp; do
    command -v "$tool" >/dev/null || { echo "Missing required command: $tool" >&2; exit 1; }
done
[[ -f .env ]] || { echo 'Deployment .env is missing; backup aborted.' >&2; exit 1; }
[[ ! -L backups && ! -L backups/automatic ]] || {
    echo 'Backup directories must not be symbolic links.' >&2; exit 1;
}
mkdir -p -- backups/automatic
chmod 700 backups backups/automatic

compose=(docker compose --project-directory "$script_dir" --file "$script_dir/compose.yml" --env-file "$script_dir/.env")
"${compose[@]}" config --quiet
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
partial="$(mktemp -d "$script_dir/backups/automatic/.partial-$stamp-XXXXXX")"
# Failed runs remain private .partial-* directories, never completed backups.
trap 'echo "Backup failed; any incomplete files remain in: $partial" >&2' ERR

cp -- .env "$partial/application.env"
# Compose exec attaches stdin by default. A dump needs none; preserve any
# following commands when this script is called from a pasted shell block.
"${compose[@]}" exec -T db sh -c '
    MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --user="$MYSQL_USER" \
        --single-transaction --quick --no-tablespaces --skip-lock-tables \
        --set-gtid-purged=OFF "$MYSQL_DATABASE"
' </dev/null | gzip > "$partial/database.sql.gz"
gzip -t "$partial/database.sql.gz"
# Read the entire stream so pipefail does not mistake SIGPIPE for a dump failure.
gzip -dc "$partial/database.sql.gz" | grep -F 'CREATE TABLE `domains`' >/dev/null
gzip -dc "$partial/database.sql.gz" | grep -F 'CREATE TABLE `subscriptions`' >/dev/null
(
    cd -- "$partial"
    sha256sum database.sql.gz application.env > SHA256SUMS
)
printf 'Created (UTC): %s\nSource: push-notification-app MySQL database\nStorage: created on VPS; external copies require verified receipts\n' "$stamp" > "$partial/backup-info.txt"
chmod 600 "$partial"/*
final="$script_dir/backups/automatic/${partial##*/.partial-}"
mv -T -- "$partial" "$final"
trap - ERR
printf 'Backup completed: %s\n' "$final"
if [[ -f "$script_dir/backup-export.py" ]]; then
    python3 "$script_dir/backup-export.py" prepare "$final"
fi
if [[ -f "$script_dir/offsite-backup.py" ]]; then
    # An unconfigured destination is explicitly skipped. Configured uploads must
    # pass encryption and remote checksum verification or this service fails.
    python3 "$script_dir/offsite-backup.py" "$final"
else
    printf 'Copy completed backup folders to separate storage for protection against VPS loss.\n'
fi

# Catalog only safe metadata; old application images may not include this CLI yet.
if "${compose[@]}" exec -T api test -f platform-ops.js </dev/null >/dev/null 2>&1; then
    manifest_hash="$(sha256sum "$final/SHA256SUMS")"
    "${compose[@]}" exec -T api node platform-ops.js record-backup "${final##*/}" "${manifest_hash%% *}" </dev/null
fi
