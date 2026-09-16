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
    try {
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

  return { state, busy, enable, sendTest, refresh: detect }
}
