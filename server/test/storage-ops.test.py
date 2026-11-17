import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import unittest
from datetime import datetime, timezone, timedelta
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parents[2] / 'deploy' / 'hostinger'


def load(name):
    spec=importlib.util.spec_from_file_location(name,SOURCE/(name+'.py'))
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='notizo-storage-test-')
        self.addCleanup(self.temp.cleanup)
        self.base=Path(self.temp.name)
        self.root=self.base/'repo'/'deploy'/'hostinger';self.root.mkdir(parents=True)
        self.offsite=load('offsite-backup');self.offsite.ROOT=self.root
        self.maintenance=load('maintenance');self.maintenance.ROOT=self.root
        self.private=self.base/'private';self.private.mkdir()

    def write(self,path,content):
        path.write_text(content,encoding='utf-8');path.chmod(0o600);return path

    def snapshot(self,days=0,suffix='fixture'):
        name=(datetime.now(timezone.utc)-timedelta(days=days)).strftime('%Y%m%dT%H%M%SZ')+'-'+suffix
        p=self.root/'backups'/'automatic'/name;p.mkdir(parents=True)
        for name,data in [('database.sql.gz',b'fixture-dump'),('application.env',b'PRIVATE_FIXTURE=secret-for-tests')]:
            (p/name).write_bytes(data)
        self.write(p/'SHA256SUMS',''.join(hashlib.sha256((p/name).read_bytes()).hexdigest()+'  '+name+'\n' for name in ('database.sql.gz','application.env')))
        self.write(p/'backup-info.txt','Fixture only\n')
        return p

    def test_backup_does_not_consume_following_pasted_shell_commands(self):
        bash=shutil.which('bash')
        if not bash and Path('C:/Program Files/Git/bin/bash.exe').exists():bash='C:/Program Files/Git/bin/bash.exe'
        if not bash:self.skipTest('Bash is required for stdin regression')
        shutil.copyfile(SOURCE/'backup.sh',self.root/'backup.sh')
        self.write(self.root/'.env','PRIVATE_FIXTURE=isolated-test-only\n')
        tools=self.base/'bin';tools.mkdir()
        docker=self.write(tools/'docker',"""#!/usr/bin/env bash
case "$*" in
  *"config --quiet"*) exit 0 ;;
  *"exec -T db"*)
    # Model Compose exec's default attachment to caller stdin.
    cat >/dev/null
    printf '%s\\n' 'CREATE TABLE `domains` (id INT);' 'CREATE TABLE `subscriptions` (id INT);'
    ;;
  *) exit 2 ;;
esac
""")
        docker.chmod(0o700)
        environment={**os.environ,'PATH':str(tools)+os.pathsep+os.environ['PATH']}
        result=subprocess.run([bash],input='set -euo pipefail\nbash backup.sh\nprintf "FOLLOW_UP_COMMAND_REACHED\\n"\n',cwd=self.root,env=environment,text=True,capture_output=True,timeout=20)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('Backup completed:',result.stdout)
        self.assertIn('FOLLOW_UP_COMMAND_REACHED',result.stdout)
        snapshots=list((self.root/'backups'/'automatic').iterdir())
        self.assertEqual(len(snapshots),1)
        self.assertTrue((snapshots[0]/'SHA256SUMS').exists())

    def test_unconfigured_backup_requires_no_tools_or_network(self):
        with patch.object(self.offsite.subprocess,'run',side_effect=AssertionError('No external calls')):
            self.offsite.run(self.base/'missing',self.root/'backup-offsite.conf.local')

    def test_retention_preview_and_minimum_snapshots_preserve_restore_and_unrelated_paths(self):
        oldest=self.snapshot(100);self.write(oldest/'restore-verified.json','{}')
        snapshots=[self.snapshot(50+i,str(i)) for i in range(10)]
        unrelated=self.root/'backups'/'deployments';unrelated.mkdir();self.write(unrelated/'keep','rollback')
        config=self.maintenance.policy();candidates=self.maintenance.prune_backups(config,False)
        self.assertEqual(len(candidates),3);self.assertTrue(all(p.exists() for p in snapshots))
        self.maintenance.prune_backups(config,True)
        self.assertEqual(sum(p.exists() for p in snapshots),7);self.assertTrue(oldest.exists());self.assertTrue((unrelated/'keep').exists())

    def test_pending_uploads_are_never_pruned(self):
        snapshots=[self.snapshot(60+i,str(i)) for i in range(10)]
        self.write(self.root/'backup-offsite.conf.local',json.dumps({'enabled':True}))
        self.assertEqual(self.maintenance.prune_backups(self.maintenance.policy(),True),[])
        self.assertTrue(all(p.exists() for p in snapshots))

    def test_unsafe_retention_values_are_rejected(self):
        for value in ({'days':1},{'minimum_local_backups':0},{'mode':'anything'},{'days':True},{'unexpected':1}):
            self.write(self.root/'maintenance.conf.local',json.dumps(value))
            with self.assertRaises(ValueError):self.maintenance.policy()

    @unittest.skipUnless(shutil.which('age') and shutil.which('age-keygen') and shutil.which('rclone'),'CI installs age and rclone for real encryption/restore tests')
    def test_real_encrypted_upload_readback_decryption_and_tamper_failure(self):
        identity=self.private/'identity.txt'
        subprocess.run(['age-keygen','-o',str(identity)],check=True,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        identity.chmod(0o600)
        public=subprocess.check_output(['age-keygen','-y',str(identity)],text=True).strip()
        recipient=self.write(self.private/'recipients.txt',public+'\n')
        rclone=self.write(self.private/'rclone.conf','[fixture]\ntype = local\n')
        remote=self.base/'remote';remote.mkdir()
        config=self.write(self.root/'backup-offsite.conf.local',json.dumps({'enabled':True,'recipient_file':str(recipient),'rclone_config':str(rclone),'remote_dir':'fixture:'+remote.as_posix()}))
        snapshot=self.snapshot()
        self.offsite.run(snapshot,config)
        archive=remote/(snapshot.name+'.tar.age')
        self.assertTrue(archive.exists());self.assertNotIn(b'PRIVATE_FIXTURE',archive.read_bytes())
        self.assertEqual(json.loads((snapshot/'offsite-receipt.json').read_text())['sha256'],hashlib.sha256(archive.read_bytes()).hexdigest())
        clear=subprocess.check_output(['age','-d','-i',str(identity),str(archive)])
        with tarfile.open(fileobj=io.BytesIO(clear)) as restored:
            self.assertEqual(set(restored.getnames()),{'database.sql.gz','application.env','SHA256SUMS','backup-info.txt'})
            self.assertEqual(restored.extractfile('application.env').read(),(snapshot/'application.env').read_bytes())
        with archive.open('ab') as stream:stream.write(b'corrupt')
        with self.assertRaises(Exception):self.offsite.run(snapshot,config)
        self.assertFalse((snapshot/'offsite-receipt.json').exists())


if __name__=='__main__':unittest.main()
