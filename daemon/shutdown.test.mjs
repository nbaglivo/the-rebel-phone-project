import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, open, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const DAEMON = fileURLToPath(new URL('./server.mjs', import.meta.url))
const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url))

// /dev/input reads block a libuv pool thread; SIGTERM (every deploy) must still
// save state and exit promptly instead of waiting on that thread forever.
test('SIGTERM saves state and exits while an input device read is blocked', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'calm-shutdown-'))
  execFileSync('mkfifo', [join(dir, 'event0')])
  const keepOpen = await open(join(dir, 'event0'), 'r+')
  const stateFile = join(dir, 'state.json')
  const child = spawn(process.execPath, [DAEMON], {
    env: {
      ...process.env,
      PORT: '18093',
      STATIC_DIR: dir,
      POWER_SUPPLY_DIR: join(FIXTURES, 'power_supply'),
      INPUT_DIR: dir,
      MUSIC_DIR: join(FIXTURES, 'music'),
      STATE_FILE: stateFile,
      MPV_CMD: 'mpv --ao=null',
      IDLE_MS: '0',
    },
    stdio: 'ignore',
  })
  try {
    await new Promise((r) => setTimeout(r, 2_500))
    child.kill('SIGTERM')
    const exited = await Promise.race([
      once(child, 'exit').then(() => true),
      new Promise((r) => setTimeout(() => r(false), 4_000)),
    ])
    assert.equal(exited, true, 'daemon still running 4 s after SIGTERM')
    const saved = JSON.parse(await readFile(stateFile, 'utf8'))
    assert.equal(saved.version, 1)
  } finally {
    child.kill('SIGKILL')
    await keepOpen.close()
  }
})
