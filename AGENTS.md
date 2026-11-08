# The Rebel Phone Project

A minimal, "calm" phone UI (Light Phone–like) written in React, running as the
entire user interface of a OnePlus 6 (`oneplus-enchilada`) on postmarketOS.
There is no desktop environment underneath: the shell IS the phone.

## Architecture (one line)

React shell (Chromium kiosk, inside `cage`) ⇄ HTTP/SSE on `127.0.0.1:8080` ⇄
local Node daemon ⇄ the system (sysfs files, D-Bus services).

- The **shell** is a thin UI. It never talks to the system directly; it only
  uses `/events` (SSE) and `POST /actions/*` on the daemon.
- The **daemon** serves the built shell AND owns all system access.
- Details, event contract and roadmap: `docs/architecture.md`.

## Repo layout

- `/` — the React shell (Vite). Build output: `dist/`.
- `daemon/` — the Node daemon (to be built). See `docs/architecture.md`.
- `scripts/deploy.sh` — build + copy to the phone + restart the session.
- `docs/device.md` — how the phone is set up, and every gotcha we hit.

## Hard constraints

- **Daemon: Node, zero npm dependencies** where reasonable (it runs on Alpine
  aarch64 via `apk add nodejs`). Exception allowed: `dbus-next` for D-Bus.
  Plain `.mjs`, no build step for the daemon.
- **Daemon listens on `127.0.0.1` only.** Never `0.0.0.0`.
- The shell must be served over HTTP by the daemon, not opened from `file://`
  (Chromium blocks Vite's module scripts on `file://`).
- Every system feature follows the same pattern: daemon reads/pushes an SSE
  event → shell gets a `useX()` hook. Don't invent a second transport.
- Design for a 1080×2280 portrait touch screen at scale 2.5 (~432×912 CSS px).
  No hover-dependent UI. Calm: no badges, no red dots, no animation for its own sake.

## The phone (target device)

- Reach it: `ssh user@172.16.42.1` (USB) — key auth is set up.
- Privilege: **`doas`, not `sudo`**. Init: **systemd**. Packages: **`apk`**.
- Session: `tinydm` → `/usr/local/bin/calm-session` (symlink to the deployed
  `daemon/calm-session`) → `cage` → Chromium kiosk.
- Logs: the session (cage, Chromium, the daemon's stdout/stderr) writes to
  `~/.local/state/tinydm.log`; `journalctl -u tinydm -b` only has systemd's lines.

## Verifying work

- Daemon without a phone: run it against fake sysfs
  (`STATIC_DIR=dist POWER_SUPPLY_DIR=daemon/fixtures/power_supply node daemon/server.mjs`) and
  `curl -N localhost:8080/events`.
- On the phone: `./scripts/deploy.sh`, then
  `ssh user@172.16.42.1 'curl -sN --max-time 3 localhost:8080/events'`.
- Never assume it works on the phone because it works on the Mac.
