import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createPlayer } from './player.mjs'
import { createStore } from './store.mjs'

const MUSIC = fileURLToPath(new URL('../fixtures/music', import.meta.url))
const SINKS = { speaker: 'spk', headphones: 'hp' }
const INTRO = 'album/01 Intro.mp3'
const SECOND = 'album/02 Second.mp3'
const LAST = 'broken.mp3'

function fakeMpv() {
  const mpv = new EventEmitter()
  mpv.calls = []
  mpv.command = async (...args) => {
    mpv.calls.push(args)
  }
  mpv.loads = () => mpv.calls.filter((c) => c[0] === 'loadfile')
  mpv.lastLoad = () => mpv.loads().at(-1)
  return mpv
}

const flush = () => new Promise((r) => setImmediate(r))

async function setup(t, { stored, probe } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: 1_000_000 })
  const file = join(await mkdtemp(join(tmpdir(), 'calm-player-')), 'state.json')
  const store = createStore(file)
  await store.load()
  if (stored) Object.assign(store.data, stored)
  await store.save()
  const mpv = fakeMpv()
  const events = {}
  const sinks = []
  const probes = []
  const player = createPlayer({
    musicDir: MUSIC,
    store,
    mpv,
    probe: probe ?? (async (path) => (probes.push(path), { title: null, duration: 3 })),
    publish: (name, data) => (events[name] = data),
    setSink: async (name) => sinks.push(name),
    sinks: SINKS,
  })
  await player.init()
  return { player, mpv, events, sinks, probes, store, file }
}

test('init restores the stored current file, paused', async (t) => {
  const { events } = await setup(t, { stored: { current: SECOND } })
  assert.equal(events.listen.current.id, SECOND)
  assert.equal(events.listen.playing, false)
})

test('a stored current that no longer exists falls back to the first entry', async (t) => {
  const { events } = await setup(t, { stored: { current: 'gone.mp3' } })
  assert.equal(events.listen.current.id, events.library[0].id)
  assert.equal(events.listen.playing, false)
})

test('playing a file loads it and moves it to the top of the library', async (t) => {
  const { player, mpv, events } = await setup(t)
  await player.play(INTRO)
  assert.equal(mpv.lastLoad()[1], join(MUSIC, INTRO))
  assert.equal(events.library[0].id, INTRO)
})

test('end of file loads the next by name and saves the finished one at 0', async (t) => {
  const { player, mpv, store } = await setup(t)
  await player.play(INTRO)
  mpv.emit('time-pos', 2.9)
  mpv.emit('end-file', { reason: 'eof' })
  await flush()
  assert.equal(mpv.lastLoad()[1], join(MUSIC, SECOND))
  assert.equal(store.data.files[INTRO].position, 0)
})

test('a replaced file (stop) does not advance', async (t) => {
  const { player, mpv } = await setup(t)
  await player.play(INTRO)
  const before = mpv.loads().length
  mpv.emit('end-file', { reason: 'stop' })
  await flush()
  assert.equal(mpv.loads().length, before)
})

test('a file that fails shows a quiet error, skips on, and the error clears after 5 s', async (t) => {
  const { player, mpv, events } = await setup(t)
  t.mock.method(console, 'error', () => {})
  await player.play(SECOND)
  mpv.emit('end-file', { reason: 'error', error: 'unrecognized file format' })
  await flush()
  assert.match(events.listen.error, /can't play/)
  assert.equal(mpv.lastLoad()[1], join(MUSIC, 'album/10 Tenth.mp3'))
  t.mock.timers.tick(5_000)
  assert.equal(events.listen.error, null)
})

test('end of the last file stops, paused', async (t) => {
  const { player, mpv, events } = await setup(t)
  await player.play(LAST)
  const before = mpv.loads().length
  mpv.emit('end-file', { reason: 'eof' })
  await flush()
  assert.equal(mpv.loads().length, before)
  assert.equal(events.listen.playing, false)
})

test('back seeks 30 s earlier, never before 0', async (t) => {
  const { player, mpv } = await setup(t, { probe: async () => ({ title: null, duration: 600 }) })
  await player.play(INTRO)
  mpv.emit('time-pos', 12)
  await player.back()
  assert.deepEqual(mpv.calls.at(-1), ['seek', 0, 'absolute'])
  mpv.emit('time-pos', 100)
  await player.back()
  assert.deepEqual(mpv.calls.at(-1), ['seek', 70, 'absolute'])
})

test('seek clamps to the file length', async (t) => {
  const { player, mpv } = await setup(t, { probe: async () => ({ title: null, duration: 600 }) })
  await player.play(INTRO)
  await player.seek(-3)
  assert.deepEqual(mpv.calls.at(-1), ['seek', 0, 'absolute'])
  await player.seek(9_999)
  assert.deepEqual(mpv.calls.at(-1), ['seek', 600, 'absolute'])
})

test('unplugging headphones pauses and switches to the speaker', async (t) => {
  const { player, mpv, sinks } = await setup(t)
  await player.play(INTRO)
  mpv.emit('pause', false)
  await player.onHeadphones(false)
  assert.deepEqual(mpv.calls.at(-1), ['set_property', 'pause', true])
  assert.equal(sinks.at(-1), 'spk')
})

test('after mpv restarts, the current file reloads paused at its saved spot', async (t) => {
  const { player, mpv, events } = await setup(t, { probe: async () => ({ title: null, duration: 3600 }) })
  await player.play(INTRO)
  mpv.emit('pause', false)
  mpv.emit('time-pos', 1234)
  mpv.emit('exit')
  assert.equal(events.listen.playing, false)
  mpv.emit('restart')
  await flush()
  const pauseCall = mpv.calls.findLast((c) => c[0] === 'set_property' && c[1] === 'pause')
  assert.deepEqual(pauseCall, ['set_property', 'pause', true])
  assert.deepEqual(mpv.lastLoad(), ['loadfile', join(MUSIC, INTRO), 'replace', -1, 'start=1234'])
})

test('position is saved every 5 s while playing', async (t) => {
  const { player, mpv, file, store } = await setup(t)
  await player.play(INTRO)
  mpv.emit('pause', false)
  mpv.emit('time-pos', 2)
  const saves = t.mock.method(store, 'save')
  t.mock.timers.tick(5_000)
  assert.equal(saves.mock.callCount(), 1)
  await saves.mock.calls[0].result
  const saved = JSON.parse(await readFile(file, 'utf8'))
  assert.equal(saved.files[INTRO].position, 2)
})

test('a rescan with unchanged files does not probe again', async (t) => {
  const { player, probes } = await setup(t)
  const first = probes.length
  assert.ok(first > 0)
  await player.rescan()
  assert.equal(probes.length, first)
})
