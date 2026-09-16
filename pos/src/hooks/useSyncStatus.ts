import { useEffect, useState } from 'react'
import { subscribeSync } from '../services/sync'
import type { SyncStatus } from '../services/sync'

export function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => ({
    online: false,
    lastSyncAt: null,
    lastAttemptAt: null,
    syncing: false,
    pendingCount: 0,
    lastError: null,
    seenByServer: false,
  }))

  useEffect(() => subscribeSync(setStatus), [])

  return status
}
