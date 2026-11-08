// When the screen should go off, and how: suspend, or just blank so audio and sync keep going.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Suspend stops audio and network, so while something plays or syncd is
 * pulling, the screen only blanks.
 * Idle never turns the screen off while on USB power; the power key still does.
 */
export function decideScreenOff({ reason, playing, usb, syncing = false }) {
  if (reason === 'idle' && usb) return 'stay'
  return playing || syncing ? 'blank' : 'suspend'
}

const read = (path) => readFile(path, 'utf8').then((s) => s.trim(), () => null)

export async function usbOnline(powerSupplyDir) {
  let names = []
  try {
    names = await readdir(powerSupplyDir)
  } catch {}
  for (const name of names) {
    const type = await read(join(powerSupplyDir, name, 'type'))
    if ((type === 'USB' || type === 'Mains') && (await read(join(powerSupplyDir, name, 'online'))) === '1') return true
  }
  return false
}
