import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createApp } from '../app.js';
import { promptDefaults, validatePrompt, readPromptToken } from '../subscription-prompts.js';
import { ensureSubscriptionPrompts } from '../domain-schema.js';

const secret = 'prompt-tests-secret-at-least-thirty-two-characters';
test('prompt validation bounds plain text, paths, URLs, display rules and larger-device templates', () => {
  const defaults = promptDefaults('website.test'); assert.equal(validatePrompt(defaults).template, 'slide-in');
  for (const change of [{ template: 'native-dialog' }, { logo: 'javascript:alert(1)' }, { accent: 'red;position:fixed' }, { delay: -1 }, { delay: 121 }, { cooldown: 0 }, { scroll: 100 }, { include_paths: ['https://evil.test/'] }, { include_paths: ['//evil.test/'] }, { exclude_paths: ['/news?q=1'] }, { heading: 'x'.repeat(81) }]) assert.throws(() => validatePrompt({ ...defaults, ...change }));
  assert.equal(validatePrompt({ ...defaults, heading: '<script>alert(1)</script>' }).heading, '<script>alert(1)</script>', 'Saved text is rendered as text, not HTML');
});
test('device grouping keeps desktop, laptop and tablets together without relying on viewport width', () => {
  const window = {}; vm.runInNewContext(readFileSync(new URL('../../client/public/sdk/prompt-ui.js', import.meta.url), 'utf8'), { window });
  const phone = window.PushPermissionUI.isPhone;
  for (const userAgent of ['Mozilla Windows NT Chrome', 'Mozilla Macintosh Safari', 'Mozilla iPad Mobile Safari', 'Mozilla Android Tablet Chrome', 'Mozilla Linux; Android 14; Pixel Tablet']) assert.equal(phone({ userAgent }), false);
  assert.equal(phone({ userAgent: 'Mozilla Macintosh Safari', maxTouchPoints: 5 }), false);
  for (const userAgent of ['Mozilla iPhone Mobile Safari', 'Mozilla Android 14; Pixel 8 Mobile Chrome', 'Windows Phone Mobile']) assert.equal(phone({ userAgent }), true);
  assert.equal(phone({ userAgent: 'Unknown browser', userAgentData: { mobile: true } }), true);
});
test('prompt schema is additive and does not change subscription data or keys', async () => {
  const queries = []; await ensureSubscriptionPrompts({ query: async sql => { queries.push(sql); return sql.startsWith('SHOW') ? [[]] : [{}]; } });
  assert.match(queries[1], /ADD COLUMN subscription_prompt JSON NULL/);
  assert.match(queries[2], /CREATE TABLE IF NOT EXISTS prompt_events/);
  assert.match(queries[2], /UNIQUE KEY prompt_subscription/);
  assert.ok(queries.every(sql => !sql.includes('vapid') && !sql.startsWith('UPDATE subscriptions')));
});

