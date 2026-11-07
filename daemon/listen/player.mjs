// Listen's player: which file is current, where every file stopped, and what
// plays next. Drives mpv; publishes the `listen` and `library` events.

import { join } from 'node:path'
import { displayOrder, displayTitle, folderOf, nextId, scanMusic, startPosition } from './library.mjs'

const SAVE_EVERY_MS = 5_000
const ERROR_SHOWN_MS = 5_000
const BACK_S = 30

export function createPlayer({ musicDir, store, mpv, probe, publish, setSink, sinks, now = () => Date.now() }) {
  /** id → { id, title, folder, duration }, in path order. */
  let entries = new Map()
  let current = null
  let loaded = null // what mpv holds right now
  let playing = false
  let position = 0
  let positionAt = now()
  let error = null
  let errorTimer
  let lastPublished = 0

  const files = () => store.data.files
  const saved = (id) => files()[id] ?? { position: 0, lastPlayed: null }
  const remember = (id, patch) => (files()[id] = { ...saved(id), ...patch })

  // ---------- publishing ----------

  function publishListen() {
    const e = current && entries.get(current)
    lastPublished = now()
    publish('listen', {
      current: e ? { id: e.id, title: e.title, folder: e.folder, duration: e.duration } : null,
      playing,
      position,
      positionAt,
      error,
    })
  }

  function publishLibrary() {
    const list = [...entries.values()].map((e) => ({ ...e, ...saved(e.id) }))
    publish('library', displayOrder(list))
  }

  const save = () => store.save().catch((err) => console.error(`listen: save failed: ${err.message}`))

  // ---------- library ----------

  async function rescan() {
    const found = await scanMusic(musicDir)
    const next = new Map()
    for (const f of found) {
      let p = store.data.probes[f.id]
      if (!p || p.size !== f.size || p.mtimeMs !== f.mtimeMs) {
        p = { size: f.size, mtimeMs: f.mtimeMs, ...(await probe(join(musicDir, f.id))) }
        store.data.probes[f.id] = p
      }
      next.set(f.id, { id: f.id, title: displayTitle(f.id, p.title), folder: folderOf(f.id), duration: p.duration })
    }
    for (const id of Object.keys(store.data.probes)) if (!next.has(id)) delete store.data.probes[id]
    for (const id of Object.keys(files())) if (!next.has(id)) delete files()[id]
    entries = next
    if (!current || !entries.has(current)) {
      if (current && loaded === current) await stopPlayback()
      choose(defaultCurrent())
    }
    publishLibrary()
    publishListen()
    await save()
  }

  function defaultCurrent() {
    const list = [...entries.values()].map((e) => ({ ...e, ...saved(e.id) }))
    return displayOrder(list)[0]?.id ?? null
  }

  function choose(id) {
    current = id
    store.data.current = id
    position = id ? saved(id).position : 0
    positionAt = now()
  }

  // ---------- playback ----------

  async function load(id, how, autoplay) {
    const e = entries.get(id)
    const start = startPosition({ duration: e?.duration ?? null, position: saved(id).position }, how)
    choose(id)
    position = start
    if (autoplay) remember(id, { lastPlayed: now() })
    loaded = id
    playing = autoplay
    await mpv.command('set_property', 'pause', !autoplay)
    await mpv.command('loadfile', join(musicDir, id), 'replace', -1, `start=${start}`)
    publishLibrary()
    publishListen()
    await save()
  }

  async function stopPlayback() {
    playing = false
    loaded = null
    await mpv.command('stop').catch(() => {})
  }

  async function play(id) {
    if (id && id !== current) return load(id, 'resume', true)
    if (!current) return
    if (loaded !== current) return load(current, 'resume', true)
    remember(current, { lastPlayed: now() })
    playing = true
    await mpv.command('set_property', 'pause', false)
    publishLibrary()
    publishListen()
  }

  async function pause() {
    playing = false
    if (loaded) await mpv.command('set_property', 'pause', true)
    if (current) remember(current, { position })
    publishListen()
    await save()
  }

  async function seek(to) {
    if (!current) return
    const duration = entries.get(current)?.duration
    const target = Math.max(0, duration != null ? Math.min(to, duration) : to)
    position = target
    positionAt = now()
    remember(current, { position: target })
    if (loaded === current) await mpv.command('seek', target, 'absolute')
    publishListen()
    await save()
  }

  const back = () => seek(position - BACK_S)
  const restart = () => seek(0)

  /** Advance to the next file by name; at the end of the list, stop paused. */
  async function next() {
    const id = current && nextId([...entries.keys()], current)
    if (id) return load(id, 'advance', true)
    await stopPlayback()
    publishListen()
    await save()
  }

  function showError(message) {
    error = message
    clearTimeout(errorTimer)
    errorTimer = setTimeout(() => {
      error = null
      publishListen()
    }, ERROR_SHOWN_MS)
  }

  async function onHeadphones(inserted) {
    await setSink(inserted ? sinks.headphones : sinks.speaker)
    if (!inserted && playing) await pause()
  }

  async function flush() {
    if (current) remember(current, { position })
    await save()
  }

  // ---------- mpv events ----------

  mpv.on('time-pos', (t) => {
    if (loaded !== current) return
    position = t
    positionAt = now()
    remember(current, { position: t })
    if (playing && now() - lastPublished >= SAVE_EVERY_MS) publishListen()
  })

  mpv.on('pause', (paused) => {
    if (!loaded || playing === !paused) return
    playing = !paused
    publishListen()
    if (paused) save()
  })

  mpv.on('duration', (d) => {
    const e = current && entries.get(current)
    if (e && e.duration == null) {
      e.duration = d
      publishListen()
    }
  })

  mpv.on('end-file', ({ reason, error: why }) => {
    if (!loaded) return
    const id = loaded
    if (reason === 'eof') {
      remember(id, { position: 0 })
      position = 0
      loaded = null
      next()
    } else if (reason === 'error') {
      const title = entries.get(id)?.title ?? id
      console.error(`listen: can't play ${id}: ${why ?? 'unknown error'}`)
      loaded = null
      showError(`can't play ${title}`)
      next()
    }
  })

  mpv.on('exit', () => {
    playing = false
    loaded = null
    publishListen()
    save()
  })

  mpv.on('restart', () => {
    if (current) load(current, 'resume', false).catch((err) => console.error(err.message))
  })

  setInterval(() => {
    if (playing) save()
  }, SAVE_EVERY_MS).unref?.()

  // ---------- public ----------

  async function init() {
    await store.load()
    current = store.data.current
    await rescan()
    choose(current && entries.has(current) ? current : defaultCurrent())
    publishListen()
  }

  return {
    init,
    rescan,
    play,
    pause,
    seek,
    back,
    restart,
    next,
    onHeadphones,
    flush,
    isPlaying: () => playing,
    has: (id) => entries.has(id),
  }
}
