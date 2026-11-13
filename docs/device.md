# Device setup and gotchas

Target: **OnePlus 6 (`oneplus-enchilada`)**, postmarketOS v26.06 (systemd
variant), flashed via webflash. Developed from a Mac.

## Access

- USB networking: phone `172.16.42.1`, Mac `172.16.42.2` (interface `en5`).
- `ssh user@172.16.42.1`. Default credentials of prebuilt images are
  `user` / `147147` (changed after setup; key auth via `ssh-copy-id`).
- sshd: `doas systemctl enable --now sshd`.
- The phone needs **Wi-Fi for `apk`** — USB networking gives no internet:
  `doas nmcli device wifi connect "<SSID>" password "<pw>"`.

## Facts about this image (don't guess these)

- `doas`, not `sudo`.
- systemd, not OpenRC (`systemctl`, not `rc-service`/`rc-update`).
- Login manager is `tinydm` (`systemctl status display-manager`).

## Session setup

Packages: `cage chromium wlr-randr nodejs curl` (see the one-time setup below;
`busybox-extras` may linger from before the daemon existed — unused).

`/usr/share/wayland-sessions/calm.desktop`:

```ini
[Desktop Entry]
Name=Calm
Exec=/usr/local/bin/calm-session
Type=Application
```

Made default with:
`doas tinydm-set-session -f -s /usr/share/wayland-sessions/calm.desktop`

`/usr/local/bin/calm-session` is a symlink to `/opt/calm-daemon/calm-session`,
which lives in the repo as `daemon/calm-session` and is deployed with the
daemon. Edit it there — never hand-paste it on the phone. It starts the daemon,
waits for port 8080, then starts cage + Chromium.

Paths on the phone: shell build → `/opt/calm/`, daemon → `/opt/calm-daemon/`.

Restart the session: `doas systemctl restart tinydm`. If it reports
"Job canceled", run `doas systemctl start tinydm`.

Back to Sxmo: `ls /usr/share/wayland-sessions/`, then `tinydm-set-session`
with the Sxmo file, then restart tinydm.

## One-time setup (unattended deploys)

So `scripts/deploy.sh` (and coding agents) can deploy without passwords:

```sh
# on the Mac
ssh-copy-id user@172.16.42.1

# on the phone
doas apk add nodejs curl rsync   # rsync is optional, faster deploys
doas install -d -o user -g user /opt/calm /opt/calm-daemon
doas chown -R user:user /opt/calm /opt/calm-daemon
doas ln -sf /opt/calm-daemon/calm-session /usr/local/bin/calm-session
printf '%s\n' \
  'permit nopass user as root cmd systemctl args restart tinydm' \
  'permit nopass user as root cmd systemctl args start tinydm' \
  | doas tee /etc/doas.d/zz-calm.conf
```

For suspend (docs/architecture.md → "Screen power = suspend") the daemon
reads `/dev/input` (`user` is in the `input` group on this image) and owns
the power key. postmarketOS already sets logind's `HandlePowerKey=ignore`; if a
power key press ever shuts the phone down, check it with
`busctl get-property org.freedesktop.login1 /org/freedesktop/login1 org.freedesktop.login1.Manager HandlePowerKey`.

