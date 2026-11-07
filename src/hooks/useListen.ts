import { useEffect, useState } from 'react'
import { useDaemonEvent } from './useDaemonEvent'

export interface ListenFile {
  id: string
  title: string
  folder: string
  /** Seconds, or null when unknown. */
  duration: number | null
}

export interface Listen {
  current: ListenFile | null
  playing: boolean
  /** Seconds into `current` at `positionAt`. */
  position: number
  /** Epoch ms when `position` was measured. */
  positionAt: number
  error: string | null
}

export interface LibraryEntry extends ListenFile {
  /** Saved position in seconds (0 = start or finished). */
  position: number
  lastPlayed: number | null
}

/** The daemon's `listen` event, or null until the daemon has sent it. */
export const useListen = () => useDaemonEvent<Listen>('listen')

/** The daemon's `library` event (recently played first), or null until sent. */
export const useLibrary = () => useDaemonEvent<LibraryEntry[]>('library')

/** Current position, advancing once a second while playing; clamped to the duration. */
export function useLivePosition(listen: Listen | null): number {
  const [now, setNow] = useState(() => Date.now())
  const playing = listen?.playing ?? false

  useEffect(() => {
    if (!playing) return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [playing])

  if (!listen) return 0
  const pos = listen.playing ? listen.position + Math.max(0, now - listen.positionAt) / 1000 : listen.position
  const duration = listen.current?.duration
  return duration != null ? Math.min(pos, duration) : pos
}

/** m:ss under an hour, h:mm:ss from an hour. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}
