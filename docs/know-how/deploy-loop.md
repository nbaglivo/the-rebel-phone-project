# The deploy loop (and letting an agent run it)

## One command, no passwords

- **Context:** coding agents deploy and test on the phone many times a day.
  Any password prompt stops them.
- **Our choice:** `scripts/deploy.sh` builds the UI, rsyncs the UI and the
  daemon into `/opt/calm` and `/opt/calm-daemon` (owned by `user`), and
  restarts the session. One-time setup: SSH key, directories owned by
  `user`, and **narrow** `doas` nopass rules (only `systemctl restart|start
  tinydm` and the sync service). Everything else still asks.
- **Gotcha:** `doas` uses the **last matching rule**, so the image's own
  `/etc/doas.d/` rules override yours. Name the file `zz-…conf`.
- **Gotcha:** `doas -C` is misleading: as `user` it can't read the config,
  and under `doas` it checks root's rules. Read the files instead.
- **Gotcha:** `doas: a tty is required` from a script = the nopass rule
  is missing or overridden.
- **Verified:** on the phone, 2026-10-30.
- **See:** `docs/device.md` → "One-time setup".

## Expect the connection to drop

- **Fact:** USB networking drops for up to a minute after each
  `systemctl restart tinydm`. Wait and retry.
- **Fact:** off USB power the phone suspends after 30 s idle. An SSH timeout
  usually means it's asleep.
- **Fact:** SSH over Wi-Fi with the USB host key:
  `ssh -o HostKeyAlias=172.16.42.1 user@<wlan0 ip>`.
- **Verified:** on the phone, 2026-10-30 / 2026-11-08.

## Know where the logs are

- **Fact:** the session's stdout/stderr (cage, Chromium, the daemon) goes to
  `~/.local/state/tinydm.log`, not the journal. `journalctl -u tinydm` only
  has systemd's lines.
- **Our choice:** prefix daemon logs per area (`screen:`, `listen:`,
  `audio:`, `mpv:`) and log every screen-off decision with its reason.
  Power bugs are impossible to debug otherwise.
- **Verified:** on the phone, 2026-11-07.

## Small remote-shell traps

- `pkill -f <pattern>` over SSH also kills the remote shell whose command
  line contains the pattern. Signal by PID.
- Ghostty's `TERM` is unknown on the phone. Copy it once:
  `infocmp -x xterm-ghostty | ssh user@172.16.42.1 -- tic -x -`.
- **Verified:** on the phone, 2026-10-30.
