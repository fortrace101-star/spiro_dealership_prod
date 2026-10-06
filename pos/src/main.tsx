import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

if (import.meta.env.DEV) {
  // Dev registers the hand-written /sw-dev.js (push handler + installability
  // fetch handler) with a plain register — no update listeners. The autoUpdate
  // registerSW below reloads the page on every SW activation, and the dev
  // worker re-activates across HMR cycles → continuous reloads.
  void navigator.serviceWorker.register('/sw-dev.js').catch(() => {})
} else {
  // Production: vite-plugin-pwa's auto-updating worker (kiosks self-update).
  registerSW({
    onNeedRefresh() {
      // autoUpdate mode handles reload; log for visibility
      console.log('[pwa] new POS version available')
    },
    onOfflineReady() {
      console.log('[pwa] POS ready to work offline')
    },
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
