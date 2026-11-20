import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const sdk = readFileSync(new URL('../../client/public/sdk/push.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../client/public/push-sw.js', import.meta.url), 'utf8');

function browser({ existing, permission = 'default', rejectSave = false, locationResult = {}, locationDenied = false, config = {} } = {}) {
  const requests = [];
  const buttons = [];
  const events = [];
  const locationPrompts = [];
  let locationCalls = 0;
  let permissionCalls = 0;
  let subscriptions = 0;
  const subscription = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/test', keys: {} }) };
  let currentSubscription = existing ? subscription : null;
  const notification = { permission, async requestPermission() { permissionCalls++; notification.permission = 'granted'; return 'granted'; } };
  const registration = { active: true, pushManager: {
    async getSubscription() { return currentSubscription; },
    async subscribe() { subscriptions++; currentSubscription = subscription; return subscription; },
  } };
  const window = { isSecureContext: true, PushManager: {}, Notification: notification, pushConfig: { domainKey: 'domain-key', apiBase: 'https://api.test/', vapidPublicKey: Buffer.alloc(65, 1).toString('base64url') }, dispatchEvent(event) { events.push(event); } };
  Object.assign(window.pushConfig, config);
  window.PushLocationUI = { mount: options => locationPrompts.push(options) };
  const context = {
    window, Notification: notification, navigator: { serviceWorker: { async register() { return registration; } }, geolocation: {
      getCurrentPosition(success, failure) { locationCalls++; if (locationDenied) failure({ code: 1 }); else success({ coords: { latitude: 22.57, longitude: 88.36, accuracy: 120 } }); },
    } },
    location: { origin: 'https://website.test' }, URL, AbortController, setTimeout, clearTimeout,
    atob: value => Buffer.from(value, 'base64').toString('binary'),
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    document: { body: { appendChild(button) { buttons.push(button); } }, createElement() { return { style: {}, addEventListener(name, handler) { this[name] = handler; } }; } },
    console: { warn() {}, error() {} },
    async fetch(url, options) { if (url.includes('/api/targeting/')) return { ok: true, json: async () => ({ ok: true, data: { allowed: true } }) }; requests.push({ url, options }); return { ok: !rejectSave, async json() { return { ok: !rejectSave, ...locationResult, message: rejectSave ? 'Storage failed' : undefined }; } }; },
  };
  return { context, registration, requests, buttons, events, locationPrompts, locationCalls: () => locationCalls, permissionCalls: () => permissionCalls, subscriptions: () => subscriptions };
}

test('GPS requires a separate visitor action even when notification permission is already granted', async () => {
  const b = browser({ existing: true, permission: 'granted', locationResult: { location_token: 'fixture-receipt', location_shared: false } });
  await vm.runInNewContext(sdk, b.context);
  assert.equal(b.locationCalls(), 0); assert.equal(b.permissionCalls(), 0); assert.equal(b.locationPrompts.length, 1);
  assert.equal(b.requests.length, 1);
  await b.locationPrompts[0].shareLocation();
  assert.equal(b.locationCalls(), 1); assert.equal(b.requests.length, 2);
  const request = b.requests[1], data = JSON.parse(request.options.body);
  assert.equal(request.url, 'https://api.test/api/subscriptions/location');
  assert.equal(data.domain_key, 'domain-key'); assert.equal(data.endpoint, 'https://fcm.googleapis.com/test');
  assert.equal(data.token, 'fixture-receipt'); assert.equal(data.consent, true); assert.equal(data.accuracy, 120);
  assert.equal(b.events.find(event => event.type === 'push:location-shared').detail.latitude, undefined);
});

test('declining device location does not upload coordinates or disable notification subscriptions', async () => {
  const b = browser({ existing: true, permission: 'granted', locationDenied: true, locationResult: { location_token: 'receipt' } });
  await vm.runInNewContext(sdk, b.context);
  await assert.rejects(b.context.window.PushNotifications.shareLocation(), /not shared/);
  assert.equal(b.requests.length, 1); assert.equal(b.permissionCalls(), 0); assert.equal(b.subscriptions(), 0);
  assert.ok(b.events.some(event => event.type === 'push:subscribed'));
});

