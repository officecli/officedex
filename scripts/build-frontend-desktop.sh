#!/usr/bin/env bash

# Desktop frontend build.
#
# Desktop frontend build. It uses the single fegit presentation component and
# drops its Office CJK webfonts in favour of the host operating system's font
# stack.
#
# Use via `npm run build:frontend:desktop`, or point wails at it explicitly:
#   wails build -f ... after setting frontend:build, if you want it as default.
# Nothing here changes the default build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${OFFICEDEX_DIR}"

bash -c 'rm -rf -- "dist/pptx"'
bash "${SCRIPT_DIR}/build-embedded-presentation-desktop.sh"
npx vite build

if [[ -e "${OFFICEDEX_DIR}/dist/pptx" ]]; then
  echo "[build-frontend-desktop] legacy dist/pptx exists; refusing to package two PPT editors" >&2
  exit 1
fi
