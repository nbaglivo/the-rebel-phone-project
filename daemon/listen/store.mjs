// Listen's saved state: one JSON file, written atomically. The only module that
// touches it, so moving to node:sqlite later is a swap here.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

const empty = () => ({ version: 1, current: null, files: {}, probes: {} })

export function createStore(file) {
  const store = { data: empty(), load, save }
  let chain = Promise.resolve()
  // Until load() has run, data is empty: saving it would wipe every position.
  let loaded = false

  async function load() {
    store.data = parse(await readFile(file, 'utf8').catch(() => null))
    loaded = true
  }

  function parse(text) {
    if (text === null) return empty()
    try {
      return { ...empty(), ...JSON.parse(text) }
    } catch (err) {
      console.error(`listen: ignoring unreadable ${file} (${err.message})`)
      return empty()
    }
  }

  // Serialized so two writers never share the temp file; each writes the latest data.
  function save() {
    if (!loaded) return chain
    chain = chain.then(write, write)
    return chain
  }

  async function write() {
    const tmp = `${file}.tmp`
    await mkdir(dirname(file), { recursive: true })
    await writeFile(tmp, JSON.stringify(store.data))
    await rename(tmp, file)
  }

  return store
}
