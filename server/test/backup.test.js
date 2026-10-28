import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';

const source = fileURLToPath(new URL('../../deploy/hostinger/', import.meta.url));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const bashPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const id = 'a'.repeat(64);
const publicFixture = 'DB_NAME=test_database\nPUSH_API_SECRET=fixture-only-not-a-live-secret\n';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-backup-test-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), dir);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(path.basename(dir).startsWith('push-backup-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const name of ['backup.sh', 'verify-backup.sh']) fs.copyFileSync(path.join(source, name), path.join(dir, name));
  fs.writeFileSync(path.join(dir, '.env'), publicFixture);
  fs.writeFileSync(path.join(dir, 'compose.yml'), 'name: push-notification-app\n');
  const log = path.join(dir, 'docker.log');
  fs.writeFileSync(path.join(bin, 'docker'), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$TEST_LOG"
case "$1" in
  compose)
    if [[ "$*" == *'config --quiet' ]]; then exit 0; fi
    printf 'CREATE TABLE \x60domains\x60 (id INT, vapid_private_key TEXT);\\n'
    if [[ "\u0024{TEST_DUMP_MODE:-}" == fail ]]; then exit 29; fi
    if [[ "\u0024{TEST_DUMP_MODE:-}" == missing-table ]]; then exit 0; fi
    printf 'CREATE TABLE \x60subscriptions\x60 (id INT);\\n'
    printf "INSERT INTO domains VALUES (1, 'fixture-private-key');\\n"
    printf 'CREATE TABLE \x60admin_accounts\x60 (id INT, password_hash TEXT);\\n'
    printf "INSERT INTO admin_accounts VALUES (1, 'fixture-scrypt-hash');\\n"
    ;;
  run)
    printf '${id}\\n'
    ;;
  exec)
    if [[ "$*" == *'valid_admin_accounts'* ]]; then printf '1\\n'; exit 0; fi
    if [[ "$2" == -i ]]; then
      cat >/dev/null
      if [[ "\u0024{TEST_RESTORE_FAIL:-}" == yes ]]; then exit 51; fi
    fi
    ;;
  rm)
    [[ "$2" == -f && "$3" == -v && "$4" == '${id}' ]]
    ;;
  *) exit 83 ;;
esac
`, { mode: 0o755 });
  function run(script, extra = {}) {
    return spawnSync(bash, ['-c', 'export PATH="$TEST_BIN:$PATH"; exec bash "$TEST_SCRIPT"'], {
      cwd: dir,
      env: { ...process.env, TEST_BIN: bashPath(bin), TEST_LOG: bashPath(log), TEST_SCRIPT: bashPath(path.join(dir, script)), ...extra },
      encoding: 'utf8', timeout: 10000,
    });
  }
  const completed = () => {
    const root = path.join(dir, 'backups', 'automatic');
    return fs.existsSync(root) ? fs.readdirSync(root).filter(name => !name.startsWith('.')).map(name => path.join(root, name)) : [];
  };
  return { dir, log, run, completed };
}

test('backup publishes a compressed dump and private configuration only after checks pass', { skip: !fs.existsSync(bash) }, t => {
  const f = fixture(t);
  const result = f.run('backup.sh');
  assert.equal(result.status, 0, result.stderr);
  const backups = f.completed();
  assert.equal(backups.length, 1);
  const sql = gunzipSync(fs.readFileSync(path.join(backups[0], 'database.sql.gz'))).toString();
  assert.match(sql, /CREATE TABLE `domains`/);
  assert.match(sql, /CREATE TABLE `subscriptions`/);
  assert.match(sql, /CREATE TABLE `admin_accounts`/);
  assert.match(sql, /fixture-scrypt-hash/);
  assert.ok(!fs.readFileSync(f.log, 'utf8').includes('"$MYSQL_DATABASE" domains subscriptions'), 'Backups must include account storage, not just the original two tables');
  assert.equal(fs.readFileSync(path.join(backups[0], 'application.env'), 'utf8'), publicFixture);
  assert.ok(fs.existsSync(path.join(backups[0], 'SHA256SUMS')));
  assert.ok(!result.stdout.includes('fixture-private-key'));
  assert.ok(!result.stdout.includes('fixture-only-not-a-live-secret'));
  assert.ok(!result.stdout.includes('fixture-scrypt-hash'));
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(backups[0]).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(backups[0], 'application.env')).mode & 0o777, 0o600);
  }
});

for (const mode of ['fail', 'missing-table']) {
  test(`backup does not publish a successful snapshot when the dump is ${mode}`, { skip: !fs.existsSync(bash) }, t => {
    const f = fixture(t);
    const result = f.run('backup.sh', { TEST_DUMP_MODE: mode });
    assert.notEqual(result.status, 0);
    assert.deepEqual(f.completed(), []);
    assert.match(result.stderr, /Backup failed/);
  });
}

test('restore verification uses only an isolated temporary container and cleans up its volume', { skip: !fs.existsSync(bash) }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh').status, 0);
  fs.writeFileSync(f.log, '');
  const result = f.run('verify-backup.sh');
  assert.equal(result.status, 0, result.stderr);
  const calls = fs.readFileSync(f.log, 'utf8');
  assert.match(calls, /run -d --network none --memory 1g --cpus 1/);
  assert.ok(!calls.includes('compose'));
  assert.ok(!calls.includes('--volume') && !calls.includes('--mount'));
  assert.match(calls, new RegExp(`rm -f -v ${id}`));
  assert.match(result.stdout, /Restore check passed/);
});

test('a modified backup is rejected before any restore container starts', { skip: !fs.existsSync(bash) }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh').status, 0);
  fs.appendFileSync(path.join(f.completed()[0], 'application.env'), 'CORRUPTED=yes\n');
  fs.writeFileSync(f.log, '');
  const result = f.run('verify-backup.sh');
  assert.notEqual(result.status, 0);
  assert.equal(fs.readFileSync(f.log, 'utf8'), '');
});

test('a failed restore still removes only the temporary restore container', { skip: !fs.existsSync(bash) }, t => {
  const f = fixture(t);
  assert.equal(f.run('backup.sh').status, 0);
  fs.writeFileSync(f.log, '');
  const result = f.run('verify-backup.sh', { TEST_RESTORE_FAIL: 'yes' });
  assert.notEqual(result.status, 0);
  const calls = fs.readFileSync(f.log, 'utf8');
  assert.ok(!calls.includes('compose'));
  assert.match(calls, new RegExp(`rm -f -v ${id}`));
  assert.ok(!result.stdout.includes('Restore check passed'));
});
