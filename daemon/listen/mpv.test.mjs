import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createMpv } from './mpv.mjs'
import { probe } from './probe.mjs'

const FIXTURES = fileURLToPath(new URL('../fixtures/music', import.meta.url))
const has = (cmd) => {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const skip = has('mpv') && has('ffprobe') ? false : 'mpv or ffprobe not installed'

const started = []
after(() => Promise.all(started.map((m) => m.stop())))

async function startMpv() {
  const socketPath = join(await mkdtemp(join(tmpdir(), 'calm-mpv-')), 'mpv.sock')
  const mpv = createMpv({ cmd: 'mpv --ao=null', socketPath })
  started.push(mpv)
  await mpv.start()
  return mpv
}

const endOf = (mpv) => Promise.race([
  once(mpv, 'end-file').then(([e]) => e),
  new Promise((_, reject) => setTimeout(() => reject(new Error('no end-file in 6 s')), 6_000)),
])

test('a file with accents, a dash and quotes plays to the end', { skip }, async () => {
  const mpv = await startMpv()
  const loaded = once(mpv, 'file-loaded')
  const ended = endOf(mpv)
  await mpv.command('loadfile', join(FIXTURES, 'Arvo Pärt — Spiegel "live".mp3'))
  await loaded
  assert.equal((await ended).reason, 'eof')
})

test('a file that is not audio ends with an error', { skip }, async () => {
  const mpv = await startMpv()
  const ended = endOf(mpv)
  await mpv.command('loadfile', join(FIXTURES, 'broken.mp3'))
  assert.equal((await ended).reason, 'error')
})

test('probe reads the title tag and duration', { skip }, async () => {
  const info = await probe(join(FIXTURES, 'album/10 Tenth.mp3'))
  assert.equal(info.title, 'Tenth Song')
  assert.ok(Math.abs(info.duration - 3) <= 0.2, `duration ${info.duration}`)
})

test('probe of a broken file gives nulls', { skip }, async () => {
  assert.deepEqual(await probe(join(FIXTURES, 'broken.mp3')), { title: null, duration: null })
})
