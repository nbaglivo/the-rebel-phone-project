import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { archiveStatus, createArchiveStatus } from './archive-status.mjs'

const now = Date.parse('2026-11-26T10:00:00Z')
const status = (fields) =>
  JSON.stringify({ role: 'publish', connected: true, uploading: false, lastUpload: null, at: '2026-11-26T09:59:30Z', ...fields })

test('no status file means no archive set up', () => {
  assert.equal(archiveStatus({ text: null, mtimeMs: null, now }), null)
})

test('a fresh status file reports the connection and the last upload', () => {
  const text = status({ connected: true, uploading: true, lastUpload: '2026-11-26T09:14:00.000Z' })
  assert.deepEqual(archiveStatus({ text, mtimeMs: now - 30_000, now }), {
    connected: true,
    uploading: true,
    lastReceived: Date.parse('2026-11-26T09:14:00.000Z'),
  })
  assert.deepEqual(archiveStatus({ text: status({ connected: false }), mtimeMs: now, now }), {
    connected: false,
    uploading: false,
    lastReceived: null,
  })
})

test('a stale status file is not connected and not uploading, but keeps the last upload', () => {
  const text = status({ connected: true, uploading: true, lastUpload: '2026-11-25T18:00:00.000Z' })
  assert.deepEqual(archiveStatus({ text, mtimeMs: now - 181_000, now }), {
    connected: false,
    uploading: false,
    lastReceived: Date.parse('2026-11-25T18:00:00.000Z'),
  })
  assert.equal(archiveStatus({ text, mtimeMs: now - 10_000, now, maxAgeMs: 5_000 }).connected, false)
})

test('a garbled status file reads as not connected', () => {
  assert.deepEqual(archiveStatus({ text: 'garbage', mtimeMs: now, now }), {
    connected: false,
    uploading: false,
    lastReceived: null,
  })
})

test('createArchiveStatus reads the file', async () => {
  assert.equal(await createArchiveStatus('/nope/status.json').read(), null)
  const file = join(await mkdtemp(join(tmpdir(), 'calm-archive-')), 'status.json')
  await writeFile(file, status({ uploading: true }))
  assert.equal((await createArchiveStatus(file).read()).uploading, true)
  assert.equal((await createArchiveStatus(file, { now: () => Date.now() + 181_000 }).read()).connected, false)
})
