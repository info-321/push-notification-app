// Public browser SDK. Never include sender credentials in pushConfig.
(async () => {
  if (window.PushNotifications) return;
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    console.warn('[Push SDK] Notifications require a supported browser and HTTPS (or localhost).');
    return;
  }
  const cfg = window.pushConfig || {};
  if (!cfg.apiBase || !cfg.domainKey || !cfg.vapidPublicKey) {
    console.error('[Push SDK] Missing apiBase, domainKey, or vapidPublicKey.');
    return;
  }
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
  let pendingWithdrawal;
  const unsubscribe = async () => {
    const scope=new URL(cfg.swScope || '/',location.origin).href,workerUrl=new URL(cfg.swPath || '/push-sw.js',location.origin).href;
    const registrations=await navigator.serviceWorker.getRegistrations();
    const own=registrations.find(item=>item.scope===scope&&item.active?.scriptURL===workerUrl);
    if(!own)return false;
    const sub=await own.pushManager.getSubscription();if(!sub&&!pendingWithdrawal)return true;
    if(sub){pendingWithdrawal=sub.toJSON();await sub.unsubscribe();}
    const data=pendingWithdrawal;
    const response=await request('/api/subscriptions/unsubscribe',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({domain_key:cfg.domainKey,subscription:data})});
    const result=await response.json();if(!response.ok||!result.ok)throw new Error(result.message || 'Could not unsubscribe.');
    // Keep a failed server withdrawal available for an explicit retry in this
    // page, without writing endpoint credentials to browser storage.
    pendingWithdrawal=null;
    window.dispatchEvent(new CustomEvent('push:unsubscribed',{detail:{}}));
    return true;
  };
  window.PushNotifications={unsubscribe};
  // Fail closed before any invitation or worker can interfere with another service.
  try {
    const response = await request(`/api/targeting/${encodeURIComponent(cfg.domainKey)}?ipad=${ipad ? '1' : '0'}&standalone=${standalone ? '1' : '0'}`), result = await response.json();
    if (!response.ok || !result.ok || result.data?.allowed !== true) return;
  } catch { console.warn('[Push SDK] Device/browser rules unavailable; setup skipped.'); return; }
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
        script.src = `${cfg.apiBase.replace(/\/$/, '')}/sdk/apple-install.js`;
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
  let savedSubscription, locationToken;
  let busy = false;
  const report = (name, detail) => window.dispatchEvent(new CustomEvent(`push:${name}`, { detail }));
  // Only these locally authored messages are suitable for the visitor-facing UI.
  const failure = (code, message) => Object.assign(new Error(message), { code, userMessage: message });
  const blocked = () => failure('permission-blocked', 'Notifications are blocked. Open this website\'s browser site settings, change Notifications to Ask or Allow, then reload the page.');
  const progress = message => {
    promptController?.progress?.(message);
    if (button) button.textContent = message;
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
      script.src = `${cfg.apiBase.replace(/\/$/, '')}/sdk/location-ui.js`;
      script.onload = () => { clearTimeout(timeout); resolve(); }; script.onerror = () => { clearTimeout(timeout); reject(new Error('Location UI unavailable')); };
      document.head.appendChild(script);
    });
    if (!document.body) await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
    window.PushLocationUI.mount({ key: cfg.domainKey, shareLocation });
  };
  const save = async subscription => {
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
    if (button) button.hidden = true;
    promptController?.hide();
    report('subscribed', {});
    if (locationToken && !result.location_shared) offerLocation().catch(() => { /* Location is optional; notifications remain enabled. */ });
    return subscription;
  };
  const subscribe = async () => {
    if (busy) return;
    if (!registration?.active) throw failure('setup-loading', 'Notification setup is still loading. Please try again.');
    if (Notification.permission === 'denied') throw blocked();
    busy = true;
    if (button) button.disabled = true;
    try {
      // Request permission in the click handler before other asynchronous work consumes the user gesture.
      progress(Notification.permission === 'granted' ? 'Connecting to notifications...' : 'Please respond to your browser\'s notification request.');
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      promptController?.outcome(permission);
      if (permission !== 'granted') return;
      progress('Connecting to notifications...');
      const existing = await registration.pushManager.getSubscription();
      checkIdentity(existing);
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(cfg.vapidPublicKey) });
      // Prompt analytics are best-effort; they must never hold up a subscription.
      return await save(subscription);
    } catch (error) {
      if (error.userMessage) throw error;
      if (Notification.permission === 'denied') throw blocked();
      if (error.name === 'NotAllowedError') throw failure('permission-unavailable', 'Your browser did not allow notifications. Check this website\'s notification permission in browser site settings.');
      throw failure('browser-subscription-failed', 'Your browser could not connect to its push service. Please check your connection and try again.');
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
    if (workerUrl.origin !== location.origin) throw new Error('The service worker must be hosted on this website.');
    if (typeof navigator.serviceWorker.getRegistrations === 'function') {
      const scope = new URL(cfg.swScope || '/', location.origin).href;
      const registrations = await navigator.serviceWorker.getRegistrations();
      const registration = registrations.find(item => item.scope === scope);
      if (registration && [registration.active, registration.waiting, registration.installing].some(worker => worker && worker.scriptURL !== workerUrl.href)) throw new Error('Another service worker owns this scope. Notification setup was skipped to preserve it.');
    }
    registration = await navigator.serviceWorker.register(workerUrl.href, { scope: cfg.swScope || '/' });
    if (!registration.active) {
      await new Promise((resolve, reject) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) return reject(new Error('The service worker did not start.'));
        const timer = setTimeout(() => reject(new Error('Service worker activation timed out.')), 15000);
        const check = () => {
          if (worker.state === 'activated') { clearTimeout(timer); resolve(); }
          else if (worker.state === 'redundant') { clearTimeout(timer); reject(new Error('Service worker installation failed.')); }
        };
        worker.addEventListener('statechange', check);
        check();
      });
    }
    const existing = await registration.pushManager.getSubscription();
    checkIdentity(existing);
    if (existing && Notification.permission === 'granted') { await save(existing); return; }
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
              script.src = `${cfg.apiBase.replace(/\/$/, '')}/sdk/prompt-ui.js`;
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
  }
})();
