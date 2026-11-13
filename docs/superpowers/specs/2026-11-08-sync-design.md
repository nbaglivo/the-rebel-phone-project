# Sync: music and audiobooks from the Mac to the phone

Date: 2026-11-08. Status: design, from brainstorming.

## Intent

Nico wants to get music and audiobooks onto the phone without cables, file
managers or `scp`. He manages one folder on his Mac; the phone's Listen
library mirrors it. He drops an album in, it shows up on the phone; he deletes
a finished audiobook, it disappears from the phone. The transport is his own
[syncd](https://github.com/nbaglivo/syncd) (Hyperswarm + Hyperdrive), which
also starts the "P2P sync core" item on the architecture roadmap.

## Goals

- **Drop and forget.** A file added to the Mac folder appears in the phone's
  library with no further action, whenever both machines are online (any
  network: Hyperswarm finds peers over the internet via its DHT).
- **Deletes propagate.** A file deleted on the Mac is removed from the phone,
  and drops out of the library.
- **One-way: Mac → phone.** Nico never adds files on the phone. Nothing
  flows phone → Mac.
- **Only complete files are visible.** A half-downloaded file never appears in
  the library. Completeness is per file: an album may appear track by track
  (Nico: fine).
- **A running sync keeps the phone awake** (Nico's call, made in the review
  doc). While a pull is in progress, screen-off blanks instead of suspending,
  like during playback; when the sync finishes, the phone suspends as usual.
  Sync still only *starts* while the phone is awake: nothing wakes it on a
  timer.
- **Survives suspend.** A download interrupted by suspend resumes after
  wake and finishes; it doesn't restart from zero or hang.
- **Best effort on any network.** If Hyperswarm can't connect (hostile NAT,
  no internet), it logs and retries; no relay or fallback path *(Claude's
  call)*.
- **Mac side runs in the background** as a launchd agent: always on, starts at
  login.
- **Phone side starts at boot** as a systemd service, installed by
  `scripts/deploy.sh`.

## Non-goals

- Any UI: no "syncing…" indicator, no progress, no counts. **Logs only**
  (Nico's call). When something seems stuck, he SSHes in and reads the logs.
- Excluding some files from sync. That is a syncd feature, tracked in
  [nbaglivo/syncd#1](https://github.com/nbaglivo/syncd/issues/1).
- Syncing anything else (Listen positions, notes, …).
- Adding or editing files on the phone.

## Anti-goals

- A sync that deletes or resurrects files because two sides race each other.
  This is why it's one-way (see below).
- Partial files in the library, or the player choking on one.
- Disk use on the phone that keeps growing after files are deleted on the Mac.
- Breaking the repo's constraints: the daemon stays dependency-free, listens
  on `127.0.0.1` only, and the shell still only talks to the daemon.

## Constraints

- Phone: OnePlus 6, postmarketOS (Alpine, **aarch64, musl**), systemd, `doas`,
  `apk`. Node from `apk add nodejs`.
- syncd needs npm packages with native addons (`sodium-native`, `udx-native`,
  `rocksdb-native`). They must work on Alpine aarch64 musl.
- Hyperswarm needs internet for DHT bootstrap: the phone must be on Wi-Fi
  (USB networking has no internet, see `docs/device.md`).
- `deploy.sh` wipes `/opt/calm*` with `rsync --delete`: syncd's storage (which
  holds its drive key) and config must live outside it.
- The daemon's dependency rule (`AGENTS.md`) applies to the daemon only. syncd
  runs as its **own process and service**, not inside the daemon *(Claude's
  call)*.
- Existing Listen behaviour (`docs/superpowers/specs/2026-11-07-listen-design.md`)
  stays as-is. The player already handles a rescan that removes the current
  file, and the scan already lists only audio extensions (so
  `*.localdrive.tmp` files are ignored).

## How it works (decided)

### One-way via syncd's existing halves

syncd today is symmetric: each side publishes its folder as a Hyperdrive and
mirrors the other's drive into its folder, both with `prune` on (mirror-drive's
default). Run symmetrically, a new Mac file can be pruned by a pull from the
phone before the phone has it, and a deleted file can come back. So:

- **Mac:** runs syncd **without `PEER_KEY`**: publish only.
- **Phone:** runs syncd **with the Mac's key**: pull only.

### Changes in syncd (nbaglivo/syncd)

1. **Atomic writes:** open the local folder with
   `new Localdrive(FOLDER, { atomic: true })`, so files are written under
   `<name>.N.localdrive.tmp` and renamed when complete.
