import assert from 'node:assert/strict'
import { test } from 'node:test'
import { classifyInput } from './input.mjs'

test('power key press is power', () => {
  assert.equal(classifyInput(1, 116, 1), 'power')
  assert.equal(classifyInput(1, 116, 0), null)
})

test('volume keys step on press and auto-repeat, not release', () => {
  assert.equal(classifyInput(1, 115, 1), 'volup')
  assert.equal(classifyInput(1, 114, 2), 'voldown')
  assert.equal(classifyInput(1, 115, 0), null)
})

test('the headphone switch reports plug and unplug', () => {
  assert.equal(classifyInput(5, 2, 1), 'hp-in')
  assert.equal(classifyInput(5, 2, 0), 'hp-out')
  assert.equal(classifyInput(5, 4, 1), null)
})

test('touches and other keys are activity; sync events are nothing', () => {
  assert.equal(classifyInput(3, 53, 100), 'activity')
  assert.equal(classifyInput(1, 30, 1), 'activity')
  assert.equal(classifyInput(0, 0, 0), null)
})
