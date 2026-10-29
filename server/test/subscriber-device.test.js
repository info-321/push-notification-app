import test from 'node:test';
import assert from 'node:assert/strict';
import { requestBrowser, requestDevice, summarizeDevices } from '../subscriber-device.js';
import { ensureSubscriptionDevice, ensureSubscriptionBrowser } from '../domain-schema.js';

const classify = (agent, hint) => requestDevice({ get: name => name === 'User-Agent' ? agent : hint });

test('browser categories distinguish desktop systems, phones and tablets without assuming unknown clients are desktop', () => {
  for (const agent of ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/140.0', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1', 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64) Firefox/142.0', 'Mozilla/5.0 (X11; CrOS x86_64 14541) Chrome/140.0']) assert.equal(classify(agent), 'desktop');
  for (const agent of ['Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile Chrome/140.0', 'Mozilla/5.0 (Linux; Android 14; Tablet) Chrome/140.0', 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Mobile Safari/605.1', 'Mozilla/5.0 (iPad; CPU OS 18_0) Safari/605.1', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Mobile/15E148 Safari/604.1']) assert.equal(classify(agent, '?0'), 'mobile');
  assert.equal(classify('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0', '?1'), 'mobile');
  for (const agent of [undefined, '', 'unknown', 'curl/8.0', 'Mozilla/5.0 Googlebot/2.1', 'x'.repeat(2049)]) assert.equal(classify(agent, '?0'), null);
});

test('device summaries preserve unknowns, distinguish an empty audience and count recorded zeroes correctly', () => {
  assert.deepEqual(summarizeDevices({ subscribers: '8', desktop: '0', mobile: null }), { desktop: null, mobile: null, device_unknown: 8, device_recorded: 0, device_available: false });
  assert.deepEqual(summarizeDevices({ subscribers: '8', desktop: '6', mobile: '0' }), { desktop: 6, mobile: 0, device_unknown: 2, device_recorded: 6, device_available: true });
  assert.deepEqual(summarizeDevices({ subscribers: 0 }), { desktop: 0, mobile: 0, device_unknown: 0, device_recorded: 0, device_available: true });
});

test('device migration is additive, repeatable and handles concurrent startup', async () => {
  for (const state of ['present', 'missing', 'concurrent']) {
    let writes = 0;
    await ensureSubscriptionDevice({ query: async sql => {
      if (sql.startsWith('SHOW')) return [state === 'present' ? [{ Field: 'device_type' }] : []];
      assert.equal(sql, 'ALTER TABLE subscriptions ADD COLUMN device_type VARCHAR(16) NULL'); writes++;
      if (state === 'concurrent') throw Object.assign(new Error('exists'), { code: 'ER_DUP_FIELDNAME' });
      return [{}];
    } });
    assert.equal(writes, state === 'present' ? 0 : 1);
  }
});


test('browser families recognize desktop/iOS browsers and derivatives before Chrome/Safari compatibility tokens', () => {
  const examples = [
    ['Mozilla/5.0 Chrome/140.0 Safari/537.36', 'Chrome'], ['Mozilla/5.0 CriOS/140.0 Mobile Safari/604.1', 'Chrome'],
    ['Mozilla/5.0 Firefox/142.0', 'Firefox'], ['Mozilla/5.0 FxiOS/142.0 Mobile Safari/604.1', 'Firefox'],
    ['Mozilla/5.0 Chrome/140.0 Safari/537.36 Edg/140.0', 'Edge'], ['Mozilla/5.0 EdgiOS/140.0 Mobile Safari/604.1', 'Edge'],
    ['Mozilla/5.0 Chrome/140.0 Safari/537.36 OPR/125.0', 'Opera'],
    ['Mozilla/5.0 SamsungBrowser/28.0 Chrome/140.0 Safari/537.36', 'Samsung Internet'],
    ['Mozilla/5.0 Version/18.0 Mobile/15E148 Safari/604.1', 'Safari'],
    ['Mozilla/5.0 Chrome/140.0 Safari/537.36 Vivaldi/7.0', 'Other'],
  ];
  for (const [agent, expected] of examples) assert.equal(requestBrowser({ get: name => name === 'User-Agent' ? agent : undefined }), expected);
  for (const [brands, expected] of [['"Chromium";v="140", "Brave";v="140"', 'Brave'], ['"Microsoft Edge";v="140", "Not_A Brand";v="99"', 'Edge']]) {
    assert.equal(requestBrowser({ get: name => name === 'User-Agent' ? 'Mozilla/5.0 Chrome/140.0 Safari/537.36' : brands }), expected);
  }
  for (const agent of [undefined, '', 'unknown', 'curl/8.0', 'Mozilla/5.0 Chrome/140.0 Googlebot/2.1', 'x'.repeat(2049)]) assert.equal(requestBrowser({ get: () => agent }), null);
});

test('browser migration preserves old rows and is repeatable across concurrent starts', async () => {
  for (const present of [true, false]) {
    let writes = 0;
    await ensureSubscriptionBrowser({ query: async sql => {
      if (sql.startsWith('SHOW')) return [present ? [{ Field: 'browser_family' }] : []];
      assert.equal(sql, 'ALTER TABLE subscriptions ADD COLUMN browser_family VARCHAR(32) NULL'); writes++;
      throw Object.assign(new Error('already added by another instance'), { code: 'ER_DUP_FIELDNAME' });
    } });
    assert.equal(writes, present ? 0 : 1);
  }
});
