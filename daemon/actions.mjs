// The `POST /actions/<name>` table. Each action validates its body and returns
// an error string (→ 400) or nothing (→ 204).

/** Body checks for the listen actions; null when the body is acceptable. */
export function validateListenAction(name, body, has) {
  switch (name) {
    case 'listen/play':
      if (body.id === undefined) return null
      if (typeof body.id !== 'string') return '`id` must be a string'
      return has(body.id) ? null : 'unknown `id`'
    case 'listen/seek':
      return typeof body.to === 'number' && Number.isFinite(body.to) ? null : '`to` must be a number of seconds'
    default:
      return null
  }
}

export function createActions({ setScreen, player }) {
  const listen = (name, run) => async (body) => {
    const error = validateListenAction(name, body, player.has)
    if (error) return error
    await run(body)
  }
  return {
    screen: ({ on }) => {
      if (typeof on !== 'boolean') return '`on` must be a boolean'
      setScreen(on)
    },
    'listen/play': listen('listen/play', ({ id }) => player.play(id)),
    'listen/pause': listen('listen/pause', () => player.pause()),
    'listen/seek': listen('listen/seek', ({ to }) => player.seek(to)),
    'listen/back': listen('listen/back', () => player.back()),
    'listen/restart': listen('listen/restart', () => player.restart()),
    'listen/next': listen('listen/next', () => player.next()),
    'listen/rescan': listen('listen/rescan', () => player.rescan()),
  }
}
