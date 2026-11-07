// Title tag and duration of one file, via ffprobe.

import { execFile } from 'node:child_process'

export function probe(path, cmd = 'ffprobe') {
  return new Promise((resolve) => {
    execFile(cmd, ['-v', 'error', '-print_format', 'json', '-show_format', path], (err, out) => {
      if (err) return resolve({ title: null, duration: null })
      try {
        const { format = {} } = JSON.parse(out)
        const tags = format.tags ?? {}
        const key = Object.keys(tags).find((k) => k.toLowerCase() === 'title')
        const duration = Number.parseFloat(format.duration)
        resolve({ title: key ? tags[key] : null, duration: Number.isFinite(duration) ? duration : null })
      } catch {
        resolve({ title: null, duration: null })
      }
    })
  })
}
