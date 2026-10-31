self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

// Telemetry is best effort and never controls notification navigation.
function recordReport(tracking, event, action = 'body') {
  if (!tracking || typeof tracking.token !== 'string' || tracking.token.length > 240 || typeof fetch !== 'function') return Promise.resolve();
  let target;
  try { target = new URL(tracking.url); if (target.protocol !== 'https:' || target.username || target.password || target.pathname !== '/api/report-events') return Promise.resolve(); }
  catch { return Promise.resolve(); }
  return (async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 2000);
      try {
        const response = await fetch(target.href, { method: 'POST', mode: 'cors', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tracking.token, event, action }) });
        if (response.ok || response.status < 500) return;
      } catch { /* Offline, blocked, or timed out. One bounded retry. */ }
      finally { clearTimeout(timeout); }
    }
  })();
}

self.addEventListener('push', event => {
  let data = {};
  if (event.data) {
    try { data = event.data.json() || {}; }
    catch { data = { body: event.data.text() }; }
  }
  const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : 0;
  if (expiresAt && Date.now() > expiresAt) return;
  const actions = Array.isArray(data.actions) ? data.actions.slice(0, 2) : [];
  const options = {
    body: data.body || '', icon: data.icon || '',
    data: { url: data.url || '/', actions, tracking: data.tracking },
    ...(data.image ? { image: data.image } : {}),
    ...(actions.length ? { actions: actions.map(item => ({ action: item.action, title: item.title })) } : {}),
  };
  event.waitUntil(self.registration.showNotification(data.title || 'New notification', options).catch(() => {
    // Keep ordinary notifications usable when a platform rejects rich options.
    delete options.image; delete options.actions;
    return self.registration.showNotification(data.title || 'New notification', options);
  }).then(() => recordReport(data.tracking, 'ack')));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target;
  const data = event.notification.data || {};
  const action = Array.isArray(data.actions) && data.actions.find(item => item.action === event.action);
  const sameSite = value => {
    try { const url = new URL(value || data.url || '/', self.location.origin); return url.origin === self.location.origin && !url.username && !url.password ? url : new URL('/', self.location.origin); }
    catch { return new URL('/', self.location.origin); }
  };
  try { target = new URL(data.url || '/', self.location.origin); }
  catch { target = new URL('/', self.location.origin); }
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  if (action) {
    const page = sameSite(action.url);
    if (action.type === 'call' && /^tel:\+?[0-9]{3,15}$/.test(action.url)) target = new URL(action.url);
    else if (action.type === 'facebook') target = new URL('https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(page.href));
    else if (action.type === 'x') target = new URL('https://twitter.com/intent/tweet?url=' + encodeURIComponent(page.href));
    else if (action.type === 'whatsapp') target = new URL('https://wa.me/?text=' + encodeURIComponent(page.href));
    else if (action.type === 'link') target = page;
  }
  const navigation = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url === target.href);
    return existing ? existing.focus() : self.clients.openWindow(target.href).catch(() => self.clients.openWindow(sameSite(data.url).href));
  });
  event.waitUntil(Promise.all([navigation, recordReport(data.tracking, 'click', action ? action.action : 'body')]));
});
