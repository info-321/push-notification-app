#!/usr/bin/env python3
"""Copy existing SMTP settings into a root-only host alert configuration."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

import ops_alert
from offsite_backup_loader import write_json

ROOT = Path(__file__).resolve().parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--to', action='append', required=True, help='Confirmed operator email; repeat for multiple recipients.')
    parser.add_argument('--require-offsite', action='store_true', help='Alert if off-server storage is not configured.')
    parser.add_argument('--replace', action='store_true', help='Explicitly replace an existing host alert configuration.')
    args = parser.parse_args()
    if os.geteuid() != 0 or ROOT != Path('/opt/push-notification-app/deploy/hostinger'):
        raise ValueError('Run from the deployed Hostinger root SSH session.')
    if any(not ops_alert.mailbox(address) for address in args.to):
        raise ValueError('Invalid operator email address.')
    target = ops_alert.CONFIG
    if target.is_symlink() or target.parent.is_symlink() or (target.exists() and not args.replace):
        raise ValueError('Configuration exists or is unsafe; review it before replacing.')
    # Compose resolves .env quoting without sourcing a shell or displaying secrets.
    result = subprocess.run(['docker', 'compose', '--project-directory', str(ROOT), '--file', str(ROOT / 'compose.yml'), '--env-file', str(ROOT / '.env'), 'config', '--format', 'json'], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, check=True, timeout=30)
    env = json.loads(result.stdout)['services']['api']['environment']
    if env.get('MAIL_ENABLED') != 'true':
        raise ValueError('Configure the existing SMTP environment first; database-only overrides are not copied.')
    settings = {'enabled': True, 'require_offsite': args.require_offsite, 'recipients': args.to,
                'smtp': {'host': env.get('SMTP_HOST'), 'port': int(env.get('SMTP_PORT', 587)), 'user': env.get('SMTP_USER'), 'password': env.get('SMTP_PASSWORD'), 'from': env.get('SMTP_FROM')}}
    # Validate before replacing the real file, then authenticate without sending.
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    import tempfile
    fd, name = tempfile.mkstemp(prefix='.alert-setup-', dir=target.parent)
    os.close(fd)
    temporary = Path(name)
    try:
        write_json(temporary, settings)
        validated = ops_alert.configuration(temporary)
        with ops_alert.smtp_session(validated['smtp']):
            pass
        os.replace(temporary, target)
    finally:
        temporary.unlink(missing_ok=True)
    print('Host backup alerts configured. SMTP authentication and TLS verified; no email was sent.')
    print('Run python3 ops_alert.py test-email and confirm the test reaches the operator mailbox.')


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except Exception as error:
        print('Alert setup failed (' + type(error).__name__ + '). Check existing SMTP configuration and use --replace only after review. No credentials were printed.', file=sys.stderr)
        sys.exit(1)