async function fixture(t) {
  const row = { user_id: 1, domain_key: 'one', domain_name: 'website.test', subscription_prompt: null }, events = new Map(), subscriptions = [], queries = [];
  const pool = { query: async (sql, params) => {
    queries.push(sql);
    if (sql.startsWith('SELECT domain_name, subscription_prompt')) return [params[0] === 'one' && params[1] === 1 ? [row] : []];
    if (sql.startsWith('UPDATE domains SET subscription_prompt')) {
      const mobile = sql.includes("'$.mobile.version'");
      const version = (mobile ? row.subscription_prompt?.mobile : row.subscription_prompt)?.version || '0'; if (params.at(-1) !== version) return [{ affectedRows: 0 }];
      const next = mobile ? JSON.parse(params[0]) : { version: params[0], draft: JSON.parse(params[1]), published: JSON.parse(params[2]), previous: JSON.parse(params[3]) };
      row.subscription_prompt = mobile ? { ...(row.subscription_prompt || {}), mobile: next } : { ...(row.subscription_prompt || {}), ...next }; return [{ affectedRows: 1 }];
    }
    if (sql.startsWith('INSERT IGNORE INTO prompt_events')) { if (!events.has(params[1])) events.set(params[1], { key: params[0], nonce: params[1], revision: params[2], template: params[3], device: params[4], views: 1, clicks: 0, dismissals: 0, subscriptions: 0 }); return [{}]; }
    if (sql.startsWith('UPDATE prompt_events')) {
      const converted = sql.includes('subscribed_at = NOW()'), permission = sql.includes('permission_outcome = ?');
      const entry = events.get(params[converted || permission ? 2 : 1]);
      if (entry && entry.key === params[converted || permission ? 1 : 0]) {
        if (converted && entry.clicks && !entry.subscriptions) { entry.subscriptions = 1; entry.subscription_id = params[0]; }
        else if (sql.includes('clicked_at = COALESCE') && !entry.dismissals) entry.clicks = 1;
        else if (sql.includes('dismissed_at = COALESCE') && !entry.clicks) entry.dismissals = 1;
        else if (permission && entry.clicks) entry.permission = params[0];
      }
      return [{}];
    }
    if (sql.startsWith('SELECT revision, template')) { assert.match(sql, /WHERE domain_key = \? AND created_at >= FROM_UNIXTIME\(\?\)/); assert.match(sql, /AND device_group = \?/); return [[...events.values()].filter(e => e.key === params[0] && e.device === params[3])]; }
    if (sql.startsWith('SELECT user_id, domain_name')) return [params[0] === 'one' ? [row] : []];
    if (sql.startsWith('SELECT id, domain_key') && sql.includes('FROM subscriptions')) return [subscriptions.filter(sub => sub.endpoint === params[0])];
    if (sql.startsWith('INSERT INTO subscriptions')) { const id = subscriptions.length + 1; subscriptions.push({ id, domain_key: params[1], endpoint: params[2] }); return [{ insertId: id }]; }
    if (sql.startsWith('UPDATE subscriptions')) return [{ affectedRows: 1 }];
    throw new Error('Unexpected query: ' + sql);
  } };
  const server = createApp({ pool, webpush: {}, secret, adminUsername: 'admin', adminPassword: 'testing', publicApiBase: 'https://push.test' }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve)); t.after(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = await (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'testing' }) })).json();
  const request = async (route, body, auth = false, origin = 'https://www.website.test') => {
    const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', Origin: origin, ...(auth ? { Authorization: `Bearer ${login.token}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  };
  const change = operation => request('/api/domains/one/prompt-settings', { operation, version: row.subscription_prompt?.version || '0', settings: row.subscription_prompt?.draft || promptDefaults(row.domain_name) }, true);
  return { row, events, subscriptions, queries, request, change };
}
test('drafts stay private until publish; revisions use optimistic locking and restore the previous publication', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/domains/one/prompt-settings')).status, 401);
  assert.equal((await f.request('/api/domains/private/prompt-settings', undefined, true)).status, 404);
  assert.equal((await f.request('/api/prompt/one')).data.prompt, null);
  assert.equal((await f.change('save')).status, 200);
  assert.equal((await f.request('/api/prompt/one')).data.prompt, null);
  assert.equal((await f.change('publish')).status, 200);
  const initial = f.row.subscription_prompt.published;
  assert.equal((await f.request('/api/prompt/one')).data.prompt.heading, initial.settings.heading);
  const published = await f.request('/api/prompt/one'); assert.equal(published.data.previous, undefined); assert.equal(published.data.draft, undefined);
  assert.equal((await f.request('/api/prompt/one', undefined, false, 'https://evil.test')).status, 403);
  assert.equal((await f.request('/api/domains/one/prompt-settings', { operation: 'publish', version: '0', settings: promptDefaults('changed') }, true)).status, 409);
  f.row.subscription_prompt.draft = { ...initial.settings, template: 'button' }; await f.change('publish');
  assert.equal(f.row.subscription_prompt.published.settings.template, 'button');
  await f.change('restore'); assert.equal(f.row.subscription_prompt.published.settings.template, 'slide-in');
  assert.notEqual(f.row.subscription_prompt.published.revision, initial.revision);
});
test('signed event tokens deduplicate views/clicks; only new saved subscriptions count and resubscriptions do not', async t => {
  const f = await fixture(t); await f.change('publish');
  const { token } = (await f.request('/api/prompt/one')).data;
  assert.equal(readPromptToken(secret, token, 'other'), null);
  assert.equal(readPromptToken(secret, token.slice(0, -4) + 'xxxx', 'one'), null);
  for (const event of ['view', 'view', 'click', 'click']) assert.equal((await f.request('/api/prompt/one/events', { token, event })).status, 200);
  const keys = { p256dh: Buffer.alloc(65, 1).toString('base64url'), auth: Buffer.alloc(16, 2).toString('base64url') };
  const subscription = { endpoint: 'https://fcm.googleapis.com/send/test', keys };
  const body = { domain_key: 'one', subscription, prompt_token: token };
  assert.equal((await f.request('/api/subscriptions', body)).created, true);
  assert.equal((await f.request('/api/subscriptions', body)).created, false);
  assert.equal((await f.request('/api/domains/one/prompt-performance')).status, 401);
  const report = await f.request('/api/domains/one/prompt-performance', undefined, true);
  assert.equal(report.data.rows[0].views, 1); assert.equal(report.data.rows[0].clicks, 1); assert.equal(report.data.rows[0].subscriptions, 1);
  const nextToken = (await f.request('/api/prompt/one')).data.token;
  assert.equal((await f.request('/api/prompt/one/events', { token: nextToken, event: 'permission', outcome: 'granted' })).status, 200);
  assert.equal(f.events.size, 1, 'Events cannot create a fake impression or conversion');
  assert.equal((await f.request('/api/prompt/one/events', { token: token + 'x', event: 'view' })).status, 400);
  assert.equal((await f.request('/api/prompt/one/events', { token, event: 'view' }, false, 'https://evil.test')).status, 403);
  assert.equal((await f.request('/api/domains/one/prompt-performance?start=2026-10-31&end=2026-01-01', undefined, true)).status, 400);
});

