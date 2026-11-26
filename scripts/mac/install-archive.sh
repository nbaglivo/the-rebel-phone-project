#!/bin/sh
# Install (or update) the notebook archive on the Mac: a second syncd launchd
# agent that receives the phone's scans into a folder and keeps everything
# (ARCHIVE=1: never deletes, overwrites or re-fetches). Safe to run again.
#   ./scripts/mac/install-archive.sh <phone-drive-key>             # ~/Notebook
#   ./scripts/mac/install-archive.sh <phone-drive-key> ~/Somewhere
# The phone's key: ssh user@172.16.42.1 'journalctl -u calm-syncd-scans | grep -A1 "MY DRIVE KEY" | tail -1'
# Doesn't touch the music agent (dev.rebelphone.syncd), its storage or log.
set -eu

KEY="${1:-}"
case "$KEY" in
  [0-9a-f][0-9a-f]*) [ "${#KEY}" -eq 64 ] || KEY="" ;;
  *) KEY="" ;;
esac
[ -n "$KEY" ] || { echo "usage: $0 <phone-drive-key (64 hex)> [folder]" >&2; exit 1; }
FOLDER="${2:-$HOME/Notebook}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/vendor/syncd"
BASE="$HOME/Library/Application Support/syncd"
APP="$BASE/app"
STORAGE="$BASE/archive-storage"
LOG="$HOME/Library/Logs/syncd-archive.log"
LABEL=dev.rebelphone.syncd-archive
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
    <key>ARCHIVE</key>
    <string>1</string>
    <key>PEER_KEY</key>
    <string>$KEY</string>
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
until grep -qE 'MY DRIVE KEY|archive|pull|connect' "$LOG" 2>/dev/null || [ "$i" -ge 15 ]; do
  sleep 1
  i=$((i + 1))
done
echo "archive agent running: receiving the phone's scans into $FOLDER"
echo "Log: $LOG"