test('saved GPS, disabled invitations and location opt-out suppress the optional offer', async () => {
  for (const options of [{ locationResult: { location_token: 'receipt', location_shared: true } }, { config: { showButton: false } }, { config: { requestLocation: false } }]) {
    const b = browser({ existing: true, permission: 'granted', locationResult: { location_token: 'receipt' }, ...options });
    await vm.runInNewContext(sdk, b.context);
    assert.equal(b.locationPrompts.length, 0); assert.equal(b.locationCalls(), 0);
  }
  const b = browser(); await vm.runInNewContext(sdk, b.context);
  await assert.rejects(b.context.window.PushNotifications.shareLocation(), /Enable notifications/);
  assert.equal(b.locationCalls(), 0);
});

test('explicit unsubscribe withdraws only our worker subscription and remains available after targeting excludes a browser', async () => {
  const b=browser(),ordinary=b.context.fetch,order=[];
  b.context.fetch=async(url,options)=>{
    if(url.includes('/api/targeting/'))return {ok:true,json:async()=>({ok:true,data:{allowed:false}})};
    if(url.endsWith('/unsubscribe'))order.push('server');
    return ordinary(url,options);
  };
  const own={scope:'https://website.test/',active:{scriptURL:'https://website.test/push-sw.js'},pushManager:{getSubscription:async()=>({toJSON:()=>({endpoint:'https://fcm.googleapis.com/fixture',keys:{p256dh:'fixture',auth:'fixture'}}),unsubscribe:async()=>{order.push('browser');return true;}})}};
  b.context.navigator.serviceWorker.getRegistrations=async()=>[own];
  await vm.runInNewContext(sdk,b.context);
  assert.equal(b.permissionCalls(),0);assert.equal(b.subscriptions(),0);
  assert.equal(await b.context.window.PushNotifications.unsubscribe(),true);
  assert.deepEqual(order,['browser','server']);
  const sent=JSON.parse(b.requests.find(r=>r.url.endsWith('/unsubscribe')).options.body);
  assert.equal(sent.domain_key,'domain-key');assert.equal(sent.subscription.keys.auth,'fixture');
  own.active.scriptURL='https://website.test/another-provider.js';order.length=0;
  assert.equal(await b.context.window.PushNotifications.unsubscribe(),false);assert.deepEqual(order,[]);
});

test('SDK waits for a visitor action, then saves the subscription and hides the button', async () => {
  const b = browser();
  await vm.runInNewContext(sdk, b.context);
  assert.equal(b.permissionCalls(), 0);
  assert.equal(b.subscriptions(), 0);
  assert.equal(b.buttons.length, 1);
  await b.context.window.PushNotifications.subscribe();
  assert.equal(b.permissionCalls(), 1);
  assert.equal(b.subscriptions(), 1);
  const save = b.requests.find(request => request.url.endsWith('/api/subscriptions'));
  assert.equal(save.url, 'https://api.test/api/subscriptions');
  assert.equal(JSON.parse(save.options.body).domain_key, 'domain-key');
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
  await assert.rejects(b.context.window.PushNotifications.subscribe(), /Could not save your subscription/);
  assert.notEqual(b.buttons[0].hidden, true);
  assert.equal(b.buttons[0].disabled, false);
});

