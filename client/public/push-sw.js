// Service worker for web push notifications with basic safety checks.
// Safe defaults: if payload lacks icon/url, it still shows a notification without errors.

self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};

  // Optional TTL check: if payload includes expiresAt (ms or ISO), skip expired notifications.
  const expiresAt = data.expiresAt ? new Date(data.expiresAt).getTime() : undefined;
  if (expiresAt && Date.now() > expiresAt) {
    return; // Do not show stale/expired notification.
  }

  const title = data.title || 'New notification';
  const body = data.body || '';
  // If no icon/url are provided, fall back to empty icon and root URL to avoid errors.
  const icon = data.icon || '';
  const url = data.url || '/';

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon,
      data: { url },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus an open tab if it matches; otherwise, open a new one.
      for (const client of clientList) {
        if (client.url.includes(url) && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(url);
      }
      return null;
    })
  );
});

// Placeholder for background sync. If you queue failed requests, trigger them with a sync tag.
self.addEventListener('sync', (event) => {
  if (event.tag === 'retry-push-sync') {
    event.waitUntil(Promise.resolve()); // Replace with real retry logic if you store a queue.
  }
});
