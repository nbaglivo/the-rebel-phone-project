// The audio files under MUSIC_DIR: scanning, ordering, and where playback goes next.

import { readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join, posix } from 'node:path'

export const AUDIO_EXTS = new Set(['.mp3', '.m4b', '.m4a', '.flac', '.ogg', '.opus', '.wav'])

// Files longer than this are books: reaching one by advancing resumes its saved spot.
const LONG_FILE_S = 1200

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** Natural order, one path segment at a time, so a folder's files stay together. */
export function comparePaths(a, b) {
  const as = a.split('/')
  const bs = b.split('/')
  for (let i = 0; i < Math.min(as.length, bs.length); i++) {
    const c = collator.compare(as[i], bs[i])
    if (c !== 0) return c
  }
  return as.length - bs.length
}

/** Every audio file under `dir` as `{ id, size, mtimeMs }`, id relative to `dir`. */
export async function scanMusic(dir) {
  const found = []
  async function walk(rel) {
    let entries
    try {
      entries = await readdir(join(dir, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const id = rel ? posix.join(rel, e.name) : e.name
      if (e.isDirectory()) await walk(id)
      else if (e.isFile() && AUDIO_EXTS.has(extname(e.name).toLowerCase())) {
        const s = await stat(join(dir, id))
        found.push({ id, size: s.size, mtimeMs: s.mtimeMs })
      }
    }
  }
  await walk('')
  return found.sort((a, b) => comparePaths(a.id, b.id))
}

export function nextId(ids, id) {
  const i = ids.indexOf(id)
  return i === -1 || i === ids.length - 1 ? null : ids[i + 1]
}

export function displayTitle(id, tagTitle) {
  const tag = tagTitle?.trim()
  return tag || basename(id, extname(id))
}

export function folderOf(id) {
  const d = dirname(id)
  return d === '.' ? '' : d
}

/** Where a file starts: tap/▶ resumes; advancing resumes only long files. */
export function startPosition({ duration, position }, how) {
  if (how === 'resume') return position
  return duration != null && duration > LONG_FILE_S ? position : 0
}

export function displayOrder(entries) {
  const played = entries.filter((e) => e.lastPlayed != null).sort((a, b) => b.lastPlayed - a.lastPlayed)
  const unplayed = entries.filter((e) => e.lastPlayed == null).sort((a, b) => collator.compare(a.title, b.title))
  return [...played, ...unplayed]
}