test('slow prompt telemetry never delays native permission or subscription saving', async () => {
  const b = browser(), ordinary = b.context.fetch, progress = [];
  let mounted, flushes = 0;
  b.context.window.PushPermissionUI = { mount(options) {
    mounted = options;
    return { outcome() {}, progress: message => progress.push(message), hide() {}, flush() { flushes++; return new Promise(() => {}); } };
  } };
  b.context.fetch = async (url, options) => url.includes('/api/prompt/')
    ? { ok: true, json: async () => ({ ok: true, data: { token: 'signed-fixture', prompt: { enabled: true, include_paths: [], exclude_paths: [] } } }) }
    : ordinary(url, options);
  await vm.runInNewContext(sdk, b.context);
  const pending = mounted.subscribe();
  assert.equal(b.permissionCalls(), 1, 'Native permission starts synchronously inside the click gesture');
  const saved = await Promise.race([pending, new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Subscription waited for analytics')), 250);
    pending.finally(() => clearTimeout(timer));
  })]);
  assert.ok(saved); assert.equal(flushes, 0);
  assert.ok(progress.includes('Saving your subscription...'));
  assert.equal(JSON.parse(b.requests[0].options.body).prompt_token, 'signed-fixture');
});

test('permission blocked after the popup opens explains the manual fix without another permission request', async () => {
  const b = browser(); await vm.runInNewContext(sdk, b.context);
  b.context.Notification.permission = 'denied';
  await assert.rejects(b.context.window.PushNotifications.subscribe(), error => error.code === 'permission-blocked' && /site settings.*Ask or Allow/.test(error.userMessage));
  assert.equal(b.permissionCalls(), 0); assert.equal(b.subscriptions(), 0); assert.equal(b.requests.filter(r => r.url.endsWith('/api/subscriptions')).length, 0);
});

test('Edge explains quiet permission requests while leaving the browser permission decision pending', async () => {
  const b = browser(), ordinary = b.context.fetch, progress = [];
  let mounted, allowPermission;
  b.context.navigator.userAgent = 'Mozilla/5.0 Windows NT Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0';
  b.context.Notification.requestPermission = () => new Promise(resolve => { allowPermission = resolve; });
  b.context.window.PushPermissionUI = { mount(options) {
    mounted = options;
    return { outcome() {}, progress: message => progress.push(message), hide() {} };
  } };
  b.context.fetch = async (url, options) => url.includes('/api/prompt/')
    ? { ok: true, json: async () => ({ ok: true, data: { prompt: { enabled: true, include_paths: [], exclude_paths: [] } } }) } : ordinary(url, options);
  await vm.runInNewContext(sdk, b.context);
  const pending = mounted.subscribe();
  assert.match(progress[0], /Edge.*notification icon beside the address bar/);
  assert.equal(b.subscriptions(), 0);
  b.context.Notification.permission = 'granted'; allowPermission('granted');
  await pending;
  assert.equal(b.subscriptions(), 1);
});

test('a dynamically loaded popup uses a versioned helper URL instead of an older cached copy', async () => {
  const b = browser(), ordinary = b.context.fetch, scripts = [];
  b.context.fetch = async (url, options) => url.includes('/api/prompt/')
    ? { ok: true, json: async () => ({ ok: true, data: { prompt: { enabled: true, include_paths: [], exclude_paths: [] } } }) } : ordinary(url, options);
  b.context.document.head = { appendChild(script) {
    scripts.push(script.src);
    b.context.window.PushPermissionUI = { mount() { return { hide() {} }; } };
    script.onload();
  } };
  await vm.runInNewContext(sdk, b.context);
  assert.equal(scripts.length, 1);
  assert.match(scripts[0], /\/sdk\/prompt-ui\.js\?v=[\w.-]+$/);
  assert.equal(b.permissionCalls(), 0);
});

