#!/usr/bin/env bash

# Keeps what desktop development runs in step with the sibling checkouts:
# public/presentation and public/writer (the embedded editors) and
# build/officecli/officecli (the bridge binary, from officecli-internal).
#
#   dev-deps.sh sync    fast-forward clean checkouts, rebuild whatever is out
#                       of date, then exit
#   dev-deps.sh watch   poll the checkouts' HEAD and sync when one moves
#
# Vite serves public/ as-is, so a rebuilt editor only needs a webview reload
# (Cmd+R). A rebuilt OfficeCLI is picked up the next time the bridge starts,
# which in practice means restarting dev mode.
#
# A failed rebuild is a warning, never fatal: the previous artifact stays in
# place, and dev mode is still usable for everything else.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OFFICEDEX_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
PRESENTATION_SOURCE="${PRESENTATION_SOURCE_DIR:-${OFFICEDEX_DIR}/../presentation}"
WRITER_SOURCE="${WRITER_SOURCE_DIR:-${OFFICEDEX_DIR}/../writer}"
OFFICECLI_SOURCE="${OFFICECLI_SOURCE_DIR:-${OFFICEDEX_DIR}/../officecli-internal}"
PRESENTATION_STAMP="${OFFICEDEX_DIR}/build/presentation/.dev-deps-stamp"
OFFICECLI_BIN="${OFFICEDEX_DIR}/build/officecli/officecli"
OFFICECLI_STAMP="${OFFICEDEX_DIR}/build/officecli/.dev-deps-stamp"
WATCH_INTERVAL="${OFFICEDEX_DEPS_WATCH_INTERVAL:-30}"

log() { echo "[dev-deps] $*" >&2; }

# Fast-forwards a checkout to its upstream, but only when that cannot touch
# anyone's work: no uncommitted tracked changes, a branch with an upstream, and
# no local commits the upstream lacks. Anything else is reported and left alone.
pull_if_clean() {
  local name="$1" dir="$2"
  if [[ "${OFFICEDEX_DEPS_PULL:-1}" != "1" ]] || ! git -C "${dir}" rev-parse --git-dir >/dev/null 2>&1; then
    return 0
  fi
  local upstream
  if ! upstream="$(git -C "${dir}" rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)"; then
    log "${name}: no upstream branch; not pulling"
    return 0
  fi
  if [[ -n "$(git -C "${dir}" status --porcelain --untracked-files=no)" ]]; then
    log "${name}: uncommitted changes; not pulling"
    return 0
  fi
  # fegit is reached over SSH through the company VPN; fail fast instead of
  # hanging dev startup when it is down, and never prompt for credentials.
  if ! GIT_SSH_COMMAND="${GIT_SSH_COMMAND:-ssh -o BatchMode=yes -o ConnectTimeout=8 -o ServerAliveInterval=5 -o ServerAliveCountMax=3}" \
    git -C "${dir}" fetch --quiet 2>/dev/null; then
    log "WARNING: ${name}: fetch failed (is EasyConnect connected?); using the local checkout"
    return 0
  fi
  local counts ahead behind
  counts="$(git -C "${dir}" rev-list --left-right --count 'HEAD...@{u}')"
  ahead="${counts%%[[:space:]]*}"
  behind="${counts##*[[:space:]]}"
  if (( behind == 0 )); then
    log "${name}: up to date with ${upstream}"
  elif (( ahead > 0 )); then
    log "${name}: ${ahead} local commit(s) not on ${upstream}; not pulling ${behind} upstream commit(s)"
  elif git -C "${dir}" merge --ff-only --quiet '@{u}'; then
    log "${name}: pulled ${behind} commit(s) from ${upstream}"
  else
    log "WARNING: ${name}: fast-forward to ${upstream} failed; using the local checkout"
  fi
}

source_head() {
  git -C "$1" rev-parse HEAD 2>/dev/null || echo "none"
}

# Everything the desktop presentation bundle is built from: the checkout's HEAD
# and uncommitted edits, plus the officedex-side Vite config and build scripts.
presentation_stamp() {
  {
    echo "head $(source_head "${PRESENTATION_SOURCE}")"
    git -C "${PRESENTATION_SOURCE}" diff HEAD --binary 2>/dev/null
    git -C "${PRESENTATION_SOURCE}" status --porcelain --untracked-files=normal 2>/dev/null
    (cd "${OFFICEDEX_DIR}" && find presentation-component scripts/build-embedded-presentation.sh \
      scripts/build-embedded-presentation-desktop.sh scripts/sync-presentation-component.mjs \
      -type f -not -name '*.test.*' | sort | xargs shasum)
  } | shasum | awk '{print $1}'
}

sync_presentation() {
  if [[ ! -d "${PRESENTATION_SOURCE}" ]]; then
    log "presentation checkout not found at ${PRESENTATION_SOURCE}; skipping"
    return 0
  fi
  local stamp
  stamp="$(presentation_stamp)"
  if [[ -f "${OFFICEDEX_DIR}/public/presentation/officedex-component.json" \
    && "$(cat "${PRESENTATION_STAMP}" 2>/dev/null)" == "${stamp}" ]]; then
    log "presentation is up to date"
    return 0
  fi
  log "presentation changed; rebuilding the desktop bundle"
  local build=(env -u PPT2MOP_SOURCE_DIR "PRESENTATION_SOURCE_DIR=${PRESENTATION_SOURCE}")
  # An explicit PPT2MOP_SOURCE_DIR makes the Vite config require it, so only
  # forward a checkout that exists (start-desktop.sh passes its default blindly).
  if [[ -n "${PPT2MOP_SOURCE_DIR:-}" && -d "${PPT2MOP_SOURCE_DIR}" ]]; then
    build+=("PPT2MOP_SOURCE_DIR=${PPT2MOP_SOURCE_DIR}")
  fi
  if (cd "${OFFICEDEX_DIR}" && "${build[@]}" bash scripts/build-embedded-presentation-desktop.sh); then
    mkdir -p "$(dirname "${PRESENTATION_STAMP}")"
    echo "${stamp}" >"${PRESENTATION_STAMP}"
    log "presentation rebuilt; reload the OfficeDex window (Cmd+R) to pick it up"
    # A new mop-wasm arrives with a sync, and a schema bump the stamps do not
    # follow makes every presentation fail to open. Not fatal here — nothing in
    # this script is — but loud, because the symptom points nowhere near it.
    if ! (cd "${OFFICEDEX_DIR}" && node scripts/verify-mop-schema.mjs --root "${PRESENTATION_SOURCE}"); then
      log "WARNING: MOP schema mismatch — presentations will not open until both schema constants are updated (see above)"
    fi
  else
    log "WARNING: presentation rebuild failed; keeping the previous public/presentation"
  fi
}

