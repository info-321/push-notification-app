// Public browser SDK. Never include sender credentials in pushConfig.
(async () => {
  if (window.PushNotifications) return;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    console.warn('[Push SDK] Notifications require a supported browser and HTTPS (or localhost).');
    return;
  }
  const cfg = window.pushConfig || {};
  // Keep helper scripts aligned with this SDK, even in browsers that previously
  // cached an unversioned helper for hours.
  const sdkVersion = '2026-11-20.5';
  if (!cfg.apiBase || !cfg.domainKey || !cfg.vapidPublicKey) {
    console.error('[Push SDK] Missing apiBase, domainKey, or vapidPublicKey.');
    return;
  }
  const isOwnWorkerScript = value => {
    try {
      const expected = new URL(cfg.swPath || '/push-sw.js', location.origin), actual = new URL(value, location.origin);
      if (actual.href === expected.href) return true;
      // A recovery query forces Chromium to reinstall an unregistered worker.
      // Only our exact origin/path/configured query plus this marker is owned.
      const marker = actual.searchParams.get('notizo_recovery');
      if (expected.searchParams.has('notizo_recovery') || !/^[a-z0-9.-]{1,80}$/.test(marker || '')) return false;
      actual.searchParams.delete('notizo_recovery'); actual.searchParams.sort(); expected.searchParams.sort();
      return actual.href === expected.href;
    } catch { return false; }
  };
  const ua = navigator.userAgent || '';
  const ipad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  const appleMobile = ipad || /iPhone|iPod/i.test(ua);
  const tablet = ipad || /Tablet|Silk\/|Kindle/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  const phone = !tablet && (/iPhone|iPod|Windows Phone|Mobile/i.test(ua) || navigator.userAgentData?.mobile === true);
  const standalone = navigator.standalone === true || (typeof window.matchMedia === 'function' && (window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches));
  const request = async (path, options = {}) => {
    const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
    try { return await fetch(`${cfg.apiBase.replace(/\/$/, '')}${path}`, { ...options, signal: controller.signal, credentials: 'omit' }); }
    finally { clearTimeout(timeout); }
  };
  const clientContext = { ipad, standalone };
  const optOutKey = `notizo-notifications-off:${cfg.domainKey}`;
  const optedOut = () => { try { return localStorage.getItem(optOutKey) === '1'; } catch { return false; } };
  const rememberOptOut = value => { try { if (value) localStorage.setItem(optOutKey, '1'); else localStorage.removeItem(optOutKey); } catch { /* Storage is optional. */ } };
  let pendingWithdrawal, withdrawalInFlight, managerController, managerLoading;
  let savedSubscription, locationToken;
  const ownedRegistration = async () => {
    if (typeof navigator.serviceWorker.getRegistrations !== 'function') return;
    const scope=new URL(cfg.swScope || '/',location.origin).href;
    const registrations=await navigator.serviceWorker.getRegistrations();
    return registrations.find(item=>item.scope===scope&&item.active?.scriptURL&&[item.active,item.waiting,item.installing].every(worker=>!worker||isOwnWorkerScript(worker.scriptURL)));
  };
  const unsubscribe = () => {
    if (withdrawalInFlight) return withdrawalInFlight;
    withdrawalInFlight = (async () => {
      const own = await ownedRegistration();
      const sub = own ? await own.pushManager.getSubscription() : null;
      if (!own && !pendingWithdrawal) return false;
      if (sub?.options?.applicationServerKey) {
        const expected = Uint8Array.from(atob(cfg.vapidPublicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - cfg.vapidPublicKey.length % 4) % 4)), c => c.charCodeAt(0));
        if (Array.from(new Uint8Array(sub.options.applicationServerKey)).join(',') !== Array.from(expected).join(',')) throw new Error('This browser subscription belongs to another provider. It has not been changed.');
      }
      if (sub) pendingWithdrawal = sub.toJSON();
      rememberOptOut(true);
      if (pendingWithdrawal) {
        const controller = new AbortController(); let timer;
        try {
          await Promise.race([
            (async () => {
              const response = await fetch(`${cfg.apiBase.replace(/\/$/, '')}/api/subscriptions/unsubscribe`, { method: 'POST', credentials: 'omit', signal: controller.signal,
                headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ domain_key: cfg.domainKey, subscription: pendingWithdrawal }) });
              const result = await response.json();
              if (!response.ok || !result?.ok) throw new Error('Could not update your notification preferences. Please tap Unsubscribe again to retry.');
            })(),
            new Promise((resolve, reject) => { timer = setTimeout(() => { reject(new Error('Updating your notification preferences took too long. Please tap Unsubscribe again to retry.')); controller.abort(); }, 10000); }),
          ]);
        } catch (error) {
          throw new Error(error.message?.startsWith('Could not update') || error.message?.startsWith('Updating your notification') ? error.message : 'Could not reach the notification service. Please tap Unsubscribe again to retry.');
        } finally { clearTimeout(timer); }
      }
      // Remove the database record first. The browser retains the proof needed
      // for a retry if the server is offline; never persist endpoint keys locally.
      if (sub) {
        try { if (!await sub.unsubscribe() && await own.pushManager.getSubscription()) throw new Error('Browser cleanup failed'); }
        catch { throw new Error('Website notifications have been stopped, but your browser could not finish disconnecting. Tap Unsubscribe again to finish.'); }
      }
      pendingWithdrawal = null; savedSubscription = null; locationToken = null;
      document.getElementById?.('notizo-location-consent')?.remove();
      managerController?.setSubscribed(false);
      window.dispatchEvent(new CustomEvent('push:unsubscribed', { detail: {} }));
      return true;
    })().finally(() => { withdrawalInFlight = null; });
    return withdrawalInFlight;
  };
  const showManager = async (subscribed = true) => {
    if (cfg.manageNotifications === false) return;
    if (managerController) { managerController.setSubscribed(subscribed, optedOut() && subscribed); return; }
    if (!managerLoading) managerLoading = (async () => {
      if (!window.PushSubscriptionUI) await new Promise((resolve, reject) => {
        const script = document.createElement('script'), timer = setTimeout(() => { script.remove(); reject(new Error('Notification manager timeout')); }, 3000);
        script.src = `${cfg.apiBase.replace(/\/$/, '')}/sdk/subscription-ui.js?v=${sdkVersion}`;
        script.onload = () => { clearTimeout(timer); resolve(); }; script.onerror = () => { clearTimeout(timer); reject(new Error('Notification manager unavailable')); };
        try { document.head.appendChild(script); } catch (error) { clearTimeout(timer); reject(error); }
      });
      if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      managerController = window.PushSubscriptionUI.mount({ subscribed, pending: optedOut() && subscribed, unsubscribe,
        canSubscribe: () => typeof window.PushNotifications.subscribe === 'function',
        subscribe: () => {
          if (typeof window.PushNotifications.subscribe !== 'function') return Promise.reject(new Error('Subscribing is unavailable for this browser. You can still unsubscribe.'));
          return window.PushNotifications.subscribe();
        } });
    })().finally(() => { managerLoading = null; });
    return managerLoading;
  };
  const manageExisting = async () => {
    try {
      const own = await ownedRegistration();
      if (own && await own.pushManager.getSubscription()) await showManager();
    } catch { /* Optional control must not delay or break subscription setup. */ }
  };
  window.PushNotifications={unsubscribe};
  // Fail closed before any invitation or worker can interfere with another service.
  try {
    const response = await request(`/api/targeting/${encodeURIComponent(cfg.domainKey)}?ipad=${ipad ? '1' : '0'}&standalone=${standalone ? '1' : '0'}`), result = await response.json();
    if (!response.ok || !result.ok || result.data?.allowed !== true) { await manageExisting(); return; }
  } catch { console.warn('[Push SDK] Device/browser rules unavailable; setup skipped.'); await manageExisting(); return; }
  // Installation guidance is ordinary HTML; it must not depend on Notification
  // or PushManager, which are absent in ordinary iPhone/iPad browser tabs.
  if (appleMobile && !standalone) {
    window.PushNotifications = { unsubscribe, subscribe: async () => { throw new Error('Add this website to your Home Screen, then open its icon to enable notifications.'); } };
    if (cfg.showButton === false) return;
    try {
      const response = await request(`/api/prompt/${encodeURIComponent(cfg.domainKey)}${phone ? '?device=mobile' : ''}`), result = await response.json();
      // Fail closed when settings cannot be checked; a published OFF must win.
      if (!response.ok || !result.ok || !result.data || !Object.hasOwn(result.data, 'prompt') || (result.data.prompt && phone && result.data.device !== 'mobile')) return;
      const p = result.data.prompt;
      if (p && !p.enabled) return;
      if (!window.PushAppleInstall) await new Promise((resolve, reject) => {
        const script = document.createElement('script'), timeout = setTimeout(() => { script.remove(); reject(new Error('Apple installation guide timeout')); }, 3000);
        script.src = `${cfg.apiBase.replace(/\/$/, '')}/sdk/apple-install.js?v=${sdkVersion}`;
        script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); reject(new Error('Apple installation guide unavailable')); };
        document.head.appendChild(script);
      });
      if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      window.PushAppleInstall.mount({ key: cfg.domainKey, ipad, settings: p });
    } catch (error) { console.warn('[Push SDK] Apple installation guide unavailable:', error.message); }
    return;
  }
  if (!('PushManager' in window) || !('Notification' in window)) {
    console.warn('[Push SDK] Notifications require a supported browser. Home Screen web push needs iOS/iPadOS 16.4 or later.');
    return;
  }
  const toBytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
  let registration;
  let button;
  let promptController, promptToken;
  let pendingPushSubscription;
  let busy = false;
  const report = (name, detail) => window.dispatchEvent(new CustomEvent(`push:${name}`, { detail }));
  // Only these locally authored messages are suitable for the visitor-facing UI.
  const failure = (code, message) => Object.assign(new Error(message), { code, userMessage: message });
  const blocked = () => failure('permission-blocked', 'Notifications are blocked. Open this website\'s browser site settings, change Notifications to Ask or Allow, then reload the page.');
  const progress = message => {
    promptController?.progress?.(message);
    if (button) button.textContent = message;
  };
  const workerConflict = () => failure('worker-provider-conflict', 'Another notification provider is using this website\'s notification worker. It has been preserved. Please contact the website administrator.');
  const waitForActiveWorker = (reg, desiredUrl) => {
    if (reg.active && (!desiredUrl || !reg.active.scriptURL || reg.active.scriptURL === desiredUrl) && (!reg.active.state || reg.active.state === 'activated')) return Promise.resolve();
    const worker = desiredUrl ? [reg.installing, reg.waiting, reg.active].find(item => item?.scriptURL === desiredUrl) : reg.active || reg.installing || reg.waiting;
    if (!worker) return Promise.reject(failure('worker-unavailable', 'Notification setup changed or did not start. Please reload this page and try again.'));
    return new Promise((resolve, reject) => {
      const finish = error => { clearTimeout(timer); worker.removeEventListener?.('statechange', check); error ? reject(error) : resolve(); };
      const check = () => {
        if (worker.state === 'activated') finish();
        else if (worker.state === 'redundant') finish(failure('worker-unavailable', 'Notification setup changed or failed. Please reload this page and try again.'));
      };
      const timer = setTimeout(() => finish(failure('worker-timeout', 'Notification setup is taking too long. Please reload this page and try again.')), 10000);
      worker.addEventListener('statechange', check); check();
    });
  };
  const lookupRegistration = async () => {
    const scope = new URL(cfg.swScope || '/', location.origin).href;
    if (typeof navigator.serviceWorker.getRegistrations === 'function') return (await navigator.serviceWorker.getRegistrations()).find(reg => reg.scope === scope);
    if (typeof navigator.serviceWorker.getRegistration === 'function') {
      const reg = await navigator.serviceWorker.getRegistration(scope);
      return reg && (!reg.scope || reg.scope === scope) ? reg : undefined;
    }
    return registration;
  };
  const assertOwnWorker = reg => {
    if ([reg.active, reg.waiting, reg.installing].some(worker => worker?.scriptURL && !isOwnWorkerScript(worker.scriptURL))) throw workerConflict();
  };
  const currentRegistration = async recovery => {
    let reg = await lookupRegistration();
    let recoveryUrl;
    if (reg) assertOwnWorker(reg);
    if (!reg || !(reg.installing || reg.waiting || (reg.active && reg.active.state !== 'redundant'))) {
      if (recovery.used) throw failure('worker-repeatedly-removed', 'Another script on this website keeps removing notification setup. Please contact the website administrator.');
      recovery.used = true;
      progress('Restoring notification setup...');
      const workerUrl = new URL(cfg.swPath || '/push-sw.js', location.origin);
      if (workerUrl.origin !== location.origin) throw failure('worker-invalid-origin', 'The notification worker must be hosted on this website. Please contact the website administrator.');
      workerUrl.searchParams.set('notizo_recovery', `${sdkVersion}.${Date.now()}.${Math.random().toString(36).slice(2, 10)}`);
      recoveryUrl = workerUrl.href;
      // Repair only the absent/empty registration at our configured scope.
      // Never unregister anything or replace another provider's worker.
      reg = await navigator.serviceWorker.register(workerUrl.href, { scope: cfg.swScope || '/', updateViaCache: 'none' });
      assertOwnWorker(reg);
    }
    await waitForActiveWorker(reg, recoveryUrl);
    assertOwnWorker(reg);
    if (recoveryUrl) {
      reg = await lookupRegistration();
      if (!reg) throw failure('worker-repeatedly-removed', 'Another script on this website keeps removing notification setup. Please contact the website administrator.');
      assertOwnWorker(reg);
    }
    return reg;
  };
  const browserSubscription = () => {
    if (!pendingPushSubscription) {
      const deadline = Date.now() + 15000;
      const recovery = { used: false };
      const attempt = (async () => {
        for (let retry = 0; retry < 2; retry++) {
          registration = await currentRegistration(recovery);
          try {
            // Read again on retry in case the browser completed the first attempt.
            const existing = await registration.pushManager.getSubscription();
            checkIdentity(existing);
            assertOwnWorker(registration);
            return existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(cfg.vapidPublicKey) });
          } catch (error) {
            if (retry || Notification.permission !== 'granted' || navigator.onLine === false || Date.now() + 500 >= deadline) throw error;
            if (error.name !== 'AbortError') {
              if (error.name !== 'InvalidStateError') throw error;
              const latest = await lookupRegistration();
              if (latest) { assertOwnWorker(latest); if (latest === registration && latest.active?.state !== 'redundant') throw error; }
            }
            progress('Retrying the browser notification connection...');
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
      })();
      pendingPushSubscription = attempt;
      const clear = () => { if (pendingPushSubscription === attempt) pendingPushSubscription = null; };
      attempt.then(clear, clear);
    }
    let timer;
    // Native PushManager operations cannot be cancelled. Reuse a still-pending
    // attempt on another click instead of creating competing subscriptions.
    return Promise.race([pendingPushSubscription, new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(failure('browser-push-timeout', 'Chrome or your browser is taking too long to connect to its push service. Try switching between Wi-Fi and mobile data, then tap Subscribe again.')), 15000);
    })]).finally(() => clearTimeout(timer));
  };
  const subscriptionFailure = error => {
    if (error.userMessage) return error;
    if (Notification.permission === 'denied') return blocked();
    if (navigator.onLine === false) return failure('browser-offline', 'Your phone or computer is offline. Reconnect to the internet, then tap Subscribe again.');
    const android = /Android/i.test(ua), name = error.name;
    // Do not render native exception messages: some contain subscription URLs.
    if (name === 'NotAllowedError') return failure('permission-unavailable', android
      ? 'Chrome could not allow notifications. Check this website\'s permission in Chrome, and Android Settings > Apps > Chrome > Notifications, then try again.'
      : 'Your browser did not allow notifications. Check this website\'s notification permission in browser site settings.');
    if (name === 'InvalidStateError') return failure('browser-subscription-state', 'Your browser\'s notification setup has changed or conflicts with an existing subscription. Reload this page. If it still fails, contact the website administrator.');
    if (['InvalidAccessError', 'InvalidCharacterError', 'TypeError'].includes(name)) return failure('push-key-invalid', 'The website\'s notification configuration could not be accepted by your browser. Please contact the website administrator.');
    if (name === 'NotSupportedError') return failure('browser-push-unsupported', 'Push notifications are unavailable in this browser or device configuration. Update your browser and try in a normal browser tab.');
    if (name === 'SecurityError') return failure('browser-security-restriction', 'Your browser or device security settings prevented notification setup. Open this website directly in a normal browser tab and check its site permissions.');
    if (['AbortError', 'NetworkError'].includes(name)) return failure('browser-push-service', android
      ? 'Chrome could not register with its push service. Try switching between Wi-Fi and mobile data, then retry. If it continues, update Chrome and Google Play services and check Chrome\'s Android notification permission.'
      : 'Your browser could not register with its push service. Check your connection, update your browser, then retry.');
    return failure('browser-subscription-failed', 'Your browser could not finish notification setup. Reload this page and try again. If it continues, share the support code with the website administrator.');
  };
  const shareLocation = () => {
    if (!savedSubscription || !locationToken) return Promise.reject(new Error('Enable notifications before sharing your location.'));
    if (!navigator.geolocation) return Promise.reject(new Error('Location sharing is unavailable in this browser.'));
    // This function is called by a separate Share location button. Notification
    // permission or a returning visit never triggers a geolocation request.
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve,
      () => reject(new Error('Location was not shared. You can keep using notifications without it.')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 })).then(async position => {
      const response = await request('/api/subscriptions/location', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain_key: cfg.domainKey, endpoint: savedSubscription.endpoint, token: locationToken,
          consent: true, latitude: position.coords.latitude, longitude: position.coords.longitude,
          accuracy: position.coords.accuracy, client_context: clientContext }) });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save location.');
      report('location-shared', {});
    });
  };
  const offerLocation = async () => {
    if (cfg.showButton === false || cfg.requestLocation === false || !navigator.geolocation) return;
    if (!window.PushLocationUI) await new Promise((resolve, reject) => {
      const script = document.createElement('script'), timeout = setTimeout(() => { script.remove(); reject(new Error('Location UI timeout')); }, 3000);
      script.src = `${cfg.apiBase.replace(/\/$/, '')}/sdk/location-ui.js?v=${sdkVersion}`;
      script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); reject(new Error('Location UI unavailable')); };
      document.head.appendChild(script);
    });
    if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    if (!savedSubscription || !locationToken) return;
    window.PushLocationUI.mount({ key: cfg.domainKey, shareLocation });
  };
  const save = async (subscription, explicit = false) => {
    progress('Saving your subscription...');
    const controller = new AbortController();
    let timer;
    let result;
    try {
      // Bound both the response and its body. A late response must never report success.
      result = await Promise.race([
        (async () => {
          const response = await fetch(`${cfg.apiBase.replace(/\/$/, '')}/api/subscriptions`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'omit', signal: controller.signal,
            body: JSON.stringify({ domain_key: cfg.domainKey, subscription: subscription.toJSON(), client_context: clientContext, ...(promptToken ? { prompt_token: promptToken } : {}) }),
          });
          if (response.status === 403) throw failure('subscription-restricted', 'This website\'s subscription rules do not allow this request. Please contact the website administrator.');
          if (response.status === 404) throw failure('website-not-found', 'Notification setup for this website is unavailable. Please contact the website administrator.');
          if (response.status === 429) throw failure('subscription-busy', 'The notification service is busy. Please wait a minute before trying again.');
          const data = await response.json();
          if (!response.ok || !data?.ok) throw failure('subscription-save-failed', 'Could not save your subscription. Please try again in a moment.');
          return data;
        })(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            reject(failure('subscription-timeout', 'Saving your subscription took too long. Please check your connection and try again.'));
            controller.abort();
          }, 10000);
        }),
      ]);
    } catch (error) {
      if (error.userMessage) throw error;
      throw failure('subscription-connection', 'Could not connect to the notification service. Please check your connection and try again.');
    } finally { clearTimeout(timer); }
    savedSubscription = subscription.toJSON();
    locationToken = result.location_token;
    if (explicit) rememberOptOut(false);
    if (button) button.hidden = true;
    promptController?.hide();
    report('subscribed', {});
    showManager().catch(() => { /* Subscription succeeds even if the optional control cannot load. */ });
    if (locationToken && !result.location_shared) offerLocation().catch(() => { /* Location is optional; notifications remain enabled. */ });
    return subscription;
  };
  const subscribe = async () => {
    if (withdrawalInFlight) throw failure('unsubscribe-in-progress', 'Please wait for your unsubscribe request to finish.');
    if (busy) return;
    if (!registration) throw failure('setup-loading', 'Notification setup is still loading. Please try again.');
    if (Notification.permission === 'denied') throw blocked();
    busy = true;
    let stage = 'permission';
    if (button) button.disabled = true;
    try {
      // Request permission in the click handler before other asynchronous work consumes the user gesture.
      progress(Notification.permission === 'granted' ? 'Connecting to notifications...' : /Edg\//.test(ua)
        ? 'Please allow notifications in Edge. If no permission popup appears, check the notification icon beside the address bar.'
        : 'Please respond to your browser\'s notification request.');
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      promptController?.outcome(permission);
      if (permission !== 'granted') return;
      stage = 'browser-registration';
      progress('Connecting to notifications...');
      const subscription = await browserSubscription();
      // Prompt analytics are best-effort; they must never hold up a subscription.
      stage = 'subscription-save';
      return await save(subscription, true);
    } catch (error) {
      const mapped = subscriptionFailure(error);
      const knownNames = ['AbortError', 'NetworkError', 'InvalidStateError', 'InvalidAccessError', 'InvalidCharacterError', 'NotAllowedError', 'NotSupportedError', 'SecurityError', 'TypeError'];
      mapped.browserError = knownNames.includes(error.name) ? error.name : 'Error';
      report('error', { code: mapped.code, stage, browserError: mapped.browserError, permission: Notification.permission });
      throw mapped;
    } finally {
      busy = false;
      if (button) { button.disabled = false; button.textContent = cfg.buttonLabel || 'Enable notifications'; }
    }
  };
  window.PushNotifications = { subscribe, shareLocation, unsubscribe };
  const checkIdentity = subscription => {
    const existingKey = subscription?.options?.applicationServerKey;
    if (existingKey && Array.from(new Uint8Array(existingKey)).join(',') !== Array.from(toBytes(cfg.vapidPublicKey)).join(',')) throw failure('subscription-provider-conflict', 'An existing subscription uses another provider. It has not been changed. Please contact the website administrator.');
  };
  try {
    const workerUrl = new URL(cfg.swPath || '/push-sw.js', location.origin);
    let registerUrl = workerUrl.href;
    if (workerUrl.origin !== location.origin) throw new Error('The service worker must be hosted on this website.');
    if (typeof navigator.serviceWorker.getRegistrations === 'function') {
      const scope = new URL(cfg.swScope || '/', location.origin).href;
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration = registrations.find(item => item.scope === scope);
      if (registration) {
        assertOwnWorker(registration);
        registerUrl = (registration.installing || registration.waiting || registration.active)?.scriptURL || registerUrl;
      }
    }
    registration = await navigator.serviceWorker.register(registerUrl, { scope: cfg.swScope || '/' });
    await waitForActiveWorker(registration);
    const existing = await registration.pushManager.getSubscription();
    checkIdentity(existing);
    if (existing && optedOut()) { await showManager(); return; }
    if (existing && Notification.permission === 'granted') { await save(existing); return; }
    if (optedOut()) return;
    if (Notification.permission === 'denied') return;
    if (cfg.showButton !== false) {
      // Phones and larger devices have independently published prompts. Tablets
      // (including desktop-mode iPads) use the larger-device group.
      const device = phone ? 'mobile' : 'large';
      {
        try {
          const response = await request(`/api/prompt/${encodeURIComponent(cfg.domainKey)}${phone ? '?device=mobile' : ''}`), result = await response.json();
          if (response.ok && result.ok && result.data?.prompt && (!phone || result.data.device === 'mobile')) {
            const p = result.data.prompt, matches = prefix => prefix === '/' || location.pathname === prefix || location.pathname.startsWith(prefix.endsWith('/') ? prefix : prefix + '/');
            let dismissedUntil = 0;
            try { dismissedUntil = Number(localStorage.getItem(`push-prompt-dismissed:${cfg.domainKey}${phone ? ':mobile' : ''}`)) || 0; } catch { /* Storage is optional. */ }
            // Honor explicit suppression even if the optional UI script cannot load.
            if (!p.enabled || dismissedUntil > Date.now() || (p.include_paths.length && !p.include_paths.some(matches)) || p.exclude_paths.some(matches)) { report('ready', {}); return; }
            if (!window.PushPermissionUI) await new Promise((resolve, reject) => {
              const script = document.createElement('script'), timeout = setTimeout(() => { script.remove(); reject(new Error('Prompt UI timeout')); }, 3000);
              script.src = `${cfg.apiBase.replace(/\/$/, '')}/sdk/prompt-ui.js?v=${sdkVersion}`;
              script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); reject(new Error('Prompt UI unavailable')); };
              document.head.appendChild(script);
            });
            if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
            promptToken = result.data.token;
            promptController = window.PushPermissionUI.mount({ key: cfg.domainKey, device, settings: result.data.prompt, subscribe,
              track: async (event, outcome) => request(`/api/prompt/${encodeURIComponent(cfg.domainKey)}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: promptToken, event, ...(outcome ? { outcome } : {}) }) }) });
            report('ready', {}); return;
          }
        } catch { /* Preserve the existing button if optional settings are unavailable. */ }
      }
      button = document.createElement('button');
      button.type = 'button';
      button.textContent = cfg.buttonLabel || 'Enable notifications';
      button.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:99999;padding:12px 18px;border:0;border-radius:8px;background:#1f73c9;color:#fff;font:600 14px system-ui;cursor:pointer';
      button.addEventListener('click', () => subscribe().catch(error => {
        button.textContent = error.userMessage || 'Could not enable notifications. Please try again.';
        report('error', { message: error.message });
        console.error('[Push SDK]', error);
      }));
      if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
      document.body.appendChild(button);
    }
    report('ready', {});
  } catch (error) {
    report('error', { message: error.message });
    console.error('[Push SDK]', error);
    await manageExisting();
  }
})();
