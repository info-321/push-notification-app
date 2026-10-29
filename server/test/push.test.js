import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';

const key = 'test-domain-key';
const endpoint = 'https://fcm.googleapis.com/fcm/send/test';
const browserKeys = { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };

async function fixture(t, { subscriptions = [], sendError, publicApiBase = 'https://push.example.org', domainOverrides = {} } = {}) {
  const calls = [];
  const deletes = [];
  const inserts = [];
  const updates = [];
  const domain = { id: 1, user_id: 1, domain_name: 'website.test', domain_key: key, vapid_public_key: 'public-key', vapid_private_key: 'private-key', status: 'pending', ...domainOverrides };
  const stored = subscriptions.map(subscription => ({ user_id: domain.user_id, domain_key: key, ...subscription }));
  const pool = { async query(sql, params) {
    if (sql.startsWith('SELECT') && sql.includes('FROM domains')) {
      if (sql.includes('domain_key = ?') && params[0] !== key) return [[]];
      const { vapid_private_key, ...publicDomain } = domain;
      if (sql.startsWith('SELECT domain_name, vapid_public_key, vapid_private_key')) return [[domain]];
      const isConfigured = Boolean(domain.vapid_public_key && domain.vapid_private_key && stored.some(subscription =>
        subscription.domain_key === key && subscription.user_id === domain.user_id && subscription.p256dh && subscription.auth));
      return [[{ ...publicDomain, is_configured: isConfigured ? 1 : 0 }]];
    }
    if (sql.startsWith('SELECT') && sql.includes('FROM subscriptions')) {
      if (sql.includes('COUNT(*) AS subscribers')) {
        assert.match(sql, /domain_key = \? AND user_id = \?/);
        assert.match(sql, /COALESCE\(p256dh, ''\) <> '' AND COALESCE\(auth, ''\) <> ''/);
        return [[{ subscribers: stored.filter(s => s.domain_key === params[0] && s.user_id === params[1] && s.p256dh && s.auth).length }]];
      }
      return [sql.includes('WHERE endpoint') ? stored.filter(s => s.endpoint === params[0]) : stored.filter(s => s.domain_key === params[0])];
    }
    if (sql.startsWith('DELETE FROM subscriptions')) {
      deletes.push(params);
      const index = stored.findIndex(s => s.id === params[0] && s.domain_key === params[1]);
      if (index !== -1) stored.splice(index, 1);
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT INTO subscriptions')) {
      inserts.push(params);
      stored.push({ id: stored.length + 1, user_id: params[0], domain_key: params[1], endpoint: params[2], p256dh: params[3], auth: params[4], country_code: params[5], region_name: params[6], region_code: params[7], city_name: params[8] });
      return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('UPDATE subscriptions')) {
      updates.push(params);
      const subscription = stored.find(s => s.id === params[6] && s.domain_key === params[7]);
      if (subscription) Object.assign(subscription, { p256dh: params[0], auth: params[1], country_code: params[2], region_name: params[3], region_code: params[4], city_name: params[5] });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const webpush = { async sendNotification(...args) { calls.push(args); if (sendError) throw sendError; } };
  const app = createApp({ pool, webpush, secret: 'test-secret-is-long-enough-for-testing', adminUsername: 'admin', adminPassword: 'test-password', publicApiBase, vapidSubject: 'mailto:owner@website.test' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = async (route, data, headers = {}) => {
    const response = await fetch(base + route, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...headers }, body: data ? JSON.stringify(data) : undefined });
    const result = await response.json();
    return { status: response.status, result };
  };
  const login = await request('/api/login', { username: 'admin', password: 'test-password' });
  const auth = { Authorization: `Bearer ${login.result.token}` };
  const config = await request(`/api/domains/${key}/integration`, undefined, auth);
  return { request, auth, config: config.result.data, calls, deletes, inserts, updates, base };
}

test('SDK and worker are served by the API, with JavaScript content types', async t => {
  const f = await fixture(t);
  for (const route of ['/sdk/push.js', '/push-sw.js']) {
    const response = await fetch(f.base + route);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /javascript/);
  }
});

test('admin login is required for domains and sender configuration', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/domains')).status, 401);
  assert.equal((await f.request(`/api/domains/${key}/integration`)).status, 401);
  assert.equal((await f.request('/api/login', { username: 'admin', password: 'wrong' })).status, 401);
  assert.equal((await f.request('/api/domains', undefined, f.auth)).status, 200);
});

test('integration returns the public deployment URL and a sender key without VAPID private keys', async t => {
  const f = await fixture(t);
  assert.equal(f.config.api_base, 'https://push.example.org');
  assert.equal(f.config.service_url, 'https://push.example.org/api/notifications');
  assert.equal(f.config.live_ready, true);
  assert.equal(typeof f.config.sender_api_key, 'string');
  assert.equal(f.config.vapid_private_key, undefined);
  const listing = await f.request('/api/domains', undefined, f.auth);
  assert.equal(listing.result.data[0].sender_api_key, undefined);
});

test('local API addresses are marked as local setup', async t => {
  const f = await fixture(t, { publicApiBase: 'http://localhost:5000' });
  assert.equal(f.config.live_ready, false);
});

test('an existing subscribed domain is configured even while ownership status is pending', async t => {
  const f = await fixture(t, { subscriptions: [{ id: 1, endpoint, ...browserKeys }] });
  for (const route of ['/api/domains', `/api/domains/${key}`, `/api/domains/${key}/integration`]) {
    const response = await f.request(route, undefined, f.auth);
    assert.equal(response.status, 200);
    const data = Array.isArray(response.result.data) ? response.result.data[0] : response.result.data;
    assert.equal(data.is_configured, true);
    assert.equal(data.status, 'pending');
    assert.equal(data.vapid_private_key, undefined);
  }
  assert.equal(f.calls.length, 0, 'Reading configuration must not send notifications');
});

test('registering a browser makes push configuration available on the next domain read', async t => {
  const f = await fixture(t);
  assert.equal(f.config.is_configured, false);
  const saved = await f.request('/api/subscriptions', { domain_key: key, subscription: { endpoint, keys: browserKeys } }, { Origin: 'https://website.test' });
  assert.equal(saved.status, 200);
  const listing = await f.request('/api/domains', undefined, f.auth);
  assert.equal(listing.result.data[0].is_configured, true);
});

test('ownership verification without a browser subscription does not claim push setup', async t => {
  const f = await fixture(t, { domainOverrides: { status: 'verified' } });
  const listing = await f.request('/api/domains', undefined, f.auth);
  assert.equal(listing.result.data[0].status, 'verified');
  assert.equal(listing.result.data[0].is_configured, false);
});

test('overview requires login, isolates the selected audience, and exposes no browser keys or sender secrets', async t => {
  const f = await fixture(t, { subscriptions: [
    { id: 1, endpoint, ...browserKeys },
    { id: 2, endpoint: endpoint + '2', ...browserKeys },
    { id: 3, endpoint, domain_key: 'other-domain', ...browserKeys },
    { id: 4, endpoint, user_id: 2, ...browserKeys },
    { id: 5, endpoint, p256dh: '', auth: browserKeys.auth },
  ] });
  const route = `/api/domains/${key}/overview`;
  assert.equal((await f.request(route)).status, 401);
  const response = await fetch(f.base + route, { headers: f.auth });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const { data } = await response.json();
  assert.deepEqual(data.subscribers, { total: 2, web: 2, mobile: null, app: null });
  assert.equal(data.domain.is_configured, true);
  assert.equal(data.domain.vapid_private_key, undefined);
  assert.equal(data.domain.sender_api_key, undefined);
  assert.ok(Number.isFinite(Date.parse(data.updated_at)));
  assert.equal(JSON.stringify(data).includes(endpoint), false);
  assert.equal(JSON.stringify(data).includes(browserKeys.auth), false);
  assert.equal(f.calls.length, 0);
});

test('overview reports zero for an empty audience and returns 404 for an unknown domain', async t => {
  const f = await fixture(t);
  const { result } = await f.request(`/api/domains/${key}/overview`, undefined, f.auth);
  assert.equal(result.data.subscribers.total, 0);
  assert.equal(result.data.domain.is_configured, false);
  assert.equal((await f.request('/api/domains/unknown/overview', undefined, f.auth)).status, 404);
});

test('overview reflects new subscriptions and expired removals on refresh', async t => {
  const f = await fixture(t, { sendError: { statusCode: 410 } });
  await f.request('/api/subscriptions', { domain_key: key, subscription: { endpoint, keys: browserKeys } }, { Origin: 'https://website.test' });
  const before = await f.request(`/api/domains/${key}/overview`, undefined, f.auth);
  assert.equal(before.result.data.subscribers.total, 1);
  await f.request('/api/notifications', { domain_key: key, title: 'Test' }, f.auth);
  const after = await f.request(`/api/domains/${key}/overview`, undefined, f.auth);
  assert.equal(after.result.data.subscribers.total, 0);
});

test('another domain, another owner, or incomplete browser keys cannot configure this domain', async t => {
  for (const subscription of [
    { domain_key: 'other-domain', ...browserKeys },
    { user_id: 2, ...browserKeys },
    { p256dh: browserKeys.p256dh, auth: '' },
    { p256dh: null, auth: browserKeys.auth },
  ]) {
    const f = await fixture(t, { subscriptions: [{ id: 1, endpoint, ...subscription }] });
    assert.equal(f.config.is_configured, false);
  }
});

test('missing domain push keys prevent a configured flag even with stored subscribers', async t => {
  for (const domainOverrides of [{ vapid_private_key: null }, { vapid_public_key: '' }]) {
    const f = await fixture(t, { subscriptions: [{ id: 1, endpoint, ...browserKeys }], domainOverrides });
    assert.equal(f.config.is_configured, false);
  }
});

test('forged admin sessions and missing sender credentials cannot send', async t => {
  const f = await fixture(t);
  const payload = { domain_key: key, title: 'Hello' };
  assert.equal((await f.request('/api/notifications', payload)).status, 401);
  assert.equal((await f.request('/api/notifications', payload, { Authorization: f.auth.Authorization + 'x' })).status, 401);
  assert.equal(f.calls.length, 0);
});

test('sender keys are scoped to one domain', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/notifications', { domain_key: 'other-domain', title: 'Hello' }, { 'X-Api-Key': f.config.sender_api_key })).status, 401);
});

