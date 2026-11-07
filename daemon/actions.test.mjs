import assert from 'node:assert/strict'
import { test } from 'node:test'
import { validateListenAction } from './actions.mjs'

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
