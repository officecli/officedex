#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_PATH="${OFFICEDEX_APP_PATH:-${OFFICEDEX_DIR}/build/bin/OfficeDex.app}"
APP_EXECUTABLE="${APP_PATH}/Contents/MacOS/officedex"
USER_DATA_DIR="${OFFICEDEX_DEV_USER_DATA_DIR:-${HOME}/Library/Application Support/OfficeDex-Test}"
PLATFORM_BASE_URL="${OFFICECLI_DEV_PLATFORM_BASE_URL:-https://officecli.shimodev.com}"
PROFILE="${OFFICE_CLI_PROFILE:-dev}"
PRESENTATION_SOURCE="${PRESENTATION_SOURCE_DIR:-${OFFICEDEX_DIR}/../presentation}"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/start-desktop.sh [--dry-run]

Starts this checkout's build/bin/OfficeDex.app with an isolated test profile.

Environment overrides:
  OFFICEDEX_APP_PATH                 Path to OfficeDex.app
  OFFICEDEX_DEV_USER_DATA_DIR        Test user-data directory
  OFFICE_CLI_PROFILE                 OfficeCLI profile (default: dev)
  OFFICECLI_DEV_PLATFORM_BASE_URL    Development platform URL
  OFFICEDEX_MOP_CONVERT_BIN          Explicit mop-convert executable
  PRESENTATION_SOURCE_DIR            Presentation checkout
EOF
}

for argument in "$@"; do
  case "${argument}" in
    --dry-run) DRY_RUN=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[start-desktop] unknown argument: ${argument}" >&2; usage >&2; exit 2 ;;
  esac
done

if [[ "${OSTYPE}" != darwin* ]]; then
  echo "[start-desktop] this launcher currently supports macOS only" >&2
  exit 1
fi

if [[ ! -x "${APP_EXECUTABLE}" ]]; then
  echo "[start-desktop] local app is missing: ${APP_PATH}" >&2
  echo "[start-desktop] build it first with: npm run build:local:latest" >&2
  exit 1
fi

resolve_mop_convert() {
  local machine_arch rust_arch candidate
  machine_arch="$(uname -m)"
  rust_arch="${machine_arch}"
  if [[ "${machine_arch}" == "arm64" ]]; then
    rust_arch="aarch64"
  elif [[ "${machine_arch}" == "x86_64" ]]; then
    rust_arch="x86_64"
  fi

  for candidate in \
    "${OFFICEDEX_MOP_CONVERT_BIN:-}" \
    "${MOP_CONVERT_BIN:-}" \
    "${OFFICEDEX_DIR}/build/presentation/tools/bin/mop-convert" \
    "${PRESENTATION_SOURCE}/tools/bin/mop-convert" \
    "${OFFICEDEX_DIR}/../ppt2mop/target/${rust_arch}-apple-darwin/release/mop-convert" \
    "${HOME}/code/my/github/learnof/pptx/tools/bin/mop-convert" \
    "${HOME}/code/my/github/learnof/presentation/mop/target/release/mop-convert"
  do
    if [[ -n "${candidate}" && -x "${candidate}" ]]; then
      printf '%s\n' "${candidate}"
      return 0
    fi
  done
  return 1
}

MOP_CONVERT_BIN="$(resolve_mop_convert || true)"
if [[ -z "${MOP_CONVERT_BIN}" ]]; then
  echo "[start-desktop] warning: mop-convert was not found; PPTX editing will be unavailable" >&2
  echo "[start-desktop] set OFFICEDEX_MOP_CONVERT_BIN to enable it" >&2
fi

if [[ "${DRY_RUN}" != true ]] && pgrep -f "^${APP_EXECUTABLE}$" >/dev/null 2>&1; then
  echo "[start-desktop] this checkout is already running: ${APP_EXECUTABLE}"
  exit 0
fi

command=(
  open -n -F
  --env "OFFICE_CLI_PROFILE=${PROFILE}"
  --env "OFFICECLI_DEV_PLATFORM_BASE_URL=${PLATFORM_BASE_URL}"
  --env "OFFICEDEX_DEV_USER_DATA_DIR=${USER_DATA_DIR}"
)

if [[ -d "${PRESENTATION_SOURCE}" ]]; then
  command+=(--env "PRESENTATION_SOURCE_DIR=${PRESENTATION_SOURCE}")
fi
if [[ -n "${MOP_CONVERT_BIN}" ]]; then
  command+=(--env "OFFICEDEX_MOP_CONVERT_BIN=${MOP_CONVERT_BIN}")
fi
command+=("${APP_PATH}")

echo "[start-desktop] app: ${APP_PATH}"
echo "[start-desktop] user data: ${USER_DATA_DIR}"
if [[ -n "${MOP_CONVERT_BIN}" ]]; then
  echo "[start-desktop] mop-convert: ${MOP_CONVERT_BIN}"
fi

if [[ "${DRY_RUN}" == true ]]; then
  printf '[start-desktop] command:'
  printf ' %q' "${command[@]}"
  printf '\n'
  exit 0
fi

"${command[@]}"
echo "[start-desktop] started"
