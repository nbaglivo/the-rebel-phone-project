# System access: how the UI talks to the phone

## A thin UI and a local daemon that owns all system access

- **Context:** a browser can't read sysfs, open `/dev/input`, run `mpv` or
  talk to D-Bus. We also wanted the UI to run on a laptop against fake data.
- **Our choice:** a Node daemon on `127.0.0.1:8080` serves the built UI and
  is the only thing that touches the system. UI → daemon: `POST /actions/*`
  (JSON). Daemon → UI: one SSE stream, `GET /events`, one named event per
  feature. Each feature is one event plus one `useX()` hook, and nothing else.
- **Why SSE:** one-way push is all the UI needs. `EventSource` reconnects by
  itself, and SSE is plain HTTP, so no library on either side.
- **Rules that paid off:** on connect, send the current value of every event,
  so the UI never waits for a first change. Send only on change. Validate
  every action body, since actions will reach the modem.
- **Alternatives:** WebSocket (two-way, needs a library or more code). A
  native shell calling D-Bus directly (no daemon at all). Chromium flags or
  extensions that expose system APIs (we found none worth it).
- **Cost / gotchas:** the first battery indicator used the browser Battery
  API. We moved it to the daemon (sysfs) so every feature has one source and
  one transport.
- **Verified:** on the phone, 2026-10-29.
- **See:** `docs/architecture.md`, `src/hooks/useDaemonEvent.ts`,
  `src/hooks/useBattery.ts` (the template for new hooks).

## Keep the daemon dependency-free; put anything with dependencies in its own service

- **Fact:** npm packages with native addons rarely ship musl/aarch64 builds
  (see [music-sync](music-sync.md)). Plain `.mjs` with no build step deploys
  with a copy.
- **Our choice:** zero npm dependencies in the daemon (allowed exception:
  `dbus-next`). Music sync (syncd, many native deps) runs as its own systemd
  service, and the daemon reads its status file.
- **Alternatives:** bundle and cross-compile everything. That's more build
  machinery for little gain at this size.
- **Verified:** on the phone, 2026-11-08.

## Listen on localhost only

- **Our choice:** bind `127.0.0.1`, never `0.0.0.0`. Actions can suspend the
  phone and will place calls. Nothing on the network should reach them.

## Make every system path an env var, with fixtures for the laptop

- **Our choice:** `POWER_SUPPLY_DIR`, `BACKLIGHT_DIR`, `INPUT_DIR`,
  `SUSPEND_CMD`, `MPV_CMD`, … default to the phone's paths. On the Mac they
  point to `daemon/fixtures/`, so the daemon and its tests run without the
  phone. Example:
  `STATIC_DIR=dist POWER_SUPPLY_DIR=daemon/fixtures/power_supply node daemon/server.mjs`.
- **Cost / gotchas:** fixtures only prove the logic. Several bugs showed up
  only on the phone (audio sinks, PulseAudio exiting, SIGTERM while blocked
  on `/dev/input` reads). Always verify on the device.
- **Verified:** Mac and phone, 2026-10-29 to 2026-11-08.

## Find hardware by type, not by name

- **Fact:** the OnePlus 6 battery is a `bq27411` fuel gauge and USB power is
  `pmi8998-charger` (`type=USB`, `online`). Names differ per device.
- **Our choice:** pick the `/sys/class/power_supply/*` entry with
  `type == Battery`. "On external power" means any supply of type `USB` or
  `Mains` with `online == 1`.
- **Verified:** on the phone, 2026-10-29.

## Keep persistent state outside the deploy directory

- **Gotcha:** deploy is `rsync --delete` into `/opt/calm*`, which wipes
  anything the app wrote there.
- **Our choice:** state lives in `~/.local/state/…` (e.g. Listen positions in
  `~/.local/state/calm/listen.json`, written atomically).
- **Verified:** on the phone, 2026-11-07.
