#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BUILT_APP_EXECUTABLE="${OFFICEDEX_DIR}/build/bin/OfficeDex.app/Contents/MacOS/officedex"
OFFICECLI_EXECUTABLE="${OFFICEDEX_DIR}/build/officecli/officecli"
USER_DATA_DIR="${OFFICEDEX_DEV_USER_DATA_DIR:-${HOME}/Library/Application Support/OfficeDex-Test}"
PLATFORM_BASE_URL="${OFFICECLI_DEV_PLATFORM_BASE_URL:-https://officecli.shimodev.com}"
# Production by default. The OfficeCLI this launcher builds carries the release
# licence proof key, which only the production platform signs with; the test
# platform (profile `dev`) uses its own seed, so every generation there fails
# with "license proof signature mismatch" unless OFFICE_CLI_LICENSE_PROOF_PUBLIC_KEY
# is set to the test platform's public key.
PROFILE="${OFFICE_CLI_PROFILE:-}"
PRESENTATION_SOURCE="${PRESENTATION_SOURCE_DIR:-${OFFICEDEX_DIR}/../presentation}"
PPT2MOP_SOURCE="${PPT2MOP_SOURCE_DIR:-${OFFICEDEX_DIR}/../ppt2mop}"
DRY_RUN=false

usage() {
  cat <<'EOF'
Usage: scripts/start-desktop.sh [--dry-run]

Starts the current source in Wails desktop development mode with an isolated
test profile. The renderer still runs inside the native desktop WebView, so
font and platform behavior match the desktop client rather than a browser tab.

Environment overrides:
  OFFICEDEX_DEV_USER_DATA_DIR        Test user-data directory
  OFFICE_CLI_PROFILE                 OfficeCLI profile (default: production; `dev` = test platform)
  OFFICECLI_DEV_PLATFORM_BASE_URL    Test platform URL, used only with OFFICE_CLI_PROFILE=dev
  OFFICEDEX_MOP_CONVERT_BIN          Explicit mop-convert executable
  PRESENTATION_SOURCE_DIR            Presentation checkout
  PPT2MOP_SOURCE_DIR                 Local ppt2mop checkout
  WRITER_SOURCE_DIR                  Writer checkout (default: ../writer)
  OFFICECLI_SOURCE_DIR               OfficeCLI checkout (default: ../officecli-internal)
  OFFICEDEX_DEPS_WATCH               0 disables rebuilding on new commits
  OFFICEDEX_DEPS_PULL                0 disables fast-forwarding clean checkouts
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
    "${PPT2MOP_SOURCE}/target/release/pptx2mop" \
    "${PPT2MOP_SOURCE}/target/${rust_arch}-apple-darwin/release/pptx2mop" \
    "${PPT2MOP_SOURCE}/target/${rust_arch}-apple-darwin/release/mop-convert" \
    "${OFFICEDEX_DIR}/build/presentation/tools/bin/mop-convert" \
    "${PRESENTATION_SOURCE}/tools/bin/mop-convert" \
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

if [[ "${DRY_RUN}" != true ]] && pgrep -f "^${BUILT_APP_EXECUTABLE}$" >/dev/null 2>&1; then
  echo "[start-desktop] the packaged local App is still running" >&2
  echo "[start-desktop] quit OfficeDex before starting desktop dev mode" >&2
  exit 1
fi

command=(
  env
  -u GOROOT
  # `env` takes -u only before the first assignment. Clearing the profile here
  # keeps one exported in the calling shell from overriding production below.
  -u OFFICE_CLI_PROFILE
  "OFFICEDEX_DEV_USER_DATA_DIR=${USER_DATA_DIR}"
)
if [[ -n "${PROFILE}" ]]; then
  command+=("OFFICE_CLI_PROFILE=${PROFILE}")
  if [[ "${PROFILE}" == "dev" ]]; then
    command+=("OFFICECLI_DEV_PLATFORM_BASE_URL=${PLATFORM_BASE_URL}")
  fi
fi

if [[ -d "${PRESENTATION_SOURCE}" ]]; then
  command+=("PRESENTATION_SOURCE_DIR=${PRESENTATION_SOURCE}")
fi
if [[ -d "${PPT2MOP_SOURCE}" ]]; then
  command+=("PPT2MOP_SOURCE_DIR=${PPT2MOP_SOURCE}")
fi
if [[ -n "${MOP_CONVERT_BIN}" ]]; then
  command+=("OFFICEDEX_MOP_CONVERT_BIN=${MOP_CONVERT_BIN}")
fi
command+=(wails dev)

echo "[start-desktop] mode: Wails desktop dev"
echo "[start-desktop] source: ${OFFICEDEX_DIR}"
echo "[start-desktop] user data: ${USER_DATA_DIR}"
echo "[start-desktop] OfficeCLI platform: ${PROFILE:+profile ${PROFILE}}${PROFILE:-production}"
if [[ -n "${MOP_CONVERT_BIN}" ]]; then
  echo "[start-desktop] mop-convert: ${MOP_CONVERT_BIN}"
fi

if [[ "${DRY_RUN}" == true ]]; then
  printf '[start-desktop] command:'
  printf ' %q' "${command[@]}"
  printf '\n'
  exit 0
fi

cd "${OFFICEDEX_DIR}"
if [[ ! -x "${OFFICECLI_EXECUTABLE}" ]]; then
  echo "[start-desktop] OfficeCLI is missing; downloading it once"
  npm run prefetch:officecli
fi
# Bring the embedded editors and OfficeCLI up to date, then keep watching the
# checkouts so a `git pull` in presentation or writer lands without a restart.
PRESENTATION_SOURCE_DIR="${PRESENTATION_SOURCE}" PPT2MOP_SOURCE_DIR="${PPT2MOP_SOURCE}" \
  bash scripts/dev-deps.sh sync
if [[ "${OFFICEDEX_DEPS_WATCH:-1}" == "1" ]]; then
  PRESENTATION_SOURCE_DIR="${PRESENTATION_SOURCE}" PPT2MOP_SOURCE_DIR="${PPT2MOP_SOURCE}" \
    bash scripts/dev-deps.sh watch &
  DEPS_WATCHER_PID=$!
  trap 'kill "${DEPS_WATCHER_PID}" 2>/dev/null || true' EXIT
fi
"${command[@]}"
