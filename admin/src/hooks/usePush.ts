import { useCallback, useEffect, useState } from 'react'
import { api, getToken } from '../lib/api'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const output = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i)
  return output
}

export type PushState = 'unsupported' | 'denied' | 'prompt' | 'subscribed' | 'unsubscribed'

export function usePush() {
  const [state, setState] = useState<PushState>('unsubscribed')
  const [busy, setBusy] = useState(false)
  // Human-readable failure reason shown under the Enable alerts button so a
  // blocked/failed subscription is never a silent no-op.
  const [error, setError] = useState('')

  const detect = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      setState('unsupported')
      return
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return
    }
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    setState(sub ? 'subscribed' : Notification.permission === 'granted' ? 'unsubscribed' : 'prompt')
  }, [])

  useEffect(() => {
    // Only enable after login (token present)
    if (!getToken()) return
    detect().catch(() => setState('unsupported'))
  }, [detect])

  const enable = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      // Browsers block the permission prompt silently once the user (or a
      // previous dismiss) has denied it — surface that instead of failing
      // quietly inside pushManager.subscribe.
      if ('Notification' in window && Notification.permission === 'denied') {
        setError('Notifications are blocked for this site. Click the lock icon in the address bar, set Notifications to Allow, then click Enable alerts again.')
        return false
      }
      if ('Notification' in window && Notification.permission === 'default') {
        const perm = await Notification.requestPermission()
        if (perm !== 'granted') {
          setError('Notification permission was not granted — no alerts can be delivered.')
          return false
        }
      }
      const { publicKey } = await api.vapidPublicKey()
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready

      const existing = await reg.pushManager.getSubscription()
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        }))

      const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
      await api.subscribe(json)
      setState('subscribed')
      return true
    } catch (err) {
      console.error('[push] subscribe failed', err)
      const msg = err instanceof Error ? err.message : String(err)
      setError(
        msg.includes('NotAllowed')
          ? 'Notifications are blocked for this site. Allow them via the lock icon in the address bar, then try again.'
          : `Could not enable alerts: ${msg}`,
      )
      return false
    } finally {
      setBusy(false)
    }
  }, [])

  const sendTest = useCallback(async () => {
    try {
      await api.testPush()
      return true
    } catch {
      return false
    }
  }, [])

  return { state, busy, error, enable, sendTest, refresh: detect }
}
