#!/usr/bin/env bash

# Desktop variant of scripts/build-embedded-presentation.sh.
#
# Identical to the default build except that it exports
# PRESENTATION_BUNDLE_WEB_FONTS=0, which makes presentation-component's vite
# config alias the Office CJK font registration module to its `.desktop.ts`
# stand-in for the desktop presentation bundle.
#
# main.go embeds dist/ verbatim with `//go:embed all:dist`; there is only one
# editable presentation frontend, so no second bundle is permitted.
#
# The default `npm run build:presentation` keeps browser fonts.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TARGET_DIR="${OFFICEDEX_DIR}/public/presentation"

export PRESENTATION_BUNDLE_WEB_FONTS=0
echo "[build-embedded-presentation-desktop] PRESENTATION_BUNDLE_WEB_FONTS=0 (host fonts)"

bash "${SCRIPT_DIR}/build-embedded-presentation.sh"

# Guard against a silent regression: if the alias stops matching, the woff files
# come back and the binary quietly regains ~67MB. Fail loudly instead.
if find "${TARGET_DIR}" -name '*.woff' -size +1M | grep -q .; then
  echo "[build-embedded-presentation-desktop] unexpected large .woff assets in ${TARGET_DIR}:" >&2
  find "${TARGET_DIR}" -name '*.woff' -size +1M -exec ls -lh {} \; >&2
  echo "[build-embedded-presentation-desktop] the office-cjk-registrations alias did not apply" >&2
  exit 1
fi

echo "[build-embedded-presentation-desktop] verified no bundled CJK webfonts"
