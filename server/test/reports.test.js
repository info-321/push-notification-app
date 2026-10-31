import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createCampaignReporter, verifyReportToken, reportFilter, csvCell } from '../reports.js';
import { deliverNotification, prepareNotification } from '../notification-delivery.js';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const secret = 'isolated-reports-test-secret-at-least-32';

test('recipient tokens are signed, expire, bind to the campaign, and contain no endpoint or credentials', async () => {
  const calls = [], pool = { query: async (sql, params) => { calls.push([sql, params]); return [{ affectedRows: 1 }]; } };
  const reporter = createCampaignReporter({ pool, secret, publicApiBase: 'https://api.test', now: () => 1800000000000 });
  const campaign = await reporter.begin({ domainKey: 'site', content: { title: 'News' }, total: 1 });
  const recipient = await campaign.recipient(), token = recipient.tracking.token;
  assert.equal(recipient.tracking.url, 'https://api.test/api/report-events');
  assert.deepEqual(verifyReportToken(token, secret, 1800000000000), { campaign: campaign.id, recipient: recipient.id });
  assert.equal(verifyReportToken(token.replace(campaign.id, crypto.randomUUID()), secret, 1800000000000), null);
  assert.equal(verifyReportToken(token, 'wrong-secret', 1800000000000), null);
  assert.equal(verifyReportToken(token, secret, 1800000000000 + 91 * 86400000), null);
  assert.equal(verifyReportToken(token.split('.').slice(0, 3).join('.') + '.' + 'é'.repeat(43), secret, 1800000000000), null);
  assert.equal(token.includes('https'), false);
});

test('report filters validate dates, escape search through parameters, and hide tests by default', () => {
  const filter = reportFilter('own-site', { q: "%' OR 1=1", from: '2026-10-01', to: '2026-10-31', status: 'partial', tests: 'only' });
  assert.equal(filter.sql.includes("OR 1=1"), false); assert.equal(filter.params[1], "%' OR 1=1");
  assert.equal(filter.params.at(-1), 1); assert.equal(reportFilter('site', {}).params.at(-1), 0);
  for (const query of [{ from: '2026-02-31' }, { from: '2026-12-01', to: '2026-01-01' }, { status: 'invented' }, { tests: 'other' }, { q: ['a', 'b'] }]) assert.throws(() => reportFilter('site', query));
  assert.equal(csvCell('=HYPERLINK("evil")'), '"\'=HYPERLINK(""evil"")"');
  assert.equal(csvCell('Title, "quoted"\nnew line'), '"Title, ""quoted""\nnew line"');
});

test('every attempted send is recorded, payloads carry per-recipient tokens, and reporting errors never trigger a resend', async () => {
  const events = [], sent = [], subscriptions = [{ id: 1, endpoint: 'https://fcm.googleapis.com/a', p256dh: 'key', auth: 'auth' }, { id: 2, endpoint: 'https://fcm.googleapis.com/b', p256dh: 'key', auth: 'auth' }];
  const pool = { query: async () => [subscriptions] };
  let recipientId = 0;
  const reporting = { begin: async values => { events.push(values); return { id: 'campaign', recipient: async () => ({ id: ++recipientId, tracking: { token: `token-${recipientId}`, url: 'https://api.test/api/report-events' } }), result: async (id, result) => events.push({ id, result }), progress: async () => {}, finish: async () => { throw new Error('DB disconnected'); }, interrupt: async counts => events.push(counts) }; } };
  const domain = { domain_name: 'site.test', vapid_public_key: 'public', vapid_private_key: 'private' };
  const prepared = prepareNotification({ title: 'News', audience: { platform: 'all', subscribed: 'all' } }, domain);
  await assert.rejects(deliverNotification({ pool, reporting, vapidSubject: 'mailto:test@example.test', webpush: { sendNotification: async (sub, payload) => sent.push(JSON.parse(payload)) } }, domain, 'site', prepared, { source: 'scheduled', scheduleRunId: 'run' }), /DB disconnected/);
  assert.equal(sent.length, 2); assert.notEqual(sent[0].tracking.token, sent[1].tracking.token);
  assert.equal(events[0].scheduleRunId, 'run'); assert.equal(events.at(-1).sent, 2);
});

test('worker reports acknowledgements after successful creation and clicks once per event without delaying navigation', async () => {
  const worker = readFileSync(new URL('../../client/public/push-sw.js', import.meta.url), 'utf8');
  const handlers = {}, calls = [], opened = [], shown = [];
  let requestResolve, pending, rejectRich = true;
  const self = { location: { origin: 'https://site.test' }, addEventListener: (name, handler) => { handlers[name] = handler; },
    registration: { showNotification: async (title, options) => { shown.push({ title, options }); if (rejectRich && options.image) throw new Error('Unsupported'); } },
    clients: { matchAll: async () => [], openWindow: async url => { opened.push(url); } } };
  const context = { self, URL, Date, AbortController, setTimeout, clearTimeout, fetch: async (url, options) => { calls.push(JSON.parse(options.body)); return { ok: true }; } };
  vm.runInNewContext(worker, context);
  const data = { title: 'News', image: 'https://cdn.test/banner.png', url: '/article', tracking: { token: 'signed-token', url: 'https://api.test/api/report-events' }, actions: [{ action: 'button-1', type: 'link', title: 'Read', url: '/more' }] };
  handlers.push({ data: { json: () => data }, waitUntil: value => { pending = value; } }); await pending;
  assert.equal(shown.length, 2); assert.equal(calls.length, 1); assert.equal(calls[0].event, 'ack');
  context.fetch = async () => new Promise(resolve => { requestResolve = resolve; });
  handlers.notificationclick({ action: 'button-1', notification: { close() {}, data: shown.at(-1).options.data }, waitUntil: value => { pending = value; } });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(opened[0], 'https://site.test/more');
  requestResolve({ ok: true }); await pending;
  context.fetch = async () => { calls.push('failed'); throw new Error('offline'); };
  handlers.notificationclick({ notification: { close() {}, data }, waitUntil: value => { pending = value; } }); await pending;
  assert.equal(opened.at(-1), 'https://site.test/article'); assert.equal(calls.filter(c => c === 'failed').length, 2);
  rejectRich = false;
});
