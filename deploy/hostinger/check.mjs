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
  const settingsRoute = '/api/domains/' + encodeURIComponent(domain.domain_key) + '/settings';
  assert.equal((await fetch(base + settingsRoute)).status, 401, 'Settings must require login');
  const settingsResponse = await fetch(base + settingsRoute, { headers: { Authorization: `Bearer ${session.token}` } });
  assert.equal(settingsResponse.status, 200, 'Domain settings must be available');
  const settings = (await settingsResponse.json()).data;
  assert.equal(typeof settings.time_zone, 'string', 'A time zone must be available');
  new Intl.DateTimeFormat('en', { timeZone: settings.time_zone });
  assert.equal(settings.vapid_private_key, undefined, 'Settings must not expose private push credentials');
  console.log('Domain settings: OK');
}
console.log('Admin authentication and domain API: OK');
console.log('Configured push integrations:', domainList.data.filter(domain => domain.is_configured).length);

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
