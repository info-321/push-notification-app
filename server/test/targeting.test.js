import {fetch} from './browser-client.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createApp } from '../app.js';
import { normalizeTargeting, readTargeting, requestTarget, targetAllowed } from '../targeting.js';
import { parsePushAudience, pushAudienceWhere } from '../push-audience.js';
import { ensureTargeting } from '../domain-schema.js';
import { prepareNotification, deliverNotification } from '../notification-delivery.js';

const apple = { mode: 'selected', devices: ['mac', 'ipad', 'iphone'], browsers: ['Safari', 'home_screen'], version: 1 };
const agents = {
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/17.0 Safari/605.1.15',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/605.1.15',
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Mobile Safari/605.1.15',
  android_phone: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Mobile Safari/537.36',
  android_tablet: 'Mozilla/5.0 (Linux; Android 14) Chrome/140.0 Safari/537.36',
  other: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0',
};
const req = ua => ({ get: key => key === 'User-Agent' ? ua : undefined });
test('targeting separates Apple hardware from browsers and recognizes installed web apps without storing raw headers', () => {
  for (const [device, ua] of Object.entries(agents)) assert.equal(requestTarget(req(ua)).device, device);
  assert.deepEqual(requestTarget(req(agents.mac), { ipad: true, standalone: true }), { device: 'ipad', browser: 'home_screen' });
  assert.equal(requestTarget(req(agents.iphone), { standalone: true }).browser, 'home_screen');
  assert.equal(requestTarget(req(agents.windows), { standalone: true }).browser, 'Chrome');
  for (const [token, browser] of [['Edg/140.0', 'Edge'], ['OPR/140.0', 'Opera'], ['Firefox/140.0', 'Firefox']]) assert.equal(requestTarget(req(agents.mac.replace('Version/17.0 Safari/605.1.15', token))).browser, browser);
  assert.equal(targetAllowed(apple, requestTarget(req(agents.mac))), true);
  assert.equal(targetAllowed(apple, requestTarget(req(agents.windows))), false);
  assert.equal(targetAllowed(apple, requestTarget(req(agents.mac.replace('Version/17.0', 'Chrome/140.0')))), false);
  for (const agent of ['unknown', 'curl/1', 'Googlebot', 'a'.repeat(3000)]) assert.deepEqual(requestTarget(req(agent)), { device: null, browser: null });
  assert.equal(targetAllowed(apple, { device: null, browser: null }), false);
  assert.deepEqual(requestTarget(req(agents.mac), null), { device: 'mac', browser: 'Safari' });
});
test('rules validate exact options, fail closed on corrupt saved rules, and combine campaign selections with website rules in parameterized SQL', () => {
  assert.equal(readTargeting(null).mode, 'all');
  assert.throws(() => readTargeting('{bad'));
  assert.throws(() => readTargeting({ mode: 'all', devices: [], browsers: [], version: '1' }));
  for (const value of [null, [], { mode: 'selected', devices: ['mac', 'mac'], browsers: [] }, { mode: 'selected', devices: ['alien'], browsers: [] }, { ...apple, version: undefined }]) assert.equal(normalizeTargeting(value), null);
  assert.ok(normalizeTargeting({ mode: 'selected', devices: [], browsers: [] }));
  const audience = parsePushAudience({ platform: 'desktop', devices: ['windows'], browsers: ['Chrome'], subscribed: 'all' });
  const where = pushAudienceWhere('site', audience, true, apple);
  assert.match(where.sql, /device_type = \?/); assert.match(where.sql, /target_device IN \(\?,\?,\?\).*target_browser IN \(\?,\?\).*target_device IN \(\?\).*target_browser IN \(\?\)/);
  assert.deepEqual(where.params, ['site', 1, 'desktop', ...apple.devices, ...apple.browsers, 'windows', 'Chrome']);
  for (const value of [{ devices: [] }, { devices: ['all'] }, { browsers: 'Safari' }, { browsers: ['Safari', 'Safari'] }, { browsers: ['Safari', "' OR 1=1"] }]) assert.equal(parsePushAudience(value), null);
  assert.match(pushAudienceWhere('site', parsePushAudience(), true, { mode: 'selected', devices: [], browsers: [] }).sql, /AND 1 = 0/);
});
test('targeting migrations are additive, repeatable and tolerate concurrent startup without rewriting subscribers', async () => {
  for (const present of [true, false]) {
    const writes = [];
    await ensureTargeting({ query: async sql => { if (sql.startsWith('SHOW')) return [present ? [{}] : []]; writes.push(sql); return [{}]; } });
    assert.equal(writes.length, present ? 0 : 3); for (const sql of writes) assert.match(sql, /^ALTER TABLE (domains|subscriptions) ADD COLUMN .+ NULL$/);
  }
  await ensureTargeting({ query: async sql => { if (sql.startsWith('SHOW')) return [[]]; throw Object.assign(new Error(), { code: 'ER_DUP_FIELDNAME' }); } });
  await assert.rejects(ensureTargeting({ query: async () => { throw new Error('storage'); } }), /storage/);
});

