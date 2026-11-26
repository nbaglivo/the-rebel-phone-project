import { useDaemonEvent } from './useDaemonEvent'
import { formatTime } from './useNow'

export interface Archive {
  connected: boolean
  uploading: boolean
  /** Epoch ms, or null when nothing has arrived yet. */
  lastReceived: number | null
}

export interface Notebook {
  camera: 'off' | 'starting' | 'on' | 'paused' | 'error'
  error: string | null
  /** Capture time (ms) of the shot awaiting review, or null. */
  pending: number | null
  /** File names in the scans directory, newest first. */
  scans: string[]
  archive: Archive | null
}

/** The daemon's `notebook` event, or null until the daemon has sent it. */
export const useNotebook = () => useDaemonEvent<Notebook>('notebook')

const day = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })

/** One calm line about the archive the scans are sent to. */
export function archiveLine(archive: Archive | null, now: Date): string {
  if (!archive) return 'archive · not set up'
  let line = `archive · ${archive.connected ? 'connected' : 'not connected'}`
  if (archive.lastReceived != null) {
    const at = new Date(archive.lastReceived)
    const today = at.toDateString() === now.toDateString()
    line += ` · last received ${today ? formatTime(at) : day(at)}`
  }
  return line
}

/** `2026-11-26_09-14-03.jpg` (or `…-2.jpg`) → `26 Nov · 09:14`. */
export function scanTime(name: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})/.exec(name)
  if (!m) return name
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const at = new Date(y, mo - 1, d, h, mi)
  return `${day(at)} · ${formatTime(at)}`
}
