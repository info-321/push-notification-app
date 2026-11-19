#!/usr/bin/env python3
"""Host-side backup alerts. Never include logs, dumps or credentials in email."""
import argparse
from contextlib import contextmanager
from email.message import EmailMessage
import json
import os
from pathlib import Path
import re
import smtplib
import socket
import ssl
import sys
import time

from importlib import import_module
from offsite_backup_loader import private_file, write_json

CONFIG = Path('/etc/notizo-backup/alerts.conf')
STATE = Path('/var/lib/notizo-backup/alerts')
EVENTS = {
    'push-notification-backup.service': ('Backup job failed', 'Inspect the daily backup service. A completed local snapshot may exist even if its upload failed.'),
    'push-notification-restore.service': ('Restore verification failed', 'Inspect the isolated restore-check service. Do not restore over the production database to test it.'),
    'push-notification-maintenance.service': ('Maintenance job failed', 'Inspect the retention service; do not remove snapshots manually to bypass a failed check.'),
    'backup-stale': ('No recent completed backup', 'No completed local backup less than 36 hours old was found.'),
    'restore-stale': ('Restore verification is overdue', 'No successful isolated restore check less than eight days old was found.'),
    'offsite-stale': ('Off-server backup verification is overdue', 'No recent verified external copy was found. Check the scheduled PC download or configured upload destination. VPS-only backups do not protect against loss of this server.'),
    'offsite-configuration': ('Off-server backup is required but not configured', 'Finish the private off-server storage configuration.'),
    'monitor-failed': ('Backup health check failed', 'Inspect push-notification-backup-health.service. Backup protection could not be assessed.'),
}


def mailbox(value):
    return isinstance(value, str) and len(value) <= 254 and bool(re.fullmatch(r'[A-Za-z0-9_+%.-]{1,64}@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', value)) and not any(x in value for x in ('..', '.@')) and not value.startswith('.')


def configuration(path=CONFIG):
    if not path.exists():
        return {'enabled': False, 'require_offsite': False}
    data = json.loads(private_file(path).read_text(encoding='utf-8'))
    if not isinstance(data, dict) or set(data) - {'enabled', 'require_offsite', 'smtp', 'recipients'} or type(data.get('enabled')) is not bool or type(data.get('require_offsite', False)) is not bool:
        raise ValueError('Invalid alert configuration.')
    if not data['enabled']:
        return data
    smtp = data.get('smtp', {})
    if not isinstance(smtp, dict) or set(smtp) != {'host', 'port', 'user', 'password', 'from'} or type(smtp['port']) is not int or smtp['port'] not in (465, 587):
        raise ValueError('Use authenticated TLS SMTP on port 465 or 587.')
    if not all(isinstance(smtp[k], str) and smtp[k] for k in ('host', 'user', 'password', 'from')) or not mailbox(smtp['from']) or re.search(r'[\s\x00]', smtp['host']):
        raise ValueError('Complete the private SMTP settings.')
    recipients = data.get('recipients')
    if not isinstance(recipients, list) or not 1 <= len(recipients) <= 5 or not all(mailbox(address) for address in recipients) or len(set(recipients)) != len(recipients):
        raise ValueError('Configure one to five distinct alert mailboxes.')
    return data


def smtp_session(settings):
    context = ssl.create_default_context()
    if settings['port'] == 465:
        connection = smtplib.SMTP_SSL(settings['host'], 465, timeout=10, context=context)
    else:
        connection = smtplib.SMTP(settings['host'], 587, timeout=10)
        try:
            connection.ehlo()
            connection.starttls(context=context)
            connection.ehlo()
        except Exception:
            connection.close()
            raise
    try:
        connection.login(settings['user'], settings['password'])
    except Exception:
        connection.close()
        raise
    return connection


