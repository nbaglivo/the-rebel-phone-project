#!/bin/sh
# Install (or update) syncd on the Mac as a launchd agent that publishes one
# folder to the phone. Safe to run again: same storage, same drive key.
#   ./scripts/mac/install-syncd.sh            # folder ~/Phone/Music
#   ./scripts/mac/install-syncd.sh ~/Somewhere
# Prints the Mac's drive key: it goes into the phone's ~/.config/syncd/env.
set -eu

FOLDER="${1:-$HOME/Phone/Music}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/vendor/syncd"
BASE="$HOME/Library/Application Support/syncd"
APP="$BASE/app"
STORAGE="$BASE/storage"
LOG="$HOME/Library/Logs/syncd.log"
LABEL=dev.rebelphone.syncd
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DOMAIN="gui/$(id -u)"

[ -f "$SRC/syncd.mjs" ] || {
  echo "vendor/syncd is missing: git submodule update --init" >&2
  exit 1
}

# launchd has no mise shims on its PATH: pin the absolute node path.
NODE="$(mise which node 2>/dev/null || command -v node || true)"
[ -n "$NODE" ] || { echo "node not found (mise install node)" >&2; exit 1; }

mkdir -p "$FOLDER" "$APP" "$STORAGE" "$(dirname "$PLIST")" "$(dirname "$LOG")"
FOLDER="$(cd "$FOLDER" && pwd)"

rsync -a --delete --exclude node_modules --exclude .git "$SRC/" "$APP/"
(cd "$APP" && PATH="$(dirname "$NODE"):$PATH" npm ci --omit=dev --silent)

xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(xml "$NODE")</string>
    <string>$(xml "$APP/syncd.mjs")</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>FOLDER</key>
    <string>$(xml "$FOLDER")</string>
    <key>STORAGE</key>
    <string>$(xml "$STORAGE")</string>
    <key>SETTLE_MS</key>
    <string>10000</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$(xml "$LOG")</string>
  <key>StandardErrorPath</key>
  <string>$(xml "$LOG")</string>
</dict>
</plist>
PLIST
plutil -lint "$PLIST" >/dev/null

launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null && sleep 1 || true
: > "$LOG"
launchctl bootstrap "$DOMAIN" "$PLIST"

i=0
until grep -q 'MY DRIVE KEY' "$LOG" 2>/dev/null || [ "$i" -ge 30 ]; do
  sleep 1
  i=$((i + 1))
done
if grep -q 'MY DRIVE KEY' "$LOG"; then
  echo "syncd is publishing $FOLDER"
  echo "Mac drive key (put it in the phone's ~/.config/syncd/env as PEER_KEY=...):"
  grep -A1 'MY DRIVE KEY' "$LOG" | tail -1
else
  echo "syncd didn't print its key within 30 s; see $LOG" >&2
  exit 1
fi
