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

/** Short two-tone chime (~0.4s) for credit-decision arrivals. Web Audio needs
 *  no audio file and respects OS/browser mute state — it cannot force sound
 *  through a muted device. Play only after the user gesture arming in
 *  POSScreen (browsers block AudioContext before the first interaction). */
export function playPushChime(): void {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const play = (freq: number, at: number, dur = 0.18) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.25, at + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur)
      osc.connect(gain).connect(ctx.destination)
      osc.start(at)
      osc.stop(at + dur + 0.05)
    }
    const t = ctx.currentTime + 0.02
    play(880, t) // A5
    play(1174.66, t + 0.2) // D6
    setTimeout(() => void ctx.close().catch(() => {}), 800)
  } catch {
    /* audio unsupported or blocked — the toast still shows */
  }
}

export type PushState = 'unsupported' | 'denied' | 'prompt' | 'subscribed' | 'unsubscribed'

/**
 * POS Web Push subscription — port of the admin dashboard's usePush hook.
 * The controlling service worker differs by environment:
 *   dev  → /sw-dev.js   (static, importScripts /push-handler.js)
 *   prod → /sw.js       (vite-plugin-pwa Workbox build, same handler injected)
 * The server targets this subscription via notifyUser(cashier_id) when an
 * admin decides a credit request — that's how the operator learns to Finalize.
 */
export function usePush() {
  const [state, setState] = useState<PushState>('unsubscribed')
  const [busy, setBusy] = useState(false)
  // Shown under the account popup + flashed as a toast so a blocked or failed
  // subscription is never a silent no-op.
  const [error, setError] = useState('')

  const detect = useCallback(async (): Promise<PushState> => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      // Distinguish "browser doesn't support Push API" from "not on a secure origin"
      const isSecure = location.protocol === 'https:' ||
        location.hostname === 'localhost' ||
        location.hostname === '127.0.0.1' ||
        location.hostname === '::1'
      if (!isSecure) {
        setError('Push notifications require HTTPS. This POS is served over HTTP — use https:// or access via localhost.')
      } else {
        setError('This browser does not support push notifications. Try Chrome, Edge, or Firefox.')
      }
      setState('unsupported')
      return 'unsupported'
    }
    if (Notification.permission === 'denied') {
      setState('denied')
      return 'denied'
    }
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = reg ? await reg.pushManager.getSubscription() : null
    const s: PushState = sub ? 'subscribed' : Notification.permission === 'granted' ? 'unsubscribed' : 'prompt'
    setState(s)
    return s
  }, [])

  const enable = useCallback(async (): Promise<boolean> => {
    setBusy(true)
    setError('')
    try {
      // Browsers block the permission prompt silently once denied — surface
      // that instead of failing quietly inside pushManager.subscribe.
      if ('Notification' in window && Notification.permission === 'denied') {
        setError(
          'Notifications are blocked for this site. Click the lock icon in the address bar, set Notifications to Allow, then click Enable alerts again.',
        )
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
      const swUrl = import.meta.env.DEV ? '/sw-dev.js' : '/sw.js'
      const reg = await navigator.serviceWorker.register(swUrl).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        throw new Error(`Service worker registration failed (${swUrl}): ${msg}`)
      })
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

  // After login: detect state, and if permission was already granted but the
  // server has no live subscription (first run, or a pruned/expired row),
  // re-subscribe silently — no permission prompt on repeat visits.
  useEffect(() => {
    if (!getToken()) return
    let cancelled = false
    detect()
      .then((s) => {
        if (!cancelled && s === 'unsubscribed' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          void enable()
        }
      })
      .catch(() => {
        if (!cancelled) setState('unsupported')
      })
    return () => {
      cancelled = true
    }
     }, [detect, enable])

  return { state, busy, error, enable, refresh: detect }
}