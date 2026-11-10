# Session and kiosk: one full-screen UI on boot

## A web UI in Chromium, inside cage, as the login session

- **Context:** we wanted to write the UI fast, in React, iterate in a desktop
  browser, and have nothing else on screen.
- **Our choice:** `tinydm` → our session script → `cage` (a Wayland
  compositor that shows exactly one fullscreen app) → `chromium --kiosk
  --app=http://127.0.0.1:8080`. Packages: `cage chromium wlr-randr`.
- **Alternatives:** a native toolkit (GTK/Qt/Flutter) avoids Chromium's
  memory and startup cost and can use Wayland protocols directly. WebKit
  (`cog`/WPE) is a lighter web kiosk. A full mobile shell (Phosh, Sxmo,
  Plasma Mobile) if you want to customise rather than replace it. Web is the
  better call when the UI changes daily and you develop on a laptop.
- **Cost / gotchas:** cage is minimal on purpose and lacks some protocols,
  e.g. output power management (see [power-and-screen](power-and-screen.md)).
- **Verified:** on the phone, 2026-10-29.
- **See:** `daemon/calm-session`, `docs/device.md` → "Session setup".

## Register the session as a wayland-session file and make it the default

- **Fact:** tinydm starts what a `.desktop` file in
  `/usr/share/wayland-sessions/` says. Make it default with
  `doas tinydm-set-session -f -s /usr/share/wayland-sessions/<name>.desktop`.
  Going back to Sxmo is the same command with Sxmo's file.
- **Our choice:** `Exec=` points to `/usr/local/bin/calm-session`, a symlink
  to the deployed copy of `daemon/calm-session`. The script lives in the repo
  and is deployed like any code, never hand-edited on the phone.
- **Gotcha:** black screen with `status=126` then `start-limit-hit` in the
  journal means the script can't be executed. tinydm's own output (in
  `~/.local/state/tinydm.log`) has the real error. Fix it, then
  `doas systemctl reset-failed tinydm && doas systemctl start tinydm`;
  `restart` alone won't clear the start limit.
- **Verified:** on the phone, 2026-10-30.

## Scale the output with wlr-randr, not Chromium flags

- **Fact:** the OnePlus 6 panel is 1080×2280. At scale 2.5 that's ~432×912
  CSS px, a normal phone viewport.
- **Gotcha:** Chromium's `--force-device-scale-factor` on Wayland gives a tiny
  window in part of the screen. Run
  `wlr-randr --output <first output> --scale 2.5` inside cage before Chromium.
- **Verified:** on the phone, 2026-10-29.

## Serve the UI over HTTP and wait for it before starting the browser

- **Fact:** Chromium blocks module scripts (Vite's output) on `file://`.
- **Fact:** if the kiosk loads before the server is up, it shows "site can't
  be reached" and never retries.
- **Our choice:** the session script starts the daemon, polls
  `curl http://127.0.0.1:8080/` for up to 10 s, then `exec`s cage. Flags:
  `--ozone-platform=wayland --no-first-run --noerrdialogs --disable-pinch`.
- **Cost / gotchas:** a BusyBox `httpd` served the shell before the daemon
  existed. Its HTML 404 page is the sign an old session script is still running.
- **Verified:** on the phone, 2026-10-30.
