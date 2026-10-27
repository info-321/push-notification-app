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
  let busy = false;
  const report = (name, detail) => window.dispatchEvent(new CustomEvent(`push:${name}`, { detail }));
  const save = async subscription => {
    const response = await fetch(`${cfg.apiBase.replace(/\/$/, '')}/api/subscriptions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_key: cfg.domainKey, subscription: subscription.toJSON() }),
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.message || 'Could not save the subscription.');
    if (button) button.hidden = true;
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
      if (permission !== 'granted') return;
      const existing = await registration.pushManager.getSubscription();
      const subscription = existing || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: toBytes(cfg.vapidPublicKey) });
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
