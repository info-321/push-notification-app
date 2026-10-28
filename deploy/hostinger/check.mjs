// Run inside the API container through stdin. Never sends notifications.
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';

const base = 'http://127.0.0.1:5000';
for (const route of ['/sdk/push.js', '/push-sw.js', '/downloads/push-notifications-plugin.zip']) {
  const response = await fetch(base + route);
  assert.equal(response.status, 200, `${route} must be available`);
  await response.arrayBuffer();
  console.log(`${route}: OK`);
}
assert.equal((await fetch(base + '/api/domains')).status, 401, 'Admin routes must require login');
const login = await fetch(base + '/api/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD }),
});
assert.equal(login.status, 200, 'Admin login must succeed');
const session = await login.json();
assert.ok(session.token, 'Login must return a session token');
const domains = await fetch(base + '/api/domains', { headers: { Authorization: `Bearer ${session.token}` } });
assert.equal(domains.status, 200, 'Authenticated database access must succeed');
const domainList = await domains.json();
assert.ok(Array.isArray(domainList.data), 'Domain API must return a list');
for (const domain of domainList.data) {
  assert.equal(typeof domain.is_configured, 'boolean', 'Domain push configuration must be an explicit boolean');
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
