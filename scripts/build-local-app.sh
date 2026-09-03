#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${OFFICEDEX_DIR}/.." && pwd)"
OFFICECLI_INTERNAL_DIR="${REPO_ROOT}/officecli-internal"
OFFICECLI_STAGE_BIN="${OFFICEDEX_DIR}/build/officecli/officecli"
APP_PATH="${OFFICEDEX_DIR}/build/bin/OfficeDex.app"
APP_NAME="OfficeDex"

export HTTP_PROXY="${HTTP_PROXY:-http://127.0.0.1:7890}"
export HTTPS_PROXY="${HTTPS_PROXY:-http://127.0.0.1:7890}"

if [[ ! -d "${OFFICECLI_INTERNAL_DIR}" ]]; then
  echo "[build-local-app] missing officecli-internal at ${OFFICECLI_INTERNAL_DIR}" >&2
  exit 1
fi

app_is_running() {
  pgrep -x "${APP_NAME}" >/dev/null 2>&1 || pgrep -x "officedex" >/dev/null 2>&1
}

verify_app_executable() {
  (
    cd "${OFFICEDEX_DIR}"
    node scripts/verify-wails-app.mjs "${APP_PATH}"
  )
}

restart_app() {
  if [[ "${OSTYPE}" != darwin* ]]; then
    echo "[build-local-app] not on macOS, skipping app restart"
    return
  fi

  if app_is_running; then
    echo "[build-local-app] asking running ${APP_NAME} to quit"
    osascript -e "tell application \"${APP_NAME}\" to quit" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! app_is_running; then
        break
      fi
      sleep 0.25
    done
  fi

  if app_is_running; then
    echo "[build-local-app] force stopping lingering ${APP_NAME} process"
    pkill -x "${APP_NAME}" >/dev/null 2>&1 || true
    pkill -x "officedex" >/dev/null 2>&1 || true
    for _ in {1..20}; do
      if ! app_is_running; then
        break
      fi
      sleep 0.25
    done
  fi

  echo "[build-local-app] opening ${APP_PATH}"
  open "${APP_PATH}"
}

echo "[build-local-app] prefetching staged officecli layout"
(
  cd "${OFFICEDEX_DIR}"
  npm run prefetch:officecli
)

echo "[build-local-app] building local officecli-internal"
mkdir -p "$(dirname "${OFFICECLI_STAGE_BIN}")"
(
  cd "${OFFICECLI_INTERNAL_DIR}"
  env -u GOROOT go build -o "${OFFICECLI_STAGE_BIN}" ./cmd/officecli
)

echo "[build-local-app] building OfficeDex.app"
(
  cd "${OFFICEDEX_DIR}"
  APP_VERSION="$(node -p 'require(`./package.json`).version')"
  env -u GOROOT wails build -ldflags "-X main.appVersion=${APP_VERSION}"
)
verify_app_executable

echo "[build-local-app] bundling office2modoc into app"
(
  cd "${OFFICEDEX_DIR}"
  npm run bundle:office2modoc:mac
)

echo "[build-local-app] bundling release licenses"
(
  cd "${OFFICEDEX_DIR}"
  npm run bundle:licenses:mac
)

echo "[build-local-app] bundling local officecli into app"
(
  cd "${OFFICEDEX_DIR}"
  npm run bundle:officecli:mac
)
verify_app_executable

echo "[build-local-app] verifying codesign"
codesign --verify --deep --strict --verbose=4 "${APP_PATH}"
verify_app_executable

restart_app

echo "[build-local-app] done: ${APP_PATH}"
