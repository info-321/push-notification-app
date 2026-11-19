import contextlib
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO / 'deploy' / 'hostinger'))
import ops_alert
import backup_health
import offsite_backup_loader


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BackupMonitoringTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='notizo-monitor-test-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base / 'repo' / 'deploy' / 'hostinger'
        self.root.mkdir(parents=True)
        self.addCleanup(patch.stopall)
        patch.object(backup_health, 'ROOT', self.root).start()
        patch.object(ops_alert, 'STATE', self.base / 'state').start()
        patch.object(offsite_backup_loader.module, 'ROOT', self.root).start()
        self.export = load('backup_export_fixture', REPO / 'deploy' / 'hostinger' / 'backup-export.py')
        self.export.ROOT = self.root
        self.pc = load('pc_backup_fixture', REPO / 'deploy' / 'windows' / 'pull-backups.py')
        self.settings = {'enabled': True, 'require_offsite': True, 'recipients': ['operator@example.test'],
                         'smtp': {'host': 'smtp.example.test', 'port': 587, 'user': 'fixture', 'password': 'NEVER_PRINT_THIS', 'from': 'sender@example.test'}}

    def write(self, path, value):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value) if isinstance(value, dict) else value, encoding='utf-8')
        path.chmod(0o600)
        return path

    def snapshot(self, days=0, suffix='fixture'):
        date = datetime.now(timezone.utc) - timedelta(days=days)
        path = self.root / 'backups' / 'automatic' / (date.strftime('%Y%m%dT%H%M%SZ') + '-' + suffix)
        path.mkdir(parents=True)
        self.write(path / 'database.sql.gz', 'fixture-dump')
        self.write(path / 'application.env', 'PRIVATE_FIXTURE=not-a-real-secret')
        self.write(path / 'backup-info.txt', 'fixture metadata')
        self.write(path / 'SHA256SUMS', ''.join(hashlib.sha256((path / name).read_bytes()).hexdigest() + '  ' + name + '\n' for name in ('database.sql.gz', 'application.env')))
        return path

    def test_alerts_validate_configuration_and_reject_header_injection(self):
        path = self.write(self.base / 'alerts.conf', self.settings)
        self.assertTrue(ops_alert.configuration(path)['enabled'])
        for bad in ['a@example.test\nBcc:evil@example.test', 'not-an-email']:
            self.write(path, {**self.settings, 'recipients': [bad]})
            with self.assertRaises(ValueError):
                ops_alert.configuration(path)
        self.assertFalse(ops_alert.configuration(self.base / 'missing.conf')['enabled'])

    def test_alerts_are_deduplicated_and_send_recovery_once(self):
        with patch.object(ops_alert, 'send', return_value=True) as send:
            ops_alert.update('backup-stale', True, self.settings, now=100000)
            ops_alert.update('backup-stale', True, self.settings, now=100010)
            self.assertEqual(send.call_count, 1)
            ops_alert.update('backup-stale', True, self.settings, now=190000)
            self.assertEqual(send.call_count, 2)
            ops_alert.update('backup-stale', False, self.settings, now=190010)
            self.assertTrue(send.call_args.kwargs['recovery'])
            ops_alert.update('backup-stale', False, self.settings, now=190020)
            self.assertEqual(send.call_count, 3)

    def test_failed_mail_is_queued_without_logging_the_provider_error(self):
        output = io.StringIO()
        with patch.object(ops_alert, 'send', side_effect=RuntimeError('NEVER_PRINT_THIS')), contextlib.redirect_stderr(output):
            self.assertFalse(ops_alert.update('backup-stale', True, self.settings))
        self.assertNotIn('NEVER_PRINT_THIS', output.getvalue())
        state = ops_alert.STATE / 'backup-stale.json'
        self.assertTrue(json.loads(state.read_text())['pending'])
        with patch.object(ops_alert, 'send', return_value=True):
            self.assertTrue(ops_alert.update('backup-stale', True, self.settings))
        self.assertFalse(json.loads(state.read_text())['pending'])

    def test_smtp_requires_tls_and_does_not_include_logs_or_credentials(self):
        with patch.object(ops_alert.smtplib, 'SMTP') as smtp:
            connection = smtp.return_value
            connection.__enter__.return_value = connection
            connection.send_message.return_value = {}
            ops_alert.send(self.settings, 'backup-stale')
            connection.starttls.assert_called_once()
            connection.login.assert_called_once_with('fixture', 'NEVER_PRINT_THIS')
            message = connection.send_message.call_args.args[0]
            self.assertNotIn('NEVER_PRINT_THIS', message.as_string())
            self.assertIn('operator@example.test', message['To'])
        with patch.object(ops_alert.smtplib, 'SMTP') as smtp:
            smtp.return_value.starttls.side_effect = RuntimeError('TLS failed')
            with self.assertRaises(RuntimeError):
                ops_alert.smtp_session(self.settings['smtp'])
            smtp.return_value.login.assert_not_called()

    def test_pc_preparation_does_not_count_as_an_off_server_copy(self):
        snapshot = self.snapshot()
        self.write(snapshot / 'restore-verified.json', {'status': 'restored_in_isolation', 'verified_at': datetime.now(timezone.utc).isoformat()})
        self.write(self.root / 'backup-local-pull.conf.local', {'enabled': True, 'recipient_file': '/private/public.txt'})
        status = backup_health.inspect(self.settings)
        self.assertEqual(status['local_backup'], 'recent')
        self.assertEqual(status['isolated_restore'], 'recent')
        self.assertTrue(status['failures']['offsite-stale'])
        self.write(snapshot / 'local-copy-receipt.json', {'snapshot': snapshot.name, 'sha256': 'a' * 64, 'status': 'copied_and_restore_verified', 'verified_at': datetime.now(timezone.utc).isoformat()})
        self.assertEqual(backup_health.inspect(self.settings)['offsite'], 'verified_recently')

    def test_old_snapshots_are_not_made_fresh_by_a_new_copy_receipt(self):
        snapshot = self.snapshot(days=3)
        self.write(self.root / 'backup-local-pull.conf.local', {'enabled': True})
        self.write(snapshot / 'local-copy-receipt.json', {'snapshot': snapshot.name, 'sha256': 'a' * 64, 'status': 'copied_and_restore_verified', 'verified_at': datetime.now(timezone.utc).isoformat()})
        status = backup_health.inspect(self.settings)
        self.assertTrue(status['failures']['backup-stale'])
        self.assertTrue(status['failures']['offsite-stale'])
        self.assertTrue(status['failures']['restore-stale'])

    def test_required_missing_destination_is_not_reported_as_healthy(self):
        self.snapshot()
        status = backup_health.inspect(self.settings)
        self.assertEqual(status['offsite'], 'not_configured')
        self.assertTrue(status['failures']['offsite-configuration'])

    def test_restricted_export_rejects_shell_commands_traversal_and_bad_receipts(self):
        snapshot = self.snapshot()
        content = b'encrypted-fixture'
        encrypted = snapshot / 'ciphertext' / (snapshot.name + '.tar.age')
        encrypted.parent.mkdir()
        encrypted.write_bytes(content)
        checksum = hashlib.sha256(content).hexdigest()
        self.write(snapshot / 'encrypted-checksum.json', {'sha256': checksum})
        with patch.object(self.export, 'configuration', return_value={'enabled': True}):
            for command in [[], ['bash'], ['get', '../../application.env'], ['list', '; whoami'], ['receipt', snapshot.name, 'wrong']]:
                with self.assertRaises(ValueError):
                    self.export.serve(command)
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                self.export.serve(['list'])
            self.assertNotIn('PRIVATE_FIXTURE', output.getvalue())
            self.assertFalse(json.loads(output.getvalue())['snapshots'][0]['copied'])
            with contextlib.redirect_stdout(io.StringIO()):
                self.export.serve(['receipt', snapshot.name, checksum])
            self.assertTrue((snapshot / 'local-copy-receipt.json').exists())

    def test_corrupt_pc_download_is_never_acknowledged_or_installed(self):
        identity = self.write(self.base / 'age.txt', 'fixture-only')
        config = {'destination': str(self.base / 'downloads'), 'age_identity': str(identity)}
        row = {'snapshot': self.snapshot().name, 'sha256': 'a' * 64, 'bytes': 10}
        def download(*args, **kwargs):
            kwargs['stdout'].write(b'bad')
        with patch.object(self.pc, 'ssh', return_value=['fixture']), patch.object(self.pc, 'metadata', return_value={'snapshots': [row]}) as metadata, patch.object(self.pc.subprocess, 'run', side_effect=download):
            with self.assertRaises(ValueError):
                self.pc.pull(config)
            self.assertEqual(metadata.call_count, 1)
        self.assertEqual(list((self.base / 'downloads').glob('*.tar.age')), [])
        self.assertEqual(list((self.base / 'downloads').glob('*.partial')), [])

    def test_pending_pc_copies_prevent_local_retention(self):
        maintenance = load('maintenance_monitor_fixture', REPO / 'deploy' / 'hostinger' / 'maintenance.py')
        maintenance.ROOT = self.root
        entries = [self.snapshot(days=50+i, suffix=str(i)) for i in range(10)]
        self.write(self.root / 'backup-local-pull.conf.local', {'enabled': True})
        self.assertEqual(maintenance.prune_backups(maintenance.policy(), True), [])
        self.assertTrue(all(path.exists() for path in entries))

    def test_pc_receipt_is_sent_only_after_decryption_verification(self):
        identity = self.write(self.base / 'pc-identity.txt', 'fixture-identity')
        folder = self.base / 'pc-copies'
        folder.mkdir()
        name = self.snapshot().name
        target = folder / (name + '.tar.age')
        target.write_bytes(b'encrypted-fixture')
        checksum = hashlib.sha256(target.read_bytes()).hexdigest()
        events = []
        def metadata(command, operation):
            if operation == 'list':
                return {'snapshots': [{'snapshot': name, 'sha256': checksum, 'bytes': target.stat().st_size, 'copied': False}]}
            self.assertEqual(events, ['decrypted_and_verified'])
            self.assertEqual(operation, 'receipt ' + name + ' ' + checksum)
            events.append('acknowledged')
            return {'ok': True}
        with patch.object(self.pc, 'ssh', return_value=['fixture']), patch.object(self.pc, 'metadata', side_effect=metadata), patch.object(self.pc, 'verify_archive', side_effect=lambda *args: events.append('decrypted_and_verified')), contextlib.redirect_stdout(io.StringIO()):
            self.pc.pull({'destination': str(folder), 'age_identity': str(identity)})
        self.assertEqual(events, ['decrypted_and_verified', 'acknowledged'])
        self.assertEqual(json.loads((folder / 'status.json').read_text())['latest_snapshot'], name)

    @unittest.skipUnless(shutil.which('age') and shutil.which('age-keygen'), 'CI installs age for a real PC decryption check')
    def test_real_pc_decryption_verifies_inner_manifest_and_detects_corruption(self):
        identity = self.base / 'identity.txt'
        subprocess.run(['age-keygen', '-o', str(identity)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        identity.chmod(0o600)
        recipient = self.write(self.base / 'recipient.txt', subprocess.check_output(['age-keygen', '-y', str(identity)], text=True))
        snapshot = self.snapshot()
        archive = offsite_backup_loader.seal_snapshot(snapshot, recipient)
        config = {'age_binary': shutil.which('age'), 'age_identity': str(identity)}
        self.pc.verify_archive(archive, config)
        with archive.open('ab') as stream:
            stream.write(b'tampered')
        with self.assertRaises(Exception):
            self.pc.verify_archive(archive, config)


if __name__ == '__main__':
    unittest.main()
