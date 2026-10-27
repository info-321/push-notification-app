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
  event.waitUntil(self.registration.showNotification(data.title || 'New notification', {
    body: data.body || '', icon: data.icon || '', data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  let target;
  try { target = new URL(event.notification.data?.url || '/', self.location.origin); }
  catch { target = new URL('/', self.location.origin); }
  if (target.origin !== self.location.origin) target = new URL('/', self.location.origin);
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => client.url === target.href);
    return existing ? existing.focus() : self.clients.openWindow(target.href);
  }));
});
