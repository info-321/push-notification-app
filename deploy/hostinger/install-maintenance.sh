#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ "$(id -u)" == 0 ]] || { echo 'Install maintenance units as root.' >&2; exit 1; }
[[ "$script_dir" == /opt/push-notification-app/deploy/hostinger ]] || { echo 'Unexpected deployment directory.' >&2; exit 1; }
[[ -x /usr/bin/python3 ]] || { echo 'Python 3 is required for maintenance.' >&2; exit 1; }
for unit in push-notification-backup.service push-notification-backup.timer \
    push-notification-restore.service push-notification-restore.timer \
    push-notification-maintenance.service push-notification-maintenance.timer \
    push-notification-ops-alert@.service push-notification-backup-health.service \
    push-notification-backup-health.timer; do
    [[ -f "$script_dir/$unit" && ! -L "$script_dir/$unit" ]] || exit 1
    install -m 644 -- "$script_dir/$unit" "/etc/systemd/system/$unit"
done
systemctl daemon-reload
systemctl enable --now push-notification-backup.timer push-notification-restore.timer push-notification-maintenance.timer
systemctl enable --now push-notification-backup-health.timer
printf 'Backup, restore, retention and half-hour health timers installed. Off-server uploads and email alerts require private configuration.\n'
