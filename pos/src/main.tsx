import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

registerSW({
  onNeedRefresh() {
    // autoUpdate mode handles reload; log for visibility
    console.log('[pwa] new POS version available')
  },
  onOfflineReady() {
    console.log('[pwa] POS ready to work offline')
  },
})

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
