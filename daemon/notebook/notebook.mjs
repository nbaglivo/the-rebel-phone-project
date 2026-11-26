// The Notebook feature in the daemon: the camera preview stream, shots, kept
// scans and the archive status, published as one `notebook` event.
// server.mjs only routes to it; contract in docs/architecture.md.

import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const LIVE = new Set(['starting', 'on'])
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// gst's multifilesink truncates and rewrites the still in place, so a read can
// catch it half-written: only a buffer from SOI (FFD8) to EOI (FFD9) is a whole JPEG.
const wholeJpeg = (buf) =>
  buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8 && buf[buf.length - 2] === 0xff && buf[buf.length - 1] === 0xd9

function sendJpeg(res, body) {
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': body.length, 'Cache-Control': 'no-cache' })
  res.end(body)
}

function notFound(res) {
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end('Not found')
}

export function createNotebook({
  camera,
  scans,
  readArchive,
  publish,
  scansDir,
  pendingPath,
  screenOn = () => true,
  stillRetries = 5,
  stillRetryMs = 100,
}) {
  let archive = null
  /** Open preview responses → their detach(). */
  const previews = new Map()

  // Called on every camera state change too, so the shell sees starting/on/paused/error at once.
  function refresh() {
    const { state, error } = camera.state()
    // A camera timeout, stop or crash drops its clients without telling them: end their responses.
    if (!LIVE.has(state)) for (const res of [...previews.keys()]) endPreview(res)
    publish('notebook', {
      camera: state,
      error,
      pending: scans.pending()?.since ?? null,
      scans: scans.list(),
      archive,
    })
  }

  function endPreview(res) {
    const detach = previews.get(res)
    if (!detach) return
    previews.delete(res)
    detach()
    res.end()
  }

  function preview(req, res) {
    // The camera never runs with the screen off, even if a stale <img> reconnects.
    if (!screenOn()) {
      res.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache' })
      res.end('screen off')
      return
    }
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-cache',
      Connection: 'close',
    })
    const detach = camera.attach((jpeg) => {
      // A slow client skips frames instead of buffering them.
      if (res.writableNeedDrain) return
      res.write(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`)
      res.write(jpeg)
      res.write('\r\n')
    })
    previews.set(res, detach)
    req.on('close', () => endPreview(res))
    // attach() may have published nothing new (another client already started it).
    refresh()
  }

  async function readStill(path) {
    for (let attempt = 0; ; attempt++) {
      const buf = await readFile(path).catch(() => null)
      if (buf && wholeJpeg(buf)) return buf
      if (attempt >= stillRetries) return null
      await wait(stillRetryMs)
    }
  }

  // One shot at a time: they share the stable copy of the still.
  let chain = Promise.resolve()
  async function shootUnlocked() {
    // A paused or stopped camera leaves its last still behind: never shoot a stale frame.
    const still = camera.state().state === 'on' ? camera.latestStill() : null
    if (!still) return 'camera not ready'
    const buf = await readStill(still)
    if (!buf) return 'camera still unreadable, try again'
    const copy = still.replace(/(\.jpg)?$/, '.shot.jpg')
    camera.shot()
    try {
      await writeFile(copy, buf)
      await scans.shoot(copy)
    } finally {
      // ~2 MB on tmpfs per shot otherwise.
      await rm(copy, { force: true }).catch(() => {})
      refresh()
    }
  }

  const after = (run) => async (...args) => {
    try {
      return await run(...args)
    } finally {
      refresh()
    }
  }

  async function serve(res, path) {
    let body
    try {
      body = await readFile(path)
    } catch {
      return notFound(res)
    }
    sendJpeg(res, body)
  }

  return {
    preview,
    refresh,
    async pollArchive() {
      archive = await readArchive()
      refresh()
    },
    // Only names the scans store lists: nothing outside scansDir is reachable.
    image: (res, name) => (scans.list().includes(name) ? serve(res, join(scansDir, name)) : notFound(res)),
    pendingImage: (res) => (scans.pending() ? serve(res, pendingPath) : notFound(res)),
    shoot() {
      const run = chain.then(shootUnlocked)
      chain = run.catch(() => {})
      return run
    },
    keep: after(() => scans.keep()),
    retake: after(() => scans.retake()),
    remove: after((name) => scans.remove(name)),
    // Screen off: stop the camera and never lose a page, so a pending shot is kept.
    // Paused, not off: on wake the shell shows "tap to resume" instead of a dead stream.
    screenOff: after(async () => {
      camera.stop('screen off', 'paused')
      for (const res of [...previews.keys()]) endPreview(res)
      // A shot still in ffmpeg would land as pending after screen off: let it finish, then keep it.
      await chain
      await scans.keep()
    }),
    previewing: () => previews.size > 0,
    uploading: async () => (await readArchive())?.uploading === true,
  }
}
