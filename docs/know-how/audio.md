# Audio

## Find out which sound server actually runs, and name the sink explicitly

- **Fact (OnePlus 6, pmOS v26.06):** PulseAudio, not PipeWire, serves audio.
  It autospawns on the first client, and `wpctl status` shows nothing. The
  **default sink is `alsa_output.platform-snd_aloop.0.analog-stereo`, a
  loopback that goes nowhere**: mpv "plays" in silence.
- **Our choice:** always output to a named sink:
  `alsa_output.platform-sound.HiFi__Speaker__sink` or
  `…HiFi__Headphones__sink` (`pactl list short sinks` lists them).
- **Verified:** on the phone, 2026-11-07.

## Keep PulseAudio alive with one idle client

- **Fact:** PulseAudio exits after 20 s with no clients (`exit-idle-time = 20`),
  and the next client races its autospawn: mpv fails with "audio output
  initialization failed".
- **Our choice:** the daemon keeps a `pactl subscribe` running.
- **Alternatives:** change `exit-idle-time` in the PulseAudio config, which
  is system config outside the repo.
- **Verified:** on the phone, 2026-11-08.

## Drive one long-lived mpv over its JSON IPC socket

- **Our choice:** `mpv --idle` with `--input-ipc-server`, driven from the
  daemon (`daemon/listen/mpv.mjs`). `ffprobe` reads durations, cached.
  mpv decodes everything (mp3, m4b, flac, …), and its IPC is a few lines of
  Node with no dependency. If mpv dies, restart it and reload the file
  **paused**. Never start playing on its own after a crash or reboot.
- **Alternatives:** GStreamer, or an MPRIS-capable player over D-Bus.
- **Verified:** on the phone, 2026-11-07.

## Hardware keys and the headphone jack arrive on /dev/input

- **Fact:** volume keys are `KEY_VOLUMEUP`/`KEY_VOLUMEDOWN`. The jack is a
  switch event, `EV_SW`/`SW_HEADPHONE_INSERT`. Its state at startup needs an
  ioctl (`EVIOCGSW`), which plain Node can't do.
- **Our choice:** volume keys step the active sink by 5 % with `pactl`. Jack
  in → headphones sink, jack out → speaker and **pause** (never blast a
  pocket). Start on the speaker, since startup jack state is unknown.
- **Gotcha:** holding a key sends auto-repeat events (`value == 2`), which
  jumped the volume tens of percent at once. Step only on press
  (`value == 1`).
- **Verified:** on the phone, 2026-11-07 / 2026-11-08.