# Everything the OfficeCLI binary is built from: the checkout's HEAD and
# uncommitted edits, plus the ldflags recipe (which carries the licence key).
officecli_stamp() {
  {
    echo "head $(source_head "${OFFICECLI_SOURCE}")"
    git -C "${OFFICECLI_SOURCE}" diff HEAD --binary 2>/dev/null
    git -C "${OFFICECLI_SOURCE}" status --porcelain --untracked-files=normal 2>/dev/null
    shasum "${SCRIPT_DIR}/officecli-ldflags.sh"
  } | shasum | awk '{print $1}'
}

# Builds the same way build-local-latest.sh does, minus the Skill snapshot
# syncs (those rewrite files inside officecli-internal, which dev startup must
# not do behind the user's back).
sync_officecli() {
  if [[ ! -f "${OFFICECLI_SOURCE}/cmd/officecli/main.go" ]]; then
    log "officecli-internal checkout not found at ${OFFICECLI_SOURCE}; keeping ${OFFICECLI_BIN}"
    return 0
  fi
  local stamp
  stamp="$(officecli_stamp)"
  if [[ -x "${OFFICECLI_BIN}" && "$(cat "${OFFICECLI_STAMP}" 2>/dev/null)" == "${stamp}" ]]; then
    log "officecli is up to date"
    return 0
  fi
  log "officecli changed; rebuilding ${OFFICECLI_BIN}"
  # shellcheck source=scripts/officecli-ldflags.sh
  source "${SCRIPT_DIR}/officecli-ldflags.sh"
  local version ldflags temporary
  version="$(node -p "require('${OFFICEDEX_DIR}/package.json').officecliVersion")"
  if ! ldflags="$(officecli_ldflags "${OFFICECLI_SOURCE}" "${version}" "local-dev" "$(date -u +%Y-%m-%dT%H:%M:%SZ)")"; then
    log "WARNING: cannot resolve OfficeCLI ldflags; keeping the previous binary"
    return 0
  fi
  mkdir -p "$(dirname "${OFFICECLI_BIN}")"
  temporary="$(mktemp "${OFFICECLI_BIN}.tmp.XXXXXX")"
  if (cd "${OFFICECLI_SOURCE}" && env -u GOROOT go build -trimpath -ldflags "${ldflags}" -o "${temporary}" ./cmd/officecli); then
    chmod 0755 "${temporary}"
    mv "${temporary}" "${OFFICECLI_BIN}"
    echo "${stamp}" >"${OFFICECLI_STAMP}"
    log "officecli rebuilt; restart dev mode if the bridge is already running"
  else
    rm -f "${temporary}"
    log "WARNING: officecli build failed; keeping the previous binary"
  fi
}

# build-embedded-writer.sh fingerprints the checkout itself and returns early on
# a cache hit, so no stamp is needed here.
sync_writer() {
  if (cd "${OFFICEDEX_DIR}" && WRITER_OPTIONAL=1 WRITER_SOURCE_DIR="${WRITER_SOURCE}" \
    bash scripts/build-embedded-writer.sh); then
    return 0
  fi
  log "WARNING: writer rebuild failed (is EasyConnect connected?); keeping the previous public/writer"
}

watch() {
  local presentation_head writer_head officecli_head
  presentation_head="$(source_head "${PRESENTATION_SOURCE}")"
  writer_head="$(source_head "${WRITER_SOURCE}")"
  officecli_head="$(source_head "${OFFICECLI_SOURCE}")"
  log "watching presentation, writer and officecli-internal for new commits every ${WATCH_INTERVAL}s"
  while sleep "${WATCH_INTERVAL}"; do
    local next
    next="$(source_head "${PRESENTATION_SOURCE}")"
    if [[ "${next}" != "${presentation_head}" ]]; then
      presentation_head="${next}"
      sync_presentation
    fi
    next="$(source_head "${WRITER_SOURCE}")"
    if [[ "${next}" != "${writer_head}" ]]; then
      writer_head="${next}"
      sync_writer
    fi
    next="$(source_head "${OFFICECLI_SOURCE}")"
    if [[ "${next}" != "${officecli_head}" ]]; then
      officecli_head="${next}"
      sync_officecli
    fi
  done
}

case "${1:-sync}" in
  sync)
    pull_if_clean presentation "${PRESENTATION_SOURCE}"
    pull_if_clean writer "${WRITER_SOURCE}"
    pull_if_clean officecli-internal "${OFFICECLI_SOURCE}"
    sync_presentation
    sync_writer
    sync_officecli
    ;;
  watch) watch ;;
  *) echo "Usage: scripts/dev-deps.sh [sync|watch]" >&2; exit 2 ;;
esac
