import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../../deploy/hostinger/', import.meta.url));
const bash = process.platform === 'win32' ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
const available = fs.existsSync(bash);
const bashPath = value => value.replaceAll('\\', '/').replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
const realGit = available ? spawnSync(bash, ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim() : '';

function git(cwd, ...args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t, change = 'app') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-deploy-test-'));
  t.after(() => {
    const relative = path.relative(os.tmpdir(), dir);
    assert.ok(!relative.startsWith('..') && !path.isAbsolute(relative));
    assert.ok(path.basename(dir).startsWith('push-deploy-test-'));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const remote = path.join(dir, 'remote');
  const checkout = path.join(dir, 'checkout');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(remote);
  fs.mkdirSync(bin);
  fs.mkdirSync(path.join(remote, 'deploy/hostinger'), { recursive: true });
  fs.mkdirSync(path.join(remote, 'server/db'), { recursive: true });
  fs.writeFileSync(path.join(remote, '.gitignore'), '.env\nbackups/\n');
  fs.writeFileSync(path.join(remote, 'app.txt'), 'original\n');
  fs.writeFileSync(path.join(remote, 'deploy/hostinger/compose.yml'), 'name: push-notification-app\n');
  fs.writeFileSync(path.join(remote, 'deploy/hostinger/check.mjs'), '// fixture check\n');
  fs.writeFileSync(path.join(remote, 'server/db/schema.sql'), '-- original schema\n');
  fs.writeFileSync(path.join(remote, 'deploy/hostinger/backup.sh'), '#!/usr/bin/env bash\nset -e\nprintf "backup\\n" >> "$TEST_LOG"\n[[ "${TEST_FAIL:-}" != backup ]]\n');
  git(remote, 'init', '-b', 'main');
  git(remote, 'config', 'core.autocrlf', 'false');
  git(remote, 'config', 'user.name', 'Deployment test');
  git(remote, 'config', 'user.email', 'test@example.invalid');
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'original');
  const previous = git(remote, 'rev-parse', 'HEAD');
  git(dir, '-c', 'core.autocrlf=false', 'clone', '--quiet', remote, checkout);
  git(checkout, 'config', 'core.autocrlf', 'false');
  fs.writeFileSync(path.join(checkout, 'deploy/hostinger/.env'), 'PRIVATE_FIXTURE=must-survive\n');
  if (change === 'compose') fs.appendFileSync(path.join(remote, 'deploy/hostinger/compose.yml'), '# infrastructure update\n');
  else if (change === 'schema') fs.appendFileSync(path.join(remote, 'server/db/schema.sql'), '-- schema update\n');
  else if (change === 'secret') {
    fs.writeFileSync(path.join(remote, 'deploy/hostinger/.env'), 'PRIVATE_FIXTURE=wrong-target\n');
    git(remote, 'add', '-f', 'deploy/hostinger/.env');
  } else fs.writeFileSync(path.join(remote, 'app.txt'), 'updated\n');
  git(remote, 'add', '.');
  git(remote, 'commit', '-m', 'update');
  const target = git(remote, 'rev-parse', 'HEAD');
  const entry = path.join(dir, 'entry.sh');
  fs.copyFileSync(path.join(source, 'deploy.sh'), entry);
  const log = path.join(dir, 'calls.log');
  fs.writeFileSync(log, '');
  const writeTool = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/usr/bin/env bash\nset -euo pipefail\n' + body, { mode: 0o755 });
  writeTool('git', `
printf 'git %s\\n' "$*" >> "$TEST_LOG"
if [[ "$1" == fetch ]]; then
  exec "$REAL_GIT" fetch --no-tags "$TEST_REMOTE" main:refs/remotes/origin/main
elif [[ "$1" == remote && "$2" == get-url ]]; then
  printf 'https://github.com/info-321/push-notification-app.git\\n'
else
  exec "$REAL_GIT" "$@"
fi
`);
  writeTool('flock', '[[ "${TEST_FAIL:-}" != locked ]]\n');
  writeTool('curl', 'printf "curl\\n" >> "$TEST_LOG"\n[[ "${TEST_FAIL:-}" != web ]]\n');
  writeTool('docker', `
printf 'docker %s\\n' "$*" >> "$TEST_LOG"
case "$1" in
  inspect) printf 'sha256:${'c'.repeat(64)}\\n' ;;
  image) exit 0 ;;
  compose)
    if [[ "$*" == *'ps --all --quiet api' ]]; then printf '${'a'.repeat(64)}\\n'; exit 0; fi
    if [[ "$*" == *'ps --all --quiet web' ]]; then printf '${'b'.repeat(64)}\\n'; exit 0; fi
    if [[ "$*" == *'build web' && "\u0024{TEST_FAIL:-}" == build ]]; then exit 19; fi
    if [[ "$*" == *' up '* && "$*" != *rollback.yml* && "\u0024{TEST_FAIL:-}" == cutover ]]; then exit 20; fi
    if [[ "$*" == *'exec -T api'* ]]; then
      cat >/dev/null
      [[ "\u0024{TEST_FAIL:-}" != verify ]]
    fi
    ;;
  *) exit 88 ;;
esac
`);
  function run(extra = {}, sha = target) {
    return spawnSync(bash, ['-c', 'export PATH="$TEST_BIN:$PATH"; exec bash "$TEST_ENTRY" "$TEST_SHA"'], {
      cwd: checkout,
      env: { ...process.env, SSH_ORIGINAL_COMMAND: '', TEST_BIN: bashPath(bin), TEST_ENTRY: bashPath(entry), TEST_LOG: bashPath(log), TEST_SHA: sha, TEST_REMOTE: bashPath(remote), REAL_GIT: realGit, PUSH_DEPLOY_ROOT: bashPath(checkout), ...extra },
      encoding: 'utf8', timeout: 20000,
    });
  }
  return { checkout, target, previous, run, calls: () => fs.readFileSync(log, 'utf8') };
}

test('deployment fast-forwards the tested SHA after a backup and updates only app containers', { skip: !available }, t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.target);
  assert.equal(fs.readFileSync(path.join(f.checkout, 'deploy/hostinger/.env'), 'utf8'), 'PRIVATE_FIXTURE=must-survive\n');
  const calls = f.calls();
  assert.ok(calls.indexOf('backup\n') < calls.indexOf('git merge --ff-only'));
  assert.ok(calls.indexOf('build api') < calls.indexOf('build web'));
  assert.match(calls, /up -d --no-deps --no-build --wait --wait-timeout 180 api web/);
  assert.ok(!calls.includes(' up -d db') && !calls.includes(' down') && !calls.includes('reset'));
  assert.match(result.stdout, /Deployment passed/);
});

