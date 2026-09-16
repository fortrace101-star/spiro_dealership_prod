import { useEffect, useRef } from 'react'
import { startBarcodeScanner } from '../services/barcodeScanner'

export function useBarcodeScanner(onBarcode: (code: string) => void, enabled = true) {
  const cbRef = useRef(onBarcode)
  cbRef.current = onBarcode

  useEffect(() => {
    if (!enabled) return
    return startBarcodeScanner((code) => cbRef.current(code))
  }, [enabled])
}
