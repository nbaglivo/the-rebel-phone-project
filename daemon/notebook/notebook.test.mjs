import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readdir, readFile, writeFile, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCamera } from './camera.mjs'
import { createScans } from './scans.mjs'
import { createNotebook } from './notebook.mjs'

const fakeCamera = fileURLToPath(new URL('../fixtures/fake-camera.mjs', import.meta.url))
const fakeFfmpeg = fileURLToPath(new URL('../fixtures/fake-ffmpeg.mjs', import.meta.url))
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9])
const ARCHIVE = { connected: true, uploading: false, lastReceived: 1_700_000_000_000 }

// A failed assertion must not leave a fake camera running and the test process alive.
const cameras = []
after(() => cameras.forEach((c) => c.stop('test over')))

function waitFor(predicate, ms = 5000) {
  return new Promise((resolve, reject) => {
    const t0 = Date.now()
    const tick = async () => {
      if (await predicate()) return resolve()
      if (Date.now() - t0 > ms) return reject(new Error('waitFor timed out'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

function fakeHttp() {
  const req = new EventEmitter()
  const res = {
    status: null,
    headers: null,
    chunks: [],
    ended: false,
    writableNeedDrain: false,
    writeHead(status, headers) {
      this.status = status
      this.headers = headers
    },
    write(chunk) {
      this.chunks.push(Buffer.from(chunk))
      return true
    },
    end(chunk) {
      if (chunk) this.chunks.push(Buffer.from(chunk))
      this.ended = true
    },
    body() {
      return Buffer.concat(this.chunks)
    },
  }
  return { req, res }
}

async function setup({ camera: stub, timeoutMs, archive = ARCHIVE, ...opts } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'notebook-'))
  const dir = join(root, 'scans')
  const pendingPath = join(root, 'pending.jpg')
  const stillPath = join(root, 'still.jpg')
  const events = []
  let notebook
  const camera =
    stub ??
    createCamera({
      cmd: process.execPath,
      args: [fakeCamera, `location=${stillPath}`],
      stillPath,
      timeoutMs,
      onState: () => notebook.refresh(),
    })
  cameras.push(camera)
  const scans = createScans({ dir, pendingPath, ffmpeg: [process.execPath, fakeFfmpeg] })
  await scans.init()
  notebook = createNotebook({
    camera,
    scans,
    readArchive: async () => archive,
    publish: (event, data) => events.push([event, data]),
    scansDir: dir,
    pendingPath,
    ...opts,
  })
  const last = () => events.filter(([e]) => e === 'notebook').at(-1)?.[1]
  return { root, dir, pendingPath, stillPath, camera, scans, notebook, events, last }
}

async function openPreview(t) {
  const { req, res } = fakeHttp()
  t.notebook.preview(req, res)
  await waitFor(() => t.camera.latestStill() !== null)
  return { req, res }
}

test('the preview is a multipart JPEG stream', async (t) => {
  const s = await setup()
  const { req, res } = fakeHttp()
  s.notebook.preview(req, res)
  assert.equal(res.status, 200)
  assert.equal(res.headers['Content-Type'], 'multipart/x-mixed-replace; boundary=frame')
  assert.equal(res.headers['Cache-Control'], 'no-cache')
  assert.equal(s.notebook.previewing(), true)
  await waitFor(() => res.body().length > 0)
  const head = res.body().subarray(0, 80).toString('latin1')
  assert.match(head, /^--frame\r\nContent-Type: image\/jpeg\r\nContent-Length: \d+\r\n\r\n\xff\xd8/)
  req.emit('close')
  assert.equal(s.notebook.previewing(), false)
  assert.equal(s.camera.state().state, 'off')
})

test('shoot before a still exists says camera not ready', async () => {
  const s = await setup()
  assert.equal(await s.notebook.shoot(), 'camera not ready')
  assert.equal(s.scans.pending(), null)
})

test('the published event has the contract shape after shoot and keep', async () => {
  const s = await setup()
  await s.notebook.pollArchive()
  const { req } = await openPreview(s)
  assert.equal(await s.notebook.shoot(), undefined)
  const shot = s.last()
  assert.deepEqual(Object.keys(shot).sort(), ['archive', 'camera', 'error', 'pending', 'scans'])
  assert.equal(shot.camera, 'on')
  assert.equal(shot.error, null)
  assert.equal(typeof shot.pending, 'number')
  assert.deepEqual(shot.scans, [])
  assert.deepEqual(shot.archive, ARCHIVE)
  await s.notebook.keep()
  const kept = s.last()
  assert.equal(kept.pending, null)
  assert.equal(kept.scans.length, 1)
  assert.match(kept.scans[0], /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jpg$/)
  req.emit('close')
  assert.equal(s.last().camera, 'off')
})

test('camera state changes are published as they happen', async () => {
  const s = await setup()
  const { req } = fakeHttp()
  s.notebook.preview(req, fakeHttp().res)
  assert.equal(s.last().camera, 'starting')
  await waitFor(() => s.last().camera === 'on')
  req.emit('close')
  assert.equal(s.last().camera, 'off')
})

test('the last preview client leaving with a pending shot keeps it', async () => {
  const s = await setup()
  const { req } = await openPreview(s)
  await s.notebook.shoot()
  req.emit('close')
  assert.equal(s.camera.state().state, 'off')
  assert.ok(s.scans.pending())
  await access(s.pendingPath)
  assert.equal(typeof s.last().pending, 'number')
})

test('screenOff stops the camera, ends the preview and keeps the pending shot', async () => {
  const s = await setup()
  const { res } = await openPreview(s)
  await s.notebook.shoot()
  await s.notebook.screenOff()
  assert.equal(s.camera.state().state, 'off')
  assert.equal(res.ended, true)
  assert.equal(s.notebook.previewing(), false)
  assert.equal(s.scans.pending(), null)
  assert.equal((await readdir(s.dir)).length, 1)
  assert.equal(s.last().scans.length, 1)
})

test('a camera timeout ends the preview response', async () => {
  const s = await setup({ timeoutMs: 300 })
  const { res } = fakeHttp()
  s.notebook.preview(new EventEmitter(), res)
  await waitFor(() => res.ended)
  assert.equal(s.camera.state().state, 'paused')
  assert.equal(s.notebook.previewing(), false)
  assert.equal(s.last().camera, 'paused')
})

function stubCamera(stillPath) {
  return {
    shots: 0,
    attach: () => () => {},
    stop() {},
    shot() {
      this.shots++
    },
    latestStill: () => stillPath,
    state: () => ({ state: 'on', error: null }),
  }
}

test('a still caught mid-rewrite is retried until it is a whole JPEG', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-still-'))
  const still = join(root, 'still.jpg')
  await writeFile(still, JPEG.subarray(0, 5))
  const camera = stubCamera(still)
  const s = await setup({ camera, stillRetries: 5, stillRetryMs: 50 })
  setTimeout(() => writeFile(still, JPEG), 120)
  assert.equal(await s.notebook.shoot(), undefined)
  assert.deepEqual(await readFile(s.pendingPath), JPEG)
  assert.equal(camera.shots, 1)
})

test('a still that never completes is rejected and nothing is written', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-still-'))
  const still = join(root, 'still.jpg')
  await writeFile(still, Buffer.from([0xff, 0xd8, 1, 2, 3]))
  const s = await setup({ camera: stubCamera(still), stillRetries: 3, stillRetryMs: 10 })
  assert.equal(await s.notebook.shoot(), 'camera still unreadable, try again')
  assert.equal(s.scans.pending(), null)
  await assert.rejects(access(s.pendingPath))
})

test('scans are passed a stable copy, not the live still', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-still-'))
  const still = join(root, 'still.jpg')
  await writeFile(still, JPEG)
  const seen = []
  const s = await setup({ camera: stubCamera(still) })
  const shoot = s.scans.shoot
  s.scans.shoot = (path) => (seen.push(path), shoot(path))
  await s.notebook.shoot()
  assert.equal(seen.length, 1)
  assert.notEqual(seen[0], still)
})

test('images: kept scans and the pending shot are served, other names are 404', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-still-'))
  const still = join(root, 'still.jpg')
  await writeFile(still, JPEG)
  const s = await setup({ camera: stubCamera(still) })

  let { res } = fakeHttp()
  await s.notebook.pendingImage(res)
  assert.equal(res.status, 404)

  await s.notebook.shoot()
  ;({ res } = fakeHttp())
  await s.notebook.pendingImage(res)
  assert.equal(res.status, 200)
  assert.equal(res.headers['Content-Type'], 'image/jpeg')
  assert.equal(res.headers['Cache-Control'], 'no-cache')
  assert.deepEqual(res.body(), JPEG)

  await s.notebook.keep()
  const [name] = s.scans.list()
  ;({ res } = fakeHttp())
  await s.notebook.image(res, name)
  assert.equal(res.status, 200)
  assert.deepEqual(res.body(), JPEG)

  for (const bad of ['../pending.jpg', 'nope.jpg', '']) {
    ;({ res } = fakeHttp())
    await s.notebook.image(res, bad)
    assert.equal(res.status, 404, bad)
  }
})

