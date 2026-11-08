import assert from 'node:assert/strict'
import { mkdtemp, rename, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import { watchLibrary } from './watch.mjs'

const DEBOUNCE = 50
const SETTLE = 400

async function setup(onChange) {
  const dir = await mkdtemp(join(tmpdir(), 'calm-watch-'))
  const w = await watchLibrary(dir, onChange, { debounceMs: DEBOUNCE })
  // macOS FSEvents reports the watched dir itself shortly after the watch starts.
  await sleep(SETTLE)
  return { dir, w }
}

test('one write gives one call', async (t) => {
  let calls = 0
  const { dir, w } = await setup(async () => calls++)
  t.after(() => w.close())
  calls = 0
  await writeFile(join(dir, 'a.mp3'), 'a')
  await sleep(SETTLE)
  assert.equal(calls, 1)
})

test('a burst of five writes gives one call', async (t) => {
  let calls = 0
  const { dir, w } = await setup(async () => calls++)
  t.after(() => w.close())
  calls = 0
  for (let i = 0; i < 5; i++) await writeFile(join(dir, `${i}.mp3`), 'x')
  await sleep(SETTLE)
  assert.equal(calls, 1)
})

test('localdrive tmp writes give no call, the final rename gives one', async (t) => {
  let calls = 0
  const { dir, w } = await setup(async () => calls++)
  t.after(() => w.close())
  calls = 0
  const tmp = join(dir, 'x.mp3.0.localdrive.tmp')
  for (let i = 0; i < 3; i++) {
    await writeFile(tmp, 'chunk'.repeat(i + 1))
    await sleep(20)
  }
  await sleep(SETTLE)
  assert.equal(calls, 0)
  await rename(tmp, join(dir, 'x.mp3'))
  await sleep(SETTLE)
  assert.equal(calls, 1)
})

test('a write during a slow onChange gives exactly one more call, never two at once', async (t) => {
  let calls = 0
  let running = 0
  let maxRunning = 0
  const { dir, w } = await setup(async () => {
    calls++
    running++
    maxRunning = Math.max(maxRunning, running)
    await sleep(200)
    running--
  })
  t.after(() => w.close())
  calls = 0
  maxRunning = 0
  await writeFile(join(dir, 'a.mp3'), 'a')
  await sleep(DEBOUNCE + 50)
  await writeFile(join(dir, 'b.mp3'), 'b')
  await sleep(SETTLE + 300)
  assert.equal(calls, 2)
  assert.equal(maxRunning, 1)
})

test('a missing folder is created and watched', async (t) => {
  let calls = 0
  const dir = join(await mkdtemp(join(tmpdir(), 'calm-watch-')), 'Music')
  const w = await watchLibrary(dir, async () => calls++, { debounceMs: DEBOUNCE })
  t.after(() => w.close())
  assert.ok((await stat(dir)).isDirectory())
  await sleep(SETTLE)
  calls = 0
  await writeFile(join(dir, 'a.mp3'), 'a')
  await sleep(SETTLE)
  assert.equal(calls, 1)
})
