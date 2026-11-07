# Listen: play audio files from ~/Music

Date: 2026-11-07. Status: design, approved in brainstorming.

## Intent

Nico wants the phone to play his own audio files, songs and audiobooks alike,
both at home through the speaker and on walks with headphones. The fake
`Music` screen becomes **Listen** (it sits next to `read` in the launcher).
It has to behave like a good audiobook player even for music: every file
remembers where you stopped, and the phone keeps playing in a pocket.

## Goals

- Play any `mp3` / `m4b` (and whatever else mpv decodes: `m4a`, `flac`, `ogg`…)
  under `~/Music`, subfolders included.
- One flat list, most recently played first; never-played files after them,
  sorted by name *(builder's call: case-insensitive by display title)*.
- Resume: opening Listen shows the last-played file, paused at its saved
  position; ▶ resumes it.
- Every file remembers its position. A file that plays to the end resets to
  0:00 *(Claude's call, confirmed in playback)*.
- When a file ends, the next one starts. **"Next" means the next file by path
  in name order** (natural sort, so `ch2` < `ch10`): `ch05 → ch06`, and after
  a folder's last file, the first file of the next folder. It ignores the
  recently-played list, so a book never plays backwards after a pause. After
  the very last file, playback stops (paused at the end, position reset).
  ⏭ uses the same rule.
- Where a file starts when reached by auto-advance or ⏭: **files longer than
  20 minutes** (books) resume at their saved position; shorter files (songs)
  start at 0:00. Tapping a row or pressing ▶ always resumes the saved spot.
- Controls: ⏮ restart file, **−30 s**, play/pause, ⏭ next file, tap the
  progress bar to seek.
- Music keeps playing with the screen off; the phone does not suspend while
  something plays. Paused → normal idle suspend again.
- Hardware volume keys change the volume, also with the screen blanked.
- Headphone unplug pauses (never falls back to the speaker in a pocket).
- Output: phone speaker and headphone jack.
- Whole shell moves to a cream paper background (separate commit, see below).

## Non-goals (for now)

- Bluetooth audio (next iteration).
- Chapter navigation inside m4b (⏮/⏭ stay file-level).
- Playlists, shuffle, repeat, search, folders view, cover art, speed control.
- SQLite. State goes in a JSON file behind one module; SQLite (`node:sqlite`,
  built into Node, so no npm dependency) can replace it later.
- Real panel power-off while playing (needs a newer cage).

## Anti-goals

- Starting playback on its own: after a reboot, redeploy, crash or battery
  death, Listen comes back **paused** at the saved spot.
- Losing an audiobook position (more than a few seconds).
- Playing out of the speaker after headphones are pulled.
- Pocket touches doing anything while the screen is blanked.
- Badges, red dots, animated equalisers, toasts. Errors are a quiet muted line.

## Constraints (from AGENTS.md and the device)

- Shell never touches the system; daemon owns playback. New SSE events + new
  `POST /actions/*`, nothing else. A `useListen()`-style hook, copying the
  `useBattery` shape.
- Daemon: plain `.mjs`, zero npm deps, listens on `127.0.0.1` only.
- Phone (checked 2026-11-07): `mpv` 0.41 and `ffprobe` installed; PipeWire +
  WirePlumber are enabled as user services and socket-activate on demand; mpv
  sees separate **Speaker** and **Headphones** sinks. `~/Music` is currently
  empty (Nico will copy mostly mp3 and m4b). Not yet verified: that the
  speaker actually makes sound, and whether the phone's Node has `node:sqlite`.
- Screen 432×912 CSS px, touch only, no hover.
- `deploy.sh` does `rsync --delete` into `/opt/calm-daemon`, so persistent
  state must **not** live there.

## Decisions

### Playback lives in the daemon, via mpv *(Claude's call)*

- The daemon spawns one long-lived `mpv --idle --no-video --input-ipc-server=<socket>`
  and drives it over mpv's JSON IPC (unix socket; Node's `net` is enough).
  Playback continues while the shell is on another screen and is in the same
  process that decides about suspend.
- mpv plays through PipeWire (default output). If mpv dies, the daemon
  restarts it and comes back paused at the last saved position.
- Config via env vars, documented in `docs/architecture.md` like the others:
  `MUSIC_DIR` (default `/home/user/Music`), `STATE_FILE` (default
  `~/.local/state/calm/listen.json`), `MPV_CMD` (default `mpv`).

### Library

- Walk `MUSIC_DIR` recursively for audio extensions; ignore hidden files.
- A file's id is its path relative to `MUSIC_DIR`. Actions only accept ids
  present in the current library (no paths from the shell reach the
  filesystem or mpv unchecked).
- Display title: the `title` tag when present, else the file name without
  extension. Folder: the relative directory, shown muted.
- Duration and title come from `ffprobe`, cached in the state file keyed by
  id + size + mtime so a big library is probed only once.
- Rescan when Listen opens *(builder's call how: on demand action, or
  `fs.watch`; on-demand is enough since files arrive via scp/rsync)*.
- Missing files (deleted since) drop out of the list; their saved position can
  be forgotten.

### Saved state (one JSON file, one module)

- Per file: `position` (seconds), `lastPlayed` (timestamp). Plus: the current
  file id and the probe cache. No queue is stored: "next" is derived from the
  library's path order.
- Written every ~5 s while playing, and on pause, seek, file change, and
  shutdown (SIGTERM from `systemctl restart tinydm`).
- Atomic write: temp file + `rename`. Corrupt or missing file → start empty,
  log once.
- Only this module touches the file, so moving to SQLite later is a swap.

### Sleep, blanking and the power key

Today "screen off" = suspend (s2idle), and suspend stops audio. While playing:

- The idle timeout or the power key **blanks** instead of suspending: publish
  `screen: { on: false }` (the shell already covers itself with
  `.screen-off`) and set the backlight to 0. The phone stays awake.
- Blanked: touches are ignored; volume keys work; the power key unblanks
  (restore previous brightness).
- Pausing (button, headphone unplug, end of the list) while blanked or idle
  goes back to today's path: idle timer → suspend.
- Cost, told to Nico: the panel draws ~130 mA at brightness 0 too, so
  listening costs about as much as a lit screen.
- Backlight write needs permission on `/sys/class/backlight/*/brightness`
  (udev rule or group, recorded in `docs/device.md`). This overlaps roadmap
  item 3 (brightness); building the minimal write here is fine.

### Volume keys and headphone unplug

- The daemon already reads every `/dev/input/event*`. Add `KEY_VOLUMEUP`
  (115) / `KEY_VOLUMEDOWN` (114): step the system output volume *(suggested:
  `wpctl set-volume @DEFAULT_AUDIO_SINK@ 5%+/-`, capped at 100%; builder
  verifies `wpctl` is on the phone)*. Volume keys don't reset the idle timer
  more than other keys do and never wake a suspended phone.
- Headphone unplug: `EV_SW` (5) `SW_HEADPHONE_INSERT` (2) value 0 → pause.
  If the jack switch doesn't show up on this device, fall back to watching the
  PipeWire default sink / route change; builder confirms which works.
- Plugging in does not auto-play.

### Broken files

- If mpv can't open or decode a file (load error / `end-file` with
  `reason: error`): log the file and error, show a muted
  "can't play <title>" line in place of the status line for a few seconds,
  skip to the next file. Nothing is deleted. If every file in the queue
  fails, stop paused.