test('subscription deadline includes a stalled response body; retry reuses the browser subscription', async () => {
  for (const stalledBody of [false, true]) {
    const b = browser(), ordinary = b.context.fetch;
    let expire, finishBody, first = true, saveSignal;
    b.context.setTimeout = (callback, ms) => ms === 10000 ? (expire = callback, 'save-deadline') : setTimeout(callback, ms);
    b.context.clearTimeout = timer => { if (timer !== 'save-deadline') clearTimeout(timer); };
    b.context.fetch = (url, options) => {
      if (!url.endsWith('/api/subscriptions') || !first) return ordinary(url, options);
      first = false; saveSignal = options.signal;
      if (!stalledBody) return new Promise(() => {});
      return Promise.resolve({ ok: true, json: () => new Promise(resolve => { finishBody = resolve; }) });
    };
    await vm.runInNewContext(sdk, b.context);
    const pending = b.context.window.PushNotifications.subscribe();
    await new Promise(resolve => setImmediate(resolve));
    expire();
    await assert.rejects(pending, error => error.code === 'subscription-timeout' && /try again/.test(error.userMessage));
    assert.equal(saveSignal.aborted, true); assert.notEqual(b.buttons[0].hidden, true);
    assert.equal(b.buttons[0].disabled, false); assert.equal(b.events.filter(e => e.type === 'push:subscribed').length, 0);
    if (finishBody) { finishBody({ ok: true }); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(b.events.filter(e => e.type === 'push:subscribed').length, 0, 'A late response cannot mark a timed-out save as successful');
    await b.context.window.PushNotifications.subscribe();
    assert.equal(b.permissionCalls(), 1); assert.equal(b.subscriptions(), 1);
    assert.equal(b.buttons[0].hidden, true);
  }
});

test('subscription errors use safe actionable messages rather than server internals', async () => {
  for (const [status, code] of [[403, 'subscription-restricted'], [404, 'website-not-found'], [429, 'subscription-busy'], [500, 'subscription-save-failed']]) {
    const b = browser(), ordinary = b.context.fetch;
    b.context.fetch = async (url, options) => url.endsWith('/api/subscriptions')
      ? { ok: false, status, json: async () => ({ ok: false, message: 'SQL private internal details' }) } : ordinary(url, options);
    await vm.runInNewContext(sdk, b.context);
    await assert.rejects(b.context.window.PushNotifications.subscribe(), error => error.code === code && !error.userMessage.includes('SQL'));
    assert.notEqual(b.buttons[0].hidden, true); assert.equal(b.buttons[0].disabled, false);
  }
});

test('saving after a connection failure retries without discarding a browser subscription', async () => {
  const b = browser(), ordinary = b.context.fetch;
  let failing = true;
  b.context.fetch = (url, options) => url.endsWith('/api/subscriptions') && failing
    ? Promise.reject(new TypeError('Failed to fetch')) : ordinary(url, options);
  await vm.runInNewContext(sdk, b.context);
  await assert.rejects(b.context.window.PushNotifications.subscribe(), error => error.code === 'subscription-connection');
  failing = false;
  await b.context.window.PushNotifications.subscribe();
  assert.equal(b.permissionCalls(), 1); assert.equal(b.subscriptions(), 1);
});

test('an active but still activating worker finishes activation before the subscription UI becomes ready', async () => {
  const b = browser();
  let changed, removed = 0;
  const worker = { state: 'activating', addEventListener(name, handler) { changed = handler; }, removeEventListener() { removed++; } };
  b.registration.active = worker;
  const setup = vm.runInNewContext(sdk, b.context);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.buttons.length, 0); assert.equal(b.permissionCalls(), 0);
  worker.state = 'activated'; changed(); await setup;
  assert.equal(removed, 1); assert.equal(b.buttons.length, 1);
  await b.context.window.PushNotifications.subscribe();
  assert.equal(b.subscriptions(), 1);
});

test('subscription retry rechecks the current worker and preserves a provider that took over after the popup opened', async () => {
  const b = browser(); await vm.runInNewContext(sdk, b.context);
  b.context.navigator.serviceWorker.getRegistration = async () => ({ scope: 'https://website.test/', active: { state: 'activated', scriptURL: 'https://website.test/feedify-worker.js' } });
  await assert.rejects(b.context.window.PushNotifications.subscribe(), error => error.code === 'worker-provider-conflict');
  assert.equal(b.subscriptions(), 0); assert.equal(b.requests.filter(r => r.url.endsWith('/api/subscriptions')).length, 0);
});

