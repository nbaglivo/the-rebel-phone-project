# Know-how: building your own calm phone

Learnings from building this phone (OnePlus 6, Nura (formerly postmarketOS), a React shell in
a Chromium kiosk, a small Node daemon), written for **you and your agent
building a different one**. You won't need our code. You'll need to know
which decisions there are to make, what we chose and why, what it cost, and
what would make another choice better for you.

## Layout

One file per topic, named after the question it answers. Add a file when a
topic doesn't fit an existing one, and list it under "Topics".

## Entry format

Each file is a list of entries under `##` headings:

```markdown
## <the decision or the lesson, as a short statement>

- **Context:** what we were trying to do, and the constraint that mattered.
- **Fact:** what's true regardless of our choices (versions, limits).
- **Our choice:** what we did. (Skip it for a pure gotcha.)
- **Alternatives:** what else is possible, and when it's the better call.
- **Cost / gotchas:** what it took, what broke, what we'd watch out for.
- **Verified:** on the phone / Mac only / docs only, and the date.
- **See:** links to the code or to `docs/device.md` / `docs/architecture.md`.
```

Leave out any field that has nothing to say. Keep entries short and concrete:
commands, numbers, version names.

## Topics

Rough order in which you'll meet them:

- [Hardware and OS](hardware-and-os.md): picking a device and a mobile
  Linux, the image's facts, USB vs Wi-Fi.
- [Session and kiosk](session-and-kiosk.md): one full-screen UI on boot
  (tinydm → cage → Chromium), scaling, startup order.
- [System access](system-access.md): a thin UI plus a local daemon, SSE and
  actions, dependencies, testing without the phone.
- [Deploy loop](deploy-loop.md): one-command, password-free deploys an agent
  can run; logs; dropped connections.
- [Power and screen](power-and-screen.md): screen off = suspend under cage,
  idle and power key from `/dev/input`, wake detection, blanking.
- [Audio](audio.md): the silent default sink, keeping PulseAudio up, mpv over
  IPC, volume keys and the headphone jack.
- [Music sync](music-sync.md): one-way P2P sync from the laptop, musl native
  addons, disk use.
- [A calm UI](calm-ui.md): what's on screen and what deliberately isn't.

Not covered yet (not built): calls and SMS (ModemManager), Bluetooth audio,
brightness control, notes/messages sync.
