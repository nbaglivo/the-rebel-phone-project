// Whether syncd (a separate service) is pulling right now: it writes a small
// JSON status file; a stale one (crashed or stalled syncd) doesn't count.

import { readFile, stat } from 'node:fs/promises'

export function syncActive({ text, mtimeMs, now, maxAgeMs }) {
  if (text === null || mtimeMs === null) return false
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return false
  }
  return data !== null && typeof data === 'object' && data.syncing === true && now - mtimeMs <= maxAgeMs
}

export function createSyncStatus(file, { maxAgeMs = 120_000, now = Date.now } = {}) {
  return {
    async isSyncing() {
      try {
        const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
        return syncActive({ text, mtimeMs: st.mtimeMs, now: now(), maxAgeMs })
      } catch {
        return false
      }
    },
  }
}