async function fixture(t) {
  const sent = [], saved = [], domain = { domain_key: 'site', domain_name: 'site.test', user_id: 1, targeting_policy: JSON.stringify(apple), vapid_public_key: 'public', vapid_private_key: 'private' };
  const subscriptions = [
    { id: 1, target_device: 'mac', target_browser: 'Safari', device_type: 'desktop' },
    { id: 2, target_device: 'windows', target_browser: 'Chrome', device_type: 'desktop' },
    { id: 3, target_device: 'ipad', target_browser: 'home_screen', device_type: 'mobile' },
    { id: 4, target_device: null, target_browser: null, device_type: 'desktop' },
  ].map(row => ({ ...row, endpoint: `https://fcm.googleapis.com/fcm/send/${row.id}`, p256dh: 'key', auth: 'auth' }));
  const pool = { query: async (sql, params = []) => {
    if (sql.startsWith('SELECT') && sql.includes('FROM domains')) return [params[0] === 'site' ? [domain] : []];
    if (sql.startsWith('UPDATE domains SET targeting_policy')) { if (readTargeting(domain.targeting_policy).version !== params[2]) return [{ affectedRows: 0 }]; domain.targeting_policy = params[0]; return [{ affectedRows: 1 }]; }
    if (sql.startsWith('INSERT INTO subscriptions')) { saved.push(params); return [{ insertId: 22 }]; }
    if (sql.startsWith('SELECT') && sql.includes('FROM subscriptions')) {
      if (sql.includes('WHERE endpoint')) return [[]];
      if (sql.includes('GROUP BY target_device, target_browser')) return [subscriptions.map(row => ({ target_device: row.target_device, target_browser: row.target_browser, subscribers: 1 }))];
      let rows = [...subscriptions], offset = 2;
      if (sql.includes('AND 1 = 0')) rows = [];
      for (const clause of sql.matchAll(/AND (device_type = \?|target_device IN \(([^)]+)\)|target_browser IN \(([^)]+)\))/g)) {
        const column = clause[1].split(' ')[0], n = clause[2] || clause[3] ? (clause[2] || clause[3]).split(',').length : 1;
        const allowed = params.slice(offset, offset + n); offset += n; rows = rows.filter(row => allowed.includes(row[column]));
      }
      return sql.includes('COUNT(*)') ? [[{ subscribers: rows.length, desktop: rows.filter(row => row.device_type === 'desktop').length, mobile: rows.filter(row => row.device_type === 'mobile').length }]] : [rows];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  } };
  const app = createApp({ pool, webpush: { sendNotification: async sub => sent.push(sub) }, adminUsername: 'admin', adminPassword: 'fixture-password', secret: 'isolated-targeting-test-secret-is-long', publicApiBase: 'https://api.test', vapidSubject: 'mailto:owner@site.test' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  let token;
  const call = async (route, method = 'GET', input, auth = false, headers = {}) => {
    const response = await fetch(base + route, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}), ...headers }, ...(input ? { body: JSON.stringify(input) } : {}) });
    return { status: response.status, cache: response.headers.get('cache-control'), ...await response.json() };
  };
  token = (await call('/api/login', 'POST', { username: 'admin', password: 'fixture-password' })).token;
  return { call, domain, sent, saved };
}
test('website rules require admin, enforce owner, reject stale writes and expose only eligibility to visitors', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('/api/domains/site/targeting')).status, 401);
  assert.equal((await f.call('/api/domains/site/targeting', 'PUT', { version: 1, policy: { mode: 'all', devices: [], browsers: [] } })).status, 401);
  assert.equal((await f.call('/api/domains/missing/targeting', 'GET', null, true)).status, 404);
  const read = await f.call('/api/domains/site/targeting', 'GET', null, true); assert.equal(read.cache, 'no-store'); assert.equal(read.data.mode, 'selected');
  const headers = { Origin: 'https://www.site.test', 'User-Agent': agents.mac };
  let result = await f.call('/api/targeting/site', 'GET', null, false, headers); assert.equal(result.data.allowed, true); assert.equal(result.data.device, 'mac'); assert.equal(result.data.browser, 'Safari'); assert.equal(result.cache, 'no-store');
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.equal((await f.call('/api/targeting/site', 'GET', null, false, { ...headers, Origin: 'https://evil.test' })).status, 403);
  result = await f.call('/api/targeting/site', 'GET', null, false, { ...headers, 'User-Agent': agents.windows }); assert.equal(result.data.allowed, false);
  result = await f.call('/api/targeting/site?ipad=1&standalone=1', 'GET', null, false, headers); assert.equal(result.data.device, 'ipad'); assert.equal(result.data.browser, 'home_screen');
  const policy = { mode: 'selected', devices: ['iphone'], browsers: ['home_screen'] };
  assert.equal((await f.call('/api/domains/site/targeting', 'PUT', { version: 1, policy }, true)).status, 200);
  assert.equal((await f.call('/api/domains/site/targeting', 'PUT', { version: 1, policy: { mode: 'all', devices: [], browsers: [] } }, true)).status, 409);
  assert.equal(readTargeting(f.domain.targeting_policy).mode, 'selected');
});
test('preview, direct tests and WordPress sends enforce website restrictions even without campaign filters', async t => {
  const f = await fixture(t);
  const preview = await f.call('/api/domains/site/send-audience?platform=all&subscribed=all', 'GET', null, true); assert.equal(preview.data.matching, 2);
  const input = { domain_key: 'site', title: 'Fixture', url: '/', audience: { platform: 'all', subscribed: 'all' } };
  const result = await f.call('/api/notifications', 'POST', input, true); assert.equal(result.total, 2); assert.equal(f.sent.length, 2);
  assert.deepEqual(f.sent.map(sub => sub.endpoint.split('/').at(-1)), ['1', '3']);
  f.sent.length = 0;
  const integration = await f.call('/api/domains/site/integration', 'GET', null, true);
  const wp = await f.call('/api/notifications', 'POST', { domain_key: 'site', title: 'WordPress fixture' }, false, { 'X-Api-Key': integration.data.sender_api_key, 'X-Push-Source': 'wordpress' }); assert.equal(wp.total, 2); assert.equal(f.sent.length, 2);
  f.sent.length = 0;
  const narrower = { ...input, audience: { ...input.audience, devices: ['windows'], browsers: ['Chrome'] } };
  const blocked = await f.call('/api/notifications/compose', 'POST', narrower, true); assert.equal(blocked.total, 0); assert.equal(f.sent.length, 0);
  const selected = await f.call('/api/notifications/compose', 'POST', { ...input, audience: { ...input.audience, devices: ['ipad'], browsers: ['home_screen'] } }, true); assert.equal(selected.total, 1);
  const query = new URLSearchParams({ devices: JSON.stringify(['ipad']), browsers: JSON.stringify(['home_screen']) });
  assert.equal((await f.call(`/api/domains/site/send-audience?${query}`, 'GET', null, true)).data.matching, 1);
  assert.equal((await f.call('/api/notifications/compose', 'POST', { ...input, audience: { ...input.audience, browsers: ['unsupported'] } }, true)).status, 400);
  f.domain.targeting_policy = JSON.stringify({ mode: 'selected', devices: [], browsers: [], version: 2 }); f.sent.length = 0;
  assert.equal((await f.call('/api/notifications', 'POST', input, true)).total, 0); assert.equal(f.sent.length, 0);
});
test('disallowed subscriptions cannot be inserted and Apple Home Screen context is saved for eligible browsers', async t => {
  const f = await fixture(t), subscription = { endpoint: 'https://web.push.apple.com/fixture', keys: { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') } };
  const input = { domain_key: 'site', subscription, target_device: 'mac', target_browser: 'Safari' };
  const headers = { Origin: 'https://site.test', 'User-Agent': agents.windows };
  assert.equal((await f.call('/api/subscriptions', 'POST', input, false, headers)).status, 403); assert.equal(f.saved.length, 0);
  const ok = await f.call('/api/subscriptions', 'POST', { ...input, client_context: { standalone: true } }, false, { ...headers, 'User-Agent': agents.iphone });
  assert.equal(ok.status, 200); assert.equal(f.saved[0][11], 'iphone'); assert.equal(f.saved[0][12], 'home_screen');
  assert.equal(f.saved[0].some(value => value === agents.iphone), false);
});

test('subscription diagnostics show recorded categories before campaign rules and never expose individual subscription credentials', async t => {
  const f = await fixture(t), route = '/api/domains/site/subscription-diagnostics';
  assert.equal((await f.call(route)).status, 401);
  assert.equal((await f.call('/api/domains/another/subscription-diagnostics', 'GET', null, true)).status, 404);
  const result = await f.call(route, 'GET', null, true);
  assert.equal(result.status, 200); assert.equal(result.cache, 'no-store');
  assert.equal(result.data.total, 4); assert.equal(result.data.unclassified, 1);
  assert.equal(result.data.groups.find(row => row.device === 'windows').allowed, false);
  assert.equal(result.data.groups.find(row => row.device === 'ipad').browser, 'home_screen');
  assert.equal(result.data.groups.find(row => row.device === 'ipad').allowed, true);
  for (const value of ['endpoint', 'p256dh', 'vapid_', 'fcm.googleapis.com']) assert.equal(JSON.stringify(result).includes(value), false);
  assert.equal(f.sent.length, 0); assert.equal(f.saved.length, 0);
});

test('SDK checks eligibility before Apple help, permission or worker registration; unavailable and older APIs fail closed', async () => {
  const sdk = readFileSync(new URL('../../client/public/sdk/push.js', import.meta.url), 'utf8');
  for (const answer of [{ ok: true, data: { allowed: false } }, { ok: true, data: {} }, null]) {
    let workers = 0, helpers = 0, permission = 0;
    const window = { isSecureContext: true, pushConfig: { apiBase: 'https://api.test', domainKey: 'site', vapidPublicKey: 'public' }, PushAppleInstall: { mount: () => helpers++ }, matchMedia: () => ({ matches: false }) };
    await vm.runInNewContext(sdk, { window, navigator: { userAgent: agents.iphone, serviceWorker: { register: () => workers++ } }, Notification: { requestPermission: () => permission++ }, AbortController, setTimeout, clearTimeout, fetch: async () => { if (!answer) throw new Error('offline'); return { ok: true, json: async () => answer }; }, console: { warn() {} } });
    assert.equal(workers, 0); assert.equal(helpers, 0); assert.equal(permission, 0);
  }
});
test('SDK preserves another provider worker and never unregisters or steals its subscription', async () => {
  const sdk = readFileSync(new URL('../../client/public/sdk/push.js', import.meta.url), 'utf8');
  let workers = 0, subscriptionReads = 0;
  const window = { isSecureContext: true, pushConfig: { apiBase: 'https://api.test', domainKey: 'site', vapidPublicKey: Buffer.alloc(65, 1).toString('base64url') }, Notification: {}, PushManager: {}, matchMedia: () => ({ matches: false }), dispatchEvent() {} };
  const context = { window, navigator: { userAgent: agents.mac, serviceWorker: { getRegistrations: async () => [{ scope: 'https://site.test/', active: { scriptURL: 'https://site.test/feedify-sw.js' }, pushManager: { getSubscription: () => subscriptionReads++ } }], register: () => workers++ } }, Notification: { permission: 'default' }, location: { origin: 'https://site.test' }, URL, AbortController, setTimeout, clearTimeout, atob: v => Buffer.from(v, 'base64').toString('binary'), CustomEvent: class {}, fetch: async () => ({ ok: true, json: async () => ({ ok: true, data: { allowed: true } }) }), console: { warn() {}, error() {} } };
  await vm.runInNewContext(sdk, context); assert.equal(workers, 0); assert.equal(subscriptionReads, 0);
});

test('a changed website rule interrupts remaining batches without retrying notifications already attempted', async () => {
  const domain = { domain_name: 'site.test', targeting_policy: null, vapid_public_key: 'public', vapid_private_key: 'private' }, sent = [];
  const subscriptions = Array.from({ length: 12 }, (_, id) => ({ id, endpoint: `https://fcm.googleapis.com/fcm/send/${id}`, p256dh: 'key', auth: 'auth' }));
  const pool = { query: async sql => sql.includes('FROM subscriptions') ? [subscriptions] : [[{ targeting_policy: JSON.stringify(apple) }]] };
  const prepared = prepareNotification({ title: 'Fixture' }, domain);
  await assert.rejects(deliverNotification({ pool, vapidSubject: 'mailto:owner@site.test', webpush: { sendNotification: async sub => sent.push(sub) } }, domain, 'site', prepared), error => error.status === 409);
  assert.equal(sent.length, 10); assert.equal(new Set(sent.map(sub => sub.endpoint)).size, 10);
});

test('the SDK refuses to save an existing subscription restricted to another application-server key', async () => {
  const sdk = readFileSync(new URL('../../client/public/sdk/push.js', import.meta.url), 'utf8');
  const subscription = { options: { applicationServerKey: new Uint8Array(65).fill(2).buffer } };
  let saves = 0, subscriptions = 0;
  const window = { isSecureContext: true, pushConfig: { apiBase: 'https://api.test', domainKey: 'site', vapidPublicKey: Buffer.alloc(65, 1).toString('base64url') }, Notification: {}, PushManager: {}, matchMedia: () => ({ matches: false }), dispatchEvent() {} };
  await vm.runInNewContext(sdk, { window, navigator: { userAgent: agents.mac, serviceWorker: { register: async () => ({ active: true, pushManager: { getSubscription: async () => subscription, subscribe: async () => subscriptions++ } }) } }, Notification: { permission: 'granted' }, location: { origin: 'https://site.test' }, URL, AbortController, setTimeout, clearTimeout, atob: v => Buffer.from(v, 'base64').toString('binary'), CustomEvent: class {}, fetch: async (url, options) => { if (options?.method === 'POST') saves++; return { ok: true, json: async () => ({ ok: true, data: { allowed: true } }) }; }, console: { error() {}, warn() {} } });
  assert.equal(saves, 0); assert.equal(subscriptions, 0);
});
