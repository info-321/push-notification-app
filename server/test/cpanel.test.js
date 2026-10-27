import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('Passenger CommonJS entry can load the ES module server', t => {
  const directory = mkdtempSync(join(tmpdir(), 'push-cpanel-test-'));
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('push-cpanel-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, 'server'));
  writeFileSync(join(directory, 'app.js'), readFileSync(new URL('../../deploy/cpanel/app.js', import.meta.url)));
  writeFileSync(join(directory, 'package.json'), '{"type":"commonjs"}');
  writeFileSync(join(directory, 'server/package.json'), '{"type":"module"}');
  writeFileSync(join(directory, 'server/index.js'), "export const loaded = 'esm-server-loaded';");
  const child = spawnSync(process.execPath, ['-e', "require('./app.js').then(server => console.log(server.loaded))"], { cwd: directory, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.match(child.stdout, /esm-server-loaded/);
  writeFileSync(join(directory, 'server/index.js'), "throw new Error('startup failure check');");
  const failed = spawnSync(process.execPath, ['app.js'], { cwd: directory, encoding: 'utf8' });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /Push API startup failed: startup failure check/);
});
