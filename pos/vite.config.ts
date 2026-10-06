import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // main.tsx already calls registerSW() from 'virtual:pwa-register' itself,
      // so do NOT also inject the auto-generated register snippet — otherwise the
      // service worker is registered twice and the reload-on-activate signal fires twice.
      injectRegister: 'manual',
      registerType: 'autoUpdate',
      // DEV: the manifest + a dev service worker are served so the app is
      // installable (PWA download / Add to Home Screen) from the dev server.
      // The reload loop from earlier stays fixed — main.tsx registers the
      // hand-written /sw-dev.js in dev (plain register, no update listeners).
      // With `registerType: 'autoUpdate'`, registerSW calls
      // window.location.reload() inside the SW "activated" handler whenever
      // `event.isUpdate || event.isExternal` is true, and the dev worker
      // re-activates across HMR cycles → continuous reloads. `devOptions`
      // only applies to `vite` dev; `vite build` still emits the
      // auto-updating worker so deployed kiosks self-update.
      devOptions: { enabled: true },
      includeAssets: ['logo.png'],
      manifest: {
        name: 'Spiro POS',
        short_name: 'Spiro POS',
        description: 'Offline-first Point of Sale for Spiro e-bike & spare parts dealerships',
        theme_color: '#0c1210',
        background_color: '#0c1210',
        display: 'standalone',
        orientation: 'landscape',
        start_url: '/',
        icons: [
          { src: '/pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Shared push handler (public/push-handler.js): OS notifications +
        // in-app forwarding, so the POS hears about credit approvals.
        importScripts: ['/push-handler.js'],
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        navigateFallback: '/index.html',
        runtimeCaching: [
          {
            // API is NEVER cached blindly — business data syncs via Dexie
            urlPattern: ({ url }) => url.pathname.startsWith('/api/'),
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: { port: 5174 },
})
