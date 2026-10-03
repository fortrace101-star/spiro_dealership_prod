import { useEffect, useRef } from 'react'
import { eventsUrl, getToken } from '../lib/api'

/** Named SSE frames the server publishes (server/src/routes/events.js). */
const EVENT_TYPES = [
  'ready',
  'sale.created',
  'approval.created',
  'approval.decided',
  'stock.changed',
  'reorder.status',
  'notification.created',
  'product.updated',
] as const

export type LiveEventType = (typeof EVENT_TYPES)[number]

export type LiveHandler = (type: string, payload: Record<string, unknown>) => void

/**
 * Live state updates over a single Server-Sent Events stream (Workstream D).
 *
 * Replaces polling latency for badges/cards: the callback fires the instant the
 * POS records a sale or an admin decides an approval. EventSource reconnects on
 * its own (the server sends `retry: 3000`); a manual backoff covers the case
 * where the stream was closed outright (e.g. the process restarted).
 *
 * The 30s polling in the consumers stays as the fallback for blocked streams.
 */
export function useEvents(onEvent: LiveHandler, enabled = true): void {
  // Keep the latest callback without re-opening the stream on every render.
  const handler = useRef(onEvent)
  handler.current = onEvent

  useEffect(() => {
    if (!enabled) return
    const token = getToken()
    if (!token || typeof EventSource === 'undefined') return

    let src: EventSource | null = null
    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | null = null
    let attempt = 0

    const connect = () => {
      if (stopped) return
      src = new EventSource(eventsUrl())
      src.onopen = () => { attempt = 0 }
      for (const type of EVENT_TYPES) {
        src.addEventListener(type, (e) => {
          let payload: Record<string, unknown> = {}
          try {
            payload = e.data ? JSON.parse(e.data as string) : {}
          } catch {
            /* non-JSON frame — ignore */
          }
          handler.current(type, payload)
        })
      }
      src.onerror = () => {
        // Native auto-reconnect handles transient drops; if the browser gave up
        // (CLOSED), back off and retry ourselves rather than going silent.
        if (stopped || !src || src.readyState !== EventSource.CLOSED) return
        src.close()
        attempt += 1
        const delay = Math.min(2000 * attempt, 15000)
        retryTimer = setTimeout(connect, delay)
      }
    }

    connect()
    return () => {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      src?.close()
    }
  }, [enabled])
}
