#!/usr/bin/env bash

# Builds one .app per interface, so both can be installed and launched.
#
# The two differ only in which document the build puts at `/` — same bundles,
# same assets, same Go source. But `dist/` is embedded into the binary by
# `go:embed`, so "same Go source" still means two compiles: you cannot produce
# the second variant by copying the first and swapping a file.
#
# Each variant gets its own bundle name, its own CFBundleName and its own
# CFBundleIdentifier. The identifier is the one that actually matters to macOS:
# two bundles sharing one identifier are one app as far as LaunchServices is
# concerned, and which of them opens a document is then a coin toss.
#
#   ./scripts/build-entries.sh            # both
#   ./scripts/build-entries.sh shell      # just the new interface
#   ./scripts/build-entries.sh legacy     # just the previous one
#
# THEY SHARE ONE DATA DIRECTORY, deliberately: ~/Library/Application Support/
# OfficeDex holds the document index both read, which is the whole point of
# being able to open the same library in either interface. The cost is that
# running both at once puts two processes on one SQLite file — it is opened
# with the default journal and no busy timeout, so the second writer gets
# "database is locked". That fails loudly rather than corrupting anything, but
# it does mean: use one at a time.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_DIR="${OFFICEDEX_DIR}/build/bin"
# What `wails build` always produces, whichever variant is being built.
BUILT_APP="${BIN_DIR}/OfficeDex.app"

WANTED="${1:-both}"
case "${WANTED}" in
  shell|legacy|both) ;;
  *)
    echo "[build-entries] usage: $0 [shell|legacy|both]" >&2
    exit 1
    ;;
esac

# Variant -> final bundle name, CFBundleName, CFBundleIdentifier.
variant_bundle() {
  case "$1" in
    shell) echo "OfficeDex.app" ;;
    legacy) echo "OfficeDex Legacy.app" ;;
  esac
}
variant_display_name() {
  case "$1" in
    shell) echo "OfficeDex" ;;
    legacy) echo "OfficeDex Legacy" ;;
  esac
}
variant_identifier() {
  case "$1" in
    shell) echo "com.wails.OfficeDex" ;;
    legacy) echo "com.wails.OfficeDexLegacy" ;;
  esac
}

# `wails build` always writes build/bin/OfficeDex.app — which is also the shell
# variant's final name. So building the legacy variant overwrites whatever is
# sitting there, whether that was produced a second ago by the shell half of
# this same run or last week by a separate invocation. Neither is leftovers.
#
# So a variant whose final name is not OfficeDex.app moves it aside for the
# duration and puts it back afterwards. This makes every order work, including
# running the two halves on different days.
build_variant() {
  local variant="$1"
  local bundle final stash=""
  bundle="$(variant_bundle "${variant}")"
  final="${BIN_DIR}/${bundle}"

  echo "[build-entries] building ${variant} -> ${bundle}"
  mkdir -p -- "${BIN_DIR}"
  if [[ "${final}" != "${BUILT_APP}" ]]; then
    rm -rf -- "${final}"
    if [[ -d "${BUILT_APP}" ]]; then
      stash="${BIN_DIR}/.officedex-entry-stash.$$"
      rm -rf -- "${stash}"
      mv -- "${BUILT_APP}" "${stash}"
    fi
  else
    rm -rf -- "${BUILT_APP}"
  fi

  # OFFICEDEX_ENTRY is validated by scripts/entry-choice.mjs; an unrecognised
  # value fails the build rather than quietly producing the other interface.
  OFFICEDEX_ENTRY="${variant}" OFFICEDEX_SKIP_OPEN=1 bash "${SCRIPT_DIR}/build-local-latest.sh"

  if [[ "${final}" != "${BUILT_APP}" ]]; then
    mv -- "${BUILT_APP}" "${final}"
    if [[ -n "${stash}" ]]; then
      mv -- "${stash}" "${BUILT_APP}"
    fi
  fi

  local plist="${final}/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Set :CFBundleName $(variant_display_name "${variant}")" "${plist}"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $(variant_identifier "${variant}")" "${plist}"
  # A bundle whose Info.plist changed after signing has a broken signature, and
  # macOS refuses to launch it. These are unsigned local builds, so this is
  # about the ad-hoc signature wails applies rather than a Developer ID one.
  codesign --force --deep --sign - "${final}" >/dev/null 2>&1 || true

  echo "[build-entries] built ${final}"
}

if [[ "${WANTED}" == "both" || "${WANTED}" == "shell" ]]; then
  build_variant shell
fi
if [[ "${WANTED}" == "both" || "${WANTED}" == "legacy" ]]; then
  build_variant legacy
fi

echo
echo "[build-entries] done:"
for summary_variant in shell legacy; do
  summary_bundle="${BIN_DIR}/$(variant_bundle "${summary_variant}")"
  if [[ -d "${summary_bundle}" ]]; then
    echo "  ${summary_bundle}  ($(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "${summary_bundle}/Contents/Info.plist" 2>/dev/null))"
  fi
done
echo "[build-entries] they share ~/Library/Application Support/OfficeDex; run one at a time."
