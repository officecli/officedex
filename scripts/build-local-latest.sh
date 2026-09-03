#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${OFFICEDEX_DIR}/.." && pwd)"
OFFICECLI_DIR="${REPO_ROOT}/officecli-internal"
OFFICECLI_SOURCE_BIN="${OFFICECLI_DIR}/officecli"
OFFICECLI_STAGE_BIN="${OFFICEDEX_DIR}/build/officecli/officecli"
APP_PATH="${OFFICEDEX_DIR}/build/bin/OfficeDex.app"
PRESENTATION_DIR="${REPO_ROOT}/presentation"

app_is_running() {
  pgrep -x "OfficeDex" >/dev/null 2>&1 || pgrep -x "officedex" >/dev/null 2>&1
}

if [[ ! -d "${OFFICECLI_DIR}" ]]; then
  echo "[build-local-latest] missing officecli-internal at ${OFFICECLI_DIR}" >&2
  exit 1
fi
if [[ ! -f "${PRESENTATION_DIR}/package.json" ]]; then
  echo "[build-local-latest] missing presentation checkout at ${PRESENTATION_DIR}" >&2
  exit 1
fi

if [[ "${OSTYPE}" == darwin* ]] && app_is_running; then
  echo "[build-local-latest] OfficeDex is running. Finish or cancel active tasks, quit the app, then run this command again." >&2
  exit 1
fi

build_officecli() {
  local output="$1"
  local temporary
  mkdir -p "$(dirname "${output}")"
  temporary="$(mktemp "${output}.tmp.XXXXXX")"
  trap 'rm -f "${temporary}"' RETURN
  env -u GOROOT go build -o "${temporary}" ./cmd/officecli
  chmod 0755 "${temporary}"
  mv "${temporary}" "${output}"
  trap - RETURN
}

echo "[build-local-latest] building OfficeCLI from ${OFFICECLI_DIR}"
cd "${OFFICECLI_DIR}"
build_officecli "${OFFICECLI_SOURCE_BIN}"
build_officecli "${OFFICECLI_STAGE_BIN}"

echo "[build-local-latest] building OfficeDex.app"
cd "${OFFICEDEX_DIR}"
APP_VERSION="$(node -p 'require("./package.json").version')"
PRESENTATION_SOURCE_DIR="${PRESENTATION_DIR}" env -u GOROOT wails build -ldflags "-X main.appVersion=${APP_VERSION}"
npm run stage:office2modoc
node scripts/bundle-office2modoc.mjs \
  --app build/bin/OfficeDex.app \
  --source build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib \
  --expected-arch arm64
npm run bundle:licenses:mac
npm run bundle:officecli:mac

echo "[build-local-latest] OfficeCLI build metadata"
go version -m "${OFFICECLI_SOURCE_BIN}" | sed -n '1,5p'
echo "[build-local-latest] built ${APP_PATH}"
if [[ "${OSTYPE}" == darwin* ]]; then
  echo "[build-local-latest] opening ${APP_PATH}"
  open "${APP_PATH}"
fi
