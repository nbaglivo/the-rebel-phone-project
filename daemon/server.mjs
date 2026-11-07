// Calm shell daemon: serves the built shell and owns all system access.
// Zero dependencies. Contract: docs/architecture.md.

// Each open /dev/input device parks a libuv pool thread in a blocking read();
// the default 4 would leave none for static files. Must be set before first use.
process.env.UV_THREADPOOL_SIZE ??= '16'

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { extname, join, resolve, sep } from 'node:path'
import { createActions } from './actions.mjs'
import { createBacklight } from './backlight.mjs'
import { classifyInput } from './input.mjs'
import { decideScreenOff, usbOnline } from './power.mjs'
import { SPEAKER_SINK, HEADPHONES_SINK, createAudio } from './audio.mjs'
import { createMpv } from './listen/mpv.mjs'
import { createPlayer } from './listen/player.mjs'
import { probe } from './listen/probe.mjs'
import { createStore } from './listen/store.mjs'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 8080)
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? '/opt/calm')
const POWER_SUPPLY_DIR = process.env.POWER_SUPPLY_DIR ?? '/sys/class/power_supply'
const POLL_MS = Number(process.env.POLL_MS ?? 10_000)
const INPUT_DIR = process.env.INPUT_DIR ?? '/dev/input'
const BACKLIGHT_DIR = process.env.BACKLIGHT_DIR ?? '/sys/class/backlight'
const IDLE_MS = Number(process.env.IDLE_MS ?? 30_000)
const SUSPEND_CMD = (process.env.SUSPEND_CMD ?? 'systemctl suspend').split(' ')
const MUSIC_DIR = process.env.MUSIC_DIR ?? '/home/user/Music'
const STATE_FILE = process.env.STATE_FILE ?? join(homedir(), '.local/state/calm/listen.json')
const MPV_CMD = process.env.MPV_CMD ?? 'mpv'
const FFPROBE_CMD = process.env.FFPROBE_CMD ?? 'ffprobe'

// ---------- State + SSE ----------

