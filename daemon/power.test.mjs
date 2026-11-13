import assert from 'node:assert/strict'
import { cp, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { decideScreenOff, usbOnline } from './power.mjs'

const FIXTURES = fileURLToPath(new URL('./fixtures/power_supply', import.meta.url))

test('idle while on USB stays on, whatever is playing', () => {
  assert.equal(decideScreenOff({ reason: 'idle', playing: false, usb: true }), 'stay')
  assert.equal(decideScreenOff({ reason: 'idle', playing: true, usb: true }), 'stay')
})

test('idle off USB blanks while playing, else suspends', () => {
  assert.equal(decideScreenOff({ reason: 'idle', playing: true, usb: false }), 'blank')
  assert.equal(decideScreenOff({ reason: 'idle', playing: false, usb: false }), 'suspend')
})

test('the power key blanks while playing and suspends otherwise, even on USB', () => {
  assert.equal(decideScreenOff({ reason: 'power', playing: true, usb: true }), 'blank')
  assert.equal(decideScreenOff({ reason: 'power', playing: false, usb: true }), 'suspend')
  assert.equal(decideScreenOff({ reason: 'power', playing: false, usb: false }), 'suspend')
})

test('a running sync blanks instead of suspending, like playback', () => {
  assert.equal(decideScreenOff({ reason: 'idle', playing: false, usb: false, syncing: true }), 'blank')
  assert.equal(decideScreenOff({ reason: 'power', playing: false, usb: true, syncing: true }), 'blank')
  assert.equal(decideScreenOff({ reason: 'idle', playing: false, usb: true, syncing: true }), 'stay')
  assert.equal(decideScreenOff({ reason: 'idle', playing: false, usb: false, syncing: false }), 'suspend')
})

test('usbOnline sees any online USB or Mains supply', async () => {
  assert.equal(await usbOnline(FIXTURES), true)
  const dir = await mkdtemp(join(tmpdir(), 'calm-ps-'))
  await cp(FIXTURES, dir, { recursive: true })
  await writeFile(join(dir, 'ac/online'), '0\n')
  assert.equal(await usbOnline(dir), false)
  await writeFile(join(dir, 'usb/online'), '1\n')
  assert.equal(await usbOnline(dir), true)
  assert.equal(await usbOnline('/nope'), false)
})
