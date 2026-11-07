// Output sink and volume. On the phone PulseAudio's default sink is the silent
// snd_aloop loopback, so the sink is always chosen explicitly (docs/device.md).

import { execFile, spawn } from 'node:child_process'

export const SPEAKER_SINK = process.env.SPEAKER_SINK ?? 'alsa_output.platform-sound.HiFi__Speaker__sink'
export const HEADPHONES_SINK = process.env.HEADPHONES_SINK ?? 'alsa_output.platform-sound.HiFi__Headphones__sink'
const VOLUME_STEP = 5

const run = (cmd, args) =>
  new Promise((resolve, reject) =>
    execFile(cmd, args, (err, out, stderr) => (err ? reject(new Error(stderr.trim() || err.message)) : resolve(out))),
  )

export function createAudio({ mpv, pactl = 'pactl' }) {
  let active = SPEAKER_SINK

  async function setSink(name) {
    active = name
    try {
      await mpv.command('set_property', 'audio-device', `pulse/${name}`)
    } catch (err) {
      console.error(`audio: can't select ${name}: ${err.message}`)
    }
  }

  /** One volume step up (+1) or down (-1) on the active sink, kept within 0–100 %. */
  async function stepVolume(direction) {
    try {
      const out = await run(pactl, ['get-sink-volume', active])
      const now = Number.parseInt(out.match(/(\d+)%/)?.[1] ?? '', 10)
      if (!Number.isFinite(now)) throw new Error(`unexpected pactl output: ${out.trim()}`)
      const level = Math.max(0, Math.min(100, now + direction * VOLUME_STEP))
      await run(pactl, ['set-sink-volume', active, `${level}%`])
    } catch (err) {
      console.error(`audio: volume change failed: ${err.message}`)
    }
  }

  // PulseAudio exits after 20 s without clients (exit-idle-time) and the next
  // play races its autospawn. One idle `pactl subscribe` client keeps it up.
  function keepServerAlive() {
    let missing = false
    const child = spawn(pactl, ['subscribe'], { stdio: 'ignore' })
    child.on('error', (err) => {
      missing = true
      console.error(`audio: can't keep PulseAudio up: ${err.message}`)
    })
    child.on('exit', () => {
      if (!missing) setTimeout(keepServerAlive, 5_000).unref()
    })
  }

  return { setSink, stepVolume, keepServerAlive, activeSink: () => active }
}
