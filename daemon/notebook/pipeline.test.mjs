import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildPipeline } from './pipeline.mjs'

test('buildPipeline puts the still path and preview size in the argv', () => {
  const argv = buildPipeline({ stillPath: '/tmp/x/still.jpg' })
  const joined = argv.join(' ')
  for (const token of ['libcamerasrc', 'method=clockwise', 'location=/tmp/x/still.jpg', 'fdsink', 'fd=1']) {
    assert.ok(argv.includes(token), `missing ${token}`)
  }
  for (const part of ['width=405', 'height=540', 'framerate=10/1']) {
    assert.ok(joined.includes(part), `missing ${part}`)
  }
})

test('buildPipeline honours custom preview size and rates', () => {
  const joined = buildPipeline({ stillPath: '/s.jpg', previewWidth: 300, previewHeight: 400, previewFps: 5, stillFps: 1 }).join(' ')
  assert.match(joined, /video\/x-raw,width=300,height=400/)
  assert.match(joined, /video\/x-raw,framerate=5\/1/)
  assert.match(joined, /video\/x-raw,framerate=1\/1/)
})

test('buildPipeline is quiet so stdout carries only JPEG frames', () => {
  assert.equal(buildPipeline({ stillPath: '/s.jpg' })[0], '-q')
})
