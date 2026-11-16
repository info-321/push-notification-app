import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sdk = readFileSync(new URL('../../client/public/sdk/push.js', import.meta.url), 'utf8');
const guide = readFileSync(new URL('../../client/public/sdk/apple-install.js', import.meta.url), 'utf8');
const settings = { enabled: true, template: 'modal', trigger: 'delay', delay: 0, scroll: 50, cooldown: 7, include_paths: [], exclude_paths: [], accent: '#12ad88', background: '#ffffff', text: '#25394b', logo: '' };
async function run({ ua = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit Safari', touch = 1, standalone = false, displayMode = false, supported = false, published = settings, showButton, fail = false, group = 'mobile' } = {}) {
  const calls = [], mounts = [], buttons = [], registered = [], warnings = [];
  let permissionCalls = 0, subscriptions = 0;
  const notification = { permission: 'default', requestPermission: async () => { permissionCalls++; notification.permission = 'granted'; return 'granted'; } };
  const registration = { active: true, pushManager: { getSubscription: async () => null, subscribe: async () => { subscriptions++; return { toJSON: () => ({ endpoint: 'fixture' }) }; } } };
  const window = { isSecureContext: true, pushConfig: { apiBase: 'https://api.test', domainKey: 'website', vapidPublicKey: Buffer.alloc(65, 1).toString('base64url'), showButton }, matchMedia: query => ({ matches: displayMode && query === '(display-mode: standalone)' }), dispatchEvent() {}, PushAppleInstall: { mount: args => mounts.push(args) } };
  if (supported) { window.Notification = notification; window.PushManager = {}; }
  const context = { window, Notification: notification, navigator: { userAgent: ua, maxTouchPoints: touch, standalone, serviceWorker: { register: async url => { registered.push(url); return registration; } } },
    location: { origin: 'https://website.test', pathname: '/' }, URL, AbortController, setTimeout, clearTimeout, CustomEvent: class {}, atob: value => Buffer.from(value, 'base64').toString('binary'),
    localStorage: { getItem: () => null }, console: { warn: (...args) => warnings.push(args), error() {} },
    document: { body: { appendChild: node => buttons.push(node) }, createElement: () => ({ style: {}, addEventListener(name, handler) { this[name] = handler; } }) },
    fetch: async (url, options) => { calls.push({ url, options }); if (fail) throw new Error('unavailable'); if (options?.method === 'POST') return { ok: true, json: async () => ({ ok: true }) }; return { ok: true, json: async () => ({ ok: true, data: { device: group, prompt: published } }) }; },
  };
  await vm.runInNewContext(sdk, context);
  return { window, calls, mounts, buttons, registered, warnings, permissionCalls: () => permissionCalls, subscriptions: () => subscriptions };
}

test('ordinary iPhone tabs get installation help even without notification APIs, without registration or permission requests', async () => {
  const b = await run(); assert.equal(b.mounts.length, 1); assert.equal(b.mounts[0].ipad, false);
  assert.equal(b.calls[0].url, 'https://api.test/api/prompt/website?device=mobile');
  assert.equal(b.registered.length, 0); assert.equal(b.permissionCalls(), 0); assert.equal(b.subscriptions(), 0);
  await assert.rejects(b.window.PushNotifications.subscribe(), /Home Screen/);
  assert.equal(b.calls.some(call => call.options?.method === 'POST'), false);
});
test('iPads including desktop-mode iPads use tablet publication; actual Macs keep the normal flow', async () => {
  for (const ua of ['Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Mobile Safari', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari']) {
    const b = await run({ ua, touch: 5, group: 'large' }); assert.equal(b.mounts.length, 1); assert.equal(b.mounts[0].ipad, true); assert.equal(b.calls[0].url, 'https://api.test/api/prompt/website');
  }
  const mac = await run({ ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) Safari', touch: 0, supported: true, published: null });
  assert.equal(mac.mounts.length, 0); assert.equal(mac.registered.length, 1); assert.equal(mac.buttons.length, 1); assert.equal(mac.permissionCalls(), 0);
});
test('installed Apple web apps use the original permission flow, with navigator and display-mode detection', async () => {
  for (const mode of [{ standalone: true }, { displayMode: true }]) {
    const b = await run({ ...mode, supported: true, published: null });
    assert.equal(b.mounts.length, 0); assert.equal(b.registered.length, 1); assert.equal(b.permissionCalls(), 0);
    await b.buttons[0].click(); assert.equal(b.permissionCalls(), 1); assert.equal(b.subscriptions(), 1);
  }
});
test('publication OFF, integration suppression, wrong mobile groups and unavailable settings never show an unwanted Apple guide', async () => {
  for (const options of [{ published: { ...settings, enabled: false } }, { showButton: false }, { group: 'large' }, { fail: true }]) {
    const b = await run(options); assert.equal(b.mounts.length, 0); assert.equal(b.registered.length, 0); assert.equal(b.permissionCalls(), 0);
  }
  const legacy = await run({ published: null }); assert.equal(legacy.mounts.length, 1); assert.equal(legacy.mounts[0].settings, null);
});
test('installation help honors page exclusions, published timing and its own dismissal cooldown without touching notification APIs', () => {
  for (const config of [{ pathname: '/excluded', settings: { ...settings, exclude_paths: ['/excluded'] } }, { pathname: '/', settings, dismissed: Date.now() + 60000 }]) {
    let timers = 0; const window = {};
    vm.runInNewContext(guide, { window, document: { activeElement: null }, location: { pathname: config.pathname }, localStorage: { getItem: () => config.dismissed || null }, Date, setTimeout: () => { timers++; }, clearTimeout() {} });
    const controller = window.PushAppleInstall.mount({ key: 'site', settings: config.settings }); assert.equal(timers, 0); controller.hide();
  }
  const timers = [], window = {};
  vm.runInNewContext(guide, { window, location: { pathname: '/' }, localStorage: { getItem: () => null }, Date, setTimeout: (callback, delay) => timers.push({ callback, delay }), clearTimeout() {} });
  window.PushAppleInstall.mount({ key: 'site', settings: { ...settings, delay: 17 } }); assert.equal(timers[0].delay, 17000);
});