test('sending uses stored browser keys and per-domain VAPID credentials', async t => {
  const f = await fixture(t, { subscriptions: [{ id: 1, endpoint, ...browserKeys }] });
  const result = await f.request('/api/notifications', { domain_key: key, title: 'Hello', body: 'World', url: '/article' }, { 'X-Api-Key': f.config.sender_api_key });
  assert.equal(result.status, 200);
  assert.equal(result.result.sent, 1);
  assert.equal(f.calls[0][0].keys.auth, browserKeys.auth);
  assert.equal(JSON.parse(f.calls[0][1]).url, 'https://website.test/article');
  assert.deepEqual(f.calls[0][2].vapidDetails, { subject: 'mailto:owner@website.test', publicKey: 'public-key', privateKey: 'private-key' });
});

test('expired endpoints are removed; temporary failures remain for retry', async t => {
  for (const statusCode of [410, 404, 503]) {
    const f = await fixture(t, { subscriptions: [{ id: 7, endpoint, ...browserKeys }], sendError: { statusCode } });
    const result = await f.request('/api/notifications', { domain_key: key, title: 'Hello' }, f.auth);
    assert.equal(f.deletes.length, statusCode === 503 ? 0 : 1);
    assert.equal(result.result.removed, statusCode === 503 ? 0 : 1);
    assert.equal(result.status, statusCode === 503 ? 502 : 200);
  }
});

