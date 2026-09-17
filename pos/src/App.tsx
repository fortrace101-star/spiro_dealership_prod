import { useEffect, useState } from 'react'
import { getToken, getStoredUser } from './lib/api'
import { startSyncEngine } from './services/sync'
import { isMobileOrTablet } from './lib/isMobile'
import RegisterScreen from './components/RegisterScreen'
import POSScreen from './components/POSScreen'
import MobileBlocker from './components/MobileBlocker'

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getToken() && getStoredUser()))
  const [mobile, setMobile] = useState<boolean>(() => isMobileOrTablet())

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

  if (mobile) return <MobileBlocker />
  if (!authed) return <RegisterScreen onAuthenticated={() => setAuthed(true)} />
  return <POSScreen />
}
