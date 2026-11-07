import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createStore } from './store.mjs'

const tmp = () => mkdtemp(join(tmpdir(), 'calm-store-'))

test('a missing file loads as empty data', async () => {
  const store = createStore(join(await tmp(), 'state.json'))
  await store.load()
  assert.deepEqual(store.data, { version: 1, current: null, files: {}, probes: {} })
})

test('saved data round-trips through a fresh store', async () => {
  const file = join(await tmp(), 'state.json')
  const a = createStore(file)
  await a.load()
  a.data.current = 'album/01 Intro.mp3'
  a.data.files['album/01 Intro.mp3'] = { position: 12.5, lastPlayed: 1000 }
  await a.save()

  const b = createStore(file)
  await b.load()
  assert.equal(b.data.current, 'album/01 Intro.mp3')
  assert.deepEqual(b.data.files['album/01 Intro.mp3'], { position: 12.5, lastPlayed: 1000 })
})

test('a corrupt file loads as empty data and logs once', async (t) => {
  const dir = await tmp()
  const file = join(dir, 'state.json')
  await writeFile(file, '{oops')
  const logged = t.mock.method(console, 'error', () => {})
  const store = createStore(file)
  await store.load()
  assert.equal(store.data.current, null)
  assert.deepEqual(store.data.files, {})
  assert.equal(logged.mock.callCount(), 1)
})

test('save leaves no temp file behind', async () => {
  const dir = await tmp()
  const store = createStore(join(dir, 'state.json'))
  await store.load()
  await Promise.all([store.save(), store.save(), store.save()])
  assert.deepEqual(await readdir(dir), ['state.json'])
})

test('save creates missing parent directories', async () => {
  const dir = await tmp()
  const file = join(dir, 'a', 'b', 'state.json')
  const store = createStore(file)
  await store.load()
  await store.save()
  assert.deepEqual(await readdir(join(dir, 'a', 'b')), ['state.json'])
})
