import { useEffect, useState } from 'react'
import { api, getToken, getStoredUser, SESSION_EXPIRED_EVENT } from './lib/api'
import { startSyncEngine } from './services/sync'
import { isMobileOrTablet } from './lib/isMobile'
import RegisterScreen from './components/RegisterScreen'
import POSScreen from './components/POSScreen'
import MobileBlocker from './components/MobileBlocker'

/** Why the operator was signed out — survives the reload into RegisterScreen. */
const NOTICE_KEY = 'spiro_pos_notice'

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getToken() && getStoredUser()))
  const [mobile, setMobile] = useState<boolean>(() => isMobileOrTablet())
  const [notice, setNotice] = useState<string | null>(() => sessionStorage.getItem(NOTICE_KEY))

  // Re-check when the viewport changes (e.g. device rotation, resizing).
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const queries = [
      window.matchMedia('(pointer: coarse)'),
      window.matchMedia('(max-width: 768px)'),
      window.matchMedia('(max-width: 1024px)'),
    ]
    const onChange = () => setMobile(isMobileOrTablet())
    queries.forEach((q) => q.addEventListener('change', onChange))
    return () => queries.forEach((q) => q.removeEventListener('change', onChange))
  }, [])

  useEffect(() => {
    if (authed && !mobile) startSyncEngine(30_000)
  }, [authed, mobile])

  // Session revocation (admin deactivated the account / token expired) arrives
  // as a 401 on any request — api.ts clears storage and emits this event.
  // Persist the reason, then reload: the same teardown as manual sign-out
  // (clearSession + location.reload), so the sync engine timer, pollers and
  // screen state all reset and RegisterScreen can explain the logout.
  useEffect(() => {
    let reloading = false
    const onExpired = (e: Event) => {
      const message = (e as CustomEvent<{ message?: string }>).detail?.message
      if (message) sessionStorage.setItem(NOTICE_KEY, message)
      if (reloading) return
      reloading = true
      window.location.reload()
    }
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired)
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired)
  }, [])

  // Liveness heartbeat: without it an idle terminal would keep showing the
  // sales screen after deactivation until its next natural request. Network
  // errors are swallowed — an offline terminal must keep working; only a real
  // 401 logs out (handled by the event above).
  useEffect(() => {
    if (!authed || mobile) return
    const id = setInterval(() => { void api.me().catch(() => {}) }, 10_000)
    return () => clearInterval(id)
  }, [authed, mobile])

  if (mobile) return <MobileBlocker />
  if (!authed) return (
    <RegisterScreen
      notice={notice}
      onAuthenticated={() => {
        sessionStorage.removeItem(NOTICE_KEY)
        setNotice(null)
        setAuthed(true)
      }}
    />
  )
  return <POSScreen />
}
