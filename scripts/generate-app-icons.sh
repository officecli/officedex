#!/usr/bin/env bash
# Pre-render the flat foreground with Apple's material settings, then generate
# every ICNS size. Feeding the raw SVG raster to macOS 26 makes IconServices
# synthesize a bevel on the white logo, even with UIPrerenderedIcon set.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/resources/dmg/OfficeDex.icon"
ICTOOL="${ICTOOL:-}"
if [[ -z "$ICTOOL" ]]; then
  for candidate in \
    "/Applications/Icon Composer.app/Contents/Executables/ictool" \
    "/Applications/Xcode.app/Contents/Applications/Icon Composer.app/Contents/Executables/ictool"; do
    if [[ -x "$candidate" ]]; then ICTOOL="$candidate"; break; fi
  done
fi
if [[ ! -x "$ICTOOL" ]]; then
  echo "Icon Composer is required to regenerate icons. Set ICTOOL to its Contents/Executables/ictool." >&2
  exit 1
fi
command -v iconutil >/dev/null
command -v sips >/dev/null

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/officedex-icons.XXXXXX")"
trap 'rm -rf "$TEMP_DIR"' EXIT
ICONSET="$TEMP_DIR/OfficeDex.iconset"
mkdir -p "$ICONSET"

"$ICTOOL" "$SOURCE" --export-image --output-file "$TEMP_DIR/master.png" \
  --platform macOS --rendition Default --width 1024 --height 1024 --scale 1

for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$TEMP_DIR/master.png" --out "$ICONSET/icon_${size}x${size}.png" >/dev/null
  sips -z "$((size * 2))" "$((size * 2))" "$TEMP_DIR/master.png" --out "$ICONSET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$TEMP_DIR/icon.icns"
cp "$ICONSET/icon_512x512@2x.png" "$ROOT/build/appicon.png"
cp "$ICONSET/icon_512x512.png" "$ROOT/build/icon.png"
cp "$TEMP_DIR/icon.icns" "$ROOT/build/icon.icns"
