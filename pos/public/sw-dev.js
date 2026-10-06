/* Spiro POS — dev-only service worker (npm run dev). Production registers the
 * vite-plugin-pwa generated /sw.js, which importScripts the same push handler;
 * the registration is keyed by scope, so dev → prod swaps the script cleanly. */
importScripts('/push-handler.js')

// Fetch handler: browsers require one for the installability criteria
// (PWA download / Add to Home Screen). Dev always goes to the network.
self.addEventListener('fetch', () => {})

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});