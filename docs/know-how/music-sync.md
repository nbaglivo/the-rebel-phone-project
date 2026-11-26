# Getting files onto the phone (music sync)

## One-way, peer-to-peer folder sync from the laptop

- **Context:** music and audiobooks without cables, `scp` or a file manager.
  The library is curated on the Mac only.
- **Our choice:** [syncd](https://github.com/nbaglivo/syncd) (Hyperswarm +
  Hyperdrive). The Mac publishes a folder, the phone pulls it into `~/Music`,
  and deletes follow. **One-way** on purpose: two-way sync risks deleting or
  resurrecting files when both sides race. It works on any network (DHT), with
  no server. No UI: logs only.
- **Alternatives:** Syncthing (mature, two-way, glibc binary, needs a
  config). rsync over SSH on a timer (simplest, LAN or VPN only). A
  cloud folder. P2P is the better call if you want local-first apps later.
- **Verified:** on the phone, 2026-11-08.
- **See:** `docs/device.md` → "Music sync".

## Native npm addons need musl builds, and gcompat is not enough

- **Fact:** `rocksdb-native`, `sodium-native`, `udx-native` and others ship
  glibc prebuilds only. Nura is musl. With `gcompat`,
  `rocksdb-native` segfaults.
- **Our choice:** build each `name@version` from the lockfile in an arm64
  Alpine Docker container on the Mac, cache it, copy it into
  `node_modules/<name>/prebuilds/linux-arm64-musl/`, and check it loads on
  the phone. Two headers needed fixes. A dependency bump needs Docker for
  one deploy.
- **Alternatives:** build on the phone (slow, needs a toolchain). A glibc
  distro.
- **Verified:** on the phone, 2026-11-08.
- **See:** `scripts/build-musl-addons.sh`, `scripts/musl/build-addon.sh`.

## Only show complete files

- **Our choice:** syncd writes `*.localdrive.tmp` and renames when done. The
  library scan ignores non-audio extensions and rescans 3 s after the folder
  stops changing. The Mac publishes a file only after it has been unchanged
  for 10 s, so slow copies arrive whole.
- **Our choice:** a wipe guard. A pull that would leave the folder empty is
  refused, because an empty source is more likely a mistake than intent.
- **Verified:** on the phone, 2026-11-08.

## Numbers

- 144 MB file: ~7 s over USB networking, ~15–20 s over Wi-Fi (2026-11-08).
- Disk: about **2× the library size** on each side (folder + syncd's
  storage). On the phone (RocksDB), space from deleted files comes back on
  compaction, not right away.
- An interrupted download resumes after suspend and finishes with the same
  md5.
- Small file, Mac → phone: ~11–16 s end to end, of which 10 s is the Mac's
  settle time. A delete reaches the phone in ~5 s (2026-11-13).
- Watch native addons for crashes on shutdown. One syncd version segfaulted
  (`SIGSEGV` in node) when systemd stopped it after hours of running. With
  `Restart=always` it came back, so the only sign was in the journal.

## For scans, mirroring is the wrong shape: use an archive receiver

- **Context:** notebook pages go phone → Mac. The phone is small and its
  copy is disposable; the Mac copy is the keeper.
- **Fact:** a mirror receiver makes the folder equal to the publisher's, so
  deleting a page on the phone would delete it on the Mac, and moving or
  renaming a page on the Mac would be undone (re-fetched) on the next pull.
- **Our choice:** a second syncd instance on the phone publishes `~/scans`;
  the Mac receives with `ARCHIVE=1`: copy each key once, remember it
  (`received.json`), never delete, overwrite or re-fetch. Two independent
  instances, one per direction, each with its own storage and key.
- **Alternatives:** plain `rsync`/`scp` of new files over USB or Wi-Fi is
  simpler if the phone is always reachable; a mirror is right when the
  receiver's folder should reflect the source (music).
- **Cost / gotchas:** the archive receiver can't pick up a corrected re-scan
  under the same name (it logs `archive skipped`); use new names. Unit-less
  `PEER_KEY` means publisher, so the phone's scans unit needs no env file.
- **Verified:** docs/code only so far (2026-11-26); end-to-end on the phone
  to be added.
- **See:** `docs/device.md` → Notebook, `vendor/syncd/README.md`.

## Running it as a background service on each side

- **Mac:** a launchd agent. launchd has no mise shims, so the agent pins
  node's absolute path. Re-install it after changing the node version.
- **Phone:** a systemd unit running as `user`. Storage (holds the drive key)
  and config live outside the deploy directory.
- **Verified:** Mac and phone, 2026-11-08.
