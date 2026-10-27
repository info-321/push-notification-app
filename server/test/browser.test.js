import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sdk = readFileSync(new URL('../../client/public/sdk/push.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../client/public/push-sw.js', import.meta.url), 'utf8');

function browser({ existing, permission = 'default', rejectSave = false } = {}) {
  const requests = [];
  const buttons = [];
  const events = [];
  let permissionCalls = 0;
  let subscriptions = 0;
  const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test', keys: {} }) };
  const notification = { permission, async requestPermission() { permissionCalls++; notification.permission = 'granted'; return 'granted'; } };
  const registration = { active: true, pushManager: {
    async getSubscription() { return existing ? subscription : null; },
    async subscribe() { subscriptions++; return subscription; },
  } };
  const window = { isSecureContext: true, PushManager: {}, Notification: notification, pushConfig: { domainKey: 'domain-key', apiBase: 'https://api.test/', vapidPublicKey: Buffer.alloc(65, 1).toString('base64url') }, dispatchEvent(event) { events.push(event); } };
  const context = {
    window, Notification: notification, navigator: { serviceWorker: { async register() { return registration; } } },
    location: { origin: 'https://website.test' }, URL, setTimeout, clearTimeout,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { body: { appendChild(button) { buttons.push(button); } }, createElement() { return { style: {}, addEventListener(name, handler) { this[name] = handler; } }; } },
    console: { warn() {}, error() {} },
    async fetch(url, options) { requests.push({ url, options }); return { ok: !rejectSave, async json() { return { ok: !rejectSave, message: rejectSave ? 'Storage failed' : undefined }; } }; },
  };
  return { context, requests, buttons, events, permissionCalls: () => permissionCalls, subscriptions: () => subscriptions };
}

test('SDK waits for a visitor action, then saves the subscription and hides the button', async () => {
  const b = browser();
  await vm.runInNewContext(sdk, b.context);
  assert.equal(b.permissionCalls(), 0);
  assert.equal(b.subscriptions(), 0);
  assert.equal(b.buttons.length, 1);
  await b.context.window.PushNotifications.subscribe();
  assert.equal(b.permissionCalls(), 1);
  assert.equal(b.subscriptions(), 1);
  assert.equal(b.requests[0].url, 'https://api.test/api/subscriptions');
  assert.equal(JSON.parse(b.requests[0].options.body).domain_key, 'domain-key');
  assert.equal(b.buttons[0].hidden, true);
});

test('SDK reuses an existing subscription without another permission prompt', async () => {
  const b = browser({ existing: true, permission: 'granted' });
  await vm.runInNewContext(sdk, b.context);
  assert.equal(b.subscriptions(), 0);
  assert.equal(b.permissionCalls(), 0);
  assert.equal(b.requests.length, 1);
});

test('denied permission never triggers a subscription or prompt', async () => {
  const b = browser({ permission: 'denied' });
  await vm.runInNewContext(sdk, b.context);
  assert.equal(b.buttons.length, 0);
  assert.equal(b.permissionCalls(), 0);
  assert.equal(b.requests.length, 0);
});

test('backend rejection remains visible as a failed subscription', async () => {
  const b = browser({ rejectSave: true });
  await vm.runInNewContext(sdk, b.context);
  await assert.rejects(b.context.window.PushNotifications.subscribe(), /Storage failed/);
  assert.notEqual(b.buttons[0].hidden, true);
  assert.equal(b.buttons[0].disabled, false);
});

test('worker accepts text payloads and does not open off-site notification links', async () => {
  const handlers = {};
  const shown = [];
  const opened = [];
  const self = {
    location: { origin: 'https://website.test' }, addEventListener(name, handler) { handlers[name] = handler; },
    registration: { showNotification(title, options) { shown.push({ title, options }); return Promise.resolve(); } },
    clients: { async matchAll() { return []; }, async openWindow(url) { opened.push(url); } },
  };
  vm.runInNewContext(worker, { self, URL, Date });
  let pending;
  handlers.push({ data: { json() { throw new Error('Not JSON'); }, text() { return 'Plain text'; } }, waitUntil(value) { pending = value; } });
  await pending;
  assert.equal(shown[0].options.body, 'Plain text');
  handlers.notificationclick({ notification: { close() {}, data: { url: 'https://evil.test/' } }, waitUntil(value) { pending = value; } });
  await pending;
  assert.equal(opened[0], 'https://website.test/');
});