Then run `./scripts/deploy.sh` once from the Mac (until it has, the symlink
points at nothing and the session can't start).

Only (re)starting tinydm is passwordless; everything else still asks. The
doas rules go in `/etc/doas.d/zz-calm.conf` because the last matching rule
wins and the image's own `/etc/doas.d/` rules would otherwise override them.

## Music sync (syncd)

Music and audiobooks come from a folder on the Mac through
[syncd](https://github.com/nbaglivo/syncd) (vendored at `vendor/syncd`), one
way: the Mac publishes, the phone pulls into `~/Music`, and deletes follow.
Design: `docs/superpowers/specs/2026-11-08-sync-design.md`.

### Mac

```sh
git submodule update --init
./scripts/mac/install-syncd.sh            # publishes ~/Phone/Music
./scripts/mac/install-syncd.sh ~/Other    # or another folder
```

It installs a launchd agent (`dev.rebelphone.syncd`, starts at login,
restarted if it dies) and prints the Mac's drive key. Re-run it after
updating the submodule or changing the node version in mise (the agent pins
node's absolute path, since launchd has no mise shims). Same storage, same
key. Files are published once they haven't changed for 10 s.

- Code: `~/Library/Application Support/syncd/app`
- Storage (holds the key, keep it): `~/Library/Application Support/syncd/storage`
- Log: `~/Library/Logs/syncd.log`
- Status: `launchctl print gui/$(id -u)/dev.rebelphone.syncd | grep state`
- Stop: `launchctl bootout gui/$(id -u)/dev.rebelphone.syncd`

### Phone

`calm-syncd` (systemd, runs as `user`, starts at boot) pulls into `~/Music`
with `PUSH=0 ATOMIC=1 WIPE_GUARD=1`; `./scripts/deploy.sh` updates and
restarts it. One-time setup (needs the doas password, so run it in a real
terminal, not via `!`):

```sh
scp scripts/calm-syncd.service user@172.16.42.1:/tmp/
ssh user@172.16.42.1 'install -d ~/.config/syncd ~/.local/share/syncd ~/.local/state/syncd'
ssh -t user@172.16.42.1 doas sh -c '"apk add npm rsync &&
  install -d -o user -g user /opt/calm-syncd &&
  install -o user -g user -m 644 /tmp/calm-syncd.service /opt/calm-syncd/ &&
  systemctl link /opt/calm-syncd/calm-syncd.service && systemctl enable calm-syncd &&
  printf \"%s\n\" \"permit nopass user as root cmd systemctl args daemon-reload\"
    \"permit nopass user as root cmd systemctl args restart calm-syncd\" >> /etc/doas.d/zz-calm.conf"'
```

- Code: `/opt/calm-syncd` (+ `node_modules`, installed on the phone by deploy
  when `package-lock.json` changes)
- Config: `~/.config/syncd/env` (`PEER_KEY=<mac key>`)
- Storage (keep it): `~/.local/share/syncd`
- Status (read by the daemon): `~/.local/state/syncd/status.json`
- Logs: `journalctl -u calm-syncd -f`

**Native addons are built for musl on the Mac.** syncd's addons
(`rocksdb-native`, `sodium-native`, `udx-native`, …) only ship glibc
prebuilds; postmarketOS is musl. `gcompat` is not enough (`rocksdb-native`
segfaults). `scripts/build-musl-addons.sh` (called by deploy) builds each
`name@version` from syncd's lockfile in an arm64 Alpine container (Docker),
caches it in `.cache/musl-addons/`, and deploy copies it to
`node_modules/<name>/prebuilds/linux-arm64-musl/` and checks it loads. A syncd
dependency bump therefore needs Docker for one deploy; recipe and the two
header-drift fixes: `scripts/musl/build-addon.sh`.

### Disk use

Each side keeps one copy of the current files in syncd's storage on top of the
folder itself, so the library takes about 2× its size on the Mac and on the
phone. Deleted and replaced files have their blocks cleared; on the phone the
storage is RocksDB, which hands that space back on compaction, not right away
(`du` of `~/.local/share/syncd` doesn't drop immediately after a delete).

### Behaviour checked on the phone (2026-11-08)

- An album added on the Mac appears in Listen, no `*.tmp` in the library;
  deleting it removes the files and the library rows.
- Emptying the Mac folder is refused (`pull refused: would leave … empty`).
- A file copied slowly into the Mac folder (10 MB over ~20 s) arrives whole:
  the Mac waits until it has been unchanged for 10 s.
- Deleting the file loaded in Listen: Listen moves to another file, paused.
- Screen off mid-download: blanks (`syncing=true`); off USB it suspends ~30 s
  after the pull ends. On USB it stays blanked, as idle never suspends on USB.
- syncd frozen mid-download: its status goes stale and the phone suspends
  ~2 min later; after wake and resume the download continues from where it
  stopped and finishes (same md5).
- Over USB networking a 144 MB file takes ~7 s; over Wi-Fi ~15–20 s.

Re-checked on 2026-11-13 with the syncd from `ba6facd`:

- Redeploy keeps the drive key and storage (`CORESTORE` unchanged).
- A small file dropped on the Mac is on the phone ~16 s later (10 s of that
  is the Mac's settle time); deleting it removes it ~5 s later, from Listen too.
- After a reboot `calm-syncd` and the session come up on their own, with the
  same key, and the next dropped file arrives in ~11 s.
- After logging out of the Mac and back in, the launchd agent is running and
  a dropped file reaches the phone.
- The previous syncd segfaulted when stopped after 3 h (330 MB memory peak);
  the new one stopped cleanly once. If deploys show `status=11/SEGV` in
  `journalctl -u calm-syncd`, that's back.

### Pairing

1. Put at least one file in the Mac folder (an empty Mac folder is refused
   by the phone's wipe guard).
2. On the phone: `printf 'PEER_KEY=%s\n' <mac key> > ~/.config/syncd/env`,
   then `doas systemctl restart calm-syncd`.
3. The first sync replaces whatever is in the phone's `~/Music`.

## Gotchas we already hit

- **SSH over Wi-Fi** (USB unplugged): `ssh -o HostKeyAlias=172.16.42.1
  user@<wlan0 ip>` reuses the USB host key. Off USB the phone suspends after
  30 s idle, so start long checks right after waking it.
- **`pkill -f <pattern>` over SSH also matches the remote shell** whose command
  line contains the pattern; signal by PID instead.

- **Daemon logs** are in `~/.local/state/tinydm.log` (with cage and
  Chromium), not in the journal. `grep -E '^(screen|listen|audio|mpv):'`
  picks out the daemon's lines; every screen-off decision is logged with its
  reason, `playing` and `usb`.
- **PulseAudio exits after 20 s idle** (`exit-idle-time = 20`) and the next
  client races its autospawn: mpv then fails with "audio output
  initialization failed". The daemon keeps one `pactl subscribe` client
  running so it stays up.
- **USB networking drops for up to a minute** after `systemctl restart
  tinydm` (each deploy): SSH times out meanwhile; wait and retry.
- **Backlight** (`/sys/class/backlight/ae94000.dsi.0/brightness`, max 512 in
  use) is `root:video 664` and `user` is in `video`: the daemon can write it
  without a udev rule.
- **USB power** shows as `pmi8998-charger` (`type=USB`, `online`).
- Node on the phone is 24.x and has `node:sqlite`.

- **No sound although mpv says it's playing**: PulseAudio (not PipeWire) is
  what actually serves audio here — it autospawns on the first client — and
  its default sink is `alsa_output.platform-snd_aloop.0.analog-stereo`, a
  loopback that goes nowhere. Pick the sink explicitly:
  `mpv --audio-device=pulse/alsa_output.platform-sound.HiFi__Speaker__sink`
  (headphones: `…HiFi__Headphones__sink`). `pactl list short sinks` lists
  them; `wpctl status` shows nothing because PipeWire owns no devices.
- **`systemd-inhibit` over SSH**: "Access denied … interactive authentication"
  — polkit only grants sleep inhibitors to the active seat session, so you
  can't keep the phone awake from SSH. The daemon keeps it awake on USB power
  instead.

- **SSH times out**: the phone is probably suspended (30 s idle). Press the
  power button, and touch the screen now and then while working over SSH.
- **Measuring power**: `current_now` of `bq27411-0` is only meaningful
  unplugged (on USB it shows the charge current). Scripts that must survive
  the SSH session ending need `systemd-run --user`, not `nohup`/`setsid`.

- **Tiny window / app uses part of the screen**: caused by Chromium's
  `--force-device-scale-factor` on Wayland. Scale the output with
  `wlr-randr --scale` inside cage instead (as above).
- **`file://` doesn't work**: Chromium blocks module scripts there. Always
  serve over HTTP.
- **macOS "No route to host" on ping/ssh** with a correct route: the terminal
  app lacks the Local Network permission (System Settings → Privacy &
  Security → Local Network).
- **`'xterm-ghostty': unknown terminal type`** on the phone: copy the
  terminfo once:
  `infocmp -x xterm-ghostty | ssh user@172.16.42.1 -- tic -x -`
  (or `export TERM=xterm-256color`).
- **Black screen, journal shows `status=126` then `start-limit-hit`**: the
  session script can't be executed. tinydm's own output (e.g. `setpriv: ...
  Exec format error`) is the real error. Fix the script, then
  `doas systemctl reset-failed tinydm && doas systemctl start tinydm` —
  `restart` alone won't clear the start limit.
- **"Site can't be reached" in the kiosk**: nothing on 8080 — the daemon
  isn't running. Run `node /opt/calm-daemon/server.mjs` by hand to see why
  (e.g. `node: not found`).
- **404 page in HTML (`<TITLE>404 Not Found</TITLE>`)**: that's BusyBox
  `httpd`, not the daemon (which answers in plain text). An old session
  script is still serving the shell.
- **`doas: a tty is required`** from `deploy.sh`: the nopass rules are
  missing or overridden; see the one-time setup.
- **`warning: /usr/local/bin/calm-session is not linked`** from `deploy.sh`:
  the phone boots an old copy of the session script, not the deployed one.
  Fix with `doas ln -sf /opt/calm-daemon/calm-session /usr/local/bin/calm-session`.
- **`doas -C` is misleading**: as `user` it can't read the config; under
  `doas` it checks rules for root. Read the rule files instead.
- Battery on this device is a `bq27411`-style fuel gauge under
  `/sys/class/power_supply/`; find it by `type == Battery`, don't hardcode
  the name.
