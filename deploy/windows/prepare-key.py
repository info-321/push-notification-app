"""Generate a dedicated, unattended SSH key without Windows shell quoting."""
import pathlib
import subprocess
import sys

keygen, destination = sys.argv[1:]
if pathlib.Path(destination).exists():
    raise SystemExit('An existing backup key is never overwritten.')
subprocess.run([keygen, '-q', '-t', 'ed25519', '-N', '', '-C', 'notizo-local-backup', '-f', destination], check=True)