test('a replaced registration for our own worker is used instead of a stale PushManager', async () => {
  const b = browser(); await vm.runInNewContext(sdk, b.context);
  let created = 0;
  b.context.navigator.serviceWorker.getRegistration = async () => ({ scope: 'https://website.test/', active: { state: 'activated', scriptURL: 'https://website.test/push-sw.js' }, pushManager: {
    getSubscription: async () => null, subscribe: async () => { created++; return { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/current-worker', keys: {} }) }; },
  } });
  await b.context.window.PushNotifications.subscribe();
  assert.equal(created, 1); assert.equal(b.subscriptions(), 0);
});

test('a transient native push abort retries once without another permission prompt', async () => {
  const b = browser(); let calls = 0;
  const nativeSubscribe = b.registration.pushManager.subscribe;
  b.registration.pushManager.subscribe = () => ++calls === 1 ? Promise.reject(Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' })) : nativeSubscribe();
  b.context.setTimeout = (fn, ms) => setTimeout(fn, ms === 500 ? 0 : ms);
  await vm.runInNewContext(sdk, b.context);
  await b.context.window.PushNotifications.subscribe();
  assert.equal(calls, 2); assert.equal(b.permissionCalls(), 1);
  assert.equal(b.events.filter(e => e.type === 'push:subscribed').length, 1);
});

test('a recovered subscription is reused after an aborted creation rather than created again', async () => {
  const b = browser(); let sub, calls = 0;
  b.registration.pushManager.getSubscription = async () => sub;
  b.registration.pushManager.subscribe = async () => {
    calls++; sub = { toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/recovered', keys: {} }) };
    throw Object.assign(new Error('Registration failed - push service error'), { name: 'AbortError' });
  };
  b.context.setTimeout = (fn, ms) => setTimeout(fn, ms === 500 ? 0 : ms);
  await vm.runInNewContext(sdk, b.context);
  await b.context.window.PushNotifications.subscribe();
  assert.equal(calls, 1); assert.equal(b.permissionCalls(), 1);
});

test('persistent Android push failures expose a safe support code and stop after one retry', async () => {
  const b = browser(); let calls = 0;
  b.context.navigator.userAgent = 'Mozilla Android Mobile Chrome/142.0.0.0';
  b.registration.pushManager.subscribe = async () => { calls++; throw Object.assign(new Error('PRIVATE_ENDPOINT_CREDENTIALS'), { name: 'AbortError' }); };
  b.context.setTimeout = (fn, ms) => setTimeout(fn, ms === 500 ? 0 : ms);
  await vm.runInNewContext(sdk, b.context);
  await assert.rejects(b.context.window.PushNotifications.subscribe(), error => error.code === 'browser-push-service' && error.browserError === 'AbortError' && /Google Play services/.test(error.userMessage));
  assert.equal(calls, 2); assert.equal(b.events.filter(e => e.type === 'push:subscribed').length, 0);
  const detail = b.events.find(e => e.type === 'push:error').detail;
  assert.equal(detail.stage, 'browser-registration'); assert.equal(detail.permission, 'granted');
  assert.equal(JSON.stringify(detail).includes('PRIVATE_ENDPOINT_CREDENTIALS'), false);
  assert.equal(b.buttons[0].disabled, false);
});

test('native configuration, permission and worker-state failures are distinct and never retried blindly', async () => {
  for (const [name, code] of [['InvalidStateError', 'browser-subscription-state'], ['InvalidAccessError', 'push-key-invalid'], ['NotAllowedError', 'permission-unavailable'], ['NotSupportedError', 'browser-push-unsupported'], ['SecurityError', 'browser-security-restriction']]) {
    const b = browser(); let calls = 0;
    b.context.navigator.userAgent = 'Mozilla Android Mobile Chrome/142.0.0.0';
    b.registration.pushManager.subscribe = async () => { calls++; throw Object.assign(new Error('PRIVATE_NATIVE_EXCEPTION'), { name }); };
    await vm.runInNewContext(sdk, b.context);
    await assert.rejects(b.context.window.PushNotifications.subscribe(), error => error.code === code && error.browserError === name && !error.userMessage.includes('PRIVATE_NATIVE_EXCEPTION'));
    assert.equal(calls, 1); assert.equal(b.events.filter(e => e.type === 'push:subscribed').length, 0);
  }
});

test('a native push timeout permits retry without starting a second concurrent PushManager operation or late success', async () => {
  const b = browser(); let expire, complete, nativeCalls = 0;
  b.registration.pushManager.subscribe = () => { nativeCalls++; return new Promise(resolve => { complete = resolve; }); };
  b.context.setTimeout = (callback, ms) => ms === 15000 ? (expire = callback, 'native-deadline') : setTimeout(callback, ms);
  b.context.clearTimeout = timer => { if (timer !== 'native-deadline') clearTimeout(timer); };
  await vm.runInNewContext(sdk, b.context);
  const first = b.context.window.PushNotifications.subscribe(); await new Promise(resolve => setImmediate(resolve));
  expire(); await assert.rejects(first, error => error.code === 'browser-push-timeout');
  assert.equal(b.events.filter(e => e.type === 'push:subscribed').length, 0);
  const retry = b.context.window.PushNotifications.subscribe(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeCalls, 1);
  complete({ toJSON: () => ({ endpoint: 'https://fcm.googleapis.com/late', keys: {} }) });
  await retry;
  assert.equal(b.permissionCalls(), 1); assert.equal(b.events.filter(e => e.type === 'push:subscribed').length, 1);
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

test('workers display rich content, open the chosen action safely, and fall back when rich options are rejected', async () => {
  for (const source of [worker, readFileSync(new URL('../../wordpress/push-notifications-plugin/push-sw.js', import.meta.url), 'utf8')]) {
    const handlers = {}, shown = [], opened = [];
    let rejectRich = false, pending;
    const self = {
      location: { origin: 'https://www.website.test' }, addEventListener(name, handler) { handlers[name] = handler; },
      registration: { showNotification(title, options) { shown.push({ title, options: JSON.parse(JSON.stringify(options)) }); return rejectRich && options.image ? Promise.reject(new Error('Unsupported')) : Promise.resolve(); } },
      clients: { async matchAll() { return []; }, async openWindow(url) { opened.push(url); } },
    };
    vm.runInNewContext(source, { self, URL, Date });
    const data = { title: 'News', body: 'Story', url: '/article?q=1#story', image: 'https://cdn.test/banner.png', actions: [{ action: 'button-1', title: 'Read', type: 'link', url: '/more' }, { action: 'button-2', title: 'Share', type: 'facebook', url: '/article' }] };
    handlers.push({ data: { json: () => data }, waitUntil(value) { pending = value; } }); await pending;
    assert.equal(shown[0].options.image, data.image); assert.equal(shown[0].options.actions.length, 2);
    const click = async (action, override = data) => { handlers.notificationclick({ action, notification: { close() {}, data: override }, waitUntil(value) { pending = value; } }); await pending; return opened.at(-1); };
    assert.equal(await click('button-1'), 'https://www.website.test/more');
    assert.equal(await click(''), 'https://www.website.test/article?q=1#story');
    const shared = new URL(await click('button-2'));
    assert.equal(shared.hostname, 'www.facebook.com'); assert.equal(shared.searchParams.get('u'), 'https://www.website.test/article');
    assert.equal(await click('button-1', { ...data, actions: [{ ...data.actions[0], url: 'https://evil.test/' }] }), 'https://www.website.test/');
    assert.equal(await click('button-1', { ...data, actions: [{ ...data.actions[0], type: 'call', url: 'tel:+911234567890' }] }), 'tel:+911234567890');
    rejectRich = true;
    handlers.push({ data: { json: () => data }, waitUntil(value) { pending = value; } }); await pending;
    assert.equal(shown.at(-1).options.image, undefined); assert.equal(shown.at(-1).options.actions, undefined);
    assert.equal(shown.at(-1).options.body, 'Story');
  }
});
