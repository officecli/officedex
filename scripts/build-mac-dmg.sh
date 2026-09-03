#!/usr/bin/env bash
# Builds a signed (and optionally notarized) single-arch OfficeDex.dmg on this Mac.
#
# Unlike `npm run dist:mac` this targets one macOS architecture and produces a
# DMG. The CI release job builds darwin/universal; a local single-arch package
# is for testing the real signing chain without waiting on a tag build.
#
#   bash scripts/build-mac-dmg.sh                     # host arch, sign + notarize + staple
#   TARGET_ARCH=x64 bash scripts/build-mac-dmg.sh     # Intel package
#   SKIP_NOTARIZE=1 bash scripts/build-mac-dmg.sh     # sign only (no Apple round-trip)
#   SKIP_SIGN=1 bash scripts/build-mac-dmg.sh         # ad-hoc only: no Developer ID, no notarization
#   bash scripts/build-mac-dmg.sh --skip-build        # repackage the existing .app
#
# TARGET_ARCH is arm64 or x64 and defaults to the host. Building the non-host
# arch cross-compiles: Go/cgo and Rust both handle darwin<->darwin fine, but the
# inputs must already exist for that arch (see the per-arch preconditions the
# script asserts below) -- nothing here downloads a foreign-arch toolchain.
#
# SKIP_SIGN produces a DMG for local testing only. Everything is ad-hoc signed
# (identity "-"), which is what `wails build` self-signs the outer app with
# anyway; Gatekeeper will quarantine it on any machine that did not build it.
#
# Credentials (notarization only):
#   NOTARIZE_API_KEY_PATH / NOTARIZE_API_KEY_ID / NOTARIZE_API_ISSUER
#   or a notarytool keychain profile in NOTARIZE_PROFILE.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# One knob, several vocabularies: Node tarballs say x64, Go says amd64, Mach-O
# (and therefore lipo) says x86_64. Resolve all of them once so no downstream
# step has to guess.
host_arch="$(uname -m)"
case "${host_arch}" in
  arm64) host_arch=arm64 ;;
  x86_64) host_arch=x64 ;;
esac
TARGET_ARCH="${TARGET_ARCH:-${host_arch}}"

# Called once for the env default and again if --arch overrode it.
resolve_arch() {
  case "${TARGET_ARCH}" in
    arm64)
      TARGET_ARCH=arm64; GO_ARCH=arm64; MACHO_ARCH=arm64; NODE_ARCH=arm64 ;;
    x64|x86_64|amd64)
      TARGET_ARCH=x64;   GO_ARCH=amd64; MACHO_ARCH=x86_64; NODE_ARCH=x64 ;;
    *)
      echo "[build-mac-dmg] unsupported architecture: ${TARGET_ARCH} (use arm64 or x64)" >&2
      exit 2 ;;
  esac
  LOG="build-mac-dmg/${TARGET_ARCH}"
}
resolve_arch

APP_PATH="${OFFICEDEX_DIR}/build/bin/OfficeDex.app"
OUT_DIR="${OFFICEDEX_DIR}/dist-artifacts"
IDENTITY="${CODESIGN_IDENTITY:-Developer ID Application: ChuXin Tec Co., Ltd. (Z35T9799TW)}"
SKIP_BUILD=0
SKIP_SIGN="${SKIP_SIGN:-0}"
# An unsigned build cannot be notarized, so SKIP_SIGN implies SKIP_NOTARIZE
# rather than failing later on missing Apple credentials.
if [[ "${SKIP_SIGN}" == "1" ]]; then
  IDENTITY="-"
  SKIP_NOTARIZE=1
fi

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1 ;;
    --arch) TARGET_ARCH="$2"; shift ;;
    *) echo "[${LOG}] unknown option: $1" >&2 ; exit 2 ;;
  esac
  shift
done

# --arch is parsed after the first resolve_arch, so redo it if it was used.
resolve_arch

