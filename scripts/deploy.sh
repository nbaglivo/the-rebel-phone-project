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

# syncd (music sync, docs/device.md → "Music sync"): code, musl builds of its
# native addons, and the calm-syncd unit. Needs rsync on both sides.
if [ ! -f vendor/syncd/syncd.mjs ]; then
  echo "warning: vendor/syncd missing (git submodule update --init), syncd not deployed" >&2
elif command -v rsync >/dev/null && ssh "$PHONE" 'command -v rsync' >/dev/null; then
  ./scripts/build-musl-addons.sh
  rsync -a --delete --exclude node_modules --exclude .git --exclude .musl --exclude calm-syncd.service \
    vendor/syncd/ "$PHONE:/opt/calm-syncd/"
  rsync -a --delete --include '*/' --include '*.node' --exclude '*' .cache/musl-addons/ "$PHONE:/opt/calm-syncd/.musl/"
  rsync -a scripts/calm-syncd.service "$PHONE:/opt/calm-syncd/calm-syncd.service"
  ssh "$PHONE" 'set -e
    cd /opt/calm-syncd
    sum=$(sha256sum package-lock.json | cut -d" " -f1)
    if [ "$(cat node_modules/.lock-sha 2>/dev/null)" != "$sum" ]; then
      npm ci --omit=dev --no-audit --no-fund >/dev/null
      echo "$sum" > node_modules/.lock-sha
    fi
    for d in .musl/*@*; do
      spec=${d#.musl/}
      name=${spec%@*}
      [ -d "node_modules/$name" ] || continue
      mkdir -p "node_modules/$name/prebuilds/linux-arm64-musl"
      cp "$d/$name.node" "node_modules/$name/prebuilds/linux-arm64-musl/"
      node -e "require(process.argv[1])" "/opt/calm-syncd/node_modules/$name" ||
        { echo "syncd: musl addon $name does not load" >&2; exit 1; }
    done'
  ssh "$PHONE" 'doas systemctl daemon-reload && doas systemctl restart calm-syncd'
else
  echo "warning: rsync missing on the Mac or the phone, syncd not deployed" >&2
fi

ssh "$PHONE" 'doas systemctl restart tinydm || doas systemctl start tinydm'

echo "Deployed. Logs: ssh $PHONE 'tail -f ~/.local/state/tinydm.log'"
echo "Sync logs: ssh $PHONE 'journalctl -u calm-syncd -f'"
