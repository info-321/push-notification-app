#!/usr/bin/env python3
"""Restricted SSH download interface. Serves encrypted snapshots, never a shell."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import shlex
import sys

from offsite_backup_loader import private_file, write_json, seal_snapshot, fingerprint

ROOT = Path(__file__).resolve().parent
NAME = re.compile(r'20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9]+')


def configuration():
    path = ROOT / 'backup-local-pull.conf.local'
    if not path.exists():
        return {'enabled': False}
    data = json.loads(private_file(path).read_text(encoding='utf-8'))
    if not isinstance(data, dict) or set(data) - {'enabled', 'recipient_file'} or type(data.get('enabled')) is not bool:
        raise ValueError('Invalid PC backup configuration.')
    if data['enabled']:
        private_file(Path(data['recipient_file']))
    return data


def archive(name, verify=True):
    if not NAME.fullmatch(name):
        raise ValueError('Invalid snapshot name.')
    snapshot = ROOT / 'backups' / 'automatic' / name
    encrypted = snapshot / 'ciphertext' / (name + '.tar.age')
    if any(p.is_symlink() for p in (ROOT / 'backups', snapshot.parent, snapshot, encrypted.parent, encrypted)):
        raise ValueError('Unsafe encrypted export.')
    seal = json.loads(private_file(snapshot / 'encrypted-checksum.json').read_text(encoding='utf-8'))
    if not re.fullmatch(r'[a-f0-9]{64}', seal.get('sha256', '')) or not encrypted.is_file() or (verify and fingerprint(encrypted) != seal['sha256']):
        raise ValueError('Encrypted export checksum failed.')
    return snapshot, encrypted, seal['sha256']


def serve(command):
    if not configuration()['enabled']:
        raise ValueError('PC backup export is not enabled.')
    if command == ['list']:
        rows = []
        root = ROOT / 'backups' / 'automatic'
        if root.is_symlink():
            raise ValueError('Unsafe snapshot root.')
        for path in sorted(root.glob('20*')):
            if not NAME.fullmatch(path.name) or path.is_symlink() or not (path / 'encrypted-checksum.json').exists():
                continue
            snapshot, encrypted, digest = archive(path.name, verify=False)
            receipt_path = snapshot / 'local-copy-receipt.json'
            receipt = json.loads(private_file(receipt_path).read_text()) if receipt_path.exists() else {}
            rows.append({'snapshot': path.name, 'sha256': digest, 'bytes': encrypted.stat().st_size,
                         'copied': receipt.get('status') == 'copied_and_restore_verified' and receipt.get('sha256') == digest})
        print(json.dumps({'snapshots': rows}))
    elif len(command) == 2 and command[0] == 'get':
        _, encrypted, _ = archive(command[1])
        with encrypted.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                sys.stdout.buffer.write(block)
    elif len(command) == 3 and command[0] == 'receipt':
        snapshot, _, digest = archive(command[1])
        if command[2] != digest:
            raise ValueError('Download receipt checksum mismatch.')
        write_json(snapshot / 'local-copy-receipt.json', {'snapshot': snapshot.name, 'sha256': digest,
                   'verified_at': datetime.now(timezone.utc).isoformat(), 'status': 'copied_and_restore_verified'})
        print(json.dumps({'ok': True}))
    else:
        raise ValueError('Only list, get and checksum receipt operations are permitted.')


def prepare(snapshot):
    settings = configuration()
    if settings['enabled']:
        seal_snapshot(snapshot, Path(settings['recipient_file']))
        print('Encrypted snapshot prepared for the local computer. It is not off-server until the computer downloads and verifies it.')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        if sys.argv[1:] == ['--serve']:
            serve(shlex.split(os.environ.get('SSH_ORIGINAL_COMMAND', '')))
        elif len(sys.argv) == 3 and sys.argv[1] == 'prepare':
            prepare(Path(sys.argv[2]))
        else:
            raise ValueError('Invalid backup-export invocation.')
    except Exception as error:
        print('Encrypted backup export failed (' + type(error).__name__ + '). No credentials were printed.', file=sys.stderr)
        sys.exit(1)
