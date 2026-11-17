import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { requestVisitorIp } from '../audience.js';
import { ensureSubscriberVisitDetails } from '../domain-schema.js';
import { locationReceipt, validLocationReceipt, validCoordinates } from '../subscriber-location.js';

const secret = 'isolated-subscriber-location-test-secret';
const endpoint = 'https://fcm.googleapis.com/fcm/send/location-fixture';
const keys = { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };
const point = { consent: true, latitude: 22.57, longitude: 88.36, accuracy: 120 };
const agent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36';

test('visitor IP comes from a verified Cloudflare path or sanitizing local proxy, never arbitrary headers/body', () => {
  const req = (peer, headers = {}) => ({ socket: { remoteAddress: peer }, get: name => headers[name] });
  assert.equal(requestVisitorIp(req('104.16.0.1', { 'CF-Connecting-IP': '203.0.113.25' })), '203.0.113.25');
  assert.equal(requestVisitorIp(req('::ffff:172.19.0.1', { 'X-Forwarded-For': '104.16.0.1', 'CF-Connecting-IP': '2001:db8::25' })), '2001:db8::25');
  assert.equal(requestVisitorIp(req('203.0.113.9', { 'CF-Connecting-IP': '203.0.113.25', 'X-Forwarded-For': '104.16.0.1' })), '203.0.113.9');
  assert.equal(requestVisitorIp(req('127.0.0.1', { 'X-Forwarded-For': '203.0.113.25', 'CF-Connecting-IP': '192.0.2.5' })), '203.0.113.25');
  for (const cf of [undefined, 'bad', '127.0.0.1', '203.0.113.25, 8.8.8.8', '<script>']) {
    assert.equal(requestVisitorIp(req('104.16.0.1', { 'CF-Connecting-IP': cf })), null);
  }
  assert.equal(requestVisitorIp(req('127.0.0.1', { 'X-Forwarded-For': '203.0.113.25, 104.16.0.1' })), null);
  assert.equal(requestVisitorIp(req('127.0.0.1')), null);
  assert.equal(requestVisitorIp(req('not-an-ip')), null);
});

test('nullable visit/GPS migration is restart-safe, handles concurrent starts and never invents historic data', async () => {
  for (const state of ['present', 'missing', 'concurrent']) {
    const writes = [];
    await ensureSubscriberVisitDetails({ query: async sql => {
      if (sql.startsWith('SHOW')) return [state === 'present' ? [{}] : []];
      writes.push(sql); assert.match(sql, /^ALTER TABLE subscriptions ADD COLUMN \w+ (VARCHAR\(45\)|DATETIME\(3\)|DOUBLE) NULL$/);
      if (state === 'concurrent') throw Object.assign(new Error('Exists'), { code: 'ER_DUP_FIELDNAME' });
      return [{}];
    } });
    assert.equal(writes.length, state === 'present' ? 0 : 8);
  }
  await assert.rejects(ensureSubscriberVisitDetails({ query: async () => { throw new Error('storage'); } }), /storage/);
});

test('location receipt is purpose-specific, expires and binds both the domain and subscription', () => {
  const token = locationReceipt(secret, 'one', endpoint, 1000);
  assert.equal(validLocationReceipt(secret, token, 'one', endpoint, 2000), true);
  assert.equal(validLocationReceipt(secret, token, 'two', endpoint, 2000), false);
  assert.equal(validLocationReceipt(secret, token, 'one', endpoint + '-other', 2000), false);
  assert.equal(validLocationReceipt(secret, token, 'one', endpoint, 1801000), false);
  assert.equal(validLocationReceipt('another-secret', token, 'one', endpoint, 2000), false);
  for (const invalid of ['', null, token + '.extra', 'bad.signature', 'x'.repeat(601), token.slice(0, -2)]) assert.equal(validLocationReceipt(secret, invalid, 'one', endpoint, 2000), false);
  assert.equal(token.includes(endpoint), false);
  assert.equal(validCoordinates(point), true);
  assert.equal(validCoordinates({ ...point, latitude: 0, longitude: 0, accuracy: 0 }), true);
  for (const changes of [{ consent: false }, { consent: 'true' }, { latitude: '22' }, { latitude: 91 }, { longitude: -181 }, { accuracy: -1 }, { accuracy: Infinity }, { longitude: null }]) assert.equal(validCoordinates({ ...point, ...changes }), false);
});

