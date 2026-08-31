#!/usr/bin/env bash

# Desktop variant of scripts/build-embedded-learnof.sh.
#
# Identical to the default build except that it exports
# PRESENTATION_BUNDLE_WEB_FONTS=0, which makes ../pptx's vite config alias the
# Office CJK font registration module to its `.desktop.ts` stand-in. Those six
# `.woff` faces (~66MB) exist so a browser on an arbitrary machine can render
# SimSun/SimHei/KaiTi/FangSong/DengXian; the desktop app runs on a real OS that
# already provides them (Windows natively, macOS via Songti/Heiti/Kaiti SC and
# STFangsong through FONT_FALLBACK), so they are pure weight inside the Go
# binary — main.go embeds dist/ verbatim with `//go:embed all:dist`.
#
# The default `npm run build:learnof` and the web build are untouched.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export PRESENTATION_BUNDLE_WEB_FONTS=0
echo "[build-embedded-learnof-desktop] PRESENTATION_BUNDLE_WEB_FONTS=0 (host fonts)"

bash "${SCRIPT_DIR}/build-embedded-learnof.sh"

OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${OFFICEDEX_DIR}/dist/pptx"

# Guard against a silent regression: if the alias stops matching, the woff files
# come back and the binary quietly regains ~66MB. Fail loudly instead.
if find "${TARGET_DIR}" -name '*.woff' -size +1M | grep -q .; then
  echo "[build-embedded-learnof-desktop] unexpected large .woff assets in ${TARGET_DIR}:" >&2
  find "${TARGET_DIR}" -name '*.woff' -size +1M -exec ls -lh {} \; >&2
  echo "[build-embedded-learnof-desktop] the office-cjk-registrations alias did not apply" >&2
  exit 1
fi

echo "[build-embedded-learnof-desktop] verified no bundled CJK webfonts"
