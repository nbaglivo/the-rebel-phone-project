import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCamera } from './camera.mjs'

const FAKE = 'daemon/fixtures/fake-camera.mjs'

function setup(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'camera-test-'))
  const stillPath = join(dir, 'still.jpg')
  const states = []
  const camera = createCamera({
    cmd: process.execPath,
    args: [FAKE, `location=${stillPath}`],
    stillPath,
    onState: (s) => states.push(s),
    ...opts,
  })
  const cleanup = () => {
    camera.stop('test over')
    rmSync(dir, { recursive: true, force: true })
  }
  return { camera, states, stillPath, cleanup }
}

function withEnv(vars, fn) {
  return async () => {
    const prev = {}
    for (const [k, v] of Object.entries(vars)) {
      prev[k] = process.env[k]
      process.env[k] = typeof v === 'function' ? v() : v
    }
    try {
      await fn()
    } finally {
      for (const [k, v] of Object.entries(prev)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    }
  }
}

const logPath = () => join(mkdtempSync(join(tmpdir(), 'camera-log-')), 'log')
const readLog = (p) => {
  try {
    return readFileSync(p, 'utf8').split('\n').filter(Boolean)
  } catch {
    return []
  }
}

function waitFor(predicate, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - t0 > ms) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

const isJpeg = (b) => b[0] === 0xff && b[1] === 0xd8 && b.at(-2) === 0xff && b.at(-1) === 0xd9

test('attach starts the camera and delivers frames', async () => {
  const { camera, states, cleanup } = setup()
  try {
    const frames = []
    camera.attach((f) => frames.push(f))
    assert.equal(camera.state().state, 'starting')
    await waitFor(() => frames.length >= 2)
    assert.ok(frames.every(isJpeg))
    assert.equal(camera.state().state, 'on')
    assert.deepEqual(states.map((s) => s.state), ['starting', 'on'])
  } finally {
    cleanup()
  }
})

test('two clients share one process, last detach stops it', withEnv({ FAKE_CAMERA_LOG: logPath }, async () => {
  const log = process.env.FAKE_CAMERA_LOG
  const { camera, cleanup } = setup()
  try {
    const a = []
    const b = []
    const detachA = camera.attach((f) => a.push(f))
    const detachB = camera.attach((f) => b.push(f))
    await waitFor(() => a.length >= 1 && b.length >= 1)
    detachA()
    assert.equal(camera.state().state, 'on')
    detachB()
    assert.equal(camera.state().state, 'off')
    assert.equal(readLog(log).filter((l) => l === 'start').length, 1)
  } finally {
    cleanup()
  }
}))

test('timeout pauses and detaches clients', async () => {
  const { camera, cleanup } = setup({ timeoutMs: 300 })
  try {
    const old = []
    camera.attach((f) => old.push(f))
    await waitFor(() => old.length >= 1)
    await waitFor(() => camera.state().state === 'paused')
    const seen = old.length
    const fresh = []
    camera.attach((f) => fresh.push(f))
    assert.equal(camera.state().state, 'starting')
    await waitFor(() => fresh.length >= 2)
    assert.equal(old.length, seen)
  } finally {
    cleanup()
  }
})

test('shot() pushes the timeout back', async () => {
  const { camera, cleanup } = setup({ timeoutMs: 1000 })
  try {
    camera.attach(() => {})
    await waitFor(() => camera.state().state === 'on')
    const t0 = Date.now()
    await new Promise((r) => setTimeout(r, 600))
    camera.shot()
    const shotAt = Date.now()
    await new Promise((r) => setTimeout(r, 600))
    assert.equal(camera.state().state, 'on')
    await waitFor(() => camera.state().state === 'paused')
    assert.ok(Date.now() - shotAt >= 900, 'paused too early after shot')
    assert.ok(Date.now() - t0 > 1000)
  } finally {
    cleanup()
  }
})

test('a crashing camera reports error with its stderr', async () => {
  const prev = process.env.FAKE_CAMERA_FAIL
  process.env.FAKE_CAMERA_FAIL = '1'
  const { camera, cleanup } = setup()
  try {
    camera.attach(() => {})
    await waitFor(() => camera.state().state === 'error')
    assert.match(camera.state().error, /fake camera/)
  } finally {
    if (prev === undefined) delete process.env.FAKE_CAMERA_FAIL
    else process.env.FAKE_CAMERA_FAIL = prev
    cleanup()
  }
})

test('stop() stops a running camera without an error', async () => {
  const { camera, states, cleanup } = setup()
  try {
    camera.attach(() => {})
    await waitFor(() => camera.state().state === 'on')
    camera.stop('screen off')
    assert.equal(camera.state().state, 'off')
    await new Promise((r) => setTimeout(r, 150))
    assert.equal(camera.state().state, 'off')
    assert.ok(!states.some((s) => s.state === 'error'))
  } finally {
    cleanup()
  }
})

test('latestStill is null until a fresh still exists', async () => {
  const { camera, stillPath, cleanup } = setup()
  try {
    camera.attach(() => {})
    assert.equal(camera.latestStill(), null)
    await waitFor(() => camera.latestStill() !== null)
    assert.equal(camera.latestStill(), stillPath)
  } finally {
    cleanup()
  }
})

test('a missing binary reports error', async () => {
  const { camera, cleanup } = setup({ cmd: '/nonexistent/camera-bin' })
  try {
    camera.attach(() => {})
    await waitFor(() => camera.state().state === 'error')
    assert.match(camera.state().error, /ENOENT/)
  } finally {
    cleanup()
  }
})

test('attach then immediate detach with a missing binary does not throw', async () => {
  const { camera, cleanup } = setup({ cmd: '/nonexistent/camera-bin' })
  try {
    const detach = camera.attach(() => {})
    detach()
    assert.equal(camera.state().state, 'off')
    await new Promise((r) => setTimeout(r, 200))
    assert.equal(camera.state().state, 'off')
  } finally {
    cleanup()
  }
})

test('stop then immediate attach never overlaps two processes', withEnv({ FAKE_CAMERA_LOG: logPath }, async () => {
  const log = process.env.FAKE_CAMERA_LOG
  const { camera, cleanup } = setup()
  try {
    camera.attach(() => {})
    await waitFor(() => camera.state().state === 'on')
    camera.stop('screen off')
    const frames = []
    camera.attach((f) => frames.push(f))
    assert.equal(camera.state().state, 'starting')
    await waitFor(() => camera.state().state === 'on' && frames.length >= 1)
    let alive = 0
    for (const line of readLog(log)) {
      alive += line === 'start' ? 1 : -1
      assert.ok(alive <= 1, 'two cameras alive at once')
    }
    assert.equal(readLog(log).filter((l) => l === 'start').length, 2)
  } finally {
    cleanup()
  }
}))
