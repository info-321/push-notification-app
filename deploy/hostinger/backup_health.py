#!/usr/bin/env python3
"""Inspect backup metadata and notify operators without accessing production SQL."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import ops_alert
from offsite_backup_loader import private_file

ROOT = Path(__file__).resolve().parent
SNAPSHOT = re.compile(r'20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9]+')
UNITS = ('push-notification-backup.service', 'push-notification-restore.service', 'push-notification-maintenance.service')


def recent(stamp, maximum_age, now):
    try:
        value = datetime.fromisoformat(stamp.replace('Z', '+00:00')).timestamp()
        return -900 <= now - value <= maximum_age
    except (AttributeError, ValueError, TypeError):
        return False


def snapshots():
    root = ROOT / 'backups' / 'automatic'
    if root.is_symlink():
        raise ValueError('Invalid snapshot directory.')
    if not root.exists():
        return []
    result = []
    for path in root.iterdir():
        if not SNAPSHOT.fullmatch(path.name) or path.is_symlink() or not path.is_dir():
            continue
        if all((path / name).is_file() and not (path / name).is_symlink() for name in ('database.sql.gz', 'application.env', 'SHA256SUMS', 'backup-info.txt')):
            result.append(path)
    return sorted(result, reverse=True)


def marker(path):
    return json.loads(private_file(path).read_text(encoding='utf-8')) if path.exists() else {}


def inspect(settings, now=None):
    now = time.time() if now is None else now
    entries = snapshots()
    latest = entries[0] if entries else None
    backup_ok = bool(latest and recent(datetime.strptime(latest.name.split('-')[0], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).isoformat(), 36 * 3600, now))
    restored = [marker(path / 'restore-verified.json') for path in entries if (path / 'restore-verified.json').exists()]
    restore_ok = any(item.get('status') == 'restored_in_isolation' and recent(item.get('verified_at'), 8 * 86400, now) for item in restored)
    offsite_path = ROOT / 'backup-offsite.conf.local'
    offsite = marker(offsite_path) if offsite_path.exists() else {}
    if not isinstance(offsite, dict) or (offsite and type(offsite.get('enabled')) is not bool):
        raise ValueError('Invalid off-server backup configuration.')
    cloud_enabled = offsite.get('enabled', False)
    local = marker(ROOT / 'backup-local-pull.conf.local')
    if not isinstance(local, dict) or (local and type(local.get('enabled')) is not bool):
        raise ValueError('Invalid PC backup configuration.')
    pc_enabled = local.get('enabled', False)
    enabled = cloud_enabled or pc_enabled
    uploaded = {'cloud': False, 'pc': False}
    for path in entries:
        receipts = []
        if cloud_enabled:
            receipts.append((marker(path / 'offsite-receipt.json'), 'uploaded_and_checksum_verified', 'cloud'))
        if pc_enabled:
            receipts.append((marker(path / 'local-copy-receipt.json'), 'copied_and_restore_verified', 'pc'))
        for receipt, status, destination in receipts:
            if receipt.get('status') == status and receipt.get('snapshot') == path.name and re.fullmatch(r'[a-f0-9]{64}', receipt.get('sha256', '')):
                # An old snapshot uploaded today is not a recent database backup.
                stamp = datetime.strptime(path.name.split('-')[0], '%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).isoformat()
                if recent(stamp, 36 * 3600, now) and recent(receipt.get('verified_at'), 36 * 3600, now):
                    uploaded[destination] = True
    offsite_ok = enabled and (not cloud_enabled or uploaded['cloud']) and (not pc_enabled or uploaded['pc'])
    failures = {'backup-stale': not backup_ok, 'restore-stale': not restore_ok,
                'offsite-configuration': bool(settings.get('require_offsite') and not enabled),
                'offsite-stale': bool(enabled and not offsite_ok)}
    return {'local_backup': 'recent' if backup_ok else 'missing_or_stale',
            'isolated_restore': 'recent' if restore_ok else 'missing_or_overdue',
            'offsite': ('verified_recently' if offsite_ok else 'missing_or_stale') if enabled else 'not_configured',
            'destination': 'local_computer' if pc_enabled else 'cloud_or_sftp' if cloud_enabled else None,
            'email_alerts': 'configured' if settings.get('enabled') else 'not_configured',
            'latest_local_snapshot': latest.name if latest else None,
            'failures': failures}


def unit_failed(unit):
    result = subprocess.run(['systemctl', 'show', unit, '--property=Result', '--value'], capture_output=True, text=True, timeout=10, check=True)
    value = result.stdout.strip()
    if not value:
        raise ValueError('A required systemd unit is missing.')
    return value != 'success'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--status', action='store_true', help='Read-only metadata status; never sends email.')
    args = parser.parse_args()
    settings = ops_alert.configuration()
    result = inspect(settings)
    if args.status:
        print(json.dumps(result, indent=2))
        return 0
    for unit in UNITS:
        result['failures'][unit] = unit_failed(unit)
    delivered = True
    for event, failed in result['failures'].items():
        delivered = ops_alert.update(event, failed, settings) and delivered
    ops_alert.update('monitor-failed', False, settings)
    print(json.dumps(result))
    return 0 if delivered else 1


if __name__ == '__main__':
    os.umask(0o077)
    try:
        sys.exit(main())
    except Exception as error:
        print('Backup monitoring failed (' + type(error).__name__ + '). Check service logs; credentials were not printed.', file=sys.stderr)
        try:
            ops_alert.update('monitor-failed', True, ops_alert.configuration())
        except Exception:
            pass
        sys.exit(1)
