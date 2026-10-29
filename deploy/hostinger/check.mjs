// Run inside the API container through stdin. Never sends notifications.
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import crypto from 'node:crypto';

const base = 'http://127.0.0.1:5000';
for (const route of ['/sdk/push.js', '/push-sw.js', '/downloads/push-notifications-plugin.zip']) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, `${route} must be available`);
  await response.arrayBuffer();
  console.log(`${route}: OK`);
}
assert.equal((await fetch(base + '/api/domains')).status, 401, 'Admin routes must require login');
// Passwords can change in the dashboard. The internal probe signs a short-lived
// session using the stored version, without overwriting the human last-login record.
const authDb = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
let accountVersion;
try {
  const [[account]] = await authDb.query('SELECT session_version FROM admin_accounts WHERE id = 1');
  assert.ok(account?.session_version, 'Persistent administrator account must exist');
  accountVersion = account.session_version;
} finally { await authDb.end(); }
const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 120000, v: accountVersion })).toString('base64url');
const signature = crypto.createHmac('sha256', process.env.PUSH_API_SECRET).update(`session:${payload}`).digest('base64url');
const session = { token: `${payload}.${signature}` };
assert.equal((await fetch(base + '/api/account')).status, 401, 'Account must require login');
const profile = await fetch(base + '/api/account', { headers: { Authorization: `Bearer ${session.token}` } });
assert.equal(profile.status, 200, 'Account API must be available');
const account = (await profile.json()).data;
assert.equal(typeof account.username, 'string');
assert.equal(account.password_hash, undefined);
assert.equal(account.session_version, undefined);
console.log('Account API: OK');
const domains = await fetch(base + '/api/domains', { headers: { Authorization: `Bearer ${session.token}` } });
assert.equal(domains.status, 200, 'Authenticated database access must succeed');
const domainList = await domains.json();
assert.ok(Array.isArray(domainList.data), 'Domain API must return a list');
for (const domain of domainList.data) {
  assert.equal(typeof domain.is_configured, 'boolean', 'Domain push configuration must be an explicit boolean');
  assert.ok(typeof domain.display_name === 'string' && domain.display_name.length > 0, 'Domains must have a friendly name or hostname fallback');
  const route = '/api/domains/' + encodeURIComponent(domain.domain_key) + '/overview';
  assert.equal((await fetch(base + route)).status, 401, 'Overview must require login');
  const response = await fetch(base + route, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(response.status, 200, 'Domain overview must be available');
  const { data } = await response.json();
  assert.ok(Number.isSafeInteger(data.subscribers.total) && data.subscribers.total >= 0, 'Subscriber counts must be nonnegative integers');
  assert.equal(data.subscribers.web, data.subscribers.total, 'Current subscriptions use browser push');
  assert.equal(data.domain.vapid_private_key, undefined, 'Dashboard must not expose private keys');
  console.log('Domain overview: OK; saved browser subscriptions:', data.subscribers.total);
  const audienceRoute = '/api/domains/' + encodeURIComponent(domain.domain_key) + '/audience';
  assert.equal((await fetch(base + audienceRoute)).status, 401, 'Audience locations must require login');
  const audienceResponse = await fetch(base + audienceRoute, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(audienceResponse.status, 200, 'Audience map data must be available');
  const audience = (await audienceResponse.json()).data;
  assert.equal(audience.total, data.subscribers.total, 'Country counts must cover only this domain audience');
  assert.equal(audience.located + audience.unknown, audience.total);
  console.log('Audience countries: OK; located:', audience.located, 'unknown:', audience.unknown);
  const analyticsRoute = '/api/domains/' + encodeURIComponent(domain.domain_key) + '/analytics';
  assert.equal((await fetch(base + analyticsRoute)).status, 401, 'Subscriber analytics must require login');
  const analyticsResponse = await fetch(base + analyticsRoute, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(analyticsResponse.status, 200, 'Subscriber date analytics must be available');
  const analytics = (await analyticsResponse.json()).data;
  assert.ok(Array.isArray(analytics.daily) && analytics.daily.length > 0);
  assert.equal(analytics.daily.reduce((total, day) => total + day.added, 0), analytics.added);
  assert.equal(analytics.range.time_zone, 'UTC');
  assert.equal(analytics.unsubscribed, null);
  console.log('Subscriber analytics: OK; saved additions in period:', analytics.added);
  const settingsRoute = '/api/domains/' + encodeURIComponent(domain.domain_key) + '/settings';
  assert.equal((await fetch(base + settingsRoute)).status, 401, 'Settings must require login');
  const settingsResponse = await fetch(base + settingsRoute, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(settingsResponse.status, 200, 'Domain settings must be available');
  const settings = (await settingsResponse.json()).data;
  assert.equal(typeof settings.time_zone, 'string', 'A time zone must be available');
  new Intl.DateTimeFormat('en', { timeZone: settings.time_zone });
  assert.equal(settings.vapid_private_key, undefined, 'Settings must not expose private push credentials');
  console.log('Domain settings: OK');
  const pwaRoute = '/api/domains/' + encodeURIComponent(domain.domain_key) + '/pwa';
  assert.equal((await fetch(base + pwaRoute)).status, 401, 'PWA settings must require login');
  const pwaResponse = await fetch(base + pwaRoute, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(pwaResponse.status, 200, 'PWA settings must be available');
  const pwa = (await pwaResponse.json()).data;
  assert.equal(typeof pwa.settings.name, 'string');
  assert.equal(typeof pwa.saved, 'boolean');
  assert.equal(pwa.vapid_private_key, undefined);
  console.log('PWA settings: OK');
}
console.log('Admin authentication and domain API: OK');
console.log('Configured push integrations:', domainList.data.filter(domain => domain.is_configured).length);

// A read-only public probe checks that the existing Cloudflare/Caddy header
// path can provide a country. It does not save a subscription or retain an IP.
if (domainList.data.length && process.env.PUBLIC_API_BASE === 'https://push.micetraveladvisor.com') {
  try {
    const route = '/api/domains/' + encodeURIComponent(domainList.data[0].domain_key) + '/audience';
    const response = await fetch(process.env.PUBLIC_API_BASE + route, { headers: { Authorization: `Bearer ${session.token}` }, signal: AbortSignal.timeout(15000) });
    if (response.ok) {
      const { data } = await response.json();
      console.log('Cloudflare country capture on public API:', data.capture_available ? 'available' : 'not available on probe');
    } else console.log('Cloudflare country capture: public probe unavailable');
  } catch { console.log('Cloudflare country capture: public probe unavailable'); }
}

const db = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});
try {
  const [[counts]] = await db.query('SELECT (SELECT COUNT(*) FROM domains) AS domains, (SELECT COUNT(*) FROM subscriptions) AS subscriptions, (SELECT COUNT(*) FROM domains WHERE vapid_private_key IS NOT NULL AND vapid_private_key <> "") AS domains_with_private_keys');
  console.log('Database counts (compare with Cloudways):', counts);
} finally {
  await db.end();
}