# notarytool multipart uploads to AWS S3 can drop mid-transfer (NAT/idle
# timeouts, transient network hiccups). CI wraps notarize.mjs in a retry loop
# for the same reason; do it here too so a single upload blip does not throw
# away the whole build.
notarize_with_retry() {
  local target="$1"
  local attempt=1
  local max=4
  while (( attempt <= max )); do
    if node scripts/notarize.mjs "${target}"; then
      return 0
    fi
    if (( attempt == max )); then
      echo "[${LOG}] notarize.mjs failed after ${max} attempts for ${target}" >&2
      return 1
    fi
    local delay=$(( attempt * 30 ))
    echo "[${LOG}] attempt ${attempt} failed; retrying in ${delay}s" >&2
    sleep "${delay}"
    attempt=$(( attempt + 1 ))
  done
}

cd "${OFFICEDEX_DIR}"

# Two concurrent runs share build/bin and dist-artifacts, and the DMG step does
# `rm -f` on a fixed path -- an overlapping run silently deletes an artifact the
# other one just verified. That has happened. Serialize on a lockfile instead.
# The lock is deliberately NOT per-arch: build/bin/OfficeDex.app is a single
# shared path, so an arm64 and an x64 build would clobber each other just as
# badly as two same-arch builds.
LOCK_DIR="${OFFICEDEX_DIR}/build/.build-mac-dmg.lock"
if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  holder="$(cat "${LOCK_DIR}/pid" 2>/dev/null || echo unknown)"
  if [[ "${holder}" != unknown ]] && kill -0 "${holder}" 2>/dev/null; then
    echo "[${LOG}] another build is running (pid ${holder}); refusing to clobber it" >&2
    exit 1
  fi
  echo "[${LOG}] clearing stale lock from pid ${holder}" >&2
  rm -rf "${LOCK_DIR}"
  mkdir "${LOCK_DIR}"
fi
echo "$$" > "${LOCK_DIR}/pid"
trap 'rm -rf "${LOCK_DIR}"' EXIT

APP_VERSION="$(node -p 'require("./package.json").version')"
DMG_PATH="${OUT_DIR}/OfficeDex-${APP_VERSION}-darwin-${TARGET_ARCH}.dmg"

# The DMG path is fixed per version+arch, and the build step below does `rm -f`
# on it. An unsigned run (SKIP_SIGN / SKIP_NOTARIZE) therefore silently replaces
# a previously notarized release image with a test one -- the file keeps its
# name and only `stapler validate` reveals the swap. That has happened. Refuse
# to overwrite a stapled DMG unless the caller says so.
if [[ -f "${DMG_PATH}" && "${ALLOW_DMG_OVERWRITE:-0}" != "1" ]] \
   && xcrun stapler validate "${DMG_PATH}" >/dev/null 2>&1; then
  echo "[${LOG}] ${DMG_PATH} is notarized + stapled; refusing to overwrite it" >&2
  echo "[${LOG}] move it aside, or re-run with ALLOW_DMG_OVERWRITE=1" >&2
  exit 1
fi

# The signing identity must exist before a long build burns time for nothing.
if [[ "${SKIP_SIGN}" == "1" ]]; then
  echo "[${LOG}] identity: (ad-hoc, unsigned build)"
elif ! security find-identity -v -p codesigning | grep -qF "${IDENTITY}"; then
  echo "[${LOG}] signing identity not in keychain: ${IDENTITY}" >&2
  echo "[${LOG}] import the Developer ID .p12 first, or use SKIP_SIGN=1" >&2
  exit 1
else
  echo "[${LOG}] identity: ${IDENTITY}"
fi
echo "[${LOG}] version:  ${APP_VERSION}"
echo "[${LOG}] target:   darwin/${GO_ARCH} (Mach-O ${MACHO_ARCH})"
if [[ "${TARGET_ARCH}" != "${host_arch}" ]]; then
  echo "[${LOG}] NOTE: cross-compiling from ${host_arch}; the produced app cannot be run here"
fi