### Events and actions

Suggested shape; builder may refine, but it must be documented in
`docs/architecture.md`.

- `listen` event: `{ current: { id, title, folder, duration } | null,
  playing, position, positionAt, error: string | null }`. Publish on changes
  plus at most every few seconds while playing; the shell interpolates
  `position` from `positionAt` so the bar moves smoothly without 1 Hz SSE.
- `library` event: `[{ id, title, folder, duration, position, lastPlayed }]`
  already sorted as displayed.
- Actions (all `POST /actions/listen/...` or `listen-*`, validated, 204 /
  400 like `screen`): `play { id? }` (no id = resume current), `pause`,
  `seek { to }` (seconds, clamped), `back` (−30 s, clamped at 0),
  `restart`, `next`, `rescan`.

### Listen screen (layout A, chosen from mockups)

Top to bottom, in today's shell style:

- Back + time (existing `Back`).
- `Listen` title.
- Status line, mono muted: `paused` / `now playing` / the error line.
- Current file title, folder muted below.
- Thin progress bar (tap = seek), elapsed and total time in mono.
  Times over an hour as `h:mm:ss`.
- Transport: ⏮ · −30 · round ▶/⏸ · ⏭.
- The flat list: current file bold, each row with its saved position in small
  mono (blank if never played or finished). Tap = play from saved position.
- Empty library: one muted line saying to copy files into `~/Music`.
- Never played anything: the top shows the first file in the list, paused at 0.

The launcher entry `music` becomes `listen`; `src/apps/Music.tsx` and the seed
tracks go.

### Cream paper (whole shell, separate commit)

- Light theme `--bg: #f1eadb`, `--ink: #3b362d`, `--muted: #776e5e`,
  `--line: #ddd3bf`, `--on-ink` follows `--bg`. Dark theme unchanged.
- A faint paper grain over the background. Prefer a small pre-rendered,
  tiled image over a live SVG filter (cheap on the phone's GPU); grain must
  stay subtle enough not to hurt text contrast.

## Verifying

- Mac: run the daemon with `MUSIC_DIR` pointing at a fixtures folder of tiny
  generated audio files (a few seconds each, one "broken" file) and mpv from
  Homebrew; `curl -N localhost:8080/events`, drive actions with `curl`.
- Phone: copy a couple of real mp3/m4b files, `./scripts/deploy.sh`, then
  check speaker sound, headphones, unplug → pause, volume keys, blank while
  playing (no suspend), pause → suspends after idle, redeploy mid-book →
  comes back paused at the right spot.

## Left to the builder

- Exact event/action names and payload details within the shape above.
- Probe and rescan mechanics, the mpv restart backoff.
- Icon for −30 (text `−30` in mono is fine).
- Fixture audio generation (`ffmpeg` on the Mac or committed tiny files).
