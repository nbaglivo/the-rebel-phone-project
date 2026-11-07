import { useEffect } from 'react'
import type { AppProps } from '../App'
import { Back } from '../components/Back'
import { Next, Pause, Play, Prev } from '../components/Icons'
import { formatClock, useLibrary, useListen, useLivePosition } from '../hooks/useListen'
import { postAction } from '../lib/actions'

// Thin UI over the daemon's player: everything here is an event or an action.
export function Listen({ time, onExit }: AppProps) {
  const listen = useListen()
  const library = useLibrary()
  const position = useLivePosition(listen)

  useEffect(() => {
    postAction('listen/rescan')
  }, [])

  const current = listen?.current ?? null
  const duration = current?.duration ?? null
  const playing = listen?.playing ?? false

  const seekTo = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
    postAction('listen/seek', { to: fraction * duration })
  }

  return (
    <div className="screen">
      <Back time={time} onClick={onExit} />
      <h1 className="title">Listen</h1>

      {library && library.length === 0 ? (
        <p className="muted">Copy audio files to ~/Music</p>
      ) : (
        <>
          <div className="now">
            <p className="mono muted">{listen?.error ?? (playing ? 'now playing' : 'paused')}</p>
            <p className="track">{current?.title ?? ''}</p>
            {current?.folder && (
              <p className="muted" style={{ fontSize: 15 }}>
                {current.folder}
              </p>
            )}
          </div>

          <div>
            <div className="seek" onPointerUp={seekTo}>
              <div
                className="progress"
                role="progressbar"
                aria-label="Position"
                aria-valuemin={0}
                aria-valuemax={duration ?? 0}
                aria-valuenow={position}
              >
                <span style={{ width: duration ? `${(position / duration) * 100}%` : 0 }} />
              </div>
            </div>
            <div className="times mono muted" style={{ fontSize: 12 }}>
              <span>{formatClock(position)}</span>
              <span>{duration != null ? formatClock(duration) : ''}</span>
            </div>
          </div>

          <div className="transport">
            <button className="icon-btn" onClick={() => postAction('listen/restart')} aria-label="Back to the start">
              <Prev />
            </button>
            <button className="icon-btn mono" onClick={() => postAction('listen/back')} aria-label="Back 30 seconds">
              −30
            </button>
            <button
              className="round"
              onClick={() => postAction(playing ? 'listen/pause' : 'listen/play')}
              aria-label={playing ? 'Pause' : 'Play'}
            >
              {playing ? <Pause /> : <Play />}
            </button>
            <button className="icon-btn" onClick={() => postAction('listen/next')} aria-label="Next file">
              <Next />
            </button>
          </div>

          <ol className="rows queue scroll">
            {library?.map((f) => (
              <li key={f.id}>
                <button aria-current={f.id === current?.id} onClick={() => postAction('listen/play', { id: f.id })}>
                  <span className="t">{f.title}</span>
                  <span className="mono" style={{ fontSize: 12 }}>
                    {f.position > 0 ? formatClock(f.position) : ''}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
