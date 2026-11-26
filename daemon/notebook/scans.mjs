// Notebook scans: a still is levelled into one pending file; keep moves it into
// the scans folder (which syncd publishes), retake drops it.

import { execFile } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { mkdir, rename, rm, stat, unlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join } from 'node:path'

const execFileP = promisify(execFile)

const PATTERN = /^(\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2})(?:-(\d+))?\.jpg$/
const FILTER = 'normalize=blackpt=black:whitept=white:smoothing=0'

const pad = (n) => String(n).padStart(2, '0')

export function scanName(date, taken) {
  const base =
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  let name = `${base}.jpg`
  for (let n = 2; taken.has(name); n++) name = `${base}-${n}.jpg`
  return name
}

export function createScans({ dir, pendingPath, ffmpeg, now = () => new Date() }) {
  let pendingAt = null
  // keep() writes a dot-name first so syncd never sees a half-written scan.
  let tmpCount = 0

  const names = () => {
    try {
      return readdirSync(dir).filter((n) => PATTERN.test(n))
    } catch {
      return []
    }
  }

  async function moveIn(captureTime) {
    const name = scanName(captureTime, new Set(names()))
    const tmp = join(dir, `.incoming-${process.pid}-${tmpCount++}.tmp`)
    await rename(pendingPath, tmp)
    await rename(tmp, join(dir, name))
    pendingAt = null
    return name
  }

  async function init() {
    await mkdir(dir, { recursive: true })
    const info = await stat(pendingPath).catch(() => null)
    if (info) await moveIn(info.mtime)
  }

  async function keep() {
    if (pendingAt === null) return
    await moveIn(new Date(pendingAt))
  }

  async function retake() {
    pendingAt = null
    await rm(pendingPath, { force: true })
  }

  async function shoot(stillPath) {
    await keep()
    const [cmd, ...prefix] = ffmpeg
    const at = now()
    try {
      await execFileP(cmd, [...prefix, '-y', '-i', stillPath, '-vf', FILTER, '-q:v', '2', pendingPath])
    } catch (err) {
      await rm(pendingPath, { force: true })
      const e = new Error(String(err.stderr || err.message).trim())
      e.cause = err
      throw e
    }
    pendingAt = at.getTime()
  }

  async function remove(name) {
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

  return { init, shoot, keep, retake, remove, list, pending }
}
