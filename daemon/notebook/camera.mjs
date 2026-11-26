// Runs the camera process only while someone watches. One process, shared by all viewers.

import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { createJpegSplitter } from './jpeg-split.mjs'

export function createCamera({ cmd, args, stillPath, timeoutMs = 120_000, onState = () => {} }) {
  let state = 'off'
  let error = null
  let child = null
  let startedAt = 0
  let timer = null
  let lastStderr = ''
  const clients = new Set()
  let closing = null
  let pendingStart = false

  function setState(next, err = null) {
    state = next
    error = err
    onState({ state, error })
  }

  function armTimeout() {
    clearTimeout(timer)
    timer = setTimeout(() => {
      kill()
      clients.clear()
      setState('paused')
    }, timeoutMs)
  }

  // Stops the running process; closing resolves once it is really gone.
  function kill() {
    clearTimeout(timer)
    timer = null
    pendingStart = false
    if (!child) return
    const c = child
    child = null
    closing = new Promise((resolve) => {
      const done = () => {
        clearTimeout(force)
        if (closing === mine) closing = null
        resolve()
      }
      const force = setTimeout(() => c.pid && c.kill('SIGKILL'), 2000)
      force.unref()
      c.once('close', done)
      c.once('error', done)
    })
    const mine = closing
    c.stdin.on('error', () => {})
    // A failed spawn has no pid; kill() on it would signal our own process group.
    if (c.pid) c.kill('SIGTERM')
  }

  function begin() {
    if (child || pendingStart) return
    setState('starting')
    if (!closing) return spawnNow()
    // A dying camera still holds the device: wait for it before starting the next.
    pendingStart = true
    closing.then(() => {
      if (!pendingStart || clients.size === 0) return
      pendingStart = false
      spawnNow()
    })
  }

  function spawnNow() {
    lastStderr = ''
    startedAt = Date.now()
    const c = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    child = c
    const split = createJpegSplitter((frame) => {
      if (state === 'starting') setState('on')
      for (const onFrame of clients) onFrame(frame)
    })
    c.stdout.on('data', (d) => {
      if (child === c) split(d)
    })
    c.stderr.on('data', (d) => {
      const line = String(d).trim().split('\n').pop()
      if (line) lastStderr = line
    })
    c.stdin.on('error', () => {})
    c.on('error', (err) => fail(c, err.message))
    c.on('close', (code, signal) => fail(c, lastStderr || `camera exited (${signal ?? code})`))
    armTimeout()
  }

  function fail(c, message) {
    if (child !== c) return
    child = null
    clearTimeout(timer)
    timer = null
    clients.clear()
    setState('error', message)
  }

  return {
    attach(onFrame) {
      clients.add(onFrame)
      begin()
      return () => {
        if (!clients.delete(onFrame)) return
        if (clients.size === 0 && (child || pendingStart)) {
          kill()
          setState('off')
        }
      }
    },
    stop(reason) {
      clients.clear()
      if (child || pendingStart) {
        kill()
        setState('off')
      }
    },
    shot() {
      if (child) armTimeout()
    },
    latestStill() {
      try {
        return statSync(stillPath).mtimeMs > startedAt ? stillPath : null
      } catch {
        return null
      }
    },
    state: () => ({ state, error }),
  }
}