def send(settings, event, recovery=False, test=False):
    if not settings['enabled']:
        return False
    title, instructions = EVENTS[event]
    message = EmailMessage()
    message['From'] = settings['smtp']['from']
    message['To'] = ', '.join(settings['recipients'])
    message['Subject'] = '[Notizo] ' + ('Test backup alert' if test else 'Recovered: ' + title if recovery else title)
    message['Auto-Submitted'] = 'auto-generated'
    message.set_content(('This is a requested test. No production job was failed.\n\n' if test else '') +
                        ('The monitored condition is healthy again.\n\n' if recovery else '') +
                        f'Server: {socket.gethostname()}\nCheck: {event}\nTime (UTC): {time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime())}\n\n' +
                        instructions + '\n\nUse your Hostinger SSH session to inspect systemctl --failed and journalctl. This email contains no backup data or credentials.')
    with smtp_session(settings['smtp']) as connection:
        refused = connection.send_message(message)
        if refused:
            raise RuntimeError('An alert recipient was refused.')
    return True


@contextmanager
def locked_state():
    if STATE.is_symlink():
        raise ValueError('Invalid alert state directory.')
    STATE.mkdir(parents=True, mode=0o700, exist_ok=True)
    os.chmod(STATE, 0o700)
    lock = STATE / '.lock'
    if lock.is_symlink():
        raise ValueError('Invalid alert lock.')
    with lock.open('a') as stream:
        os.chmod(lock, 0o600)
        if os.name != 'nt':
            import_module('fcntl').flock(stream, import_module('fcntl').LOCK_EX)
        try:
            yield
        finally:
            if os.name != 'nt':
                import_module('fcntl').flock(stream, import_module('fcntl').LOCK_UN)


def update(event, failed, settings, now=None):
    if event not in EVENTS:
        raise ValueError('Unknown backup alert.')
    now = time.time() if now is None else now
    with locked_state():
        path = STATE / (event + '.json')
        previous = json.loads(private_file(path).read_text(encoding='utf-8')) if path.exists() else {}
        active = previous.get('active', False)
        # Failures are sent immediately, then at most daily while unresolved.
        # Failed deliveries stay queued for the next half-hour health check.
        changed = active != failed
        pending = bool(previous.get('pending')) or changed or (failed and now - previous.get('sent_at', 0) >= 86400)
        if not failed and not active and not previous.get('pending'):
            return True
        record = {'active': failed, 'pending': pending, 'sent_at': previous.get('sent_at', 0), 'updated_at': now}
        if pending and (failed or previous.get('sent_at', 0)):
            try:
                if send(settings, event, recovery=not failed):
                    record.update(pending=False, sent_at=now)
                else:
                    print('Email alerts are not configured; incident retained locally.', file=sys.stderr)
            except Exception as error:
                print('Backup alert delivery failed (' + type(error).__name__ + '); queued for retry.', file=sys.stderr)
        elif not failed:
            record['pending'] = False
        write_json(path, record)
        return not record['pending']


def retry(settings):
    for event in EVENTS:
        path = STATE / (event + '.json')
        if path.exists():
            record = json.loads(private_file(path).read_text(encoding='utf-8'))
            if record.get('pending'):
                update(event, bool(record.get('active')), settings)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['failure', 'check', 'test-email'])
    parser.add_argument('unit', nargs='?')
    args = parser.parse_args()
    settings = configuration()
    if args.command == 'failure':
        if args.unit not in EVENTS:
            raise ValueError('Unknown failed unit.')
        return 0 if update(args.unit, True, settings) else 1
    if not settings['enabled']:
        raise ValueError('Configure host SMTP alerts first.')
    if args.command == 'check':
        with smtp_session(settings['smtp']):
            pass
        print('Host SMTP authentication and TLS verified. No email was sent.')
    else:
        send(settings, 'monitor-failed', test=True)
        print('Test alert accepted by SMTP. Confirm receipt in the configured mailbox.')
    return 0


if __name__ == '__main__':
    os.umask(0o077)
    try:
        sys.exit(main())
    except Exception as error:
        print('Backup alert operation failed (' + type(error).__name__ + '). Check the private configuration; credentials were not printed.', file=sys.stderr)
        sys.exit(1)
