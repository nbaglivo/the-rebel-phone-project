import type { AppId } from '../App'
import { formatDate } from '../hooks/useNow'
import { Squiggle } from '../components/Icons'
import { BatteryIndicator } from '../components/BatteryIndicator'
import { useBattery } from '../hooks/useBattery'

const launcher: AppId[] = ['call', 'messages', 'notes', 'listen', 'read']

export function Home({ now, time, onOpen }: { now: Date; time: string; onOpen: (app: AppId) => void }) {
  const battery = useBattery()
  return (
    <div className="home">
      <div>
        <div className="status">
          <p className="mono muted">{formatDate(now)}</p>
          {battery && <BatteryIndicator battery={battery} />}
        </div>
        <p className="clock">
          <time dateTime={now.toISOString()}>{time}</time>
        </p>
      </div>
      <Squiggle className="squiggle" />
      <nav aria-label="Apps" className="launcher">
        <ul className="rows rows--closed">
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