2. **Pull-only mode** *(Claude's call)*: an env switch (e.g. `PUSH=0`) so the
   phone doesn't publish its own drive. Without it, the phone keeps a second,
   unused copy of the whole library in its own drive.
3. **Deleted files free their space.** `Hyperdrive.del` only removes the entry;
   blob blocks stay on disk. Required outcome: after a file is deleted or
   replaced on the Mac, its old bytes are eventually gone from both the Mac's
   syncd storage and the phone's. The phone still keeps its copy of the
   Mac's current blobs: `mirror-drive` compares files by reading both sides
   and preloads source blobs, so clearing them would re-download the library.
   Phone disk use ≈ 2× the library *(found while planning; Nico is fine with
   disk for now)*. The phone pulls incrementally (only keys changed since the
   last pulled version) so a pull doesn't re-read the whole library.
4. **Status file:** an env switch (e.g. `STATUS_FILE`) makes syncd write
   whether it is pulling, and touch the file at most every 30 s while the pull
   is downloading *(Claude's call)*. A pull stalled on a dead connection stops
   touching it, so the daemon's 2-minute staleness rule covers stalls as well
   as crashes. The daemon only reads files, so there is no second transport.
5. **Logs:** one line per pull/push with counts (already there), plus errors
   and peer connect/disconnect lines, so a stuck sync is diagnosable from logs
   alone.
6. **Full-wipe guard** (Nico's call): if a pull would leave the local folder
   with no files at all, skip it and log why. Protects against an empty or
   missing Mac folder (moved, external disk not mounted). Partial deletes go
   through as usual.
7. **Publish only settled files** *(Claude's call)*: on the publishing side,
   don't push a file that is still being written into the folder (e.g. wait
   until its size/mtime stop changing). Otherwise a large copy into the Mac
   folder reaches the phone truncated, and atomic writes on the phone can't
   catch that.

These land in the syncd repo (Nico's own), merged to main. New behaviour is
behind opt-in env switches so syncd's default two-way mode keeps working as
its README describes *(Claude's call)*. This repo pins the syncd commit it
deploys.

### Phone

- syncd code deployed by `scripts/deploy.sh` to its own directory (e.g.
  `/opt/calm-syncd`), with its npm dependencies installed for aarch64 musl.
  Whether that's `npm ci` on the phone, prebuilds, or building on the phone
  (`apk add build-base python3`) is the builder's call; it must stay
  unattended like the rest of `deploy.sh`.
- A systemd service, running as `user`, started at boot, restarted on
  failure: `FOLDER=/home/user/Music`, `STORAGE=~/.local/share/syncd`,
  `PEER_KEY` from a config file outside `/opt` (e.g. `~/.config/syncd/env`).
  Deploying restarts it.
- Logs go to the journal (`journalctl -u <unit>`) *(Claude's call; the session
  log stays for cage/Chromium/daemon)*.

### Daemon

- Watch `MUSIC_DIR` recursively and, debounced (a few seconds), call the
  player's existing `rescan()`, which pushes the `library` event. No new
  dependencies. This also makes files copied by any other means show up.
- Read syncd's status file. "Syncing" = the file says so **and** was touched
  in the last ~2 minutes, so a crashed syncd can't keep the phone awake
  forever *(Claude's call)*.
- `decideScreenOff` gets `syncing` next to `playing`: syncing → blank, not
  suspend, for idle and the power key alike, as for playback *(Claude's
  call)*. When syncing ends while blanked, suspend after `IDLE_MS`, the same
  path as playback stopping while blanked.
- No new SSE event, no shell changes.

### Mac

- Synced folder: configurable, default `~/Phone/Music` *(Claude's call)*.
- A launchd agent plist plus a small install script in this repo
  (e.g. `scripts/mac/`) that installs syncd's dependencies, writes the agent
  with the folder and storage paths, loads it, and prints the Mac's drive key.
  Storage under `~/Library/Application Support/syncd`. Logs to a file under
  `~/Library/Logs/`.

### One-time pairing

1. Install the Mac agent; it prints the Mac drive key.
2. Put that key in the phone's config file; start the phone service.
The phone's key is not needed (the Mac never pulls).

**First sync wipes the phone's current `~/Music`** (Nico's call: what's there
today is test material). No migration; Listen positions for removed files are
dropped by its normal rescan. Put at least one file in the Mac folder before
pairing: against an empty Mac folder, the full-wipe guard would (correctly)
refuse the first sync.

## Docs

- `docs/device.md`: phone setup (Wi-Fi needed, config file, service, where
  logs are), Mac setup, the pairing steps, and gotchas found while building.
- `docs/architecture.md`: syncd as a separate process feeding `MUSIC_DIR`;
  the daemon's folder watch.
- **Disk use**, documented: what syncd stores on each side on top of the
  visible folder, and what deleting frees. The Mac keeps a second full copy
  of the library in syncd's storage (≈2× the folder); Nico is fine with that
  for now, so no Mac-side disk target.

## Verification

On the phone, not just the Mac:

- Add an album on the Mac → its tracks appear in Listen, each only once
  complete; no `.tmp` ever visible in the library.
- Delete it on the Mac → files gone from `~/Music`, gone from the library, and
  `du -sh ~/.local/share/syncd` drops accordingly.
- Empty the Mac folder (or stop the agent, move the folder, restart it) →
  the phone keeps its library and logs the refused wipe.
- Copy a large file into the Mac folder slowly → it reaches the phone whole.
- Delete the file that is currently loaded in Listen → player behaves as for
  any rescan that removes the current file.
- Start a large audiobook download, turn the screen off → the phone stays
  awake (blanked) until it finishes, then suspends.
- Kill syncd mid-pull (`kill -9`) with the screen off → the phone suspends
  within a few minutes, not never.
- Suspend the phone by the power key mid-download, wake it → the download
  resumes and completes, without manual restarts.
- Reboot the phone → service comes back and catches up on changes made
  meanwhile. Redeploy → drive key and storage unchanged.
- Log out and back in on the Mac → agent running; drop a file → it arrives.

## Left to the builder

- How syncd's dependencies get onto the phone.
- How deleted blobs are reclaimed in syncd.
- Exact env names, unit name, file paths marked "e.g." above.
- Debounce interval for the daemon's folder watch.
