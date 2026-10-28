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
"${compose[@]}" exec -T db sh -c '
    MYSQL_PWD="$MYSQL_PASSWORD" exec mysqldump --user="$MYSQL_USER" \
        --single-transaction --quick --no-tablespaces --skip-lock-tables \
        --set-gtid-purged=OFF "$MYSQL_DATABASE"
' | gzip > "$partial/database.sql.gz"
gzip -t "$partial/database.sql.gz"
# Read the entire stream so pipefail does not mistake SIGPIPE for a dump failure.
gzip -dc "$partial/database.sql.gz" | grep -F 'CREATE TABLE `domains`' >/dev/null
gzip -dc "$partial/database.sql.gz" | grep -F 'CREATE TABLE `subscriptions`' >/dev/null
(
    cd -- "$partial"
    sha256sum database.sql.gz application.env > SHA256SUMS
)
printf 'Created (UTC): %s\nSource: push-notification-app MySQL database\nStorage: local VPS only\n' "$stamp" > "$partial/backup-info.txt"
chmod 600 "$partial"/*
final="$script_dir/backups/automatic/${partial##*/.partial-}"
mv -T -- "$partial" "$final"
trap - ERR
printf 'Backup completed: %s\n' "$final"
printf 'Copy completed backup folders to separate storage for protection against VPS loss.\n'