test('all four additional templates publish and issue valid attribution tokens and performance rows', async t => {
  const f = await fixture(t);
  for (const template of ['dialog', 'modal', 'fullscreen', 'sticky']) {
    const settings = { ...promptDefaults('website.test'), template };
    const result = await f.request('/api/domains/one/prompt-settings', { operation: 'publish', version: f.row.subscription_prompt?.version || '0', settings }, true);
    assert.equal(result.status, 200);
    const published = await f.request('/api/prompt/one');
    assert.equal(published.data.prompt.template, template);
    assert.equal(readPromptToken(secret, published.data.token, 'one').template, template);
    for (const event of ['view', 'click']) assert.equal((await f.request('/api/prompt/one/events', { token: published.data.token, event })).status, 200);
  }
  const report = await f.request('/api/domains/one/prompt-performance', undefined, true);
  assert.deepEqual(report.data.rows.map(row => row.template), ['dialog', 'modal', 'fullscreen', 'sticky']);
  assert.ok(report.data.rows.every(row => row.views === 1 && row.clicks === 1));
});

test('seven mobile templates publish independently, reject Bell, and keep signed tracking and performance separate', async t => {
  const f = await fixture(t);
  const largeBefore = (await f.request('/api/domains/one/prompt-settings', undefined, true)).data;
  for (const template of ['native', 'dialog', 'modal', 'fullscreen', 'header', 'slide-up', 'sticky']) {
    const mobile = (await f.request('/api/domains/one/prompt-settings?device=mobile', undefined, true)).data;
    const settings = { ...promptDefaults('website.test'), template };
    const result = await f.request('/api/domains/one/prompt-settings', { device: 'mobile', operation: 'publish', version: mobile.version, settings }, true);
    assert.equal(result.status, 200);
    const published = await f.request('/api/prompt/one?device=mobile');
    assert.equal(published.data.device, 'mobile'); assert.equal(published.data.prompt.template, template);
    assert.equal(readPromptToken(secret, published.data.token, 'one').device, 'mobile');
    for (const event of ['view', 'click']) assert.equal((await f.request('/api/prompt/one/events', { token: published.data.token, event, device: 'large' })).status, 200);
  }
  assert.deepEqual((await f.request('/api/domains/one/prompt-settings', undefined, true)).data, largeBefore);
  const mobileBefore = JSON.stringify(f.row.subscription_prompt.mobile);
  assert.equal((await f.request('/api/domains/one/prompt-settings', { operation: 'publish', version: largeBefore.version, settings: largeBefore.draft }, true)).status, 200, 'Publishing mobile does not invalidate the desktop version');
  assert.equal(JSON.stringify(f.row.subscription_prompt.mobile), mobileBefore, 'Desktop JSON updates preserve independently published mobile data');
  const mobileReport = await f.request('/api/domains/one/prompt-performance?device=mobile', undefined, true);
  assert.equal(mobileReport.data.rows.length, 7); assert.ok(mobileReport.data.rows.every(row => row.views === 1 && row.clicks === 1));
  assert.deepEqual((await f.request('/api/domains/one/prompt-performance', undefined, true)).data.rows, []);
  const version = f.row.subscription_prompt.mobile.version;
  assert.equal((await f.request('/api/domains/one/prompt-settings', { device: 'mobile', operation: 'save', version, settings: { ...promptDefaults('website.test'), template: 'bell' } }, true)).status, 400);
  assert.equal((await f.request('/api/domains/one/prompt-settings', { device: 'large', operation: 'save', version: f.row.subscription_prompt.version, settings: { ...promptDefaults('website.test'), template: 'native' } }, true)).status, 400);
  const desktopBefore = (await f.request('/api/domains/one/prompt-settings', undefined, true)).data;
  assert.equal((await f.request('/api/domains/one/prompt-settings', { device: 'mobile', operation: 'restore', version }, true)).status, 200);
  assert.equal(f.row.subscription_prompt.mobile.published.settings.template, 'slide-up');
  assert.deepEqual((await f.request('/api/domains/one/prompt-settings', undefined, true)).data, desktopBefore);
  assert.equal((await f.request('/api/prompt/one?device=phone')).status, 400);
});

test('migration backfills legacy prompt history to the larger-device group without changing counts', async () => {
  const queries = [];
  await ensureSubscriptionPrompts({ query: async sql => {
    queries.push(sql);
    if (sql.startsWith('SHOW COLUMNS FROM domains')) return [[{ Field: 'subscription_prompt' }]];
    if (sql.startsWith('SHOW COLUMNS FROM prompt_events')) return [[]];
    return [{}];
  } });
  assert.match(queries.at(-1), /ADD COLUMN device_group VARCHAR\(16\) NOT NULL DEFAULT 'large'/);
  assert.ok(queries.every(sql => !sql.startsWith('UPDATE') && !sql.startsWith('DELETE')));
});
