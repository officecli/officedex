#!/usr/bin/env bash

# Desktop frontend build.
#
# Mirrors scripts/build-frontend-with-learnof.sh (the default `frontend:build`
# in wails.json) but routes the embedded learnof editor through the desktop
# variant, which drops the Office CJK webfonts in favour of the host operating
# system's own font stack.
#
# Use via `npm run build:frontend:desktop`, or point wails at it explicitly:
#   wails build -f ... after setting frontend:build, if you want it as default.
# Nothing here changes the default build.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${OFFICEDEX_DIR}"

npx vite build
bash "${SCRIPT_DIR}/build-embedded-learnof-desktop.sh"
