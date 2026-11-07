// Backlight off and back on, for blanking the screen without suspending.
// Needs write access to brightness (udev rule in docs/device.md).

import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export function createBacklight(dir) {
  let saved = null
  let warned = false

  const warn = (err) => {
    if (!warned) console.error(`backlight: ${err.message}`)
    warned = true
  }

  async function brightnessFile() {
    const [name] = (await readdir(dir)).sort()
    if (!name) throw new Error(`no backlight in ${dir}`)
    return join(dir, name, 'brightness')
  }

  async function blank() {
    try {
      const file = await brightnessFile()
      const level = (await readFile(file, 'utf8')).trim()
      if (level !== '0') saved = level
      await writeFile(file, '0')
    } catch (err) {
      warn(err)
    }
  }

  async function restore() {
    if (saved == null) return
    try {
      await writeFile(await brightnessFile(), saved)
    } catch (err) {
      warn(err)
    }
  }

  return { blank, restore }
}
