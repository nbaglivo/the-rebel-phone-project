# Power and screen

## Under cage, "screen off" has to be suspend

- **Fact:** cage 0.3 has no `wlr-output-power-management`, so the panel can't
  be powered off on its own. Brightness 0 measured no saving: ~130 mA either
  way, unplugged.
- **Our choice:** screen off = `systemctl suspend` (`s2idle`), which powers
  the panel down too. logind allows it from the active seat session without
  a password.
- **Alternatives:** a compositor that supports output power management
  (newer cage, sway, a custom wlroots compositor). Then the screen can turn
  off while the CPU keeps running, which is simpler for music and calls.
- **Verified:** on the phone, 2026-10-30.
- **See:** `docs/architecture.md` → "Screen power = suspend", `daemon/power.mjs`.

## Detect idle and the power key by reading /dev/input directly

- **Fact:** `user` is in the `input` group on this image, so the daemon can
  read every `/dev/input/event*` as raw `struct input_event` records (no
  libinput, no dependencies). `EV_KEY`/`EV_ABS` = any key or touch.
- **Fact:** Nura already sets logind's `HandlePowerKey=ignore`, so the
  app owns the power key. If a press ever shuts the phone down, check it with
  `busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandlePowerKey`.
- **Gotcha:** blocking reads on input devices kept the daemon from exiting on
  SIGTERM, which stalled every session restart. Handle shutdown explicitly.
- **Verified:** on the phone, 2026-10-30 / 2026-11-07.

## Detect wake-up with a wall-clock jump

- **Fact:** timers stop during suspend, the wall clock doesn't. A jump over
  5 s between ticks means "we were asleep", whatever woke the phone.
- **Our choice:** that jump sets `screen: { on: true }`. A power key press
  within 2 s of a change is ignored, so a wake press can't send it straight
  back to sleep. If no input device opens, never suspend.
- **Verified:** on the phone, 2026-10-30.

## Suspend kills audio and network: blank instead when something is running

- **Context:** music in a pocket and a background sync both stop on suspend.
- **Our choice:** while playing or syncing, "screen off" = backlight to 0 plus
  a full-screen cover in the UI that swallows touches. Only the power key
  unblanks. When both stop, suspend after the idle timeout. On USB or mains
  power, idle never turns the screen off (the power key still does).
- **Gotcha:** a "keep awake" signal from another process must expire. syncd's
  status counts only if written in the last 2 minutes, so a crashed or
  stalled syncd can't keep the phone awake forever.
- **Fact:** the backlight
  (`/sys/class/backlight/ae94000.dsi.0/brightness`, max 512 in use) is
  `root:video 664` and `user` is in `video`, so no udev rule is needed.
- **Verified:** on the phone, 2026-11-07 / 2026-11-08.

## You can't keep the phone awake from SSH

- **Fact:** `systemd-inhibit` over SSH fails with "Access denied … interactive
  authentication". polkit grants sleep inhibitors only to the active seat
  session.
- **Our choice:** the daemon stays awake on USB power, which covers
  development. Off USB, the phone suspends after 30 s idle, so start long
  checks right after waking it, and touch the screen now and then.
- **Verified:** on the phone, 2026-11-07.

## Measure power unplugged, from a detached unit

- **Fact:** `current_now` of the fuel gauge is only meaningful unplugged. On
  USB it shows the charge current.
- **Fact:** a script that must outlive the SSH session needs
  `systemd-run --user`. `nohup`/`setsid` die with it.
- **Verified:** on the phone, 2026-10-30.
