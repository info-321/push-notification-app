import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { requestCountry, validCountryCode } from '../audience.js';
import { ensureSubscriptionCountry } from '../domain-schema.js';

const keys = { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };
const request = (peer, country, forwarded) => ({ socket: { remoteAddress: peer }, get: name => ({ 'CF-IPCountry': country, 'X-Forwarded-For': forwarded }[name]) });

test('country capture accepts only Cloudflare peers or a local sanitizing proxy with one Cloudflare hop', () => {
  assert.equal(requestCountry(request('104.16.0.1', 'IN')), 'IN');
  assert.equal(requestCountry(request('2606:4700::1234', 'US')), 'US');
  assert.equal(requestCountry(request('::ffff:172.18.0.1', 'GB', '104.24.0.2')), 'GB');
  assert.equal(requestCountry(request('::1', 'IN', '2400:cb00::1')), 'IN');
  for (const [peer, country, forwarded] of [
    ['8.8.8.8', 'IN', '104.16.0.1'], ['127.0.0.1', 'IN', '8.8.8.8'], ['127.0.0.1', 'IN', undefined],
    ['172.18.0.1', 'IN', '8.8.8.8, 104.16.0.1'], ['172.18.0.1', 'IN', 'garbage'],
    ['104.16.0.1', 'XX'], ['104.16.0.1', 'T1'], ['104.16.0.1', 'ZZ'], ['104.16.0.1', 'EU'], ['104.16.0.1', 'in'],
  ]) assert.equal(requestCountry(request(peer, country, forwarded)), null);
  assert.equal(validCountryCode('XK'), true);
  assert.equal(validCountryCode('XY'), false);
});

test('country migration preserves existing subscriptions and handles repeated or concurrent startup', async () => {
  for (const state of ['present', 'missing', 'concurrent']) {
    let writes = 0;
    await ensureSubscriptionCountry({ query: async sql => {
      if (sql.startsWith('SHOW')) return [state === 'present' ? [{ Field: 'country_code' }] : []];
      assert.equal(sql, 'ALTER TABLE subscriptions ADD COLUMN country_code CHAR(2) NULL'); writes++;
      if (state === 'concurrent') throw Object.assign(new Error('exists'), { code: 'ER_DUP_FIELDNAME' });
      return [{}];
    } });
    assert.equal(writes, state === 'present' ? 0 : 1);
  }
});

async function fixture(t, subscriptions = []) {
  const domains = [{ domain_key: 'mice', domain_name: 'website.test', user_id: 1 }, { domain_key: 'second', domain_name: 'second.test', user_id: 1 }, { domain_key: 'private', domain_name: 'private.test', user_id: 2 }];
  const stored = subscriptions.map((row, i) => ({ id: i + 1, endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, user_id: 1, domain_key: 'mice', ...keys, country_code: null, ...row }));
  const pool = { query: async (sql, params) => {
    if (sql.includes('FROM domains')) return [domains.filter(row => row.domain_key === params[0] && (params.length === 1 || row.user_id === params[1]))];
    if (sql.includes('GROUP BY country_code')) {
      assert.match(sql, /domain_key = \? AND user_id = \?/);
      assert.match(sql, /COALESCE\(p256dh, ''\) <> '' AND COALESCE\(auth, ''\) <> ''/);
      const countries = new Map();
      for (const row of stored.filter(row => row.domain_key === params[0] && row.user_id === params[1] && row.p256dh && row.auth)) countries.set(row.country_code, (countries.get(row.country_code) || 0) + 1);
      return [[...countries].map(([country_code, subscribers]) => ({ country_code, subscribers }))];
    }
    if (sql.startsWith('SELECT id, domain_key')) return [stored.filter(row => row.endpoint === params[0])];
    if (sql.startsWith('INSERT INTO subscriptions')) {
      stored.push({ id: stored.length + 1, user_id: params[0], domain_key: params[1], endpoint: params[2], p256dh: params[3], auth: params[4], country_code: params[5] });
      return [{ affectedRows: 1 }];
    }
    assert.match(sql, /country_code = COALESCE\(\?, country_code\)/);
    const row = stored.find(row => row.id === params[3] && row.domain_key === params[4]);
    if (row) Object.assign(row, { p256dh: params[0], auth: params[1], country_code: params[2] || row.country_code });
    return [{ affectedRows: row ? 1 : 0 }];
  } };
  const app = createApp({ pool, webpush: {}, adminUsername: 'admin', adminPassword: 'audience-test', secret: 'audience-test-secret-long-enough-for-auth', publicApiBase: 'https://push.example.test', vapidSubject: 'mailto:test@example.test' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'audience-test' }) })).json();
  const audience = async (key = 'mice', auth = true) => {
    const response = await fetch(`${base}/api/domains/${key}/audience`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  };
  const subscribe = async (country, extra = {}) => {
    const response = await fetch(base + '/api/subscriptions', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://website.test', ...(country ? { 'CF-IPCountry': country, 'X-Forwarded-For': '104.16.0.1' } : {}), ...extra }, body: JSON.stringify({ domain_key: 'mice', country_code: 'US', subscription: { endpoint: 'https://fcm.googleapis.com/fcm/send/new', keys } }) });
    assert.equal(response.status, 200);
  };
  return { audience, subscribe, stored };
}

test('audience counts are authenticated, scoped to owner/domain and expose only country aggregates', async t => {
  const f = await fixture(t, [{ country_code: 'IN' }, { country_code: 'IN' }, { country_code: 'US' }, { country_code: null }, { country_code: 'XX' }, { country_code: 'GB', user_id: 2 }, { country_code: 'CA', domain_key: 'second' }, { country_code: 'FR', auth: '' }]);
  assert.equal((await f.audience('mice', false)).status, 401);
  const result = await f.audience();
  assert.equal(result.status, 200); assert.equal(result.cache, 'no-store');
  assert.deepEqual(result.data.countries, [{ code: 'IN', name: 'India', subscribers: 2 }, { code: 'US', name: 'United States', subscribers: 1 }]);
  assert.equal(result.data.located, 3); assert.equal(result.data.unknown, 2); assert.equal(result.data.total, 5);
  assert.equal(result.data.capture_available, false);
  for (const privateValue of ['fcm.googleapis.com', keys.auth, keys.p256dh, 'remoteAddress']) assert.equal(JSON.stringify(result).includes(privateValue), false);
  for (const key of ['missing', 'private']) assert.equal((await f.audience(key)).status, 404);
});

test('legacy and empty audiences remain unknown or empty without fabricated locations', async t => {
  const f = await fixture(t, [{}, {}]);
  assert.deepEqual((await f.audience()).data.countries, []);
  assert.equal((await f.audience()).data.unknown, 2);
  assert.equal((await f.audience('second')).data.total, 0);
});

test('new and reconnecting browsers record country, retain it when missing, and ignore forged body data', async t => {
  const f = await fixture(t);
  await f.subscribe(); assert.equal(f.stored[0].country_code, null);
  await f.subscribe('IN'); assert.equal(f.stored[0].country_code, 'IN');
  await f.subscribe(); assert.equal(f.stored[0].country_code, 'IN');
  await f.subscribe('GB', { 'X-Forwarded-For': '8.8.8.8' }); assert.equal(f.stored[0].country_code, 'IN');
  await f.subscribe('US'); assert.equal(f.stored.length, 1); assert.equal(f.stored[0].country_code, 'US');
  assert.equal((await f.audience()).data.total, 1); assert.equal((await f.audience()).data.countries[0].code, 'US');
});
