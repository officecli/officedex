#!/usr/bin/env bash

# Wails frontend build: OfficeDex shell plus the single fegit presentation
# component. The legacy duplicate bundle is intentionally not built.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${OFFICEDEX_DIR}"
bash -c 'rm -rf -- "dist/pptx"'
bash "${SCRIPT_DIR}/build-embedded-presentation.sh"
npx vite build

if [[ -e "${OFFICEDEX_DIR}/dist/pptx" ]]; then
  echo "[build-frontend-with-presentation] legacy dist/pptx was generated" >&2
  echo "The frontend must reference only public/presentation." >&2
  exit 1
fi

echo "[build-frontend-with-presentation] built OfficeDex with fegit presentation only"
