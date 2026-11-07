#!/bin/sh
# Build the shell, copy shell + daemon to the phone, restart the session.
#   ./scripts/deploy.sh            # build + deploy
#   ./scripts/deploy.sh --no-build # skip `npm run build`
#
# Runs unattended (no passwords), given the one-time phone setup in
# docs/device.md → "One-time setup": key SSH, nodejs, /opt/calm* owned by
# `user`, the calm-session symlink, and doas nopass rules for tinydm.
set -eu

PHONE="${PHONE:-user@172.16.42.1}"
cd "$(dirname "$0")/.."

ssh "$PHONE" 'command -v node' >/dev/null || {
  echo "node is not installed on the phone: ssh $PHONE 'doas apk add nodejs'" >&2
  exit 1
}

[ "${1:-}" = "--no-build" ] || npm run build

rsync_or_scp() { # src dest
  if command -v rsync >/dev/null && ssh "$PHONE" 'command -v rsync' >/dev/null; then
    rsync -a --delete "$1/" "$PHONE:$2/"
  else
    ssh "$PHONE" "rm -rf $2/*"
    scp -rq "$1/." "$PHONE:$2/"
  fi
}

rsync_or_scp dist /opt/calm
[ -d daemon ] && rsync_or_scp daemon /opt/calm-daemon

ssh "$PHONE" '[ "$(readlink /usr/local/bin/calm-session)" = /opt/calm-daemon/calm-session ]' ||
  echo "warning: /usr/local/bin/calm-session is not linked to the deployed one (docs/device.md)" >&2

ssh "$PHONE" 'doas systemctl restart tinydm || doas systemctl start tinydm'

echo "Deployed. Logs: ssh $PHONE 'tail -f ~/.local/state/tinydm.log'"
