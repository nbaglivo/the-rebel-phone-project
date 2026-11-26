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

  function kill() {
    clearTimeout(timer)
    timer = null
    if (!child) return
    const c = child
    child = null
    c.removeAllListeners('exit')
    c.removeAllListeners('error')
    c.stdout.removeAllListeners('data')
    c.stdin.on('error', () => {})
    c.kill('SIGTERM')
  }

  function start() {
    lastStderr = ''
    startedAt = Date.now()
    setState('starting')
    const c = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] })
    child = c
    const split = createJpegSplitter((frame) => {
      if (state === 'starting') setState('on')
      for (const onFrame of clients) onFrame(frame)
    })
    c.stdout.on('data', split)
    c.stderr.on('data', (d) => {
      const line = String(d).trim().split('\n').pop()
      if (line) lastStderr = line
    })
    c.stdin.on('error', () => {})
    c.on('error', (err) => fail(c, err.message))
    c.on('exit', (code, signal) => fail(c, lastStderr || `camera exited (${signal ?? code})`))
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
      if (!child) start()
      return () => {
        if (!clients.delete(onFrame)) return
        if (clients.size === 0 && child) {
          kill()
          setState('off')
        }
      }
    },
    stop(reason) {
      clients.clear()
      if (child) {
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
