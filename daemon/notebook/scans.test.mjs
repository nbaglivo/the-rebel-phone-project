import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile, utimes, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createScans, scanName } from './scans.mjs'

const fake = fileURLToPath(new URL('../fixtures/fake-ffmpeg.mjs', import.meta.url))

async function setup(times = []) {
  const root = await mkdtemp(join(tmpdir(), 'scans-'))
  const dir = join(root, 'scans')
  const pendingPath = join(root, 'pending.jpg')
  const still = join(root, 'still.jpg')
  await writeFile(still, 'jpeg-bytes')
  let n = 0
  const scans = createScans({
    dir,
    pendingPath,
    ffmpeg: [process.execPath, fake],
    now: () => times[n++ % times.length] ?? new Date(2026, 10, 26, 9, 0, n),
  })
  await scans.init()
  return { root, dir, pendingPath, still, scans }
}

test('scanName formats local time and avoids clashes', () => {
  const d = new Date(2026, 10, 26, 9, 14, 3)
  assert.equal(scanName(d, new Set()), '2026-11-26_09-14-03.jpg')
  assert.equal(scanName(d, new Set(['2026-11-26_09-14-03.jpg'])), '2026-11-26_09-14-03-2.jpg')
})

test('shoot then keep puts one file in the folder', async () => {
  const { dir, still, scans, pendingPath } = await setup()
  await scans.shoot(still)
  assert.ok(scans.pending().since > 0)
  await scans.keep()
  assert.equal((await readdir(dir)).length, 1)
  assert.equal(scans.list().length, 1)
  assert.equal(scans.pending(), null)
  await assert.rejects(access(pendingPath))
})

test('shoot then retake leaves none', async () => {
  const { dir, still, scans, pendingPath } = await setup()
  await scans.shoot(still)
  await scans.retake()
  assert.deepEqual(await readdir(dir), [])
  assert.equal(scans.pending(), null)
  await assert.rejects(access(pendingPath))
})

test('a second shoot keeps the first pending shot', async () => {
  const { dir, still, scans } = await setup()
  await scans.shoot(still)
  await scans.shoot(still)
  assert.equal((await readdir(dir)).length, 1)
  await scans.keep()
  assert.equal((await readdir(dir)).length, 2)
})

test('init keeps a pending shot left by a crash', async () => {
  const { dir, pendingPath, scans } = await setup()
  await writeFile(pendingPath, 'x')
  await utimes(pendingPath, new Date(2026, 10, 25, 8, 0, 0), new Date(2026, 10, 25, 8, 0, 0))
  await scans.init()
  assert.deepEqual(await readdir(dir), ['2026-11-25_08-00-00.jpg'])
  assert.equal(scans.pending(), null)
})

test('failed ffmpeg throws with stderr and leaves nothing', async () => {
  const { root, pendingPath, scans } = await setup()
  const bad = join(root, 'FAIL.jpg')
  await writeFile(bad, 'x')
  await assert.rejects(scans.shoot(bad), /boom/)
  assert.equal(scans.pending(), null)
  await assert.rejects(access(pendingPath))
})

test('remove rejects names outside the pattern', async () => {
  const { dir, scans } = await setup()
  await writeFile(join(dir, 'notes.txt'), 'n')
  assert.equal(typeof (await scans.remove('../x.jpg')), 'string')
  assert.equal(typeof (await scans.remove('notes.txt')), 'string')
  assert.equal(typeof (await scans.remove('2026-01-01_00-00-00.jpg')), 'string')
  assert.deepEqual(await readdir(dir), ['notes.txt'])
  await writeFile(join(dir, '2026-01-01_00-00-00.jpg'), 'j')
  assert.equal(await scans.remove('2026-01-01_00-00-00.jpg'), undefined)
  assert.deepEqual(await readdir(dir), ['notes.txt'])
})

test('list is newest first and ignores other files', async () => {
  const { dir, scans } = await setup()
  for (const f of ['2026-01-01_00-00-00.jpg', '2026-01-02_00-00-00.jpg', '2026-01-02_00-00-00-2.jpg', 'notes.txt', '.2026-01-03.tmp'])
    await writeFile(join(dir, f), 'x')
  await scans.init()
  assert.deepEqual(scans.list(), ['2026-01-02_00-00-00-2.jpg', '2026-01-02_00-00-00.jpg', '2026-01-01_00-00-00.jpg'])
})
