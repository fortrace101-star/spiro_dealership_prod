/* Spiro POS — Web Push handlers, shared by both service-worker builds:
 *   dev  → public/sw-dev.js importScripts this
 *   prod → vite-plugin-pwa Workbox /sw.js importScripts this (vite.config.ts)
 * Forwards every push to open POS windows ({ type: 'PUSH', payload }) so the
 * page can refresh the credit badge, and raises the OS notification so the
 * cashier hears about credit approvals even with the tab in the background. */

self.addEventListener('push', (event) => {
  let data = { title: 'Spiro POS', body: 'New activity', url: '/' };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    if (event.data) data.body = event.data.text();
  }
  // Single-screen app: every destination is home (admin URLs like /approvals
  // have no meaning on the POS origin, so never navigate there).
  data.url = '/';

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        client.postMessage({ type: 'PUSH', payload: data });
      }
      await self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/logo.png',
        badge: '/pwa-192.png',
        tag: data.tag || undefined,
        // OS notification must beep/vibrate on arrival even with no POS tab focused.
        silent: false,
        data: { url: '/' },
        vibrate: [100, 50, 100],
      });
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.navigate(url).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});