import { useEffect, useState } from 'react'
import { getToken, getStoredUser } from './lib/api'
import { startSyncEngine } from './services/sync'
import RegisterScreen from './components/RegisterScreen'
import POSScreen from './components/POSScreen'

export default function App() {
  const [authed, setAuthed] = useState<boolean>(() => Boolean(getToken() && getStoredUser()))

  useEffect(() => {
    if (authed) startSyncEngine(30_000)
  }, [authed])

  if (!authed) return <RegisterScreen onAuthenticated={() => setAuthed(true)} />
  return <POSScreen />
}
