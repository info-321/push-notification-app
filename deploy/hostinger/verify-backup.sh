#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
backup_root="$script_dir/backups/automatic"
for tool in docker gzip sha256sum; do
    command -v "$tool" >/dev/null || { echo "Missing required command: $tool" >&2; exit 1; }
done
if [[ $# -gt 1 ]]; then
    echo 'Usage: bash verify-backup.sh [completed-backup-folder]' >&2; exit 1
fi
if [[ $# -eq 1 ]]; then
    backup_dir="$(cd -- "$1" && pwd -P)"
else
    shopt -s nullglob
    candidates=("$backup_root"/20*)
    [[ ${#candidates[@]} -gt 0 ]] || { echo 'No completed backups found.' >&2; exit 1; }
    backup_dir="$(cd -- "${candidates[-1]}" && pwd -P)"
fi
[[ "$backup_dir" == "$backup_root"/20* && "$(dirname -- "$backup_dir")" == "$backup_root" ]] || {
    echo 'Choose a completed backup directly inside backups/automatic.' >&2; exit 1;
}
cd -- "$backup_dir"
sha256sum --check --status SHA256SUMS
gzip -t database.sql.gz

# No mounts or network: this MySQL instance cannot access production data.
container_id=''
cleanup() {
    if [[ "$container_id" =~ ^[a-f0-9]{64}$ ]]; then
        docker rm -f -v "$container_id" >/dev/null
    fi
}
trap cleanup EXIT
container_id="$(docker run -d --network none --memory 1g --cpus 1 \
    --label push-notification.restore-check=true \
    --env MYSQL_ALLOW_EMPTY_PASSWORD=yes --env MYSQL_DATABASE=restore_check mysql:8.4)"
[[ "$container_id" =~ ^[a-f0-9]{64}$ ]] || { echo 'Unexpected restore container ID.' >&2; exit 1; }
ready=false
for ((attempt=0; attempt<90; attempt++)); do
    if docker exec "$container_id" mysql --protocol=TCP --host=127.0.0.1 \
        --user=root --database=restore_check --execute='SELECT 1' >/dev/null 2>&1; then
        ready=true; break
    fi
    sleep 2
done
[[ "$ready" == true ]] || { echo 'Temporary restore database did not become ready.' >&2; exit 1; }
gzip -dc database.sql.gz | docker exec -i "$container_id" mysql --user=root restore_check
docker exec "$container_id" mysql --user=root --database=restore_check --execute='
    SELECT (SELECT COUNT(*) FROM domains) AS domains,
           (SELECT COUNT(*) FROM subscriptions) AS subscriptions,
           (SELECT COUNT(*) FROM domains WHERE vapid_private_key IS NOT NULL
             AND LENGTH(vapid_private_key) > 0) AS domains_with_private_keys;
'
printf 'Restore check passed: %s\n' "$backup_dir"
printf 'The application.env checksum also passed; its contents were not displayed.\n'
