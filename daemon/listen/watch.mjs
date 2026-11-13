// Rescans the library when files under MUSIC_DIR change (syncd, scp, anything).
// syncd writes each file as `<name>.N.localdrive.tmp` and renames it when done,
// so tmp events are ignored: a track shows up once, when it is complete.

import { watch } from 'node:fs'
import { mkdir } from 'node:fs/promises'

const TMP_SUFFIX = '.localdrive.tmp'

export async function watchLibrary(dir, onChange, { debounceMs = 3000 } = {}) {
  await mkdir(dir, { recursive: true })
  let timer
  let running = false
  let again = false

  async function run() {
    if (running) {
      again = true
      return
    }
    running = true
    try {
      await onChange()
    } catch (err) {
      console.error(`listen: rescan after a change failed: ${err.message}`)
    } finally {
      running = false
    }
    if (again) {
      again = false
      run()
    }
  }

  const watcher = watch(dir, { recursive: true }, (_event, filename) => {
    if (filename && String(filename).endsWith(TMP_SUFFIX)) return
    clearTimeout(timer)
    timer = setTimeout(run, debounceMs)
  })
  watcher.on('error', (err) => console.error(`listen: watching ${dir} failed: ${err.message}`))

  return {
    close() {
      clearTimeout(timer)
      watcher.close()
    },
  }
}
