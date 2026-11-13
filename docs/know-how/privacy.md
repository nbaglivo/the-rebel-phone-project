# Privacy: what leaves the phone

## A Chromium kiosk talks to Google even when it only shows localhost

- **Context:** the whole UI is one page on `http://127.0.0.1:8080` in a
  Chromium kiosk ([session-and-kiosk](session-and-kiosk.md)). Nothing in our
  code calls the internet, so we assumed the browser didn't either.
- **Fact:** stock Alpine Chromium 155 (Nura/postmarketOS on the OnePlus 6),
  launched with only `--kiosk --app=... --no-first-run`, contacted Google in
  its **first minute**: `android.clients.google.com/c2dm/register3` and
  `mtalk.google.com:5228` (push messaging), `accounts.google.com/ListAccounts`,
  `www.google.com/async/folae`, `update.googleapis.com` (component updater),
  `optimizationguide-pa.googleapis.com/v1:GetModels` (with an API key, so the
  Alpine build does ship one) and `clients2.google.com/time`. Its crash
  handler (`chrome_crashpad_handler`) also runs.
- **How we measured, without root or tcpdump:** add
  `--log-net-log=/tmp/netlog.json --net-log-capture-mode=Default` to the
  Chromium command line, restart the session, then
  `grep -oE '"(url|host)":"[^"]+"' /tmp/netlog.json | sort | uniq -c`.
  The NetLog lists every request Chromium itself makes, including ones that
  fail. It doesn't see other processes (syncd, the OS).
- **Fact:** flags and policy are **not enough** on their own. With all of
  the flags and policy below loaded (checked: a non-allowlisted URL fails
  with `ERR_BLOCKED_BY_ADMINISTRATOR`), Chromium still called
  `accounts.google.com`, `android.clients.google.com` (push),
  `update.googleapis.com` and `www.google.com/async/folae` in its first
  minute. Baseline over ~8 min: 8 Google hosts. Flags + policy: 4.
  `URLBlocklist` only covers pages and their subresources, not the browser's
  own services. `ComponentUpdatesEnabled: false` exempts "security-critical"
  components.
- **Our choice:** keep Chromium, but harden it in three layers:
  - **a dead proxy** (the layer that actually stops traffic):
    `--proxy-server=socks5://127.0.0.1:9`, a port where nothing listens.
    Chromium always bypasses the proxy for loopback, so the UI loads directly.
    Every other request, including the internal services', fails with
    `ERR_PROXY_CONNECTION_FAILED` before leaving the phone. With SOCKS5 the
    proxy resolves hostnames, so there are no DNS lookups for them either;
  - a managed policy, `daemon/chromium-policy.json`, symlinked to
    `/etc/chromium/policies/managed/calm.json`. It turns off metrics, Safe
    Browsing, sync and sign-in, component updates, network prediction, the
    default search provider, spellcheck, translate, autofill, the media
    router and DNS over HTTPS. It keeps WebRTC UDP on the proxy, and sets
    `URLBlocklist: ["*"]` with `URLAllowlist: ["http://127.0.0.1:8080"]` so the
    kiosk can't navigate anywhere else;
  - flags in `daemon/calm-session`, so fewer services even try:
    `--disable-background-networking --disable-component-update
    --disable-sync --disable-default-apps --disable-domain-reliability
    --disable-client-side-phishing-detection --no-pings
    --disable-features=MediaRouter,OptimizationHints,Translate,AutofillServerCommunication`.
- **Gotcha (not a leak):** the NetLog shows a socket to
  `[2001:4860:4860::8888]:443` (Google DNS) that ignores the proxy. It's a
  UDP *connect*, which sends no packets: Chromium checks whether IPv6 is
  reachable by asking the kernel for a route. (Recalled from Chromium's
  source, not re-checked. The NetLog shows no data sent.) The same NetLog
  shows `secure_dns_mode: 0` and no DoH servers.
- **Alternatives:** a WebKit kiosk (`cog`/WPE) has no Google services to turn
  off. A native UI has no browser at all. Ungoogled-chromium removes the calls
  at build time, but Alpine doesn't package it. An outbound firewall is the
  layer that also covers bugs in Chromium's proxy handling. All our processes
  run as `user`, though, so nftables can't tell Chromium from syncd by uid.
  You'd need a separate user or a cgroup match for that. If your UI never
  needs the internet, a dead proxy gets you most of a firewall for one flag.
  If it does (maps, web content), allowlist those hosts through a real local
  proxy instead.
- **Cost / gotchas:** `/etc/chromium/policies` doesn't exist on the image;
  create it. The policy dir needs root once; after that the symlink target is
  deployed with the daemon, so policy changes don't need the doas password.
  That also means anything running as `user` could loosen the policy, but such
  code could reach the network directly anyway.
- **Cost:** Chromium keeps retrying its blocked services with backoff
  (56 failed attempts in 8 min, all to the dead proxy). It's harmless and
  cheap, but don't read the attempt count as traffic: count the socket
  addresses in the NetLog instead.
- **Verified:** on the phone, 2026-11-13, ~8 min NetLog per run. Baseline:
  70 non-loopback requests to 8 Google hosts. Flags + policy: 4 hosts still
  reached. Plus the dead proxy: 0 sockets to any outside address (all to
  `127.0.0.1:9`, plus the IPv6 route check). UI and `/events` unaffected.
  Not covered: syncd and the OS, which this NetLog can't see.
- **See:** `daemon/calm-session`, `daemon/chromium-policy.json`,
  `docs/device.md` → "One-time setup".