test('a failed image build leaves the running app containers untouched', { skip: !available }, t => {
  const f = fixture(t);
  const result = f.run({ TEST_FAIL: 'build' });
  assert.notEqual(result.status, 0);
  assert.ok(!f.calls().includes(' up '));
  assert.match(result.stderr, /before container replacement/);
});

for (const failure of ['cutover', 'verify', 'web']) {
  test(`a ${failure} failure restores pinned prior app images without restoring the database`, { skip: !available }, t => {
    const f = fixture(t);
    const result = f.run({ TEST_FAIL: failure });
    assert.notEqual(result.status, 0);
    assert.match(f.calls(), /rollback.yml .*up -d --no-deps --no-build --pull never --wait/);
    assert.ok(!f.calls().includes(' down') && !f.calls().includes(' up -d db'));
    assert.match(result.stderr, /Previous app images restored/);
  });
}

test('stale Actions runs skip before backup, checkout update, or container operations', { skip: !available }, t => {
  const f = fixture(t);
  const result = f.run({}, f.previous);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Skipped stale run/);
  assert.ok(!f.calls().includes('backup\n') && !f.calls().includes('docker '));
  assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
});

for (const change of ['compose', 'schema', 'secret']) {
  test(`a ${change} change is rejected without touching the live checkout or database`, { skip: !available }, t => {
    const f = fixture(t, change);
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, change === 'secret' ? /private deployment path/ : /Compose or schema changed/);
    assert.ok(!f.calls().includes('backup\n') && !f.calls().includes('docker '));
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
    assert.equal(fs.readFileSync(path.join(f.checkout, 'deploy/hostinger/.env'), 'utf8'), 'PRIVATE_FIXTURE=must-survive\n');
  });
}

test('manual tracked edits are preserved and block automatic deployment', { skip: !available }, t => {
  const f = fixture(t);
  fs.writeFileSync(path.join(f.checkout, 'app.txt'), 'manual edit\n');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /local changes/);
  assert.equal(fs.readFileSync(path.join(f.checkout, 'app.txt'), 'utf8'), 'manual edit\n');
  assert.ok(!f.calls().includes('backup\n') && !f.calls().includes('docker '));
});

for (const failure of ['backup', 'locked']) {
  test(`a ${failure} failure prevents checkout updates and container replacement`, { skip: !available }, t => {
    const f = fixture(t);
    const result = f.run({ TEST_FAIL: failure });
    assert.notEqual(result.status, 0);
    if (failure === 'locked') assert.match(result.stderr, /Another deployment/);
    else assert.match(f.calls(), /backup\n/);
    assert.equal(git(f.checkout, 'rev-parse', 'HEAD'), f.previous);
    assert.ok(!f.calls().includes(' up ') && !f.calls().includes('build api'));
  });
}

test('the forced SSH entry rejects command injection before accessing the server checkout', { skip: !available }, t => {
  const f = fixture(t);
  const result = f.run({ SSH_ORIGINAL_COMMAND: `deploy ${f.target}; id` });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Only deploy/);
  assert.equal(f.calls(), '');
});
