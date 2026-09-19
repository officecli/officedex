#!/usr/bin/env bash

set -euo pipefail
OFFICE2MODOC_VERSION="$(tr -d '[:space:]' < "$(dirname "$0")/../office2modoc.version")"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/officecli-ldflags.sh
source "${SCRIPT_DIR}/officecli-ldflags.sh"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${OFFICEDEX_DIR}/.." && pwd)"
OFFICECLI_DIR="${REPO_ROOT}/officecli-internal"
OFFICECLI_SOURCE_BIN="${OFFICECLI_DIR}/officecli"
OFFICECLI_STAGE_BIN="${OFFICEDEX_DIR}/build/officecli/officecli"
APP_PATH="${OFFICEDEX_DIR}/build/bin/OfficeDex.app"
OFFICECLI_RELEASE_VERSION="$(node -p "require('${OFFICEDEX_DIR}/package.json').officecliVersion")"
PRESENTATION_DIR="${REPO_ROOT}/presentation"
WAILS_BIN="$(command -v wails || true)"
if [[ -z "${WAILS_BIN}" ]]; then
  WAILS_BIN="$(env -u GOROOT go env GOPATH)/bin/wails"
fi
if [[ ! -x "${WAILS_BIN}" ]]; then
  echo "[build-local-latest] wails is unavailable in PATH or GOPATH/bin" >&2
  exit 1
fi

if [[ ! -d "${OFFICECLI_DIR}" ]]; then
  echo "[build-local-latest] missing officecli-internal at ${OFFICECLI_DIR}" >&2
  exit 1
fi
if [[ ! -f "${PRESENTATION_DIR}/package.json" ]]; then
  echo "[build-local-latest] missing presentation checkout at ${PRESENTATION_DIR}" >&2
  exit 1
fi

if [[ "${OSTYPE}" == darwin* ]]; then
  /usr/bin/osascript -l JavaScript "${SCRIPT_DIR}/quit-officedex-app.js"
fi

build_officecli() {
  local output="$1"
  local temporary
  mkdir -p "$(dirname "${output}")"
  temporary="$(mktemp "${output}.tmp.XXXXXX")"
  trap 'rm -f "${temporary}"' RETURN
  env -u GOROOT go build -trimpath \
    -ldflags "$(officecli_ldflags "${OFFICECLI_DIR}" "${OFFICECLI_RELEASE_VERSION}" "local-build" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")" \
    -o "${temporary}" ./cmd/officecli
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
node "${SCRIPT_DIR}/verify-officecli-canvas-contract.mjs" \
  --binary "${OFFICECLI_STAGE_BIN}" \
  --expected "${OFFICECLI_RELEASE_VERSION}"

echo "[build-local-latest] building OfficeDex.app"
cd "${OFFICEDEX_DIR}"
APP_VERSION="$(node -p 'require("./package.json").version')"
# Writer is optional on machines without the sibling checkout.
export WRITER_OPTIONAL=1
# The frontend is built here rather than left to `wails build`, which would run
# the same script (wails.json frontend:build) through its own process plumbing.
# Doing it directly keeps build-time switches — OFFICEDEX_ENTRY in particular —
# on one short, visible path from this shell to vite, and puts vite's output in
# this log instead of behind "Compiling frontend: Done.". `-s` then tells wails
# the frontend is already there.
PRESENTATION_SOURCE_DIR="${PRESENTATION_DIR}" bash "${SCRIPT_DIR}/build-frontend-desktop.sh"
PRESENTATION_SOURCE_DIR="${PRESENTATION_DIR}" env -u GOROOT "${WAILS_BIN}" build -s -ldflags "-X main.appVersion=${APP_VERSION}"
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
# OfficeCLI but uses the presentation checkout, so that gate asks the wrong
# question: ask the binary instead, because it runs the same resolvers the app
# runs at startup.
#
# wails build leaves Contents/Resources alone, so payloads a previous DMG build
# staged there outlive it. A local build stages no Node runtime, so any
# mop-runtime in this bundle came from an earlier build -- carried unnoticed into
# every local build for four days and, since the app prefers the runtime beside
# its executable, the one the worker actually ran. What this build ships is this
# build's decision, not build history's.
rm -rf "${APP_PATH}/Contents/Resources/mop-runtime"

# Same carry-over, same preference order, different payload: a local build stages
# no presentation runtime, but a DMG build's staged copy survives in the bundle
# and both runtimeenv.BridgeEnv and officecli's resolver prefer
# Contents/Resources/presentation over the checkout. That copy is whatever the
# staging list contained the day the DMG was built -- it carries the four markers
# the resolvers check, so it wins, and then the JSSDK Host runner it never staged
# (tools/execute-jssdk.mjs) is missing and PPTX generation fails. Drop it so this
# build runs against ${PRESENTATION_DIR}, which is the checkout it was built from.
rm -rf "${APP_PATH}/Contents/Resources/presentation"

echo "[build-local-latest] verifying runtime dependencies"
"${APP_PATH}/Contents/MacOS/officedex" --verify-runtime

# Then ask the packaging gate what it can answer here. A local build stages no
# Node runtime, so mop-runtime is allowed to be absent -- but not allowed to be
# present and broken. It was exactly that: a stale build/mop-runtime holding a
# symlink to Homebrew's node got bundled into every local build for four days,
# and because the app prefers the runtime beside its executable over the one on
# PATH, it was also the one the worker ran, straight into a dyld abort.
echo "[build-local-latest] verifying packaged runtime payloads"
node scripts/verify-packaged-runtime.mjs build/bin --may-be-absent=mop-runtime,writer-fonts,presentation

echo "[build-local-latest] OfficeCLI build metadata"
go version -m "${OFFICECLI_SOURCE_BIN}" | sed -n '1,5p'
echo "[build-local-latest] built ${APP_PATH}"
# scripts/build-entries.sh renames this bundle after the build, so it sets this
# and opens the final one itself. Launching a bundle that is about to be moved
# out from under the running process is a good way to spend an afternoon.
if [[ "${OSTYPE}" == darwin* && "${OFFICEDEX_SKIP_OPEN:-}" != "1" ]]; then
  echo "[build-local-latest] opening ${APP_PATH}"
  open "${APP_PATH}"
fi