/** Last value of every event, so new clients get the full state on connect. */
const state = new Map()
const clients = new Set()

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`

function publish(event, data) {
  const prev = state.get(event)
  if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(data)) return
  state.set(event, data)
  for (const res of clients) res.write(frame(event, data))
}

function events(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  res.write('retry: 2000\n\n')
  for (const [event, data] of state) res.write(frame(event, data))
  clients.add(res)
  req.on('close', () => clients.delete(res))
}

// Comment lines keep idle connections from being dropped.
setInterval(() => {
  for (const res of clients) res.write(': ping\n\n')
}, 30_000).unref()

// ---------- Battery (sysfs) ----------

const readAttr = (dir, name) =>
  readFile(join(dir, name), 'utf8').then(
    (s) => s.trim(),
    () => null,
  )

const STATUSES = new Set(['Charging', 'Discharging', 'Full', 'Not charging'])

async function readBattery() {
  let names = []
  try {
    names = await readdir(POWER_SUPPLY_DIR)
  } catch {}
  for (const name of names.sort()) {
    const dir = join(POWER_SUPPLY_DIR, name)
    if ((await readAttr(dir, 'type')) !== 'Battery') continue
    const capacity = Number.parseInt((await readAttr(dir, 'capacity')) ?? '', 10)
    const status = await readAttr(dir, 'status')
    return {
      level: Number.isFinite(capacity) ? Math.max(0, Math.min(100, capacity)) : null,
      status: STATUSES.has(status) ? status : null,
    }
  }
  return { level: null, status: null }
}

async function pollBattery() {
  publish('battery', await readBattery())
}

// ---------- Screen + suspend (/dev/input + logind) ----------

// cage can't power the display off (no wlr-output-power-management), so screen
// off means suspend: s2idle powers the panel down along with everything else.
// Suspend stops audio, so while something plays the screen only blanks
// (backlight 0 + the shell's cover) and the phone stays awake.

// struct input_event on 64-bit: timeval (16), type u16, code u16, value s32.
const EVENT_SIZE = 24
// The press that woke the phone and the resume check below both turn the screen on.
const SETTLE_MS = 2_000

const backlight = createBacklight(BACKLIGHT_DIR)
let screenOn = true
let blanked = false
let changedAt = 0
let idleTimer
let blankSuspendTimer
let canWake = false

function armIdle() {
  clearTimeout(idleTimer)
  if (IDLE_MS > 0) idleTimer = setTimeout(() => setScreen(false, 'idle'), IDLE_MS)
}

function suspend() {
  execFile(SUSPEND_CMD[0], SUSPEND_CMD.slice(1), (err, _out, stderr) => {
    if (err) console.error(`screen: ${SUSPEND_CMD.join(' ')} failed: ${stderr.trim() || err.message}`)
  })
}

async function setScreen(on, reason = 'power') {
  if (on === screenOn) return
  // Never sleep without an input device to notice the wake-up press.
  if (!on && !canWake) return
  if (on) {
    screenOn = true
    changedAt = Date.now()
    clearTimeout(blankSuspendTimer)
    blankSuspendTimer = undefined
    if (blanked) await backlight.restore()
    blanked = false
    publish('screen', { on: true })
    return armIdle()
  }
  const decision = decideScreenOff({ reason, playing: player.isPlaying(), usb: await usbOnline(POWER_SUPPLY_DIR) })
  if (decision === 'stay') return armIdle()
  screenOn = false
  changedAt = Date.now()
  clearTimeout(idleTimer)
  publish('screen', { on: false })
  if (decision === 'blank') {
    blanked = true
    await backlight.blank()
  } else {
    suspend()
  }
}

// Blanked and playback stopped (pause, unplug, end of list): sleep after IDLE_MS,
// unless something plays again or the power key comes first.
function checkBlanked() {
  if (!blanked || IDLE_MS <= 0) return
  if (player.isPlaying()) {
    clearTimeout(blankSuspendTimer)
    blankSuspendTimer = undefined
  } else if (!blankSuspendTimer) {
    blankSuspendTimer = setTimeout(async () => {
      blankSuspendTimer = undefined
      if (!blanked || player.isPlaying()) return
      if (decideScreenOff({ reason: 'idle', playing: false, usb: await usbOnline(POWER_SUPPLY_DIR) }) !== 'suspend') return
      blanked = false
      await backlight.restore()
      suspend()
    }, IDLE_MS)
  }
}

// Timers stop during suspend but the wall clock doesn't: a jump means we woke
// up, whatever woke us (power key, modem, alarm).
let lastTick = Date.now()
setInterval(() => {
  const now = Date.now()
  if (now - lastTick > 5_000) setScreen(true)
  lastTick = now
  checkBlanked()
}, 1_000).unref()

// Only the power key wakes the screen; touches while off are ignored (pocket).
// Volume keys work while blanked; the headphone jack goes to the player.
function onInput(type, code, value) {
  const kind = classifyInput(type, code, value)
  if (kind === 'power') {
    if (!screenOn || Date.now() - changedAt > SETTLE_MS) setScreen(!screenOn)
    return
  }
  if (kind === 'volup' || kind === 'voldown') audio.stepVolume(kind === 'volup' ? 1 : -1)
  else if (kind === 'hp-in' || kind === 'hp-out') player.onHeadphones(kind === 'hp-in')
  if (kind && screenOn) armIdle()
}

async function watchDevice(path) {
  let handle
  try {
    handle = await open(path, 'r')
  } catch (err) {
    return console.error(`screen: can't read ${path} (${err.code})`)
  }
  if (!canWake) {
    canWake = true
    armIdle()
  }
  let rest = Buffer.alloc(0)
  handle
    .createReadStream()
    .on('data', (chunk) => {
      const buf = rest.length ? Buffer.concat([rest, chunk]) : chunk
      let i = 0
      for (; i + EVENT_SIZE <= buf.length; i += EVENT_SIZE) {
        onInput(buf.readUInt16LE(i + 16), buf.readUInt16LE(i + 18), buf.readInt32LE(i + 20))
      }
      rest = buf.subarray(i)
    })
    .on('error', (err) => console.error(`screen: ${path}: ${err.message}`))
}

