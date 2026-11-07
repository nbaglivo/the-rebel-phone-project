#!/bin/sh
# Regenerate the tiny audio files the daemon tests and fixture runs use.
# Needs ffmpeg (Mac: brew install ffmpeg mpv). Output is committed.
set -eu

DIR="$(cd "$(dirname "$0")/.." && pwd)/daemon/fixtures/music"
rm -rf "$DIR"
mkdir -p "$DIR/album" "$DIR/.hidden"

tone() { # path freq [title]
  set -- "$1" "$2" "${3:-}"
  ffmpeg -loglevel error -y -f lavfi -i "sine=frequency=$2:duration=3" \
    -ac 1 -b:a 32k ${3:+-metadata "title=$3"} "$1"
}

tone "$DIR/album/01 Intro.mp3" 440
tone "$DIR/album/02 Second.mp3" 494
tone "$DIR/album/10 Tenth.mp3" 523 "Tenth Song"
tone "$DIR/Arvo Pärt — Spiegel \"live\".mp3" 587
tone "$DIR/.hidden/skip.mp3" 659
printf 'not audio\n' > "$DIR/broken.mp3"