test('remove and retake publish the new state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-still-'))
  const still = join(root, 'still.jpg')
  await writeFile(still, JPEG)
  const s = await setup({ camera: stubCamera(still) })
  await s.notebook.shoot()
  await s.notebook.retake()
  assert.equal(s.last().pending, null)
  await s.notebook.shoot()
  await s.notebook.keep()
  const [name] = s.last().scans
  assert.equal(typeof (await s.notebook.remove('../x.jpg')), 'string')
  assert.equal(await s.notebook.remove(name), undefined)
  assert.deepEqual(s.last().scans, [])
})

test('uploading follows the archive status', async () => {
  let s = await setup({ archive: { connected: true, uploading: true, lastReceived: null } })
  assert.equal(await s.notebook.uploading(), true)
  s = await setup({ archive: null })
  assert.equal(await s.notebook.uploading(), false)
  await s.notebook.pollArchive()
  assert.equal(s.last().archive, null)
})

test('after the camera pauses, an old still is not shot', async () => {
  const s = await setup({ timeoutMs: 900 })
  const { res } = await openPreview(s)
  await waitFor(() => res.ended)
  assert.equal(s.camera.state().state, 'paused')
  assert.equal(await s.notebook.shoot(), 'camera not ready')
  assert.equal(s.scans.pending(), null)
})

test('screenOff waits for a shot in flight and keeps it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-SLOW-'))
  const still = join(root, 'still.jpg')
  await writeFile(still, JPEG)
  const s = await setup({ camera: stubCamera(still) })
  const shooting = s.notebook.shoot()
  await s.notebook.screenOff()
  assert.equal(s.scans.pending(), null)
  assert.equal((await readdir(s.dir)).length, 1)
  assert.equal(await shooting, undefined)
})

test('the stable copy of the still is deleted after the shot, whatever happened', async () => {
  const root = await mkdtemp(join(tmpdir(), 'notebook-still-'))
  const still = join(root, 'still.jpg')
  await writeFile(still, JPEG)
  const s = await setup({ camera: stubCamera(still) })
  await s.notebook.shoot()
  assert.deepEqual((await readdir(root)).sort(), ['still.jpg'])
  const failRoot = await mkdtemp(join(tmpdir(), 'notebook-FAIL-'))
  const failStill = join(failRoot, 'still.jpg')
  await writeFile(failStill, JPEG)
  const f = await setup({ camera: stubCamera(failStill) })
  await assert.rejects(f.notebook.shoot())
  assert.deepEqual((await readdir(failRoot)).sort(), ['still.jpg'])
})
