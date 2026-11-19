#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
[[ $(id -u) == 0 && "$script_dir" == /opt/push-notification-app/deploy/hostinger ]] || exit 1
[[ $# == 2 && -f "$1" && ! -L "$1" && -f "$2" && ! -L "$2" ]] || { echo 'Usage: bash install-local-backup.sh PUBLIC_SSH_KEY PUBLIC_AGE_RECIPIENT'; exit 1; }
command -v age >/dev/null || { echo 'Install age on this VPS first: apt-get install age'; exit 1; }
ssh-keygen -l -f "$1" >/dev/null
python3 - "$1" "$2" "$script_dir" <<'VALIDATE'
import base64,json,os,pathlib,re,sys
key=pathlib.Path(sys.argv[1]).read_text().strip().split()
recipient=pathlib.Path(sys.argv[2]).read_text().strip()
if len(key) not in (2,3) or key[0]!='ssh-ed25519' or not re.fullmatch(r'age1[0-9a-z]{58}',recipient):raise SystemExit('Expected one Ed25519 public key and one public age recipient.')
base64.b64decode(key[1],validate=True)
root=pathlib.Path('/etc/notizo-backup');root.mkdir(mode=0o700,exist_ok=True)
if root.is_symlink():raise SystemExit('Unsafe private configuration directory.')
dest=root/'local-recipient.txt'
if dest.is_symlink() or (dest.exists() and dest.read_text().strip()!=recipient):raise SystemExit('An existing different encryption recipient must not be overwritten. Review key rotation first.')
dest.write_text(recipient+'\n');dest.chmod(0o600)
ssh=pathlib.Path('/root/.ssh');ssh.mkdir(mode=0o700,exist_ok=True)
authorized=ssh/'authorized_keys'
if ssh.is_symlink() or authorized.is_symlink():raise SystemExit('Unsafe SSH paths.')
existing=authorized.read_text() if authorized.exists() else ''
entry='restrict,command="/usr/local/sbin/notizo-backup-export" '+key[0]+' '+key[1]+' notizo-local-backup'
matches=[line for line in existing.splitlines() if key[1] in line.split()]
if matches and matches!=[entry]:raise SystemExit('This key already has different SSH access; use a new dedicated backup key.')
if not matches:
 with authorized.open('a') as stream:stream.write(('\n' if existing and not existing.endswith('\n') else '')+entry+'\n')
authorized.chmod(0o600)
config=pathlib.Path(sys.argv[3])/'backup-local-pull.conf.local'
if config.is_symlink():raise SystemExit('Unsafe backup configuration.')
config.write_text(json.dumps({'enabled':True,'recipient_file':str(dest)},indent=2)+'\n');config.chmod(0o600)
VALIDATE
install -o root -g root -m 750 "$script_dir/backup-export-command.sh" /usr/local/sbin/notizo-backup-export
printf 'Restricted encrypted downloads enabled. Prepare a new backup, then run the PC download and confirm its receipt.\n'
