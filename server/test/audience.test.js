import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { requestCountry, requestLocation, mergeLocation, locationName, validCountryCode } from '../audience.js';
import { ensureSubscriptionCountry, ensureSubscriptionLocations } from '../domain-schema.js';

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
      const grouped = new Map();
      for (const row of stored.filter(row => row.domain_key === params[0] && row.user_id === params[1] && row.p256dh && row.auth)) {
        const fields = { country_code: row.country_code, region_name: row.region_name || null, region_code: row.region_code || null, city_name: row.city_name || null };
        const key = JSON.stringify(fields);
        if (grouped.has(key)) grouped.get(key).subscribers++;
        else grouped.set(key, { ...fields, subscribers: 1 });
      }
      return [[...grouped.values()]];
    }
    if (sql.startsWith('SELECT id, domain_key')) return [stored.filter(row => row.endpoint === params[0])];
    if (sql.startsWith('INSERT INTO subscriptions')) {
      stored.push({ id: stored.length + 1, user_id: params[0], domain_key: params[1], endpoint: params[2], p256dh: params[3], auth: params[4], country_code: params[5], region_name: params[6], region_code: params[7], city_name: params[8] });
      return [{ affectedRows: 1 }];
    }
    assert.match(sql, /country_code = \?, region_name = \?, region_code = \?, city_name = \?/);
    const row = stored.find(row => row.id === params[6] && row.domain_key === params[7]);
    if (row) Object.assign(row, { p256dh: params[0], auth: params[1], country_code: params[2], region_name: params[3], region_code: params[4], city_name: params[5] });
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


test('state/city header parsing accepts trusted UTF-8 names and rejects malformed or spoofed locations', () => {
  const headers = { 'CF-IPCountry': 'BR', 'X-Forwarded-For': '104.16.0.1', 'CF-Region': Buffer.from('S\u00e3o Paulo', 'utf8').toString('latin1'), 'CF-Region-Code': 'sp', 'CF-IPCity': Buffer.from('S\u00e3o Paulo', 'utf8').toString('latin1') };
  const req = { socket: { remoteAddress: '127.0.0.1' }, get: name => headers[name] };
  assert.deepEqual(requestLocation(req), { country_code: 'BR', region_name: 'S\u00e3o Paulo', region_code: 'SP', city_name: 'S\u00e3o Paulo' });
  headers['X-Forwarded-For'] = '8.8.8.8';
  assert.deepEqual(requestLocation(req), { country_code: null, region_name: null, region_code: null, city_name: null });
  for (const name of ['<script>alert(1)</script>', 'New\nYork', 'Unknown', 'x'.repeat(129), '127.0.0.1', 'n/a']) assert.equal(locationName(name), null);
  assert.equal(locationName('Saint-\u00c9tienne'), 'Saint-\u00c9tienne');
});

test('location snapshots preserve missing data and clear incompatible cities on state or country changes', () => {
  const old = { country_code: 'IN', region_name: 'West Bengal', region_code: 'WB', city_name: 'Kolkata' };
  assert.deepEqual(mergeLocation(old, { country_code: null, region_name: null, region_code: null, city_name: null }), old);
  assert.deepEqual(mergeLocation(old, { country_code: 'IN', region_name: null, region_code: null, city_name: null }), old);
  assert.deepEqual(mergeLocation(old, { country_code: 'US', region_name: null, region_code: null, city_name: null }), { country_code: 'US', region_name: null, region_code: null, city_name: null });
  assert.equal(mergeLocation(old, { country_code: 'IN', region_name: 'Maharashtra', region_code: 'MH', city_name: null }).city_name, null);
  const cityOnly = mergeLocation(old, { country_code: 'IN', region_name: null, region_code: null, city_name: 'Mumbai' });
  assert.equal(cityOnly.region_name, null); assert.equal(cityOnly.region_code, null); assert.equal(cityOnly.city_name, 'Mumbai');
});

test('state/city migrations are nullable, repeatable and preserve existing subscription records', async () => {
  for (const state of ['present', 'missing', 'concurrent']) {
    let writes = 0;
    await ensureSubscriptionLocations({ query: async sql => {
      if (sql.startsWith('SHOW')) return [state === 'present' ? [{ Field: 'fixture' }] : []];
      assert.match(sql, /^ALTER TABLE subscriptions ADD COLUMN (region_name|region_code|city_name) VARCHAR\((128|16)\)( CHARACTER SET utf8mb4)? NULL$/);
      writes++;
      if (state === 'concurrent') throw Object.assign(new Error('exists'), { code: 'ER_DUP_FIELDNAME' });
      return [{}];
    } });
    assert.equal(writes, state === 'present' ? 0 : 3);
  }
});

test('country, state and city counts reconcile and identical city names remain separated by state and country', async t => {
  const f = await fixture(t, [
    { country_code: 'US', region_name: 'Illinois', region_code: 'IL', city_name: 'Springfield' },
    { country_code: 'US', region_name: 'Illinois', region_code: 'IL', city_name: 'Springfield' },
    { country_code: 'US', region_name: 'Massachusetts', region_code: 'MA', city_name: 'Springfield' },
    { country_code: 'IN', region_name: 'West Bengal', region_code: 'WB', city_name: 'Kolkata' },
    { country_code: 'IN', region_name: 'West Bengal', region_code: 'WB', city_name: null },
    { country_code: 'IN', region_name: null, region_code: null, city_name: null },
    { country_code: null },
    { country_code: 'IN', region_name: 'Other owner', city_name: 'Hidden', user_id: 2 },
    { country_code: 'IN', region_name: 'Other domain', city_name: 'Hidden', domain_key: 'second' },
  ]);
  const { data } = await f.audience();
  assert.equal(data.total, 7);
  assert.equal(data.countries.find(row => row.code === 'US').subscribers, 3);
  assert.equal(data.countries.find(row => row.code === 'IN').subscribers, 3);
  assert.equal(data.states.find(row => row.code === 'WB').subscribers, 2);
  const springfields = data.cities.filter(row => row.name === 'Springfield');
  assert.equal(springfields.length, 2);
  assert.deepEqual(springfields.map(row => row.subscribers).sort(), [1, 2]);
  assert.equal(data.state_located, 5); assert.equal(data.state_unknown, 2);
  assert.equal(data.city_located, 4); assert.equal(data.city_unknown, 3);
  assert.equal(data.state_located + data.state_unknown, data.total);
  assert.equal(data.city_located + data.city_unknown, data.total);
  assert.equal(JSON.stringify(data).includes('Hidden'), false);
});

test('a reconnect saves real state and city, keeps metadata when missing, and clears stale details when moving country', async t => {
  const f = await fixture(t);
  await f.subscribe('IN', { 'CF-Region': 'West Bengal', 'CF-Region-Code': 'WB', 'CF-IPCity': 'Kolkata' });
  assert.equal(f.stored[0].region_name, 'West Bengal'); assert.equal(f.stored[0].city_name, 'Kolkata');
  await f.subscribe(); assert.equal(f.stored[0].city_name, 'Kolkata');
  let result = await f.audience();
  assert.equal(result.data.states[0].name, 'West Bengal'); assert.equal(result.data.cities[0].name, 'Kolkata');
  await f.subscribe('US');
  assert.equal(f.stored[0].region_name, null); assert.equal(f.stored[0].city_name, null);
  result = await f.audience(); assert.equal(result.data.state_unknown, 1); assert.equal(result.data.city_unknown, 1);
  assert.equal(result.data.countries[0].code, 'US'); assert.equal(f.stored.length, 1);
});
