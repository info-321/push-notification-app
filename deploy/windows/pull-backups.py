#!/usr/bin/env python3
"""Download encrypted Notizo backups. No database port or public backup URL."""
import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
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

NAME = re.compile(r'20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9]+')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def atomic_json(path, value):
    fd, temporary = tempfile.mkstemp(prefix='.status-', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as stream:
            json.dump(value, stream, indent=2)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def ssh(config):
    if not re.fullmatch(r'[A-Za-z0-9.-]+', config['host']) or not re.fullmatch(r'[A-Za-z0-9_-]+', config['user']):
        raise ValueError('Invalid SSH destination.')
    for key in ('ssh_key', 'known_hosts', 'age_identity', 'age_binary'):
        path = Path(config[key])
        if not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError('Complete the local key, pinned host and age setup.')
    return [config.get('ssh_binary', 'ssh'), '-T', '-i', config['ssh_key'], '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes',
            '-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=' + config['known_hosts'], '-o', 'ConnectTimeout=15',
            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4', config['user'] + '@' + config['host']]


def metadata(command, operation):
    result = subprocess.run([*command, operation], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=60)
    if len(result.stdout) > 2 * 1024 * 1024:
        raise ValueError('Backup metadata is unexpectedly large.')
    return json.loads(result.stdout)


def verify_archive(path, config):
    process = subprocess.Popen([config['age_binary'], '--decrypt', '--identity', config['age_identity'], str(path)], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    expected = {'database.sql.gz', 'application.env', 'SHA256SUMS', 'backup-info.txt'}
    seen, hashes, manifest = set(), {}, ''
    try:
        # Inspect the decrypted stream in memory. Never extract configuration or
        # subscriber data onto the computer, and never follow archive paths.
        with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
            for member in archive:
                if member.name not in expected or member.name in seen or not member.isfile():
                    raise ValueError('Unexpected backup archive entry.')
                seen.add(member.name)
                stream = archive.extractfile(member)
                if member.name == 'SHA256SUMS':
                    if member.size > 1024:
                        raise ValueError('Invalid backup manifest.')
                    manifest = stream.read().decode('utf-8')
                else:
                    h = hashlib.sha256()
                    for block in iter(lambda: stream.read(1024 * 1024), b''):
                        h.update(block)
                    hashes[member.name] = h.hexdigest()
        # Read remaining age bytes so authentication of the final encrypted
        # chunk is checked even after tar's end markers.
        while process.stdout.read(1024 * 1024):
            pass
        if process.wait(timeout=60) != 0 or seen != expected:
            raise ValueError('Backup decryption or authentication failed.')
        lines = manifest.splitlines()
        actual = {}
        for line in lines:
            match = re.fullmatch(r'([a-f0-9]{64})  (database\.sql\.gz|application\.env)', line)
            if not match or match[2] in actual:
                raise ValueError('Invalid backup manifest.')
            actual[match[2]] = match[1]
        if set(actual) != {'database.sql.gz', 'application.env'} or any(hashes[name] != value for name, value in actual.items()):
            raise ValueError('Decrypted backup checksum mismatch.')
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.kill()
            process.wait()


def pull(config):
    destination = Path(config['destination'])
    if not destination.is_absolute() or destination.is_symlink():
        raise ValueError('Choose a dedicated absolute local backup directory.')
    destination.mkdir(parents=True, exist_ok=True)
    command = ssh(config)
    rows = metadata(command, 'list').get('snapshots')
    if not isinstance(rows, list) or not rows or len(rows) > 5000:
        raise ValueError('No prepared encrypted snapshots are available yet.')
    seen = set()
    for row in rows:
        if not isinstance(row, dict) or not NAME.fullmatch(row.get('snapshot', '')) or not re.fullmatch(r'[a-f0-9]{64}', row.get('sha256', '')) or type(row.get('bytes')) is not int or not 1 <= row['bytes'] <= 10**12 or row['snapshot'] in seen:
            raise ValueError('Invalid encrypted snapshot metadata.')
        seen.add(row['snapshot'])
    count = 0
    identity_hash = digest(Path(config['age_identity']))
    for row in sorted(rows, key=lambda item: item['snapshot']):
        name = row['snapshot']
        target = destination / (name + '.tar.age')
        verified_path = target.with_suffix('.verified.json')
        if target.is_symlink():
            raise ValueError('Unsafe local archive path.')
        if not target.exists():
            if shutil.disk_usage(destination).free < row['bytes'] * 2 + 100 * 1024 * 1024:
                raise ValueError('Insufficient space for the encrypted download.')
            fd, temporary = tempfile.mkstemp(prefix='.download-', suffix='.partial', dir=destination)
            try:
                with os.fdopen(fd, 'wb') as stream:
                    subprocess.run([*command, 'get ' + name], stdout=stream, stderr=subprocess.DEVNULL, check=True, timeout=900)
                downloaded = Path(temporary)
                if downloaded.stat().st_size != row['bytes'] or digest(downloaded) != row['sha256']:
                    raise ValueError('Encrypted download checksum mismatch.')
                verify_archive(downloaded, config)
                os.replace(downloaded, target)
                count += 1
            finally:
                if Path(temporary).exists():
                    Path(temporary).unlink()
        else:
            if target.stat().st_size != row['bytes'] or digest(target) != row['sha256']:
                raise ValueError('An existing local archive changed; it was not overwritten.')
            if verified_path.is_symlink():
                raise ValueError('Unsafe local verification marker.')
            cached = json.loads(verified_path.read_text()) if verified_path.exists() else {}
            if cached.get('sha256') != row['sha256'] or cached.get('identity_sha256') != identity_hash:
                verify_archive(target, config)
        # This acknowledgement is sent only after local bytes, decryption and
        # inner manifest verification passed. It never runs production SQL.
        if not row.get('copied') and metadata(command, 'receipt ' + name + ' ' + row['sha256']).get('ok') is not True:
            raise ValueError('The server did not accept the verified-copy receipt.')
        atomic_json(verified_path, {'snapshot': name, 'sha256': row['sha256'], 'identity_sha256': identity_hash, 'verified_at': datetime.now(timezone.utc).isoformat()})
    atomic_json(destination / 'status.json', {'status': 'verified', 'checked_at': datetime.now(timezone.utc).isoformat(), 'latest_snapshot': max(seen), 'downloaded': count})
    print(f'PC backup verification passed. {count} new encrypted archive(s); local copies retained.')


@contextmanager
def single_run(directory):
    lock = directory / '.pull.lock'
    if lock.is_symlink():
        raise ValueError('Invalid local backup lock.')
    with lock.open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0)
            if stream.read(1) == b'':
                stream.write(b'0')
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            yield
        finally:
            if os.name == 'nt':
                stream.seek(0)
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    try:
        config = json.loads(args.config.read_text(encoding='utf-8-sig'))
        with single_run(args.config.parent):
            pull(config)
    except Exception as error:
        print('PC backup failed (' + type(error).__name__ + '). Check SSH authorization, pinned host key, disk space and the prepared server backup. No credentials were printed.', file=sys.stderr)
        sys.exit(1)
