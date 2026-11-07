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

## Gotchas we already hit

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
- **`doas -C` is misleading**: as `user` it can't read the config; under
  `doas` it checks rules for root. Read the rule files instead.
- Battery on this device is a `bq27411`-style fuel gauge under
  `/sys/class/power_supply/`; find it by `type == Battery`, don't hardcode
  the name.
