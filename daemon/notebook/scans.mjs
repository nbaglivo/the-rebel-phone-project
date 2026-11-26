// Notebook scans: a still is levelled into one pending file; keep moves it into
// the scans folder (which syncd publishes), retake drops it.

import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { mkdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import { dirname, join } from 'node:path'

const execFileP = promisify(execFile)

const PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:-(\d+))?\.jpg$/
const FILTER = 'hue=s=0,normalize=blackpt=black:whitept=white:smoothing=0'

const pad = (n) => String(n).padStart(2, '0')

export function scanName(date, taken) {
  const base =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  let name = `${base}.jpg`
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.jpg`
  return name
}

export function createScans({ dir, pendingPath, ffmpeg, now = () => new Date(), ffmpegTimeoutMs = 20_000 }) {
  let pendingAt = null
  // Ends in .jpg so ffmpeg infers the format; renamed over pendingPath once complete.
  const partPath = pendingPath.replace(/(\.jpg)?$/, '.part.jpg')
  // keep() writes a dot-name first so syncd never sees a half-written scan.
  let tmpCount = 0

  const names = () => {
    try {
      return readdirSync(dir).filter((n) => PATTERN.test(n))
    } catch {
      return []
    }
  }

  // One operation at a time: shoot, keep, retake, remove and init share pendingPath.
  let chain = Promise.resolve()
  const locked = (fn) => (...args) => {
    const run = chain.then(() => fn(...args))
    chain = run.catch(() => {})
    return run
  }

  const exists = (p) => stat(p).then(() => true, () => false)

  async function moveIn(captureTime) {
    const name = scanName(captureTime, new Set(names()))
    const tmp = join(dir, `.incoming-${process.pid}-${tmpCount++}.tmp`)
    try {
      await rename(pendingPath, tmp)
      pendingAt = null
      await rename(tmp, join(dir, name))
    } catch (err) {
      // A tmp left in dir is adopted by the next init(); only forget the shot if the file left.
      if (!(await exists(pendingPath))) pendingAt = null
      throw err
    }
  }

  async function initUnlocked() {
    await mkdir(dir, { recursive: true })
    await mkdir(dirname(pendingPath), { recursive: true })
    // A truncated encode from a crash is never a scan.
    await rm(partPath, { force: true })
    for (const n of readdirSync(dir).filter((n) => /^\.incoming-.*\.tmp$/.test(n))) {
      const info = await stat(join(dir, n)).catch(() => null)
      if (info) await rename(join(dir, n), join(dir, scanName(info.mtime, new Set(names()))))
    }
    const info = await stat(pendingPath).catch(() => null)
    if (info) await moveIn(info.mtime)
  }

  async function keepUnlocked() {
    if (pendingAt === null) return
    await moveIn(new Date(pendingAt))
  }

  async function retakeUnlocked() {
    pendingAt = null
    await rm(pendingPath, { force: true })
  }

  async function shootUnlocked(stillPath) {
    await keepUnlocked()
    const [cmd, ...prefix] = ffmpeg
    const at = now()
    try {
      // A hung encode must fail: screen off waits for the shot before it can suspend.
      await execFileP(cmd, [...prefix, '-y', '-i', stillPath, '-vf', FILTER, '-q:v', '2', partPath], {
        timeout: ffmpegTimeoutMs,
        killSignal: 'SIGKILL',
      })
      await rename(partPath, pendingPath)
    } catch (err) {
      await rm(partPath, { force: true })
      const e = new Error(String(err.stderr || err.message).trim())
      e.cause = err
      throw e
    }
    pendingAt = at.getTime()
  }

  async function removeUnlocked(name) {
    if (typeof name !== 'string' || !PATTERN.test(name)) return `not a scan name: ${name}`
    try {
      await unlink(join(dir, name))
    } catch (err) {
      return `cannot remove ${name}: ${err.code ?? err.message}`
    }
  }

  // Newest first: by timestamp, then by clash suffix (-2 is later than none).
  function list() {
    const key = (n) => {
      const m = PATTERN.exec(n)
      return `${m[1]}#${String(m[2] ?? 1).padStart(6, '0')}`
    }
    return names().sort((a, b) => (key(a) < key(b) ? 1 : -1))
  }

  const pending = () => (pendingAt === null ? null : { since: pendingAt })

  return {
    init: locked(initUnlocked),
    shoot: locked(shootUnlocked),
    keep: locked(keepUnlocked),
    retake: locked(retakeUnlocked),
    remove: locked(removeUnlocked),
    list,
    pending,
  }
}