test('no subscribers is reported without claiming a delivery', async t => {
  const f = await fixture(t);
  const response = await f.request('/api/notifications', { domain_key: key, title: 'Hello' }, f.auth);
  assert.equal(response.result.sent, 0);
  assert.match(response.result.message, /No subscribers/);
});

test('invalid payloads and off-site or non-HTTPS links are rejected', async t => {
  const f = await fixture(t);
  for (const payload of [{ title: '' }, { title: 'Hello', url: 'https://evil.test/' }, { title: 'Hello', url: 'javascript:alert(1)' }, { title: 'x'.repeat(151) }]) {
    const response = await f.request('/api/notifications', { domain_key: key, ...payload }, f.auth);
    assert.equal(response.status, 400);
  }
});

test('subscriptions are validated and assigned the domain owner on the server', async t => {
  const f = await fixture(t);
  const payload = { domain_key: key, userId: 999, subscription: { endpoint, keys: browserKeys } };
  const result = await f.request('/api/subscriptions', payload, { Origin: 'https://www.website.test' });
  assert.equal(result.status, 200);
  assert.equal(f.inserts[0][0], 1);
  assert.equal((await f.request('/api/subscriptions', payload, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.request('/api/subscriptions', payload)).status, 403);
});

test('invalid subscription keys and internal push endpoints are rejected', async t => {
  const f = await fixture(t);
  for (const subscription of [{ endpoint: 'https://127.0.0.1/private', keys: browserKeys }, { endpoint, keys: { auth: 'bad' } }]) {
    assert.equal((await f.request('/api/subscriptions', { domain_key: key, subscription }, { Origin: 'https://website.test' })).status, 400);
  }
  assert.equal(f.inserts.length, 0);
});

test('a subscription cannot be moved between registered sites', async t => {
  const f = await fixture(t, { subscriptions: [{ id: 1, endpoint, domain_key: 'different-domain', ...browserKeys }] });
  const result = await f.request('/api/subscriptions', { domain_key: key, subscription: { endpoint, keys: browserKeys } }, { Origin: 'https://website.test' });
  assert.equal(result.status, 409);
});

test('resubscribing updates encryption keys only for the same domain', async t => {
  const f = await fixture(t, { subscriptions: [{ id: 9, endpoint, domain_key: key, ...browserKeys }] });
  const result = await f.request('/api/subscriptions', { domain_key: key, subscription: { endpoint, keys: browserKeys } }, { Origin: 'https://website.test' });
  assert.equal(result.status, 200);
  assert.equal(f.inserts.length, 0);
  assert.deepEqual(f.updates[0], [browserKeys.p256dh, browserKeys.auth, null, null, null, null, 9, key]);
});
