import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../app.js';
import { analyticsRange } from '../analytics.js';

test('analytics date ranges handle leap days, UTC month defaults and bounded inclusive dates', () => {
  const now = new Date('2026-10-29T23:30:00Z');
  assert.equal(analyticsRange({}, now).start, '2026-10-01');
  assert.equal(analyticsRange({}, now).end, '2026-10-29');
  assert.equal(analyticsRange({ start: '2024-02-29', end: '2024-03-01' }, now).afterLast.toISOString(), '2024-03-02T00:00:00.000Z');
  assert.ok(analyticsRange({ start: '2024-01-01', end: '2024-12-31' }, now));
  for (const query of [{ start: '2024-01-01', end: '2025-01-01' }, { start: '2025-02-29', end: '2025-03-01' }, { start: '2024-01-02', end: '2024-01-01' }, { start: '2024-01-01' }, { start: ['2024-01-01'], end: '2024-01-01' }, { start: '1960-01-01', end: '1960-01-01' }, { start: '2099-01-01', end: '2099-01-01' }, { start: 'bad', end: 'bad' }]) assert.equal(analyticsRange(query, now), null);
});

async function fixture(t, deviceTypes = []) {
  const records = [
    { day: '2024-01-01', owner: 1, key: 'mice', complete: true },
    { day: '2024-01-02', owner: 1, key: 'mice', complete: true },
    { day: '2024-01-02', owner: 1, key: 'mice', complete: true },
    { day: '2024-01-03', owner: 1, key: 'mice', complete: true },
    { day: '2024-01-01', owner: 2, key: 'mice', complete: true },
    { day: '2024-01-01', owner: 1, key: 'second', complete: true },
    { day: '2024-01-01', owner: 1, key: 'mice', complete: false },
  ];
  records.forEach((row, index) => { row.device_type = deviceTypes[index]; });
  let reads = 0;
  const pool = { query: async (sql, params) => {
    if (sql.startsWith('SELECT user_id FROM domains')) return [[...(['mice', 'second'].includes(params[0]) && params[1] === 1 ? [{ user_id: 1 }] : [])]];
    assert.match(sql, /FLOOR\(UNIX_TIMESTAMP\(created_at\) \/ 86400\)/);
    assert.match(sql, /domain_key = \? AND user_id = \?/);
    assert.match(sql, /COALESCE\(p256dh, ''\) <> '' AND COALESCE\(auth, ''\) <> ''/);
    assert.match(sql, /created_at >= FROM_UNIXTIME\(\?\) AND created_at < FROM_UNIXTIME\(\?\)/);
    reads++;
    const grouped = new Map();
    for (const row of records) {
      const timestamp = Date.parse(row.day + 'T00:00:00Z') / 1000;
      if (row.key === params[0] && row.owner === params[1] && row.complete && timestamp >= params[2] && timestamp < params[3]) {
        const bucket = grouped.get(timestamp / 86400) || { subscribers: 0, desktop: 0, mobile: 0 };
        bucket.subscribers++; if (['desktop', 'mobile'].includes(row.device_type)) bucket[row.device_type]++;
        grouped.set(timestamp / 86400, bucket);
      }
    }
    return [[...grouped].map(([day_number, counts]) => ({ day_number, ...Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, String(value)])) }))];
  } };
  const app = createApp({ pool, webpush: {}, adminUsername: 'admin', adminPassword: 'analytics-test', secret: 'analytics-test-secret-long-enough-for-auth', publicApiBase: 'https://push.example.test', vapidSubject: 'mailto:test@example.test' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const { token } = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'analytics-test' }) })).json();
  const request = async (key = 'mice', query = 'start=2024-01-01&end=2024-01-02', auth = true) => {
    const response = await fetch(`${base}/api/domains/${key}/analytics?${query}`, { headers: auth ? { Authorization: `Bearer ${token}` } : {} });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  };
  return { request, reads: () => reads };
}

test('analytics require login and scope dates to complete saved records for this website and owner', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('mice', undefined, false)).status, 401);
  const result = await f.request();
  assert.equal(result.status, 200); assert.equal(result.cache, 'no-store');
  assert.deepEqual(result.data.daily, [{ date: '2024-01-01', added: 1, desktop: 0, mobile: 0, device_unknown: 1 }, { date: '2024-01-02', added: 2, desktop: 0, mobile: 0, device_unknown: 2 }]);
  assert.equal(result.data.added, 3);
  assert.equal(result.data.unsubscribed, null); assert.equal(result.data.net, null); assert.equal(result.data.mobile, null);
  assert.equal(result.data.browser.available, false);
  assert.equal(JSON.stringify(result).includes('endpoint'), false);
  assert.equal((await f.request('second')).data.added, 1);
  assert.equal((await f.request('missing')).status, 404);
});

test('valid empty periods include daily zeros while invalid or oversized ranges never query subscriptions', async t => {
  const f = await fixture(t);
  const empty = await f.request('mice', 'start=2024-02-01&end=2024-02-03');
  assert.equal(empty.data.added, 0);
  assert.deepEqual(empty.data.daily.map(day => day.added), [0, 0, 0]);
  const before = f.reads();
  for (const query of ['start=2024-01-01', 'start=bad&end=bad', 'start=2024-01-01&end=2025-01-01']) assert.equal((await f.request('mice', query)).status, 400);
  assert.equal(f.reads(), before);
});


test('period device counts reconcile with unknowns and stay scoped to selected dates, website and owner', async t => {
  const f = await fixture(t, ['desktop', 'mobile', null, 'desktop', 'mobile', 'mobile', 'desktop']);
  const { data } = await f.request();
  assert.equal(data.added, 3); assert.equal(data.desktop, 1); assert.equal(data.mobile, 1);
  assert.equal(data.device_unknown, 1); assert.equal(data.device_recorded, 2); assert.equal(data.device_available, true);
  for (const day of data.daily) assert.equal(day.desktop + day.mobile + day.device_unknown, day.added);
  assert.equal(data.daily[0].desktop, 1); assert.equal(data.daily[1].mobile, 1);
  assert.equal((await f.request('second')).data.mobile, 1);
});

test('an all-desktop audience reports real desktop counts and zero mobile instead of null', async t => {
  const f = await fixture(t, ['desktop', 'desktop', 'desktop']);
  const { data } = await f.request();
  assert.equal(data.desktop, 3); assert.equal(data.mobile, 0); assert.equal(data.device_unknown, 0);
  assert.equal(data.device_available, true); assert.equal(data.app, null); assert.equal(data.unsubscribed, null);
});
