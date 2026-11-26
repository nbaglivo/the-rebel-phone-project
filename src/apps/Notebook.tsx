import { useEffect, useState } from 'react'
import type { AppProps } from '../App'
import { Back } from '../components/Back'
import { archiveLine, scanTime, useNotebook } from '../hooks/useNotebook'
import { useNow } from '../hooks/useNow'
import { postAction } from '../lib/actions'

// Thin UI over the daemon's camera. The preview <img> holds the camera open,
// so it is mounted only while the viewfinder is on screen.
export function Notebook({ time, onExit }: AppProps) {
  const notebook = useNotebook()
  const now = useNow()
  const [attempt, setAttempt] = useState(0)
  const [view, setView] = useState<'scan' | 'pages'>('scan')
  const [open, setOpen] = useState<string | null>(null)
  // Set on entering and on tapping resume: mounts the preview even while the
  // daemon still reports paused/error, since opening the stream is what restarts it.
  const [resuming, setResuming] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const camera = notebook?.camera

  useEffect(() => {
    if (!resuming) return
    if (camera === 'starting' || camera === 'on') {
      setResuming(false)
      return
    }
    if (camera === 'paused' || camera === 'error') {
      const t = window.setTimeout(() => setResuming(false), 5000)
      return () => window.clearTimeout(t)
    }
  }, [resuming, camera, attempt])

  const run = async (name: string, body: object = {}) => {
    if (busy) return
    setBusy(name)
    try {
      await postAction(`notebook/${name}`, body)
    } finally {
      setBusy(null)
    }
  }

  if (!notebook) {
    return (
      <div className="screen">
        <Back time={time} onClick={onExit} />
        <h1 className="title">Notebook</h1>
      </div>
    )
  }

  const { error, pending, scans, archive } = notebook

  if (pending != null) {
    return (
      <div className="screen">
        <Back time={time} onClick={onExit} />
        <h1 className="title">Notebook</h1>
        <img className="page" src={`/notebook/pending.jpg?t=${pending}`} alt="Scan to review" />
        <div className="actions">
          <button className="pill" disabled={busy !== null} onClick={() => run('keep')}>
            keep
          </button>
          <button className="pill" disabled={busy !== null} onClick={() => run('retake')}>
            retake
          </button>
        </div>
      </div>
    )
  }

  if (view === 'pages' && open && scans.includes(open)) {
    const remove = async () => {
      await run('delete', { name: open })
      setOpen(null)
    }
    return (
      <div className="screen">
        <Back time={time} onClick={() => setOpen(null)} />
        <p className="mono muted">{scanTime(open)}</p>
        <div className="scroll">
          <img className="page" src={`/scans/${open}`} alt={`Scan from ${scanTime(open)}`} />
        </div>
        <button className="pill" disabled={busy !== null} onClick={remove}>
          delete
        </button>
      </div>
    )
  }

  if (view === 'pages') {
    return (
      <div className="screen">
        <Back time={time} onClick={() => setView('scan')} />
        <h1 className="title">Pages</h1>
        {scans.length === 0 ? (
          <p className="muted">No pages yet</p>
        ) : (
          <ul className="rows scroll">
            {scans.map((name) => (
              <li key={name}>
                <button className="page-row" onClick={() => setOpen(name)}>
                  <span className="mono">{scanTime(name)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  // 'off' mounts the preview too: opening the stream is what starts the camera.
  const live = resuming || (camera !== 'paused' && camera !== 'error')
  const resume = () => {
    setAttempt((n) => n + 1)
    setResuming(true)
  }

  return (
    <div className="screen">
      <Back time={time} onClick={onExit} />
      <h1 className="title">Notebook</h1>
      <div className="viewfinder">
        {live ? (
          <>
            <img key={attempt} className="page" src={`/camera/preview?n=${attempt}`} alt="Camera preview" />
            {camera !== 'on' && <p className="mono muted overlay">starting camera…</p>}
          </>
        ) : (
          <button className="resume mono muted" onClick={resume}>
            {camera === 'error' ? (error ?? 'camera error') : 'paused · tap to resume'}
            {camera === 'error' && <span>try again</span>}
          </button>
        )}
      </div>
      <button className="pill" disabled={camera !== 'on' || busy !== null} onClick={() => run('shoot')}>
        scan
      </button>
      <p className="mono muted">{archiveLine(archive, now)}</p>
      <button className="mono" onClick={() => setView('pages')}>
        pages
      </button>
    </div>
  )
}
