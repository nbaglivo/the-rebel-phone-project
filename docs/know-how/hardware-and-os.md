# Hardware and OS

## A mainline-Linux phone running Nura is enough for a custom shell

- **Context:** the goal was a phone whose whole UI is our own, with no Android
  underneath.
- **Our choice:** OnePlus 6 (`oneplus-enchilada`), [Nura](https://nura.eco)
  (formerly postmarketOS) v26.06,
  **systemd variant**, flashed with webflash from a Mac. It came
  with Sxmo; we replaced the session, not the OS.
- **Why this device:** cheap second-hand, so bricking it while learning would
  cost little. It was reported to work well and was one of the recommended
  devices. For a first build, "cheap and well supported" beats "the phone you
  actually want".
- **What we'd pick next:** a Fairphone, for repairability, once one is well
  supported. When we looked (2026-11), the newer Fairphone models weren't.
  Check the current status before buying.
- **Fact:** Nura was called postmarketOS until recently. Wiki pages,
  package names and tools may still use the old name or the `pmos` prefix.
  Search both.
- **Fact:** Nura is Alpine: `apk`, **musl** libc, aarch64, BusyBox
  userland. Images come in OpenRC and systemd variants. Pick one on purpose,
  since every service and doc command differs (`systemctl` vs `rc-service`).
- **Alternatives:** any device with good mainline support on the
  Nura (postmarketOS) wiki (calls, audio, suspend all "works"). The PinePhone
  family runs the same stack, with weaker hardware. Mobian/Debian gives glibc,
  which avoids the native-addon problem in [music-sync](music-sync.md).
  Check modem, audio and suspend status on the device's wiki page before
  buying. Those are what a phone needs.
- **Verified:** on the phone, 2026-10-29.
- **See:** `docs/device.md`.

## Learn the image's facts once, write them down, never guess them

- **Fact (this image):** `doas`, not `sudo`. systemd. Login manager is
  `tinydm`. Node from `apk add nodejs` is 24.x and includes `node:sqlite`.
  PulseAudio (not PipeWire) serves audio, see [audio](audio.md).
- **Cost / gotchas:** agents default to `sudo`, OpenRC commands and PipeWire
  tools, and each wrong guess costs a round trip. Put a "facts, don't guess"
  list at the top of your agent instructions.
- **Verified:** on the phone, 2026-10-29 to 2026-11-08.

## USB networking for development, Wi-Fi for packages

- **Fact:** Nura's USB gadget gives the phone `172.16.42.1` and the
  Mac `172.16.42.2`, with **no internet** for the phone. `apk` needs Wi-Fi:
  `doas nmcli device wifi connect "<SSID>" password "<pw>"`.
- **Fact:** prebuilt images log in as `user` / `147147`. Change it, then
  `ssh-copy-id` so agents can work without passwords.
- **Gotcha:** on macOS, "No route to host" with a correct route means the
  terminal app lacks the Local Network permission (System Settings →
  Privacy & Security → Local Network).
- **Verified:** on the phone and the Mac, 2026-10-29.
