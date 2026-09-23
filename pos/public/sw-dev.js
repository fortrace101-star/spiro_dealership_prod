/* Spiro POS — dev-only service worker (npm run dev). Production registers the
 * vite-plugin-pwa generated /sw.js, which importScripts the same push handler;
 * the registration is keyed by scope, so dev → prod swaps the script cleanly. */
importScripts('/push-handler.js')

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});