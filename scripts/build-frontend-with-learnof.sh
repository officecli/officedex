#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

cd "${OFFICEDEX_DIR}"
npx vite build
bash "${SCRIPT_DIR}/build-embedded-learnof.sh"
