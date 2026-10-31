// Opt-in integration test: only the disposable CI MySQL service is used.
// Never reads .env or contacts a push provider.
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import mysql from 'mysql2/promise';
import { createApp } from '../app.js';
import * as migrations from '../domain-schema.js';
import { ensureSchedules, createScheduleWorker, scheduleGraceMs } from '../schedules.js';
import { ensureReports, createCampaignReporter } from '../reports.js';

test('MySQL scheduler transactions, ownership, idempotency, concurrency and restart recovery', { skip: process.env.SCHEDULE_TEST_MYSQL !== '1' }, async t => {
  const pool = mysql.createPool({ host: '127.0.0.1', port: 33309, user: 'root', password: 'disposable-scheduler-ci', database: 'scheduler_test', multipleStatements: true, connectionLimit: 10, timezone: 'Z' });
  t.after(() => pool.end());
  const [[db]] = await pool.query('SELECT DATABASE() AS name');
  assert.equal(db.name, 'scheduler_test');
  await pool.query(await fs.readFile(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  for (const migrate of Object.values(migrations)) await migrate(pool);
  await ensureSchedules(pool); await ensureSchedules(pool); await ensureReports(pool); // Restart migration is harmless.
  for (const [key, owner] of [['site', 1], ['other', 2]]) await pool.query('INSERT INTO domains (user_id, domain_name, domain_key, verification_token, vapid_public_key, vapid_private_key) VALUES (?, ?, ?, ?, ?, ?)', [owner, `${key}.test`, key, 'test-verification', 'test-public', 'test-private']);
  const insertSub = async (endpoint, device = 'desktop', owner = 1, key = 'site') => pool.query('INSERT INTO subscriptions (user_id, domain_key, endpoint, p256dh, auth, device_type) VALUES (?, ?, ?, ?, ?, ?)', [owner, key, `https://fcm.googleapis.com/fcm/send/${endpoint}`, 'fixture-public', 'fixture-auth', device]);
  await insertSub('desktop'); await insertSub('mobile', 'mobile'); await insertSub('unknown', null); await insertSub('another-owner', 'desktop', 2);
  let sent = [], behavior = async () => {};
  const webpush = { sendNotification: async (sub, body, options) => { sent.push({ sub, body: JSON.parse(body), options }); await behavior(sub); } };
  const reporting = createCampaignReporter({ pool, secret: 'isolated-test-secret-32-characters-long', publicApiBase: 'https://api.test' });
  const app = createApp({ pool, webpush, reporting, adminUsername: 'fixture', adminPassword: 'fixture-password', secret: 'isolated-test-secret-32-characters-long', publicApiBase: 'https://api.test', vapidSubject: 'mailto:test@example.test' });
  const server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let token;
  const request = async (path, method = 'GET', input, authenticated = true, extraHeaders = {}) => {
    const response = await fetch(baseUrl + path, { method, headers: { 'Content-Type': 'application/json', ...(authenticated && token ? { Authorization: `Bearer ${token}` } : {}), ...extraHeaders }, ...(input ? { body: JSON.stringify(input) } : {}) });
    return { status: response.status, ...await response.json() };
  };
  token = (await request('/api/login', 'POST', { username: 'fixture', password: 'fixture-password' })).token;
  assert.ok(token);
  const startMs = Math.ceil((Date.now() + 10 * 60000) / 60000) * 60000;
  const start = new Date(startMs).toISOString().slice(0, 16);
  const once = { kind: 'once', time_zone: 'UTC', start };
  const recurring = { ...once, kind: 'recurring', frequency: 'daily', interval: 1, end_mode: 'count', count: 3 };
  const input = (schedule = once, audience = { platform: 'desktop', subscribed: 'all' }) => ({ domain_key: 'site', request_key: crypto.randomUUID(), title: 'Scheduled news', body: 'Fixture only', url: '/article', icon: '', banner: { enabled: true, image: 'https://cdn.test/banner.png', actions: [{ title: 'Read More', url: '', type: 'link' }] }, audience, schedule });
  const getJob = async id => (await pool.query('SELECT * FROM notification_schedules WHERE id = ?', [id]))[0][0];
  const clearJobs = async () => { await pool.query('DELETE FROM push_campaign_recipients'); await pool.query('DELETE FROM push_campaigns'); await pool.query('DELETE FROM notification_schedule_runs'); await pool.query('DELETE FROM notification_schedules'); sent = []; behavior = async () => {}; };
  const worker = clock => createScheduleWorker({ pool, webpush, reporting: createCampaignReporter({ pool, secret: 'isolated-test-secret-32-characters-long', publicApiBase: 'https://api.test', now: () => clock }), vapidSubject: 'mailto:test@example.test', now: () => clock, logger: { error: (...args) => { throw new Error(args.join(' ')); } } });

  await t.test('routes require an administrator, enforce ownership, and preview does not create or send', async () => {
    for (const path of ['/api/schedules/status', '/api/domains/site/schedules', '/api/schedules/missing/runs']) assert.equal((await request(path, 'GET', null, false)).status, 401);
    for (const path of ['/api/schedules', '/api/schedules/preview']) assert.equal((await request(path, 'POST', input(), false)).status, 401);
    assert.equal((await request('/api/schedules/missing', 'PATCH', { action: 'pause' }, false)).status, 401);
    assert.equal((await request('/api/domains/other/schedules')).status, 404);
    assert.equal((await request('/api/schedules', 'POST', { ...input(), domain_key: 'other' })).status, 404);
    assert.equal((await request('/api/schedules/preview', 'POST', { schedule: once })).data.upcoming[0], new Date(startMs).toISOString());
    const [[count]] = await pool.query('SELECT COUNT(*) AS n FROM notification_schedules'); assert.equal(count.n, 0); assert.equal(sent.length, 0);
    for (const patch of [{ audience: {} }, { title: '' }, { url: 'https://evil.test/' }, { schedule: { ...once, start: '2000-01-01T00:00' } }]) assert.equal((await request('/api/schedules', 'POST', { ...input(), ...patch })).status, 400);
  });
  await t.test('concurrent duplicate requests save once and two workers send a due occurrence once', async () => {
    const body = input();
    const results = await Promise.all([request('/api/schedules', 'POST', body), request('/api/schedules', 'POST', body)]);
    assert.deepEqual(results.map(r => r.status).sort(), [200, 201]); assert.equal(results[0].data.id, results[1].data.id);
    assert.equal((await request('/api/schedules', 'POST', { ...body, title: 'Different content' })).status, 409);
    assert.equal(JSON.stringify(results).includes('test-private'), false);
    assert.equal((await request('/api/domains/site/schedules')).data.total, 1);
    assert.equal(sent.length, 0);
    behavior = async () => new Promise(resolve => setTimeout(resolve, 60));
    await Promise.all([worker(startMs).tick(), worker(startMs).tick()]);
    assert.equal(sent.length, 1); assert.match(sent[0].sub.endpoint, /desktop$/); assert.equal(sent[0].body.url, '/article'); assert.equal(sent[0].body.actions[0].url, '/article'); assert.equal(sent[0].body.image, body.banner.image);
    assert.equal((await getJob(results[0].data.id)).status, 'completed');
    await worker(startMs).tick(); assert.equal(sent.length, 1);
    assert.equal((await request(`/api/schedules/${results[0].data.id}/runs`)).data.length, 1);
    assert.equal((await request('/api/schedules/status')).data.running, true);
  });
  await t.test('pause, resume and cancel persist and cannot access another owner or resurrect completed jobs', async () => {
    await clearJobs(); const saved = await request('/api/schedules', 'POST', input()); const id = saved.data.id;
    assert.equal((await request(`/api/schedules/${id}`, 'PATCH', { action: 'pause' })).status, 200);
    await worker(startMs).tick(); assert.equal(sent.length, 0);
    assert.equal((await request(`/api/schedules/${id}`, 'PATCH', { action: 'resume' })).status, 200);
    assert.equal((await request(`/api/schedules/${id}`, 'PATCH', { action: 'cancel' })).status, 200);
    await worker(startMs).tick(); assert.equal(sent.length, 0);
    assert.equal((await request(`/api/schedules/${id}`, 'PATCH', { action: 'resume' })).status, 400);
    await pool.query('UPDATE notification_schedules SET user_id = 2 WHERE id = ?', [id]);
    assert.equal((await request(`/api/schedules/${id}`, 'PATCH', { action: 'cancel' })).status, 404);
    assert.equal((await request(`/api/schedules/${id}/runs`)).status, 404);
  });
  await t.test('recurrence reevaluates audience at execution, expires invalid endpoints, and records provider failures without retry', async () => {
    await clearJobs(); const id = (await request('/api/schedules', 'POST', input(recurring))).data.id;
    await insertSub('new-desktop'); // Joined after the schedule was saved.
    behavior = async sub => { if (sub.endpoint.endsWith('/desktop')) throw { statusCode: 410 }; if (sub.endpoint.endsWith('/new-desktop')) throw { statusCode: 503 }; };
    await worker(startMs).tick(); assert.equal(sent.length, 2);
    let job = await getJob(id); assert.equal(job.status, 'active'); assert.equal(Number(job.next_run_ms), startMs + 86400000);
    assert.equal(job.last_result.failed, 1); assert.equal(job.last_result.removed, 1);
    assert.equal((await pool.query("SELECT id FROM subscriptions WHERE endpoint LIKE '%/desktop'"))[0].length, 0);
    await worker(startMs + 1000).tick(); assert.equal(sent.length, 2);
    await worker(startMs + 86400000).tick(); assert.equal(sent.length, 3);
    assert.equal((await request(`/api/schedules/${id}/runs`)).data.length, 2);
  });
  await t.test('late work is skipped without a catch-up burst, including exhausted one-time and recurring schedules', async () => {
    await clearJobs(); const a = (await request('/api/schedules', 'POST', input())).data.id; const b = (await request('/api/schedules', 'POST', input(recurring))).data.id;
    await worker(startMs + scheduleGraceMs + 1).tick(); assert.equal(sent.length, 0);
    assert.equal((await getJob(a)).status, 'missed'); assert.equal(Number((await getJob(b)).next_run_ms), startMs + 86400000);
    await worker(startMs + 10 * 86400000).tick(); assert.equal((await getJob(b)).status, 'completed'); assert.equal(sent.length, 0);
  });
  await t.test('restart holds uncertain sends for review and never resends a consumed occurrence', async () => {
    await clearJobs(); const id = (await request('/api/schedules', 'POST', input(recurring))).data.id;
    await pool.query("UPDATE notification_schedules SET status = 'running', next_index = 1, run_count = 1 WHERE id = ?", [id]);
    await pool.query("INSERT INTO notification_schedule_runs (id, schedule_id, due_ms, status, started_ms) VALUES (?, ?, ?, 'sending', ?)", [crypto.randomUUID(), id, startMs, startMs]);
    await worker(startMs).tick(); assert.equal(sent.length, 0); assert.equal((await getJob(id)).status, 'needs_review');
    assert.equal((await request(`/api/schedules/${id}/runs`)).data[0].status, 'interrupted');
    assert.equal((await request(`/api/schedules/${id}`, 'PATCH', { action: 'resume' })).status, 200);
    assert.equal(Number((await getJob(id)).next_run_ms), startMs + 86400000);
  });
  await t.test('runtime interruption after a batch records partial progress and holds future sends', async () => {
    await clearJobs(); const id = (await request('/api/schedules', 'POST', input(recurring))).data.id;
    behavior = async () => { await pool.query('UPDATE notification_schedules SET claim_token = NULL WHERE id = ?', [id]); };
    await worker(startMs).tick(); assert.equal(sent.length, 1);
    // A changed claim cannot be finished; next process recovers the abandoned send.
    await worker(startMs).tick(); assert.equal((await getJob(id)).status, 'needs_review'); assert.equal(sent.length, 1);
    const run = (await request(`/api/schedules/${id}/runs`)).data[0]; assert.equal(run.status, 'interrupted'); assert.equal(run.result.sent, 1);
  });
  await t.test('empty future audiences complete without sending and no pending jobs are lost on worker recreation', async () => {
    await clearJobs(); const id = (await request('/api/schedules', 'POST', input(once, { platform: 'mobile', subscribed: 'all' }))).data.id;
    await pool.query("DELETE FROM subscriptions WHERE device_type = 'mobile'");
    await worker(startMs - 1).tick(); assert.equal((await getJob(id)).status, 'active');
    await worker(startMs).tick(); assert.equal((await getJob(id)).status, 'completed'); assert.equal(sent.length, 0); assert.equal((await getJob(id)).last_result.total, 0);
  });
  await t.test('campaigns record immediate and scheduled sends; telemetry is signed, scoped and idempotent; CSV is protected', async () => {
    await clearJobs();
    const route = '/api/domains/site/reports';
    for (const path of [route, route + '/export', route + '/missing']) assert.equal((await request(path, 'GET', null, false)).status, 401);
    assert.equal((await request('/api/domains/other/reports')).status, 404);
    const result = await request('/api/notifications/compose', 'POST', { ...input(once, { platform: 'all', subscribed: 'all' }), title: '=Important, "news"' });
    assert.equal(result.status, 200); assert.ok(result.campaign_id); assert.ok(sent.length > 0);
    const tracking = sent[0].body.tracking;
    const event = (event, token = tracking.token, origin = 'https://www.site.test') => request('/api/report-events', 'POST', { token, event, action: 'button-1' }, false, { Origin: origin });
    assert.equal((await event('ack')).status, 200);
    assert.equal((await event('ack')).status, 200);
    await Promise.all([event('click'), event('click'), event('click')]);
    assert.equal((await event('click', tracking.token, 'https://evil.test')).status, 403);
    assert.equal((await event('click', tracking.token + 'x')).status, 400);
    assert.equal((await request('/api/report-events', 'POST', { token: tracking.token, event: 'click' }, false)).status, 403);
    const report = (await request(route + '/' + result.campaign_id)).data;
    assert.equal(report.accepted, result.sent); assert.equal(report.targeted, result.total); assert.equal(report.clicks, 1); assert.equal(report.acknowledged, 1);
    assert.equal(report.click_rate, 100 / result.sent); assert.equal(report.source, 'composer');
    const serialized = JSON.stringify(report); for (const privateValue of ['test-private', 'fixture-auth', tracking.token, 'fcm.googleapis.com']) assert.equal(serialized.includes(privateValue), false);
    assert.equal((await request('/api/domains/other/reports/' + result.campaign_id)).status, 404);
    assert.equal((await request(route + '?q=Important')).data.total, 1);
    assert.equal((await request(route + '?q=missing')).data.total, 0);
    assert.equal((await request(route + '?from=2026-02-31')).status, 400);
    const csvResponse = await fetch(baseUrl + route + '/export', { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(csvResponse.status, 200); assert.match(csvResponse.headers.get('content-type'), /text\/csv/);
    assert.match(await csvResponse.text(), /'=Important, ""news""/);
    await request('/api/notifications', 'POST', { ...input(), title: 'Configuration test' });
    assert.equal((await request(route)).data.total, 1); assert.equal((await request(route + '?tests=only')).data.total, 1);
    const senderKey = crypto.createHmac('sha256', 'isolated-test-secret-32-characters-long').update('send:site').digest('base64url');
    const wordpress = await request('/api/notifications', 'POST', { ...input(), title: 'WordPress published article' }, false, { 'X-Api-Key': senderKey, 'X-Push-Source': 'wordpress' });
    assert.equal(wordpress.status, 200); assert.equal((await request(route + '/' + wordpress.campaign_id)).data.source, 'wordpress');
    const scheduled = await request('/api/schedules', 'POST', input(recurring));
    await worker(startMs).tick(); await worker(startMs + 86400000).tick();
    const [[runs]] = await pool.query("SELECT COUNT(*) AS n FROM push_campaigns WHERE source = 'scheduled'"); assert.equal(runs.n, 2);
    assert.equal((await request(`/api/schedules/${scheduled.data.id}/runs`)).data.length, 2);
    const before = (await request(route + '?tests=include')).data.total;
    await ensureReports(pool); assert.equal((await request(route + '?tests=include')).data.total, before);
    const runId = crypto.randomUUID(), legacyId = scheduled.data.id;
    await pool.query("INSERT INTO notification_schedule_runs (id, schedule_id, due_ms, status, started_ms, finished_ms, result) VALUES (?, ?, ?, 'completed', ?, ?, ?)", [runId, legacyId, startMs - 1, startMs - 1, startMs, JSON.stringify({ total: 2, sent: 2, failed: 0, removed: 0 })]);
    await ensureReports(pool); await ensureReports(pool);
    const legacy = (await request(route + '/' + runId)).data;
    assert.equal(legacy.source, 'historical'); assert.equal(legacy.accepted, 2); assert.equal(legacy.tracking, false); assert.equal(legacy.clicks, null); assert.equal(legacy.acknowledged, null); assert.equal(legacy.click_rate, null);
    const existing = (await request(route)).data.rows;
    const template = existing[0];
    for (let i = 0; i < 21; i++) await pool.query("INSERT INTO push_campaigns (id, user_id, domain_key, source, content, status, tracking, created_ms, updated_ms) VALUES (?, 1, 'site', 'api', ?, 'completed', FALSE, ?, ?)", [crypto.randomUUID(), JSON.stringify(template.content), Date.now() + i, Date.now()]);
    assert.equal((await request(route)).data.rows.length, 20); assert.ok((await request(route + '?page=2')).data.rows.length > 0);
    const one = (await request(route + '?limit=5')).data; assert.equal(one.rows.length, 5);
  });

});
