import { useEffect, useState } from 'react'

// One EventSource for the whole shell. The daemon sends every event's current
// value on connect and then only changes, so the last value is cached here for
// components that mount later. EventSource only delivers named events that have
// a listener, so a name first asked for after connecting reconnects: the
// daemon then replays every current value, including the new one.

type Listener = (data: unknown) => void

let source: EventSource | null = null
const last = new Map<string, unknown>()
const listeners = new Map<string, Set<Listener>>()

function connect() {
  source?.close()
  source = new EventSource('/events')
  for (const [event, subscribers] of listeners) {
    source.addEventListener(event, (e) => {
      const data = JSON.parse((e as MessageEvent<string>).data)
      last.set(event, data)
      for (const l of subscribers) l(data)
    })
  }
}

let reconnect: number | undefined

function subscribe(event: string, listener: Listener): () => void {
  let set = listeners.get(event)
  if (!set) {
    set = new Set()
    listeners.set(event, set)
    // Batch the names that mount together into one connection.
    window.clearTimeout(reconnect)
    reconnect = window.setTimeout(connect, 0)
  }

  set.add(listener)
  if (last.has(event)) listener(last.get(event))
  return () => set.delete(listener)
}

/** Latest payload of a daemon event (see docs/architecture.md), or null before the first one. */
export function useDaemonEvent<T>(event: string): T | null {
  const [data, setData] = useState<T | null>(() => (last.get(event) as T | undefined) ?? null)

  useEffect(() => subscribe(event, (d) => setData(d as T)), [event])

  return data
}
