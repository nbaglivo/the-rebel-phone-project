# A calm UI

## Few apps, no notifications, nothing that pulls for attention

- **Context:** the point of the phone is to be used less. Inspired by the
  Light Phone.
- **Our choice:** home is time, date and battery plus a text list of five
  apps (call, messages, notes, listen, read). No badges, no red dots, no
  toasts, no animation for its own sake. Errors are a quiet muted line.
  The clock doubles as the back button.
- **Alternatives:** an e-ink device or a feature phone gives calm for free,
  without a custom shell. A custom shell is the better call when you want
  exactly your apps and your own sync.

## Design for touch at the real viewport

- **Fact:** 1080×2280 at scale 2.5 ≈ 432×912 CSS px. Develop in a desktop
  browser at that size, then check on the phone.
- **Our choice:** no hover-dependent UI. Pinch zoom is off
  (`--disable-pinch`). While the screen is "off" but awake (blanked), a cover
  swallows pocket touches.

## Work offline, with no framework weight

- **Our choice:** React 19 + Vite + TypeScript, no router, no UI library.
  Fonts are self-hosted (`@fontsource`), so nothing loads from the network.
  Paper-textured background, IBM Plex Sans Light + Plex Mono.
- **Verified:** on the phone, 2026-10-29 / 2026-11-08.
