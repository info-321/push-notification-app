// Public browser SDK. Never include sender credentials in pushConfig.
(async () => {
  if (window.PushNotifications) return;
  if (!window.isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    console.warn('[Push SDK] Notifications require a supported browser and HTTPS (or localhost).');
    return;
  }
  const cfg = window.pushConfig || {};
  if (!cfg.apiBase || !cfg.domainKey || !cfg.vapidPublicKey) {
    console.error('[Push SDK] Missing apiBase, domainKey, or vapidPublicKey.');
    return;
  }
  const toBytes = value => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
  let registration;
  let button;
  let promptController, promptToken;
  let busy = false;
  const report = (name, detail) => window.dispatchEvent(new CustomEvent(`push:${name}`, { detail }));
  const save = async subscription => {
    const response = await fetch(`${cfg.apiBase.replace(/\/$/, '')}/api/subscriptions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_key: cfg.domainKey, subscription: subscription.toJSON(), ...(promptToken ? { prompt_token: promptToken } : {}) }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save the subscription.');
    if (button) button.hidden = true;
    promptController?.hide();
    report('subscribed', {});
    return subscription;
  };
  const subscribe = async () => {
    if (busy) return;
    if (!registration?.active) throw new Error('Notification setup is still loading. Please try again.');
    if (Notification.permission === 'denied') throw new Error('Notifications are blocked. Enable them in your browser site settings.');
    busy = true;
    if (button) button.disabled = true;
    try {
      // Request permission in the click handler before other asynchronous work consumes the user gesture.
      const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      promptController?.outcome(permission);
      if (permission !== 'granted') return;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(cfg.vapidPublicKey) });
      await promptController?.flush();
      return await save(subscription);
    } finally {
      busy = false;
      if (button) button.disabled = false;
    }
  };
  window.PushNotifications = { subscribe };
  try {
    const workerUrl = new URL(cfg.swPath || '/push-sw.js', location.origin);
    if (workerUrl.origin !== location.origin) throw new Error('The service worker must be hosted on this website.');
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
    if (existing && Notification.permission === 'granted') { await save(existing); return; }
    if (Notification.permission === 'denied') return;
    if (cfg.showButton !== false) {
      // Phones and larger devices have independently published prompts. Tablets
      // (including desktop-mode iPads) use the larger-device group.
      const ua = navigator.userAgent || '';
      const tablet = /iPad|Tablet|Silk\/|Kindle/i.test(ua) || /Android/i.test(ua) && !/Mobile/i.test(ua) || /Macintosh/i.test(ua) && navigator.maxTouchPoints > 1;
      const phone = !tablet && (/iPhone|iPod|Windows Phone|Mobile/i.test(ua) || navigator.userAgentData?.mobile === true);
      const device = phone ? 'mobile' : 'large';
      {
        try {
          const request = async (path, options = {}) => {
            const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 3000);
            try { return await fetch(`${cfg.apiBase.replace(/\/$/, '')}${path}`, { ...options, signal: controller.signal, credentials: 'omit' }); }
            finally { clearTimeout(timeout); }
          };
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
        button.textContent = 'Try enabling notifications again';
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
