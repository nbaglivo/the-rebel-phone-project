import { useCallback, useEffect, useState } from 'react'
import { useNow, formatTime } from './hooks/useNow'
import { useScreen } from './hooks/useScreen'
import { Home } from './apps/Home'
import { Call } from './apps/Call'
import { Messages } from './apps/Messages'
import { Notes } from './apps/Notes'
import { Listen } from './apps/Listen'
import { Read } from './apps/Read'

export type AppId = 'call' | 'messages' | 'notes' | 'listen' | 'read'
type Screen = 'home' | AppId

export interface AppProps {
  time: string
  onExit: () => void
}

const apps: Record<AppId, (props: AppProps) => React.ReactNode> = {
  call: Call,
  messages: Messages,
  notes: Notes,
  listen: Listen,
  read: Read,
}

export function App() {
  const now = useNow()
  const time = formatTime(now)
  const [screen, setScreen] = useState<Screen>('home')
  const goHome = useCallback(() => setScreen('home'), [])
  const display = useScreen()

  // Escape (or a hardware back key mapped to it) always returns home.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') goHome()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goHome])

  const Active = screen === 'home' ? null : apps[screen]

  return (
    <main className="shell">
      {Active ? (
        <Active key={screen} time={time} onExit={goHome} />
      ) : (
        <Home now={now} time={time} onOpen={setScreen} />
      )}
      {display?.on === false && <div className="screen-off" aria-hidden />}
    </main>
  )
}
