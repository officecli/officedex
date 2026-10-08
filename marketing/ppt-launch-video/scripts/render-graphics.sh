#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_DIR="$ROOT/graphics"
OUTPUT_DIR="$SOURCE_DIR/rendered"

mkdir -p "$OUTPUT_DIR"

for source in "$SOURCE_DIR/opening.svg" "$SOURCE_DIR/cta.svg"; do
  name="${source:t:r}"
  rm -f "$OUTPUT_DIR/$name.png"
  rsvg-convert --width 1920 --height 1080 --output "$OUTPUT_DIR/$name.png" "$source"
  test -s "$OUTPUT_DIR/$name.png"
done

sips -g pixelWidth -g pixelHeight "$OUTPUT_DIR/opening.png" "$OUTPUT_DIR/cta.png"
