#!/usr/bin/env bash

set -euo pipefail
OFFICE2MODOC_VERSION="$(tr -d '[:space:]' < "$(dirname "$0")/../office2modoc.version")"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${OFFICEDEX_DIR}/.." && pwd)"
OFFICECLI_DIR="${REPO_ROOT}/officecli-internal"
OFFICECLI_SOURCE_BIN="${OFFICECLI_DIR}/officecli"
OFFICECLI_STAGE_BIN="${OFFICEDEX_DIR}/build/officecli/officecli"
APP_PATH="${OFFICEDEX_DIR}/build/bin/OfficeDex.app"
PRESENTATION_DIR="${REPO_ROOT}/presentation"
WAILS_BIN="$(command -v wails || true)"
if [[ -z "${WAILS_BIN}" ]]; then
  WAILS_BIN="$(env -u GOROOT go env GOPATH)/bin/wails"
fi
if [[ ! -x "${WAILS_BIN}" ]]; then
  echo "[build-local-latest] wails is unavailable in PATH or GOPATH/bin" >&2
  exit 1
fi

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
# The design Skill is distilled in the plan repo and synced into both OfficeCLI
# and OfficeDex. That distilled catalog is working data outside git, so a
# checkout that does not have it still builds: what it would generate is already
# committed in both repositories, and the sync exists to refresh that snapshot.
JSSDK_DESIGN_CATALOG="${REPO_ROOT}/plans/aippt-jssdk-skill-strategy/distilled-skills"
if [[ ! -f "${JSSDK_DESIGN_CATALOG}/scripts/evidence-policy.mjs" ]]; then
  JSSDK_DESIGN_CATALOG="${REPO_ROOT}/plan/aippt-jssdk-skill-strategy/distilled-skills"
fi
if [[ -f "${JSSDK_DESIGN_CATALOG}/scripts/evidence-policy.mjs" && -d "${JSSDK_DESIGN_CATALOG}/design-skill" ]]; then
  node scripts/sync-jssdk-design-skill.mjs "${JSSDK_DESIGN_CATALOG}/design-skill" "${JSSDK_DESIGN_CATALOG}"
else
  echo "[build-local-latest] skipping design Skill sync: no distilled catalog at ${REPO_ROOT}/{plans,plan}/aippt-jssdk-skill-strategy/distilled-skills; keeping the snapshot committed in OfficeCLI"
fi
node scripts/sync-jssdk-animation-skill.mjs
build_officecli "${OFFICECLI_SOURCE_BIN}"
build_officecli "${OFFICECLI_STAGE_BIN}"

echo "[build-local-latest] building OfficeDex.app"
cd "${OFFICEDEX_DIR}"
APP_VERSION="$(node -p 'require("./package.json").version')"
PRESENTATION_SOURCE_DIR="${PRESENTATION_DIR}" env -u GOROOT "${WAILS_BIN}" build -ldflags "-X main.appVersion=${APP_VERSION}"
node --input-type=module -e 'import { stageDesktopSkills } from "./scripts/bundle-runtime.mjs"; await stageDesktopSkills("build/bin/OfficeDex.app/Contents/Resources");'
npm run stage:office2modoc
node scripts/bundle-office2modoc.mjs \
  --app build/bin/OfficeDex.app \
  --source build/cache/office2modoc/${OFFICE2MODOC_VERSION}/darwin-arm64/liboffice2modoc_ffi.dylib \
  --expected-arch arm64
npm run bundle:licenses:mac
npm run bundle:officecli:mac

# The packaging flow gates on scripts/verify-packaged-runtime.mjs, which checks
# a complete staged Contents/Resources tree. A local build stages Skills and
# OfficeCLI but uses the presentation checkout, so that gate asks the wrong question.
# Ask the binary instead: it runs the same resolvers the app runs at startup.
echo "[build-local-latest] verifying runtime dependencies"
"${APP_PATH}/Contents/MacOS/officedex" --verify-runtime

echo "[build-local-latest] OfficeCLI build metadata"
go version -m "${OFFICECLI_SOURCE_BIN}" | sed -n '1,5p'
echo "[build-local-latest] built ${APP_PATH}"
if [[ "${OSTYPE}" == darwin* ]]; then
  echo "[build-local-latest] opening ${APP_PATH}"
  open "${APP_PATH}"
fi
