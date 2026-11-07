# Architecture

```
┌──────────────────────────── OnePlus 6 / postmarketOS ────────────────────────────┐
│                                                                                    │
│  tinydm ─▶ calm-session ─▶ cage (Wayland, single fullscreen app)                   │
│                              └─▶ chromium --kiosk http://127.0.0.1:8080            │
│                                     │  React shell                                 │
│                                     │  GET /            (static build)             │
│                                     │  GET /events      (SSE: state → shell)       │
│                                     │  POST /actions/*  (commands → system)        │
│                                     ▼                                              │
│                              daemon (Node, 127.0.0.1:8080)                         │
│                                     │                                              │
│                 ┌───────────────────┼────────────────────┐                         │
│              sysfs files        D-Bus (system bus)    /dev/input                   │
│        /sys/class/power_supply  ModemManager, UPower,  power button,               │
│        /sys/class/backlight     NetworkManager,        volume keys                 │
│                                 feedbackd                                          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

## Daemon responsibilities

1. Serve the shell's `dist/` (with SPA fallback to `index.html`, and no path
   traversal outside the static dir).
2. Hold the current phone state in memory and push changes over SSE.
3. Accept actions from the shell and perform them on the system.
4. Later: host the P2P sync core (Hypercore/Holepunch) for local-first apps.

Config via env vars (with phone defaults), so it runs on the Mac against fixtures:

| Env                | Default                    |
| ------------------ | -------------------------- |
| `PORT`             | `8080`                     |
| `STATIC_DIR`       | `/opt/calm`                |
| `POWER_SUPPLY_DIR` | `/sys/class/power_supply`  |
| `BACKLIGHT_DIR`    | `/sys/class/backlight`     |
| `POLL_MS`          | `10000`                    |
| `INPUT_DIR`        | `/dev/input`               |
| `IDLE_MS`          | `30000` (`0`: never idle)  |
| `SUSPEND_CMD`      | `systemctl suspend`        |
| `MUSIC_DIR`        | `/home/user/Music`         |
| `STATE_FILE`       | `~/.local/state/calm/listen.json` (outside `/opt/calm-daemon`: deploy wipes it) |
| `MPV_CMD`          | `mpv` (Mac tests: `mpv --ao=null`) |
| `FFPROBE_CMD`      | `ffprobe`                  |
| `SPEAKER_SINK`     | `alsa_output.platform-sound.HiFi__Speaker__sink` |
| `HEADPHONES_SINK`  | `alsa_output.platform-sound.HiFi__Headphones__sink` |

## Event contract (`GET /events`, server-sent events)

- One SSE stream for the whole shell; the shell opens a single `EventSource`.
- Each feature is a named event. On connect, the daemon immediately sends the
  current value of every event, so the UI never waits for the first change.
- Only send when the value changed.

| Event      | Payload                                                                      | Source |
| ---------- | ---------------------------------------------------------------------------- | ------ |
| `battery`  | `{ level: 0-100 \| null, status: "Charging"\|"Discharging"\|"Full"\|"Not charging" \| null }` | sysfs `type == Battery` → `capacity`, `status` (later: UPower signals) |
| `screen`   | `{ on: boolean }` | `false` while suspending or suspended, see below |
| `listen`   | `{ current: { id, title, folder, duration } \| null, playing, position, positionAt, error: string \| null }` | the player (`daemon/listen/`); sent on changes and at most every 5 s while playing — the shell interpolates from `positionAt` (ms) |
| `library`  | `[{ id, title, folder, duration, position, lastPlayed }]`, recently played first, then unplayed by title | scan of `MUSIC_DIR` (`id` = path relative to it) |

### Listen

The daemon runs one `mpv --idle` and drives it over its JSON IPC socket
(`daemon/listen/mpv.mjs`); if mpv dies it is restarted and the current file
reloads **paused**. Positions, last-played times and the ffprobe cache live
in `STATE_FILE` (atomic JSON writes, every 5 s while playing and on every
change and SIGTERM). "Next" is the next file by path in natural order;
reached by advancing, files over 20 minutes resume their saved spot, shorter
ones start at 0. A file that fails to play shows a muted error for 5 s and is
skipped. Output always goes to an explicit PulseAudio sink (the phone's
default sink is a silent loopback, see `docs/device.md`).

### Screen power = suspend

cage 0.3 has no `wlr-output-power-management`, so the display can't be powered
off on its own (and brightness 0 measured as no saving: ~130 mA either way).
Screen off is therefore suspend (`s2idle`), which powers the panel down too.

The daemon reads every `INPUT_DIR/event*` (raw `struct input_event`). Any key
or touch (`EV_KEY`/`EV_ABS`) while on restarts the `IDLE_MS` timer; when it
fires, or on a power key press, it publishes `screen: { on: false }` and runs
`SUSPEND_CMD` (logind allows it from the active seat session). Waking: the
power key is a wakeup source. Timers stop during suspend but the wall clock
doesn't, so a jump of more than 5 s means "woke up" (from anything) and sets
`on: true`; a power key press within 2 s of a change can't send it straight
back to sleep. If no input device can be opened it never suspends.
While `screen.on` is false the shell covers itself with `.screen-off`, so
the screen looks off immediately and stray touches go nowhere.

Suspend stops audio, so `daemon/power.mjs` decides how the screen goes off:

- **Playing** (idle or power key): **blank** — `screen: { on: false }`,
  backlight to 0 (`BACKLIGHT_DIR`), no suspend. Only the power key unblanks.
  If playback stops while blanked, it suspends after `IDLE_MS`.
- **On USB or mains power** (any `POWER_SUPPLY_DIR` supply of type `USB` or
  `Mains` with `online == 1`): idle never turns the screen off; the power key
  still does.
- **Otherwise:** suspend, as above.

Volume keys (`KEY_VOLUMEUP`/`DOWN`, also while blanked) step the active
PulseAudio sink by 5 % (`pactl`). The headphone jack switch
(`EV_SW`/`SW_HEADPHONE_INSERT`) selects the headphones or speaker sink, and
unplugging pauses. The jack state at startup can't be read without an ioctl,
so the daemon starts on the speaker.

## Actions (`POST /actions/<name>`, JSON body)

Built: `screen { on: boolean }` (`false` suspends);
`listen/play { id? }` (no `id`: resume current; unknown `id` → 400),
`listen/pause`, `listen/seek { to }` (seconds, clamped to the file),
`listen/back` (−30 s), `listen/restart`, `listen/next`, `listen/rescan`.

Planned: `brightness { level }`, `call { number }`, `call/hangup`,
`sms/send { to, body }`, `suspend`. Return `204` on success, `4xx` with
`{ error }` on bad input. Validate everything — this endpoint can touch the modem.

## Shell side

- `src/hooks/useDaemonEvent.ts` — the one shared `EventSource`; `useDaemonEvent(name)`
  returns the latest payload of one event.
- `src/hooks/useBattery.ts` — the reference hook: subscribes
  to one event name. New hooks copy this shape.
- `src/components/BatteryIndicator.tsx` — the reference component.

## Roadmap

1. Daemon in `daemon/server.mjs`: static + SSE + battery (sysfs polling). ✓
2. Fixtures in `daemon/fixtures/` for running without the phone. ✓
3. Brightness (sysfs read + write action). ← next
4. Power button / suspend (`/dev/input`, logind). Idle and power key
   suspend ✓; still to do: wake for calls/SMS (modem), keep awake for
   calls and music.
5. Modem: calls + SMS via ModemManager (`dbus-next`).
6. Switch battery to UPower signals (no polling).
