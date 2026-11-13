#!/bin/sh
# Build musl versions of syncd's native addons (the phone is Alpine/musl; upstream
# ships glibc only). Needs Docker. Results are cached per name@version in
# .cache/musl-addons/, so this is a no-op until syncd's lockfile changes.
set -eu
cd "$(dirname "$0")/.."
LOCK=vendor/syncd/package-lock.json
CACHE=.cache/musl-addons
mkdir -p "$CACHE"

ADDONS=$(node -e '
  const l = require("./" + process.argv[1]).packages
  for (const [k, v] of Object.entries(l)) {
    const n = k.replace(/^.*node_modules\//, "")
    if (k && (/-native$/.test(n) || n === "fs-native-extensions")) console.log(n + "@" + v.version)
  }' "$LOCK" | sort -u)

for spec in $ADDONS; do
  name=${spec%@*}
  version=${spec#*@}
  [ -f "$CACHE/$spec/$name.node" ] && continue
  command -v docker >/dev/null || { echo "docker is needed to build $spec for musl" >&2; exit 1; }
  date=$(npm view "$spec" time --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s)[process.argv[1]]))" "$version")
  echo "building $spec for linux-arm64-musl (deps as of $date)"
  work=$(mktemp -d)
  (cd "$work" && npm pack "$spec" --silent >/dev/null)
  cp "$work/$name-$version.tgz" "$CACHE/"
  rm -rf "$work"
  docker run --rm --platform linux/arm64 -v "$PWD/scripts/musl:/scripts:ro" -v "$PWD/$CACHE:/src" \
    node:24-alpine sh /scripts/build-addon.sh "$name" "$date" "$name-$version.tgz" "$spec" \
    > "$CACHE/$spec.log" 2>&1 || { echo "build of $spec failed, see $CACHE/$spec.log" >&2; exit 1; }
  rm -f "$CACHE/$name-$version.tgz"
done
echo "musl addons ready in $CACHE"