# Notarization credentials are only consulted after a full build, so check them
# up front rather than failing at the last step.
if [[ "${SKIP_NOTARIZE:-}" != "1" ]]; then
  if [[ -n "${NOTARIZE_API_KEY_PATH:-}" || -n "${NOTARIZE_API_KEY_ID:-}" || -n "${NOTARIZE_API_ISSUER:-}" ]]; then
    missing=()
    [[ -n "${NOTARIZE_API_KEY_PATH:-}" ]] || missing+=(NOTARIZE_API_KEY_PATH)
    [[ -n "${NOTARIZE_API_KEY_ID:-}" ]] || missing+=(NOTARIZE_API_KEY_ID)
    [[ -n "${NOTARIZE_API_ISSUER:-}" ]] || missing+=(NOTARIZE_API_ISSUER)
    if [[ ${#missing[@]} -gt 0 ]]; then
      echo "[${LOG}] incomplete API-key credentials; missing: ${missing[*]}" >&2
      echo "[${LOG}] set all three, or use SKIP_NOTARIZE=1 to sign only" >&2
      exit 1
    fi
    [[ -f "${NOTARIZE_API_KEY_PATH}" ]] || {
      echo "[${LOG}] API key not found: ${NOTARIZE_API_KEY_PATH}" >&2
      exit 1
    }
    echo "[${LOG}] notarize: API key ${NOTARIZE_API_KEY_ID}"
  elif xcrun notarytool history --keychain-profile "${NOTARIZE_PROFILE:-OfficeDex-Notarize}" >/dev/null 2>&1; then
    echo "[${LOG}] notarize: keychain profile ${NOTARIZE_PROFILE:-OfficeDex-Notarize}"
  else
    echo "[${LOG}] no notarization credentials available." >&2
    echo "[${LOG}] Either set NOTARIZE_API_KEY_PATH/_ID/_ISSUER," >&2
    echo "[${LOG}] or store a profile:" >&2
    echo "[${LOG}]   xcrun notarytool store-credentials OfficeDex-Notarize \\" >&2
    echo "[${LOG}]     --key <AuthKey.p8> --key-id <KEY_ID> --issuer <ISSUER_UUID>" >&2
    echo "[${LOG}] or re-run with SKIP_NOTARIZE=1 to sign without notarizing." >&2
    exit 1
  fi
fi

if [[ "${SKIP_BUILD}" -eq 0 ]]; then
  echo "[${LOG}] prefetching officecli"
  npm run prefetch:officecli

  # Homebrew's node links against ~20 Cellar dylibs and cannot be redistributed.
  # The official darwin tarball is self-contained, so extract that instead
  # and point MOP_RUNTIME_SOURCE at it. This is the runtime that ships inside
  # the app, so it must match the TARGET arch, not the build host's.
  echo "[${LOG}] staging MOP Node runtime (darwin-${NODE_ARCH})"
  NODE_TARBALL="${OFFICEDEX_DIR}/build/cache/pptxgenjs-runtime/node-v24.18.0-darwin-${NODE_ARCH}.tar.gz"
  NODE_RUNTIME_DIR="${OFFICEDEX_DIR}/build/node-runtime-${TARGET_ARCH}"
  if [[ ! -f "${NODE_TARBALL}" ]]; then
    echo "[${LOG}] missing Node tarball: ${NODE_TARBALL}" >&2
    echo "[${LOG}] fetch the darwin-${NODE_ARCH} tarball into build/cache/pptxgenjs-runtime/ first" >&2
    exit 1
  fi
  SHASUMS="${OFFICEDEX_DIR}/build/cache/pptxgenjs-runtime/node-v24.18.0-SHASUMS256.txt"
  expected="$(awk -v f="node-v24.18.0-darwin-${NODE_ARCH}.tar.gz" '$2 == f || $2 == "*"f {print $1}' "${SHASUMS}")"
  actual="$(shasum -a 256 "${NODE_TARBALL}" | awk '{print $1}')"
  if [[ -z "${expected}" || "${expected}" != "${actual}" ]]; then
    echo "[${LOG}] Node tarball checksum mismatch" >&2
    exit 1
  fi
  rm -rf "${NODE_RUNTIME_DIR}"
  mkdir -p "${NODE_RUNTIME_DIR}"
  tar -xzf "${NODE_TARBALL}" -C "${NODE_RUNTIME_DIR}" --strip-components=1
  MOP_RUNTIME_SOURCE="${NODE_RUNTIME_DIR}" npm run stage:mop-runtime

  # The MOP presentation runtime (Vite SSR root + mop-convert). Without this
  # the packaged app has nothing at Resources/presentation and every PPTX
  # generation on a user's machine fails with "mop-convert was not found".
  # PRESENTATION_TARGET_ARCH picks the target's esbuild/rollup natives; the
  # presentation checkout must have been installed with that arch available.
  #
  # mop-convert is a native binary and the presentation checkout only ever
  # holds one arch's copy (tools/bin/mop-convert, whatever was built last).
  # Staging it blind would silently package the host's arm64 converter into an
  # Intel app; the assertion further down catches that, but only after a full
  # Wails build. Resolve it here, per-arch, and fail before any of that work.
  #
  # MOP_CONVERT_BIN is the same override stage-presentation-runtime.mjs reads,
  # so an explicit value still wins.
  if [[ -z "${MOP_CONVERT_BIN:-}" ]]; then
    for candidate in \
      "${OFFICEDEX_DIR}/build/cache/mop-convert/darwin-${TARGET_ARCH}/mop-convert" \
      "${OFFICEDEX_DIR}/../ppt2mop/target/${MACHO_ARCH}-apple-darwin/release/mop-convert"
    do
      [[ -f "${candidate}" ]] || continue
      if lipo -archs "${candidate}" 2>/dev/null | grep -qw "${MACHO_ARCH}"; then
        MOP_CONVERT_BIN="${candidate}"
        break
      fi
    done
  fi
  if [[ -n "${MOP_CONVERT_BIN:-}" ]]; then
    archs="$(lipo -archs "${MOP_CONVERT_BIN}" 2>/dev/null || echo unknown)"
    if ! grep -qw "${MACHO_ARCH}" <<<"${archs}"; then
      echo "[${LOG}] ${MOP_CONVERT_BIN} has no ${MACHO_ARCH} slice (got: ${archs})" >&2
      exit 1
    fi
    echo "[${LOG}] mop-convert source: ${MOP_CONVERT_BIN} (${archs})"
    export MOP_CONVERT_BIN
  else
    # Fall through to the checkout's own copy only when it already matches;
    # otherwise say exactly how to produce the missing one.
    checkout_converter="$(node -e 'import("./scripts/stage-presentation-runtime.mjs").then(m=>console.log(m.resolvePresentationSource()))' 2>/dev/null)/tools/bin/mop-convert"
    archs="$(lipo -archs "${checkout_converter}" 2>/dev/null || echo missing)"
    if ! grep -qw "${MACHO_ARCH}" <<<"${archs}"; then
      echo "[${LOG}] no ${MACHO_ARCH} mop-convert available (checkout has: ${archs})" >&2
      echo "[${LOG}] build one, e.g. in the ppt2mop checkout:" >&2
      echo "[${LOG}]   cargo build --release -p mop-convert --target ${MACHO_ARCH}-apple-darwin" >&2
      echo "[${LOG}] or point MOP_CONVERT_BIN at an existing ${MACHO_ARCH} binary" >&2
      exit 1
    fi
  fi

  echo "[${LOG}] staging MOP presentation runtime"
  PRESENTATION_TARGET_ARCH="${TARGET_ARCH}" PRESENTATION_TARGET_PLATFORM=darwin \
    npm run stage:presentation

  # The embedded MOP worker was patched (worker cacheDir must live outside
  # the bundle, or Vite invalidates the code signature on first write). That
  # worker is `//go:embed`-ed into officecli, so we must rebuild officecli
  # from officecli-internal rather than reuse the fetched release binary.
  OFFICECLI_INTERNAL="${OFFICEDEX_DIR}/../officecli-internal"
  if [[ -d "${OFFICECLI_INTERNAL}" ]]; then
    echo "[${LOG}] rebuilding officecli from ${OFFICECLI_INTERNAL}"
    (
      cd "${OFFICECLI_INTERNAL}"
      # prefetch:officecli just staged a universal (fat) binary at this path.
      # `go build -o` refuses to overwrite a file it does not recognise as an
      # object file ("already exists and is not an object file"), so clear it
      # first. Without this the build dies right here whenever prefetch
      # actually downloaded rather than skipped.
      rm -f "${OFFICEDEX_DIR}/build/officecli/officecli"
      # officecli is pure Go (CGO_ENABLED=0 in its own release config), so
      # GOARCH alone cross-compiles it cleanly.
      env -u GOROOT GOOS=darwin GOARCH="${GO_ARCH}" CGO_ENABLED=0 go build -trimpath \
        -o "${OFFICEDEX_DIR}/build/officecli/officecli" ./cmd/officecli
    )
    lipo -info "${OFFICEDEX_DIR}/build/officecli/officecli" | head -1
  else
    echo "[${LOG}] officecli-internal not found; keeping fetched release binary" >&2
    echo "[${LOG}] WARNING: it may lack the worker cacheDir fix" >&2
  fi

  # main.go embeds dist/ verbatim (`//go:embed all:dist`), so every font byte in
  # the frontend build becomes a byte of the shipped binary. The desktop
  # presentation build drops the ~66MB Office CJK webfont payload because the
  # host OS already provides those families. Pass -s so wails does not rebuild
  # the frontend through its default script.
  echo "[${LOG}] building desktop frontend (host fonts, no bundled CJK)"
  npm run build:frontend:desktop

  echo "[${LOG}] building OfficeDex.app (darwin/${GO_ARCH})"
  env -u GOROOT wails build -platform "darwin/${GO_ARCH}" -trimpath -s \
    -ldflags "-X main.appVersion=${APP_VERSION}"

  node scripts/verify-wails-app.mjs "${APP_PATH}"

  echo "[${LOG}] bundling runtimes and licenses"
  node scripts/bundle-runtime.mjs
  # `npm run bundle:office2modoc:mac` defaults to the darwin-universal FFI,
  # which only the CI release job produces. This script targets a single arch,
  # so bundle that slice explicitly and assert it really is single-arch.
  OFFICE2MODOC_DYLIB="${OFFICEDEX_DIR}/build/cache/office2modoc/0.1.34/darwin-${TARGET_ARCH}/liboffice2modoc_ffi.dylib"
  if [[ ! -f "${OFFICE2MODOC_DYLIB}" ]]; then
    echo "[${LOG}] missing office2modoc FFI: ${OFFICE2MODOC_DYLIB}" >&2
    echo "[${LOG}] stage it first, e.g.:" >&2
    echo "[${LOG}]   OFFICE2MODOC_TARGET=${MACHO_ARCH}-apple-darwin node scripts/stage-office2modoc-ffi.mjs" >&2
    exit 1
  fi
  node scripts/bundle-office2modoc.mjs \
    --app "${APP_PATH}" \
    --source "${OFFICE2MODOC_DYLIB}" \
    --expected-arch "${MACHO_ARCH}" \
    --identity "${IDENTITY}"
  npm run bundle:licenses:mac

  # Deliberately not `npm run bundle:officecli:mac`: that script hardcodes
  # build/darwin/local-entitlements.plist, which grants
  # disable-library-validation for ad-hoc dev builds. A Developer ID build
  # signs every nested binary with one identity and must not weaken library
  # validation, so stage officecli with the real identity and no entitlements.
  echo "[${LOG}] staging + signing bundled officecli"
  # An ad-hoc build is the case the local entitlements exist for: without
  # disable-library-validation an ad-hoc outer app cannot load the nested
  # binaries it just ad-hoc signed.
  officecli_args=(
    --app "${APP_PATH}"
    --source "${OFFICEDEX_DIR}/build/officecli/officecli"
    --identity "${IDENTITY}"
  )
  if [[ "${SKIP_SIGN}" == "1" && -f "${OFFICEDEX_DIR}/build/darwin/local-entitlements.plist" ]]; then
    officecli_args+=(--entitlements "${OFFICEDEX_DIR}/build/darwin/local-entitlements.plist")
  fi
  node scripts/codesign-bundled-officecli.mjs "${officecli_args[@]}"

  node scripts/verify-wails-app.mjs "${APP_PATH}"
fi

if [[ ! -d "${APP_PATH}" ]]; then
  echo "[${LOG}] no app bundle at ${APP_PATH}" >&2
  exit 1
fi

# A universal officecli inside a single-arch app is fine, but a binary carrying
# only the *other* arch would fail to exec. Assert the target slice is present.
for bin in "${APP_PATH}/Contents/MacOS/officedex" \
           "${APP_PATH}/Contents/Resources/officecli/officecli"; do
  archs="$(lipo -archs "${bin}")"
  echo "[${LOG}] $(basename "${bin}") archs: ${archs}"
  grep -qw "${MACHO_ARCH}" <<<"${archs}" || {
    echo "[${LOG}] ${bin} has no ${MACHO_ARCH} slice (got: ${archs})" >&2
    exit 1
  }
done

# The two native payloads that are not Go binaries: they are staged from
# separate per-arch caches, so a stale cache is the likeliest way to ship a
# package that dies on the user's machine with "bad CPU type".
for bin in "${APP_PATH}/Contents/Resources/presentation/tools/bin/mop-convert" \
           "${APP_PATH}/Contents/Resources/mop-runtime/bin/node"; do
  [[ -f "${bin}" ]] || continue
  archs="$(lipo -archs "${bin}" 2>/dev/null || echo unknown)"
  echo "[${LOG}] $(basename "${bin}") archs: ${archs}"
  grep -qw "${MACHO_ARCH}" <<<"${archs}" || {
    echo "[${LOG}] ${bin} has no ${MACHO_ARCH} slice (got: ${archs})" >&2
    exit 1
  }
done

if [[ "${SKIP_SIGN}" == "1" ]]; then
  echo "[${LOG}] skipping Developer ID signing + notarization of .app"
else
  echo "[${LOG}] signing + notarizing .app"
  notarize_with_retry "${APP_PATH}"
fi

echo "[${LOG}] building DMG"
mkdir -p "${OUT_DIR}"
rm -f "${DMG_PATH}"
# Stage the .app alone so stray build/bin siblings stay out of the image.
STAGING="$(mktemp -d)"
# Keep the lock cleanup: a bare `trap ... EXIT` here would replace it.
trap 'rm -rf "${STAGING}" "${LOCK_DIR}"' EXIT
cp -R "${APP_PATH}" "${STAGING}/"
ln -s /Applications "${STAGING}/Applications"

if command -v create-dmg >/dev/null 2>&1; then
  create-dmg \
    --volname "OfficeDex ${APP_VERSION}" \
    --window-pos 200 120 --window-size 600 400 --icon-size 100 \
    --icon "OfficeDex.app" 175 200 --hide-extension "OfficeDex.app" \
    --app-drop-link 425 200 --no-internet-enable \
    "${DMG_PATH}" "${STAGING}" || true
fi

# create-dmg is optional; hdiutil ships with macOS and is the fallback so this
# script works on a machine without Homebrew.
if [[ ! -f "${DMG_PATH}" ]]; then
  echo "[${LOG}] create-dmg unavailable or failed; using hdiutil"
  hdiutil create -volname "OfficeDex ${APP_VERSION}" \
    -srcfolder "${STAGING}" -ov -format UDZO "${DMG_PATH}"
fi

if [[ "${SKIP_SIGN}" == "1" ]]; then
  echo "[${LOG}] skipping Developer ID signing + notarization of DMG"
  echo "[${LOG}] NOTE: unsigned image; on another Mac clear quarantine with"
  echo "[${LOG}]   xattr -dr com.apple.quarantine /Applications/OfficeDex.app"
else
  echo "[${LOG}] signing + notarizing DMG"
  notarize_with_retry "${DMG_PATH}"
fi

shasum -a 256 "${DMG_PATH}"
echo "[${LOG}] done: ${DMG_PATH}"
