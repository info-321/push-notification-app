// client/public/sdk/push.js
// Hosted SDK loaded by your snippet. Performs all requested checks.

(async () => {
  // 1) Browser support check
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn('[Push SDK] Browser does not support Service Worker / Push.');
    return;
  }

  // 2) HTTPS requirement (allow localhost)
  if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
    console.warn('[Push SDK] Push requires HTTPS (or localhost). Aborting.');
    return;
  }

  // 3) Config from snippet
  const cfg = window.pushConfig || {};
  if (!cfg.apiBase || !cfg.domainKey || !cfg.vapidPublicKey) {
    console.error('[Push SDK] Missing apiBase / domainKey / vapidPublicKey in config.');
    return;
  }

  try {
    // 4) Register service worker
    const swReg = await navigator.serviceWorker.register(cfg.swPath || '/push-sw.js');
    if (!swReg.scope || !swReg.scope.startsWith(location.origin)) {
      console.warn('[Push SDK] SW scope may be too narrow:', swReg.scope);
    }

    // 5) Subscribe with VAPID
    const sub = await swReg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(cfg.vapidPublicKey),
    });

    // 6) Send subscription to backend
    const res = await fetch(`${cfg.apiBase}/api/subscriptions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain_key: cfg.domainKey, subscription: sub }),
    });

    // 7) Handle backend rejection
    if (!res.ok) {
      const text = await res.text();
      console.warn('[Push SDK] Backend rejected subscription:', res.status, text);
      return;
    }

    // 8) Confirm success + optional domain ownership warning
    const data = await res.json().catch(() => ({}));
    if (data && data.domain_verified === false) {
      console.warn('[Push SDK] Domain not verified. Please complete ownership check.');
    }
    console.info('[Push SDK] Subscription stored successfully.');
  } catch (err) {
    console.error('[Push SDK] Subscription/registration error:', err);
  }

  // Helper: convert base64 VAPID key to Uint8Array
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
      outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
  }
})();
