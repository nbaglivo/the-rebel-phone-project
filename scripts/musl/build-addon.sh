#!/bin/sh
# Runs INSIDE an arm64 Alpine container (see scripts/build-musl-addons.sh).
# Builds one Holepunch native addon (bare-make / cmake-bare) for linux-arm64-musl.
#   build-addon.sh <name> <release date ISO> <tgz in /src> <output dir in /src>
# Upstream only publishes glibc prebuilds, and its bundled cmake/clang are glibc
# binaries, so this uses Alpine's toolchain and reproduces the release's
# dependency versions with npm --before. Two fixes for header drift:
#   - bare-headers (installed by cmake-bare at generate time) is pinned to the
#     newest release before the addon's release date;
#   - libjstl passes `const char *` where js_create_string_utf8 takes
#     `const utf8_t *` (unsigned char): add the cast.
set -eux
NAME=$1
BEFORE=$2
TGZ=$3
OUT=$4

apk add --no-cache build-base cmake ninja git linux-headers python3 clang clang-extra-tools lld >/dev/null
npm i -g --before="$BEFORE" bare-make >/dev/null 2>&1
BM=/usr/local/lib/node_modules/bare-make/node_modules
ln -sf /usr/bin/cmake $BM/cmake-runtime-linux-arm64/bin/cmake
ln -sf /usr/bin/ninja $BM/ninja-runtime-linux-arm64/bin/ninja
cat > $BM/cmake-toolchains/linux-arm64.cmake <<'TC'
set(CMAKE_SYSTEM_NAME Linux)
set(CMAKE_SYSTEM_PROCESSOR aarch64)
set(CMAKE_C_COMPILER /usr/bin/clang)
set(CMAKE_CXX_COMPILER /usr/bin/clang++)
set(CMAKE_ASM_COMPILER /usr/bin/clang)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)
set(VCPKG_TARGET_TRIPLET arm64-linux)
include("${CMAKE_CURRENT_LIST_DIR}/external-project/use-toolchain.cmake" OPTIONAL)
TC

rm -rf /build && mkdir /build && tar xzf "/src/$TGZ" -C /build --strip-components=1 && cd /build
npm install --before="$BEFORE" --ignore-scripts --no-audit --no-fund >/dev/null 2>&1
rm -rf prebuilds
bare-make generate

if [ -d build/_bare ]; then
  V=$(npm view bare-headers time --json | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const t=JSON.parse(s);console.log(Object.keys(t).filter(k=>/^[0-9.]+\$/.test(k)&&t[k]<process.argv[1]).sort((a,b)=>t[a]<t[b]?-1:1).pop())})" "$BEFORE")
  (cd build/_bare && npm install --no-audit --no-fund "bare-headers@$V" >/dev/null 2>&1)
fi
J=build/_deps/github+holepunchto+libjstl-src/include/jstl.h
[ -f "$J" ] && sed -i 's/js_create_string_utf8(env, value, N,/js_create_string_utf8(env, reinterpret_cast<const utf8_t *>(value), N,/' "$J"

bare-make build
bare-make install
mkdir -p "/src/$OUT"
cp prebuilds/linux-arm64/"$NAME".node "/src/$OUT/"
