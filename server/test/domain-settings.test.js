import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { ensureDomainTimeZone } from '../domain-schema.js';

test('time-zone migration preserves existing columns and handles first or concurrent startup', async () => {
  for (const state of ['present', 'missing', 'concurrent']) {
    let calls = 0;
    await ensureDomainTimeZone({ query: async sql => {
      calls++;
      if (sql.startsWith('SHOW')) return [state === 'present' ? [{ Field: 'time_zone' }] : []];
      assert.equal(sql, 'ALTER TABLE domains ADD COLUMN time_zone VARCHAR(64) NULL');
      if (state === 'concurrent') throw Object.assign(new Error('already exists'), { code: 'ER_DUP_FIELDNAME' });
      return [{}];
    } });
    assert.equal(calls, state === 'present' ? 1 : 2);
  }
  await assert.rejects(ensureDomainTimeZone({ query: async sql => {
    if (sql.startsWith('SHOW')) return [[]];
    throw new Error('Storage unavailable');
  } }), /Storage unavailable/);
});

async function fixture(t) {
  const records = [
    { domain_key: 'mice', user_id: 1, domain_name: 'micetraveladvisor.com', time_zone: null, vapid_private_key: 'private-do-not-expose' },
    { domain_key: 'other', user_id: 1, domain_name: 'other.example.test', time_zone: 'Europe/London' },
    { domain_key: 'another-owner', user_id: 2, domain_name: 'private.example.test', time_zone: 'UTC' },
  ];
  const writes = [];
  const pool = { query: async (sql, params) => {
    if (sql.startsWith('SELECT domain_key, domain_name, time_zone FROM domains')) {
      assert.match(sql, /domain_key = \? AND user_id = \?/);
      return [records.filter(record => record.domain_key === params[0] && record.user_id === params[1]).map(({ domain_key, domain_name, time_zone }) => ({ domain_key, domain_name, time_zone }))];
    }
    assert.equal(sql, 'UPDATE domains SET time_zone = ? WHERE domain_key = ? AND user_id = ?');
    writes.push(params);
    const record = records.find(record => record.domain_key === params[1] && record.user_id === params[2]);
    if (!record) return [{ affectedRows: 0 }];
    record.time_zone = params[0];
    return [{ affectedRows: 1 }];
  } };
  const app = createApp({ pool, webpush: {}, adminUsername: 'admin', adminPassword: 'testing', secret: 'settings-test-secret-at-least-thirty-two-characters', publicApiBase: 'https://push.example.test', vapidSubject: 'mailto:test@example.test' });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'testing' }) });
  const { token } = await login.json();
  const request = async (key = 'mice', method = 'GET', body, auth = true) => {
    const response = await fetch(`${base}/api/domains/${key}/settings`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  };
  return { request, records, writes };
}

test('settings require login and return a default time zone without private credentials', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('mice', 'GET', undefined, false)).status, 401);
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.equal(response.cache, 'no-store');
  assert.deepEqual(response.data, { domain_key: 'mice', domain_name: 'micetraveladvisor.com', time_zone: 'Asia/Kolkata' });
  assert.equal(JSON.stringify(response).includes('private-do-not-expose'), false);
  assert.equal(f.writes.length, 0);
});

test('saving settings persists the selected website time zone without changing keys or other websites', async t => {
  const f = await fixture(t);
  const before = structuredClone(f.records);
  const saved = await f.request('mice', 'PUT', { time_zone: 'America/New_York', vapid_private_key: 'forged', sender_api_key: 'forged', weekly_report_email: true });
  assert.equal(saved.status, 200);
  assert.equal((await f.request()).data.time_zone, 'America/New_York');
  assert.deepEqual(f.records, [{ ...before[0], time_zone: 'America/New_York' }, ...before.slice(1)]);
  assert.equal((await f.request('other', 'PUT', { time_zone: 'UTC' })).status, 200);
  assert.equal((await f.request()).data.time_zone, 'America/New_York');
});

test('invalid time zones and unauthorized updates cannot change settings', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('mice', 'PUT', { time_zone: 'UTC' }, false)).status, 401);
  for (const time_zone of [null, '', {}, 'Wrong/Zone', 'UTC+25', 'x'.repeat(65)]) {
    assert.equal((await f.request('mice', 'PUT', { time_zone })).status, 400);
  }
  assert.equal(f.writes.length, 0);
  for (const key of ['missing', 'another-owner']) {
    assert.equal((await f.request(key)).status, 404);
    assert.equal((await f.request(key, 'PUT', { time_zone: 'Asia/Tokyo' })).status, 404);
  }
  assert.equal(f.records[2].time_zone, 'UTC');
});