async function watchInput() {
  let names = []
  try {
    names = await readdir(INPUT_DIR)
  } catch {}
  names = names.filter((n) => n.startsWith('event'))
  if (!names.length) console.error(`screen: no input devices in ${INPUT_DIR}, screen stays on`)
  for (const name of names) watchDevice(join(INPUT_DIR, name))
}

// ---------- Static files ----------

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

async function sendFile(res, path, method) {
  const body = await readFile(path)
  res.writeHead(200, {
    'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
    'Content-Length': body.length,
    'Cache-Control': path.includes(`${sep}assets${sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  res.end(method === 'HEAD' ? undefined : body)
}

async function serveStatic(req, res, pathname) {
  let decoded
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return send(res, 400, 'Bad request')
  }
  const path = resolve(STATIC_DIR, `.${decoded}`)
  if (decoded.includes('\0') || (path !== STATIC_DIR && !path.startsWith(STATIC_DIR + sep))) {
    return send(res, 404, 'Not found')
  }
  try {
    if ((await stat(path)).isFile()) return await sendFile(res, path, req.method)
  } catch {}
  // Missing files with an extension are real 404s; everything else is an app route.
  if (extname(decoded)) return send(res, 404, 'Not found')
  try {
    await sendFile(res, join(STATIC_DIR, 'index.html'), req.method)
  } catch {
    send(res, 503, 'Shell not built')
  }
}

// ---------- HTTP ----------

const send = (res, code, text) => {
  res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

const sendJson = (res, code, data) => {
  res.writeHead(code, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

async function readJson(req) {
  let body = ''
  for await (const chunk of req) {
    body += chunk
    if (body.length > 64 * 1024) throw new Error('body too large')
  }
  return JSON.parse(body)
}

// ---------- Listen (mpv) ----------

const mpv = createMpv({ cmd: MPV_CMD, socketPath: join(tmpdir(), `calm-mpv-${process.pid}.sock`) })
const audio = createAudio({ mpv })
const player = createPlayer({
  musicDir: MUSIC_DIR,
  store: createStore(STATE_FILE),
  mpv,
  probe: (path) => probe(path, FFPROBE_CMD),
  publish,
  setSink: audio.setSink,
  sinks: { speaker: SPEAKER_SINK, headphones: HEADPHONES_SINK },
})

const actions = createActions({ setScreen, player })

async function action(req, res, name) {
  if (!Object.hasOwn(actions, name)) return send(res, 404, 'Unknown action')
  if (req.method !== 'POST') return send(res, 405, 'Method not allowed')
  let body
  try {
    body = await readJson(req)
  } catch {
    return sendJson(res, 400, { error: 'invalid JSON body' })
  }
  if (body === null || typeof body !== 'object') return sendJson(res, 400, { error: 'body must be an object' })
  let error
  try {
    error = await actions[name](body)
  } catch (err) {
    console.error(`action ${name} failed: ${err.message}`)
    return sendJson(res, 500, { error: err.message })
  }
  if (error) return sendJson(res, 400, { error })
  res.writeHead(204)
  res.end()
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  if (pathname === '/events' && req.method === 'GET') return events(req, res)
  if (pathname.startsWith('/actions/')) return action(req, res, pathname.slice('/actions/'.length))
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, pathname)
  send(res, 405, 'Method not allowed')
})

await pollBattery()
setInterval(pollBattery, POLL_MS)
publish('screen', { on: true })
watchInput()

// Not awaited: probing a large library on first run must not delay the shell.
;(async () => {
  try {
    await mpv.start()
    await audio.setSink(SPEAKER_SINK)
  } catch (err) {
    console.error(`listen: mpv didn't start (${err.message}); playback is unavailable`)
  }
  await player.init()
})().catch((err) => console.error(`listen: init failed: ${err.message}`))

// tinydm restarts send SIGTERM: save positions first, never lose a book.
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, async () => {
    await player.flush().catch(() => {})
    await mpv.stop().catch(() => {})
    process.exit(0)
  })
}

server.listen(PORT, HOST, () => {
  console.log(`calm daemon on http://${HOST}:${PORT} (static: ${STATIC_DIR}, power: ${POWER_SUPPLY_DIR}, music: ${MUSIC_DIR})`)
})