async function fixture(t) {
  const rows = [], writes = [], domain = { domain_name: 'one.test', domain_key: 'one', user_id: 1, targeting_policy: null };
  let fail = false;
  const pool = { query: async (sql, params = []) => {
    if (fail) throw Object.assign(new Error('Database unavailable'), { code: 'TEST_STORAGE' });
    if (sql.startsWith('SELECT') && sql.includes('FROM domains')) return [params[0] === 'one' ? [domain] : []];
    if (sql.startsWith('SELECT id, domain_key')) return [rows.filter(row => row.endpoint === params[0])];
    if (sql.startsWith('INSERT INTO subscriptions')) {
      rows.push({ id: rows.length + 1, user_id: params[0], domain_key: params[1], endpoint: params[2], p256dh: params[3], auth: params[4], ip_address: params[13] });
      writes.push({ sql, params }); return [{ affectedRows: 1, insertId: rows.length }];
    }
    if (sql.startsWith('UPDATE subscriptions SET p256dh')) {
      const row = rows.find(row => row.id === params[12] && row.domain_key === params[13]);
      if (row && params[10]) row.ip_address = params[10];
      writes.push({ sql, params }); return [{ affectedRows: row ? 1 : 0 }];
    }
    if (sql.startsWith('UPDATE subscriptions SET latitude')) {
      assert.match(sql, /WHERE domain_key = \? AND endpoint = \? AND user_id = 1/);
      const row = rows.find(row => row.domain_key === params[3] && row.endpoint === params[4] && row.user_id === 1);
      if (row) Object.assign(row, { latitude: params[0], longitude: params[1], location_accuracy_m: params[2], location_consent_at: new Date() });
      writes.push({ sql, params }); return [{ affectedRows: row ? 1 : 0 }];
    }
    throw new Error('Unexpected SQL: ' + sql);
  } };
  const app = createApp({ pool, webpush: {}, secret, adminUsername: 'fixture', adminPassword: 'fixture-password', publicApiBase: 'https://api.test' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const call = async (path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://www.one.test', 'User-Agent': agent, ...headers }, body: JSON.stringify(body) });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  };
  const subscribe = (headers, changes) => call('/api/subscriptions', { domain_key: 'one', subscription: { endpoint, keys }, ...changes }, headers);
  const share = (token, changes, headers) => call('/api/subscriptions/location', { ...point, domain_key: 'one', endpoint, token, ...changes }, headers);
  return { rows, writes, subscribe, share, domain, breakStorage: () => { fail = true; } };
}

test('new registrations and revisits store the observed IP per domain, preserve missing IPs and keep GPS separate', async t => {
  const f = await fixture(t);
  const saved = await f.subscribe({ 'X-Forwarded-For': '104.16.0.1', 'CF-Connecting-IP': '203.0.113.25' }, { ip_address: '8.8.8.8', ...point });
  assert.equal(saved.status, 200); assert.equal(saved.cache, 'no-store'); assert.equal(saved.location_shared, false);
  assert.equal(f.rows[0].ip_address, '203.0.113.25'); assert.equal(f.rows[0].latitude, undefined);
  assert.equal(validLocationReceipt(secret, saved.location_token, 'one', endpoint), true);
  assert.equal(JSON.stringify(saved).includes('203.0.113.25'), false);
  await f.subscribe(); assert.equal(f.rows.length, 1); assert.equal(f.rows[0].ip_address, '203.0.113.25');
  await f.subscribe({ 'X-Forwarded-For': '104.16.0.1', 'CF-Connecting-IP': '2001:db8::5' });
  assert.equal(f.rows[0].ip_address, '2001:db8::5');
  assert.match(f.writes.at(-1).sql, /last_seen_at = UTC_TIMESTAMP\(3\)/);
  const denied = await f.subscribe({}, { subscription: { endpoint, keys: { ...keys, auth: Buffer.alloc(16, 3).toString('base64url') } } });
  assert.equal(denied.status, 409); assert.equal(denied.location_token, undefined);
});

test('GPS storage requires explicit consent, valid coordinates, current receipt, matching origin/domain and eligible device', async t => {
  const f = await fixture(t), { location_token: token } = await f.subscribe();
  for (const [receipt, changes, headers, expected] of [
    [null, {}, {}, 403], [token, { consent: false }, {}, 400], [token, { latitude: 91 }, {}, 400],
    [token, { domain_key: 'another' }, {}, 403], [token, { endpoint: endpoint + '-another' }, {}, 403],
    [token, {}, { Origin: 'https://evil.test' }, 403], [token, {}, { Origin: 'null' }, 403],
    [locationReceipt(secret, 'one', endpoint, 0), {}, {}, 403],
  ]) assert.equal((await f.share(receipt, changes, headers)).status, expected);
  assert.equal(f.writes.length, 1);
  const saved = await f.share(token); assert.equal(saved.status, 200); assert.equal(saved.cache, 'no-store');
  assert.equal(f.rows[0].latitude, point.latitude); assert.equal(f.rows[0].longitude, point.longitude); assert.ok(f.rows[0].location_consent_at);
  assert.equal((await f.subscribe()).location_shared, true);
  assert.equal(f.rows[0].latitude, point.latitude, 'A normal revisit must not change consented coordinates');
  f.domain.targeting_policy = JSON.stringify({ mode: 'selected', devices: ['iphone'], browsers: ['home_screen'], version: 1 });
  assert.equal((await f.share(token)).status, 403);
  f.domain.targeting_policy = null; f.rows[0].user_id = 2;
  assert.equal((await f.share(token)).status, 404, 'Another owner must not be writable');
});

test('missing subscriptions and failed GPS writes never create a subscription or return stored personal data', async t => {
  const f = await fixture(t);
  assert.equal((await f.share(locationReceipt(secret, 'one', endpoint))).status, 404);
  assert.equal(f.rows.length, 0);
  const { location_token: token } = await f.subscribe(); f.breakStorage();
  const failed = await f.share(token); assert.equal(failed.status, 503);
  assert.equal(f.rows.length, 1); assert.equal(f.rows[0].latitude, undefined);
  assert.equal(JSON.stringify(failed).includes(endpoint), false);
});
