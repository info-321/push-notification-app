self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

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
    data: { url: data.url || '/', actions },
    ...(data.image ? { image: data.image } : {}),
    ...(actions.length ? { actions: actions.map(item => ({ action: item.action, title: item.title })) } : {}),
  };
  event.waitUntil(self.registration.showNotification(data.title || 'New notification', options).catch(() => {
    // Keep ordinary notifications usable when a platform rejects rich options.
    delete options.image; delete options.actions;
    return self.registration.showNotification(data.title || 'New notification', options);
  }));
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
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url === target.href);
    return existing ? existing.focus() : self.clients.openWindow(target.href).catch(() => self.clients.openWindow(sameSite(data.url).href));
  }));
});
