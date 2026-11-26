// The archive line on the phone: syncd, publishing ~/scans, writes a small JSON
// status file ({ connected, uploading, lastUpload, at }) at least every minute.
// A stale file means syncd died or the phone slept: not connected.

import { readFile, stat } from 'node:fs/promises'

export function archiveStatus({ text, mtimeMs, now, maxAgeMs = 180_000 }) {
  if (text === null || text === undefined || mtimeMs === null) return null
  let data
  try {
    data = JSON.parse(text)
  } catch {}
  if (data === null || typeof data !== 'object') return { connected: false, uploading: false, lastReceived: null }
  const fresh = now - mtimeMs <= maxAgeMs
  const last = typeof data.lastUpload === 'string' ? Date.parse(data.lastUpload) : Number.NaN
  return {
    connected: fresh && data.connected === true,
    uploading: fresh && data.uploading === true,
    lastReceived: Number.isFinite(last) ? last : null,
  }
}

export function createArchiveStatus(file, { maxAgeMs = 180_000, now = Date.now } = {}) {
  return {
    async read() {
      try {
        const [text, st] = await Promise.all([readFile(file, 'utf8'), stat(file)])
        return archiveStatus({ text, mtimeMs: st.mtimeMs, now: now(), maxAgeMs })
      } catch {
        return null
      }
    },
  }
}
