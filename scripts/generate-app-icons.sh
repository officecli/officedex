#!/usr/bin/env bash
# Regenerate committed native icons from the SVG (macOS + librsvg required).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/resources/dmg/app-icon.svg"
command -v rsvg-convert >/dev/null
command -v iconutil >/dev/null

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/officedex-icons.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT
ICONSET="$TEMP_DIR/OfficeDex.iconset"
mkdir -p "$ICONSET"

for size in 16 32 128 256 512; do
  rsvg-convert -w "$size" -h "$size" "$SOURCE" -o "$ICONSET/icon_${size}x${size}.png"
  rsvg-convert -w "$((size * 2))" -h "$((size * 2))" "$SOURCE" -o "$ICONSET/icon_${size}x${size}@2x.png"
done
iconutil -c icns "$ICONSET" -o "$TEMP_DIR/icon.icns"
cp "$ICONSET/icon_512x512@2x.png" "$ROOT/build/appicon.png"
cp "$ICONSET/icon_512x512.png" "$ROOT/build/icon.png"
cp "$TEMP_DIR/icon.icns" "$ROOT/build/icon.icns"
