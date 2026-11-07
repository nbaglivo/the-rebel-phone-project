// One long-lived mpv, driven over its JSON IPC socket. Restarts itself if it dies.

import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { rm } from 'node:fs/promises'
import { connect } from 'node:net'

const OBSERVED = ['time-pos', 'pause', 'duration']
const CONNECT_TIMEOUT_MS = 5_000
const BACKOFF_MIN_MS = 1_000
const BACKOFF_MAX_MS = 30_000
const HEALTHY_MS = 60_000

export function createMpv({ cmd, socketPath }) {
  const mpv = new EventEmitter()
  const [bin, ...extra] = cmd.split(' ').filter(Boolean)
  let child = null
  let socket = null
  let nextRequest = 1
  const pending = new Map()
  let stopping = false
  let backoff = BACKOFF_MIN_MS
  let startedAt = 0

  async function start() {
    stopping = false
    await rm(socketPath, { force: true })
    child = spawn(bin, [...extra, '--idle=yes', '--no-video', '--no-terminal', `--input-ipc-server=${socketPath}`], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    startedAt = Date.now()
    child.stderr.on('data', (d) => console.error(`mpv: ${String(d).trim()}`))
    child.on('exit', onExit)
    socket = await connectWithRetry()
    let buf = ''
    socket.on('data', (chunk) => {
      buf += chunk
      let nl
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        if (line) onMessage(JSON.parse(line))
      }
    })
    socket.on('error', () => {})
    for (const [i, name] of OBSERVED.entries()) await command('observe_property', i + 1, name)
  }

  function connectWithRetry() {
    const deadline = Date.now() + CONNECT_TIMEOUT_MS
    return new Promise((resolve, reject) => {
      const attempt = () => {
        const s = connect(socketPath)
        s.setEncoding('utf8')
        s.once('connect', () => resolve(s))
        s.once('error', () => {
          s.destroy()
          if (Date.now() > deadline) reject(new Error(`mpv: no IPC socket at ${socketPath}`))
          else setTimeout(attempt, 50)
        })
      }
      attempt()
    })
  }

  function onMessage(msg) {
    if (msg.request_id !== undefined) {
      const p = pending.get(msg.request_id)
      pending.delete(msg.request_id)
      if (!p) return
      if (msg.error === 'success') p.resolve(msg.data)
      else p.reject(new Error(`mpv: ${msg.error}`))
      return
    }
    if (msg.event === 'property-change' && OBSERVED.includes(msg.name) && msg.data != null) {
      mpv.emit(msg.name, msg.data)
    } else if (msg.event === 'file-loaded') {
      mpv.emit('file-loaded')
    } else if (msg.event === 'end-file') {
      mpv.emit('end-file', { reason: msg.reason, error: msg.file_error })
    }
  }

  function command(...args) {
    if (!socket || socket.destroyed) return Promise.reject(new Error('mpv: not running'))
    const request_id = nextRequest++
    return new Promise((resolve, reject) => {
      pending.set(request_id, { resolve, reject })
      socket.write(`${JSON.stringify({ command: args, request_id })}\n`)
    })
  }

  function onExit(code, signal) {
    socket?.destroy()
    socket = null
    for (const p of pending.values()) p.reject(new Error('mpv: exited'))
    pending.clear()
    if (stopping) return
    console.error(`mpv: exited (${signal ?? code}), restarting in ${backoff / 1000} s`)
    mpv.emit('exit')
    if (Date.now() - startedAt > HEALTHY_MS) backoff = BACKOFF_MIN_MS
    const wait = backoff
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS)
    setTimeout(() => {
      if (!stopping) start().then(() => mpv.emit('restart'), (err) => console.error(err.message))
    }, wait)
  }

  async function stop() {
    stopping = true
    if (!child || child.exitCode !== null) return
    const exited = new Promise((r) => child.once('exit', r))
    child.kill()
    await exited
  }

  return Object.assign(mpv, { start, command, stop })
}
