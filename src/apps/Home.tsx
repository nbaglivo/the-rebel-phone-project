import type { AppId } from '../App'
import { formatDate } from '../hooks/useNow'
import { BatteryIndicator } from '../components/BatteryIndicator'
import { useBattery } from '../hooks/useBattery'
import { useListen } from '../hooks/useListen'

const launcher: AppId[] = ['call', 'messages', 'notes', 'listen', 'read']

export function Home({ now, time, onOpen }: { now: Date; time: string; onOpen: (app: AppId) => void }) {
  const battery = useBattery()
  const listen = useListen()
  const playing = listen?.playing ? listen.current : null

  return (
    <div className="home">
      <div className="status">
        <p className="mono muted">{formatDate(now)}</p>
        {battery && <BatteryIndicator battery={battery} />}
      </div>

      <div className="home-time">
        <p className="clock">
          <time dateTime={now.toISOString()}>{time}</time>
        </p>
        {playing && (
          <button className="now-playing" onClick={() => onOpen('listen')}>
            <span className="mono muted">listening to</span>
            <span className="title-line">{playing.title}</span>
          </button>
        )}
      </div>

      <nav aria-label="Apps" className="launcher">
        <ul>
          {launcher.map((id) => (
            <li key={id}>
              <button onClick={() => onOpen(id)}>{id}</button>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}
