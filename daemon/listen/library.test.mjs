import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  comparePaths,
  displayOrder,
  displayTitle,
  folderOf,
  nextId,
  scanMusic,
  startPosition,
} from './library.mjs'

const FIXTURES = fileURLToPath(new URL('../fixtures/music', import.meta.url))

test('scanMusic lists audio files by natural path order, skipping hidden ones', async () => {
  const ids = (await scanMusic(FIXTURES)).map((f) => f.id)
  const expected = [
    'album/01 Intro.mp3',
    'album/02 Second.mp3',
    'album/10 Tenth.mp3',
    'Arvo Pärt — Spiegel "live".mp3',
    'broken.mp3',
  ].sort(comparePaths)
  assert.deepEqual(ids, expected)
  assert.ok(!ids.some((id) => id.includes('.hidden')))
})

test('scanMusic returns size and mtime for each file', async () => {
  const [first] = await scanMusic(FIXTURES)
  assert.ok(first.size > 0)
  assert.ok(first.mtimeMs > 0)
})

test('scanMusic on a missing dir returns an empty list', async () => {
  assert.deepEqual(await scanMusic('/nope/does-not-exist'), [])
})

test('comparePaths sorts numbers naturally', () => {
  assert.ok(comparePaths('ch2.mp3', 'ch10.mp3') < 0)
  assert.ok(comparePaths('album/10 Tenth.mp3', 'album/02 Second.mp3') > 0)
})

test('nextId follows the list and stops at the end', () => {
  assert.equal(nextId(['a', 'b'], 'a'), 'b')
  assert.equal(nextId(['a', 'b'], 'b'), null)
  assert.equal(nextId(['a'], 'gone'), null)
})

test('displayTitle prefers a non-blank tag, else the file name', () => {
  assert.equal(displayTitle('album/01 Intro.mp3', null), '01 Intro')
  assert.equal(displayTitle('x.mp3', '  Tenth Song '), 'Tenth Song')
  assert.equal(displayTitle('x.mp3', '  '), 'x')
})

test('folderOf gives the relative directory', () => {
  assert.equal(folderOf('album/01 Intro.mp3'), 'album')
  assert.equal(folderOf('a.mp3'), '')
})

test('startPosition resumes long files on advance, restarts short ones', () => {
  assert.equal(startPosition({ duration: 3600, position: 900 }, 'advance'), 900)
  assert.equal(startPosition({ duration: 200, position: 90 }, 'advance'), 0)
  assert.equal(startPosition({ duration: 200, position: 90 }, 'resume'), 90)
  assert.equal(startPosition({ duration: null, position: 5 }, 'advance'), 0)
})

test('displayOrder puts played files newest first, then unplayed by title', () => {
  const entries = [
    { title: 'B', lastPlayed: null },
    { title: 'old', lastPlayed: 10 },
    { title: 'a', lastPlayed: null },
    { title: 'new', lastPlayed: 20 },
  ]
  assert.deepEqual(
    displayOrder(entries).map((e) => e.title),
    ['new', 'old', 'a', 'B'],
  )
})
