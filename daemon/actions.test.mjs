import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createActions, validateListenAction } from './actions.mjs'

const has = (id) => id === 'album/01 Intro.mp3'

test('seek needs a finite number', () => {
  assert.equal(typeof validateListenAction('listen/seek', { to: '5' }, has), 'string')
  assert.equal(typeof validateListenAction('listen/seek', { to: null }, has), 'string')
  assert.equal(typeof validateListenAction('listen/seek', {}, has), 'string')
  assert.equal(validateListenAction('listen/seek', { to: -3 }, has), null)
})

test('play accepts no id or a known id', () => {
  assert.equal(validateListenAction('listen/play', {}, has), null)
  assert.equal(validateListenAction('listen/play', { id: 'album/01 Intro.mp3', extra: 1 }, has), null)
  assert.equal(typeof validateListenAction('listen/play', { id: 'nope' }, has), 'string')
  assert.equal(typeof validateListenAction('listen/play', { id: 5 }, has), 'string')
})

test('argument-free actions accept any object', () => {
  for (const name of ['listen/pause', 'listen/back', 'listen/restart', 'listen/next', 'listen/rescan']) {
    assert.equal(validateListenAction(name, {}, has), null)
  }
})

test('notebook actions call the notebook; delete needs a string name', async () => {
  const calls = []
  const notebook = {
    shoot: async () => calls.push('shoot'),
    keep: async () => calls.push('keep'),
    retake: async () => calls.push('retake'),
    remove: async (name) => calls.push(`remove ${name}`),
  }
  const actions = createActions({ setScreen: () => {}, player: { has: () => false }, notebook })
  assert.equal(typeof (await actions['notebook/delete']({})), 'string')
  assert.equal(typeof (await actions['notebook/delete']({ name: 5 })), 'string')
  assert.deepEqual(calls, [])
  await actions['notebook/shoot']({})
  await actions['notebook/keep']({})
  await actions['notebook/retake']({})
  await actions['notebook/delete']({ name: '2026-11-26_09-14-03.jpg' })
  assert.deepEqual(calls, ['shoot', 'keep', 'retake', 'remove 2026-11-26_09-14-03.jpg'])
})

test('notebook action errors come back as the 400 message', async () => {
  const notebook = { shoot: async () => 'camera not ready', remove: async () => 'not a scan name: x' }
  const actions = createActions({ setScreen: () => {}, player: { has: () => false }, notebook })
  assert.equal(await actions['notebook/shoot']({}), 'camera not ready')
  assert.equal(await actions['notebook/delete']({ name: 'x' }), 'not a scan name: x')
})
