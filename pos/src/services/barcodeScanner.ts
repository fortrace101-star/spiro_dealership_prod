/**
 * USB barcode scanners act as HID keyboards: they "type" the barcode very fast
 * and finish with Enter. We buffer keystrokes and dispatch when Enter arrives
 * or when the inter-keystroke gap exceeds the timeout.
 */
let buffer = ''
let timeout: ReturnType<typeof setTimeout> | null = null
let active = false
let lastKeyTime = 0

const MIN_LENGTH = 4
const TYPING_TIMEOUT_MS = 100
const MAX_GAP_MS = 120

function isTypingTarget(el: EventTarget | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

export function startBarcodeScanner(onBarcode: (code: string) => void): () => void {
  if (active) return () => {}
  active = true

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      if (buffer.length >= MIN_LENGTH) {
        const code = buffer
        clearBuffer()
        onBarcode(code)
      }
      return
    }

    if (e.key.length === 1) {
      // Only treat as scanner input when focus is NOT in a text field,
      // so we never steal real typing.
      if (isTypingTarget(document.activeElement)) {
        clearBuffer()
        return
      }
      const now = Date.now()
      if (now - lastKeyTime > MAX_GAP_MS && buffer.length > 0) {
        // gap too long → previous buffer was probably human typing; drop it
        clearBuffer()
      }
      lastKeyTime = now
      buffer += e.key
      if (timeout) clearTimeout(timeout)
      timeout = setTimeout(clearBuffer, TYPING_TIMEOUT_MS)
    }
  }

  function clearBuffer() {
    buffer = ''
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  }

  window.addEventListener('keydown', handleKeyDown)
  return () => {
    window.removeEventListener('keydown', handleKeyDown)
    active = false
  }
}
