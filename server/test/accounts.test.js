import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { createAdminToken, hashPassword, verifyPassword, memoryAccountRepository } from '../accounts.js';

const initialPassword = 'Initial-password-123';
const nextPassword = 'Replacement-password-456';
const secret = 'account-tests-secret-at-least-thirty-two-characters';

async function fixture(t, repository = memoryAccountRepository('owner@example.test', initialPassword)) {
  const pool = { query: async sql => [sql.includes('FROM domains') ? [{ user_id: 1, domain_name: 'example.test', domain_key: 'website', vapid_public_key: 'public', vapid_private_key: 'private', is_configured: 0 }] : []] };
  const app = createApp({ pool, webpush: {}, adminUsername: 'owner@example.test', adminPassword: initialPassword, secret, publicApiBase: 'https://push.example.test', vapidSubject: 'mailto:owner@example.test', accountRepository: repository });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, method = 'GET', payload, token, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...headers, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  };
  const login = (password = initialPassword) => request('/api/login', 'POST', { username: 'owner@example.test', password }, undefined, { 'X-Forwarded-For': '203.0.113.66' });
  return { request, login, repository };
}

test('password storage uses salted scrypt hashes with no plaintext fallback', async () => {
  const left = await hashPassword(initialPassword), right = await hashPassword(initialPassword);
  assert.notEqual(left, right);
  assert.equal(left.includes(initialPassword), false);
  assert.equal(await verifyPassword(initialPassword, left), true);
  assert.equal(await verifyPassword('wrong', left), false);
  assert.equal(await verifyPassword(initialPassword, 'invalid-hash'), false);
});

test('account profile requires authentication and reports real login data without credentials', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/account')).status, 401);
  const login = await f.login();
  const result = await f.request('/api/account', 'GET', undefined, login.token);
  assert.equal(result.status, 200);
  assert.equal(result.cache, 'no-store');
  assert.equal(result.data.email, 'owner@example.test');
  assert.ok(Number.isFinite(Date.parse(result.data.last_login_at)));
  assert.equal(result.data.last_login_ip, '127.0.0.1', 'Untrusted forwarding headers must not spoof login records');
  for (const key of ['password', 'password_hash', 'session_version']) assert.equal(result.data[key], undefined);
});

test('password change requires the current password and validates the replacement', async t => {
  const f = await fixture(t);
  const { token } = await f.login();
  assert.equal((await f.request('/api/account/password', 'POST', { current_password: initialPassword, new_password: nextPassword })).status, 401);
  for (const new_password of ['short', 'x'.repeat(129), null, initialPassword]) {
    assert.equal((await f.request('/api/account/password', 'POST', { current_password: initialPassword, new_password }, token)).status, 400);
  }
  assert.equal((await f.request('/api/account/password', 'POST', { current_password: 'wrong', new_password: nextPassword }, token)).status, 400);
  assert.equal(await verifyPassword(initialPassword, (await f.repository.read()).password_hash), true);
});

test('changing a password revokes prior sessions, survives a new app instance, and preserves WordPress sender keys', async t => {
  const repository = memoryAccountRepository('owner@example.test', initialPassword);
  const f = await fixture(t, repository);
  const first = await f.login(), second = await f.login();
  const before = await f.request('/api/domains/website/integration', 'GET', undefined, first.token);
  const changed = await f.request('/api/account/password', 'POST', { current_password: initialPassword, new_password: nextPassword }, first.token);
  assert.equal(changed.status, 200);
  assert.ok(changed.token);
  for (const token of [first.token, second.token, createAdminToken(secret, undefined)]) {
    assert.equal((await f.request('/api/account', 'GET', undefined, token)).status, 401);
  }
  assert.equal((await f.request('/api/account', 'GET', undefined, changed.token)).status, 200);
  assert.equal((await f.login()).status, 401);
  assert.equal((await f.login(nextPassword)).status, 200);
  const after = await f.request('/api/domains/website/integration', 'GET', undefined, changed.token);
  assert.equal(after.data.sender_api_key, before.data.sender_api_key);
  const sent = await f.request('/api/notifications', 'POST', { domain_key: 'website', title: 'No subscribers' }, undefined, { 'X-Api-Key': before.data.sender_api_key });
  assert.equal(sent.status, 200);
  assert.equal(sent.total, 0);
  const restarted = await fixture(t, repository);
  assert.equal((await restarted.login(nextPassword)).status, 200);
  assert.equal((await restarted.login()).status, 401);
});

test('password update conflicts leave the existing password intact', async t => {
  const repository = memoryAccountRepository('owner@example.test', initialPassword);
  repository.changePassword = async () => false;
  const f = await fixture(t, repository), { token } = await f.login();
  const result = await f.request('/api/account/password', 'POST', { current_password: initialPassword, new_password: nextPassword }, token);
  assert.equal(result.status, 409);
  assert.equal((await f.login()).status, 200);
});

test('repeated wrong current passwords are limited without changing the stored password', async t => {
  const f = await fixture(t), { token } = await f.login();
  for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/account/password', 'POST', { current_password: 'wrong', new_password: nextPassword }, token)).status, 400);
  assert.equal((await f.request('/api/account/password', 'POST', { current_password: 'wrong', new_password: nextPassword }, token)).status, 429);
  assert.equal(await verifyPassword(initialPassword, (await f.repository.read()).password_hash), true);
});
