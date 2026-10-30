// Calm shell daemon: serves the built shell and owns all system access.
// Zero dependencies. Contract: docs/architecture.md.

// Each open /dev/input device parks a libuv pool thread in a blocking read();
// the default 4 would leave none for static files. Must be set before first use.
process.env.UV_THREADPOOL_SIZE ??= '16'

import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { open, readFile, readdir, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

const HOST = '127.0.0.1'
const PORT = Number(process.env.PORT ?? 8080)
const STATIC_DIR = resolve(process.env.STATIC_DIR ?? '/opt/calm')
const POWER_SUPPLY_DIR = process.env.POWER_SUPPLY_DIR ?? '/sys/class/power_supply'
const POLL_MS = Number(process.env.POLL_MS ?? 10_000)
const INPUT_DIR = process.env.INPUT_DIR ?? '/dev/input'
const IDLE_MS = Number(process.env.IDLE_MS ?? 30_000)
const SUSPEND_CMD = (process.env.SUSPEND_CMD ?? 'systemctl suspend').split(' ')

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

// struct input_event on 64-bit: timeval (16), type u16, code u16, value s32.
const EVENT_SIZE = 24
const EV_KEY = 1
const EV_ABS = 3
const KEY_POWER = 116
// The press that woke the phone and the resume check below both turn the screen on.
const SETTLE_MS = 2_000

let screenOn = true
let changedAt = 0
let idleTimer
let canWake = false

function armIdle() {
  clearTimeout(idleTimer)
  if (IDLE_MS > 0) idleTimer = setTimeout(() => setScreen(false), IDLE_MS)
}

function setScreen(on) {
  if (on === screenOn) return
  // Never sleep without an input device to notice the wake-up press.
  if (!on && !canWake) return
  screenOn = on
  changedAt = Date.now()
  publish('screen', { on })
  if (on) return armIdle()
  clearTimeout(idleTimer)
  execFile(SUSPEND_CMD[0], SUSPEND_CMD.slice(1), (err, _out, stderr) => {
    if (err) console.error(`screen: ${SUSPEND_CMD.join(' ')} failed: ${stderr.trim() || err.message}`)
  })
}

// Timers stop during suspend but the wall clock doesn't: a jump means we woke
// up, whatever woke us (power key, modem, alarm).
let lastTick = Date.now()
setInterval(() => {
  const now = Date.now()
  if (now - lastTick > 5_000) setScreen(true)
  lastTick = now
}, 1_000).unref()

// Only the power key wakes the screen; touches while off are ignored (pocket).
function onInput(type, code, value) {
  if (type === EV_KEY && code === KEY_POWER) {
    if (value === 1 && (!screenOn || Date.now() - changedAt > SETTLE_MS)) setScreen(!screenOn)
  } else if (screenOn && (type === EV_KEY || type === EV_ABS)) {
    armIdle()
  }
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

const actions = {
  screen: ({ on }) => {
    if (typeof on !== 'boolean') return '`on` must be a boolean'
    setScreen(on)
  },
}

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
  const error = actions[name](body)
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

server.listen(PORT, HOST, () => {
  console.log(`calm daemon on http://${HOST}:${PORT} (static: ${STATIC_DIR}, power: ${POWER_SUPPLY_DIR})`)
})
