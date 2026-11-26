import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createJpegSplitter } from './jpeg-split.mjs'

const img = (...body) => Buffer.from([0xff, 0xd8, ...body, 0xff, 0xd9])

function collect() {
  const frames = []
  return { frames, push: createJpegSplitter((f) => frames.push(f)) }
}

test('one image in one chunk', () => {
  const { frames, push } = collect()
  push(img(1, 2, 3))
  assert.deepEqual(frames, [img(1, 2, 3)])
})

test('one image split across three chunks', () => {
  const { frames, push } = collect()
  const whole = img(1, 2, 3, 4, 5)
  push(whole.subarray(0, 1))
  push(whole.subarray(1, 5))
  assert.equal(frames.length, 0)
  push(whole.subarray(5))
  assert.deepEqual(frames, [whole])
})

test('two images in one chunk', () => {
  const { frames, push } = collect()
  push(Buffer.concat([img(1), img(2, 3)]))
  assert.deepEqual(frames, [img(1), img(2, 3)])
})

test('leading garbage before FFD8 is dropped', () => {
  const { frames, push } = collect()
  push(Buffer.concat([Buffer.from([9, 9, 0xff, 0x00]), img(7)]))
  assert.deepEqual(frames, [img(7)])
})
