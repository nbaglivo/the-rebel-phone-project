// What one raw /dev/input event means to the daemon.

const EV_KEY = 1
const EV_ABS = 3
const EV_SW = 5
const KEY_POWER = 116
const KEY_VOLUMEUP = 115
const KEY_VOLUMEDOWN = 114
const SW_HEADPHONE_INSERT = 2

/** @returns {'power'|'volup'|'voldown'|'hp-in'|'hp-out'|'activity'|null} */
export function classifyInput(type, code, value) {
  if (type === EV_KEY) {
    if (code === KEY_POWER) return value === 1 ? 'power' : null
    // One step per press (1); auto-repeat (2) jumps tens of percent in a blink.
    if (code === KEY_VOLUMEUP) return value === 1 ? 'volup' : null
    if (code === KEY_VOLUMEDOWN) return value === 1 ? 'voldown' : null
    return 'activity'
  }
  if (type === EV_SW && code === SW_HEADPHONE_INSERT) return value ? 'hp-in' : 'hp-out'
  if (type === EV_ABS) return 'activity'
  return null
}
