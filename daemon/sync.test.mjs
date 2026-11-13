import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createSyncStatus, syncActive } from './sync.mjs'

const now = 1_000_000_000
const maxAgeMs = 120_000

test('a fresh syncing status counts, a stale one does not', () => {
  assert.equal(syncActive({ text: '{"syncing":true}', mtimeMs: now - 10_000, now, maxAgeMs }), true)
  assert.equal(syncActive({ text: '{"syncing":true}', mtimeMs: now - 121_000, now, maxAgeMs }), false)
})

test('false, missing and garbage statuses do not count', () => {
  assert.equal(syncActive({ text: '{"syncing":false}', mtimeMs: now, now, maxAgeMs }), false)
  assert.equal(syncActive({ text: null, mtimeMs: null, now, maxAgeMs }), false)
  assert.equal(syncActive({ text: 'garbage', mtimeMs: now, now, maxAgeMs }), false)
  assert.equal(syncActive({ text: 'true', mtimeMs: now, now, maxAgeMs }), false)
})

test('createSyncStatus reads the file', async () => {
  assert.equal(await createSyncStatus('/nope/status.json').isSyncing(), false)
  const file = join(await mkdtemp(join(tmpdir(), 'calm-sync-')), 'status.json')
  await writeFile(file, '{"syncing":true,"at":"2026-11-08T00:00:00Z"}\n')
  assert.equal(await createSyncStatus(file).isSyncing(), true)
  assert.equal(await createSyncStatus(file, { now: () => Date.now() + 121_000 }).isSyncing(), false)
})
