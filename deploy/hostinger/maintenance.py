#!/usr/bin/env python3
"""Bounded database retention, then conservative local backup retention.

No remote objects or deployment rollback directories are removed. An offsite
configuration requires an upload receipt before an old local snapshot is pruned.
"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parent
DEFAULT = {'mode':'apply','days':90,'auditDays':365,'batch':500,'maxBatches':20,
           'local_backup_days':30,'minimum_local_backups':7}


def policy():
    path=ROOT/'maintenance.conf.local'
    config=DEFAULT.copy()
    if path.exists():
        if path.is_symlink() or not path.is_file():raise ValueError('Invalid retention policy file.')
        value=json.loads(path.read_text(encoding='utf-8'))
        if not isinstance(value,dict) or set(value)-set(DEFAULT):raise ValueError('Unknown retention policy field.')
        config.update(value)
    if config['mode'] not in ('apply','preview'):raise ValueError('Choose apply or preview mode.')
    for key,lo,hi in [('days',90,3650),('auditDays',365,3650),('batch',1,1000),('maxBatches',1,100),('local_backup_days',7,3650),('minimum_local_backups',7,1000)]:
        if type(config[key]) is not int or not lo<=config[key]<=hi:raise ValueError('Invalid retention policy: '+key)
    return config


def prune_backups(config, apply):
    root=ROOT/'backups'/'automatic'
    if root.is_symlink():raise ValueError('Backup directory must not be a symbolic link.')
    if not root.exists():return []
    root=root.resolve()
    import re
    entries=sorted((p for p in root.iterdir() if re.fullmatch(r'20[0-9]{6}T[0-9]{6}Z-[A-Za-z0-9]+',p.name) and not p.is_symlink() and p.is_dir()
                    and all((p/name).is_file() and not (p/name).is_symlink() for name in ('SHA256SUMS','database.sql.gz','application.env'))),reverse=True)
    # Always retain at least seven complete snapshots, the newest restored
    # snapshot, and every snapshot not yet uploaded when offsite mode is enabled.
    protected=set(entries[:config['minimum_local_backups']])
    restored=next((p for p in entries if (p/'restore-verified.json').is_file()),None)
    if restored:protected.add(restored)
    offsite=False
    if (ROOT/'backup-offsite.conf.local').exists():
        offsite=json.loads((ROOT/'backup-offsite.conf.local').read_text(encoding='utf-8')).get('enabled',False)
    removed=[]
    cutoff=time.time()-config['local_backup_days']*86400
    for entry in entries:
        stamp=datetime.strptime(entry.name.split('-')[0],'%Y%m%dT%H%M%SZ').replace(tzinfo=timezone.utc).timestamp()
        if entry in protected or stamp>=cutoff:continue
        # A missing verification marker means this snapshot is never eligible.
        if not (entry/'SHA256SUMS').is_file() or not (entry/'database.sql.gz').is_file() or not (entry/'application.env').is_file():continue
        if offsite:
            receipt=entry/'offsite-receipt.json'
            if not receipt.is_file() or json.loads(receipt.read_text(encoding='utf-8')).get('status')!='uploaded_and_checksum_verified':continue
        resolved=entry.resolve()
        if resolved.parent!=root or entry.is_symlink():raise ValueError('Unsafe backup deletion target.')
        if apply:shutil.rmtree(resolved)
        removed.append(entry.name)
    return removed


if __name__=='__main__':
    os.umask(0o077)
    try:
        if sys.argv[1:] not in ([],['--preview']):raise ValueError('Usage: python3 maintenance.py [--preview]')
        config=policy();apply=config['mode']=='apply' and '--preview' not in sys.argv
        if apply:
            # Cleanup requires a recent successful local snapshot. Never delete
            # detail merely because the daily backup job failed or was disabled.
            import hashlib
            snapshots=sorted((ROOT/'backups'/'automatic').glob('20*'),reverse=True)
            recent=next((p for p in snapshots if not p.is_symlink() and (p/'SHA256SUMS').is_file()),None)
            if recent is None or time.time()-(recent/'SHA256SUMS').stat().st_mtime>36*3600:
                raise ValueError('A checked backup less than 36 hours old is required before cleanup.')
            manifest=(recent/'SHA256SUMS').read_text(encoding='utf-8').splitlines()
            if len(manifest)!=2:raise ValueError('Incomplete backup manifest.')
            names=set()
            for line in manifest:
                digest,name=line.split('  ',1)
                if name not in ('database.sql.gz','application.env') or (recent/name).is_symlink():raise ValueError('Invalid backup manifest.')
                names.add(name)
                h=hashlib.sha256()
                with (recent/name).open('rb') as stream:
                    for block in iter(lambda:stream.read(1024*1024),b''):h.update(block)
                if h.hexdigest()!=digest:raise ValueError('Backup checksum failed; cleanup was skipped.')
            if names!={'database.sql.gz','application.env'}:raise ValueError('Incomplete backup manifest.')
        command=['docker','compose','--project-directory',str(ROOT),'--file',str(ROOT/'compose.yml'),'--env-file',str(ROOT/'.env'),'exec','-T','api','node','maintenance.js']
        command += [f'--{key}={config[key]}' for key in ('days','auditDays','batch','maxBatches')]
        if apply:command.append('--apply')
        subprocess.run(command,check=True,timeout=900)
        removed=prune_backups(config,apply)
        print(json.dumps({'local_backup_cleanup':'applied' if apply else 'preview','eligible_snapshots':len(removed)}))
    except Exception as error:
        print('Maintenance failed ('+type(error).__name__+'). Check the maintenance service; no credentials were printed.',file=sys.stderr)
        sys.exit(1)
