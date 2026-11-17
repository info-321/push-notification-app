#!/usr/bin/env python3
"""Encrypt an existing checked snapshot, upload it, then verify remote bytes.

Uses age public recipients and an administrator's private rclone configuration.
No decryption identity or destination credentials are written into the archive.
Disabled until backup-offsite.conf.local is configured; no account is created.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent


def private_file(path):
    path = Path(path)
    if not path.is_absolute() or path.is_symlink() or not path.is_file():
        raise ValueError('Configuration paths must be absolute regular files.')
    if os.name != 'nt' and (path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077):
        raise ValueError('Private configuration files must be owned by this user and mode 600.')
    return path


def fingerprint(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    fd, name = tempfile.mkstemp(prefix='.status-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2)
        os.chmod(name, 0o600)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def run(snapshot, config):
    if not config.exists():
        print('Off-server backup is not configured; local backup remains available.')
        return
    settings = json.loads(private_file(config).read_text(encoding='utf-8'))
    allowed = {'enabled', 'recipient_file', 'rclone_config', 'remote_dir'}
    if not isinstance(settings, dict) or set(settings) - allowed or not isinstance(settings.get('enabled'), bool):
        raise ValueError('Invalid off-server backup configuration.')
    if not settings['enabled']:
        print('Off-server backup is disabled; local backup remains available.')
        return
    recipient = private_file(settings['recipient_file'])
    rclone_config = private_file(settings['rclone_config'])
    # The configuration/recipient files must live outside the repository and
    # snapshots, so an .env backup cannot accidentally include upload credentials.
    for path in (recipient, rclone_config):
        if path.resolve().is_relative_to(ROOT.parent.parent):
            raise ValueError('Keep backup credentials and recipients outside the application checkout.')
    remote = settings['remote_dir']
    if not isinstance(remote, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]*:[^\r\n\x00]+', remote):
        raise ValueError('Choose a named rclone remote and dedicated backup directory.')
    for tool in ('age', 'rclone'):
        if not shutil.which(tool):
            raise ValueError('Install age and rclone before enabling off-server backups.')
    snapshot = snapshot.resolve()
    if snapshot.parent != ROOT / 'backups' / 'automatic' or not re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9]+', snapshot.name):
        raise ValueError('Choose a completed backup directly in backups/automatic.')
    files = [snapshot / name for name in ('database.sql.gz', 'application.env', 'SHA256SUMS', 'backup-info.txt')]
    (snapshot / 'offsite-receipt.json').unlink(missing_ok=True)
    if any(path.is_symlink() or not path.is_file() for path in files):
        raise ValueError('The local snapshot is incomplete or contains symbolic links.')
    manifest = {}
    for line in files[2].read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  (database\.sql\.gz|application\.env)', line)
        if not match:
            raise ValueError('Invalid local backup manifest.')
        manifest[match[2]] = match[1]
    if len(manifest) != 2 or any(fingerprint(snapshot / name) != digest for name, digest in manifest.items()):
        raise ValueError('Local backup checksum failed; nothing was uploaded.')
    encrypted = snapshot / 'snapshot.tar.age'
    seal = snapshot / 'encrypted-checksum.json'
    if not encrypted.exists():
        fd, temporary = tempfile.mkstemp(prefix='.encrypted-', dir=snapshot)
        try:
            with os.fdopen(fd, 'wb') as out:
                child = subprocess.Popen(['age', '-R', str(recipient)], stdin=subprocess.PIPE, stdout=out, stderr=subprocess.DEVNULL)
                try:
                    with tarfile.open(fileobj=child.stdin, mode='w|') as archive:
                        for path in files:
                            archive.add(path, arcname=path.name, recursive=False)
                    child.stdin.close()
                    if child.wait(timeout=300) != 0:
                        raise RuntimeError('Backup encryption failed.')
                finally:
                    if child.poll() is None:
                        child.kill()
                        child.wait()
            os.chmod(temporary, 0o600)
            os.replace(temporary, encrypted)
            write_json(seal, {'sha256':fingerprint(encrypted)})
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
    if encrypted.is_symlink() or not encrypted.is_file():
        raise ValueError('Invalid encrypted snapshot path.')
    if seal.is_symlink() or not seal.is_file() or json.loads(seal.read_text(encoding='utf-8')).get('sha256') != fingerprint(encrypted):
        raise ValueError('The encrypted snapshot changed. Retain the original local dump and investigate before retrying.')
    expected = fingerprint(encrypted)
    target = remote.rstrip('/') + '/' + snapshot.name + '.tar.age'
    options = ['--config', str(rclone_config), '--contimeout', '20s', '--timeout', '2m', '--retries', '3']
    subprocess.run(['rclone', 'copyto', str(encrypted), target, '--immutable', *options], check=True,
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=900)
    if fingerprint(encrypted) != expected:
        raise RuntimeError('The encrypted snapshot changed during upload.')
    h = hashlib.sha256()
    child = subprocess.Popen(['rclone', 'cat', target, *options], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        for block in iter(lambda: child.stdout.read(1024 * 1024), b''):
            h.update(block)
        if child.wait(timeout=900) != 0 or h.hexdigest() != expected:
            raise RuntimeError('Remote backup checksum failed.')
    finally:
        child.stdout.close()
        if child.poll() is None:
            child.kill()
            child.wait()
    write_json(snapshot / 'offsite-receipt.json', {'sha256':expected, 'verified_at':datetime.now(timezone.utc).isoformat(),
               'snapshot':snapshot.name, 'status':'uploaded_and_checksum_verified'})
    print('Encrypted off-server backup uploaded and its full checksum verified.')


if __name__ == '__main__':
    os.umask(0o077)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('snapshot', type=Path)
    args = parser.parse_args()
    try:
        run(args.snapshot, ROOT / 'backup-offsite.conf.local')
    except Exception as error:
        # Tool stderr and exception representations can include remote credentials.
        print('Off-server backup failed (' + type(error).__name__ + '). Check configuration and connectivity; local snapshot retained.', file=sys.stderr)
        sys.exit(1)
