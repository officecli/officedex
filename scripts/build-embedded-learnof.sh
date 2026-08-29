#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PPTX_DIR="${OFFICEDEX_DIR}/../pptx"
PPTX_DIST="${PPTX_DIR}/dist"
TARGET_DIR="${OFFICEDEX_DIR}/dist/pptx"

if [[ ! -f "${PPTX_DIR}/package.json" ]]; then
  echo "[build-embedded-learnof] missing learnof/pptx checkout at ${PPTX_DIR}" >&2
  exit 1
fi

echo "[build-embedded-learnof] building ${PPTX_DIR} with base /pptx/"
(
  cd "${PPTX_DIR}"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm exec vite build --config packages/presentation-app/vite.config.ts --base /pptx/
  else
    npx vite build --config packages/presentation-app/vite.config.ts --base /pptx/
  fi
)

if [[ ! -f "${PPTX_DIST}/index.html" ]]; then
  echo "[build-embedded-learnof] build did not produce ${PPTX_DIST}/index.html" >&2
  exit 1
fi

rm -rf "${TARGET_DIR}"
mkdir -p "${TARGET_DIR}"
cp -R "${PPTX_DIST}/." "${TARGET_DIR}/"
echo "[build-embedded-learnof] staged editor at ${TARGET_DIR}"
