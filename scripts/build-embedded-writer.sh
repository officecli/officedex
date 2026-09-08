#!/usr/bin/env bash

# Builds the Writer embed artifact and syncs it into public/writer.
#
# Unlike the presentation component, OfficeDex does not build Writer from
# source with its own Vite config: writer publishes formal artifacts
# (packages/*/dist) and its apps/officedex-embed consumes them. This script
# only drives writer's own `pnpm build:officedex-embed`, copies the resulting
# dist into build/writer/dist, and syncs it. Nothing here imports writer source.
#
# The default-font closure inside that dist stays out of public/writer; it is
# staged separately by `npm run stage:writer-fonts`.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "${ROOT}" rev-parse --path-format=absolute --git-common-dir)"
OFFICEDEX_MAIN_DIR="$(cd "$(dirname "${GIT_COMMON_DIR}")" && pwd)"
DEFAULT_WRITER_SOURCE="$(cd "${OFFICEDEX_MAIN_DIR}/.." && pwd)/writer"
SOURCE="${WRITER_SOURCE_DIR:-${DEFAULT_WRITER_SOURCE}}"

if [[ ! -f "${SOURCE}/pnpm-workspace.yaml" || ! -f "${SOURCE}/apps/officedex-embed/package.json" ]]; then
  echo "[build-embedded-writer] writer source not found at ${SOURCE}" >&2
  echo "Set WRITER_SOURCE_DIR to a local writer checkout." >&2
  exit 1
fi

EMBED_DIST="${SOURCE}/apps/officedex-embed/dist"
DIST_DIRECTORY="${ROOT}/build/writer/dist"

if [[ -n "${WRITER_SOURCE_REVISION:-}" ]]; then
  REVISION="${WRITER_SOURCE_REVISION}"
elif git -C "${SOURCE}" rev-parse HEAD >/dev/null 2>&1; then
  REVISION="$(git -C "${SOURCE}" rev-parse HEAD)"
  if [[ -n "$(git -C "${SOURCE}" status --porcelain --untracked-files=normal)" ]]; then
    REVISION="${REVISION}-dirty"
  fi
else
  echo "[build-embedded-writer] source revision is unavailable" >&2
  echo "Set WRITER_SOURCE_REVISION when building from a source archive." >&2
  exit 1
fi

if [[ "${WRITER_SKIP_INSTALL:-0}" != "1" ]]; then
  echo "[build-embedded-writer] installing writer dependencies (pnpm)"
  # The default registry is npmmirror: resolving metadata straight from
  # registry.npmjs.org times out here. The @shimo scope is pinned to the
  # internal registry by writer's own .npmrc, which resolves to a 10.16/12
  # address routed through the EasyConnect tunnel — it needs the company VPN
  # connected, not a proxy.
  if ! (
    cd "${SOURCE}"
    npm_config_registry="${WRITER_NPM_REGISTRY:-https://registry.npmmirror.com}" \
      pnpm install --ignore-scripts
  ); then
    echo "[build-embedded-writer] pnpm install failed" >&2
    echo "@shimo packages come from the internal registry; check that EasyConnect is connected." >&2
    exit 1
  fi
fi

echo "[build-embedded-writer] building the Writer embed artifact"
(
  cd "${SOURCE}"
  pnpm build:officedex-embed
)

if [[ ! -f "${EMBED_DIST}/index.html" ]]; then
  echo "[build-embedded-writer] writer produced no artifact at ${EMBED_DIST}" >&2
  exit 1
fi

rm -rf -- "${DIST_DIRECTORY}"
mkdir -p "$(dirname "${DIST_DIRECTORY}")"
cp -R "${EMBED_DIST}" "${DIST_DIRECTORY}"

node "${ROOT}/scripts/sync-writer-component.mjs" \
  --dist "${DIST_DIRECTORY}" \
  --public "${ROOT}/public/writer" \
  --source-revision "${REVISION}"

# The embed is built with writerNextDefaultFontsPlugin({ desktop: true }), which
# delivers glyph bytes only for the licensed faces the render allowlist can
# actually paint. If that flag stops taking effect the closure silently returns
# to ~336MB of commercial CJK fonts, so fail here rather than in the licence gate
# at the end of a 3-minute package run.
FONT_CLOSURE="${DIST_DIRECTORY}/writer-next-default-fonts"
if [[ -d "${FONT_CLOSURE}" ]]; then
  unlicensed="$(find "${FONT_CLOSURE}" -type f \( -name '*.woff' -o -name '*.woff2' -o -name '*.ttf' -o -name '*.otf' \) \
    -exec basename {} \; | grep -iE '^(hy|fz|0f7cf5e4|a94346c5|huaxin|symbol|mtextra|wingding|vera|misans|arial|timesnewroman|couriernew|cambriamath|fangsong|kaiti|lisu|simsun|simhei|verdana)' \
    | grep -ivx 'hyzhongheikw.woff' || true)"
  if [[ -n "${unlicensed}" ]]; then
    echo "[build-embedded-writer] unlicensed font glyphs in the delivered closure:" >&2
    echo "${unlicensed}" | sed 's/^/  /' >&2
    echo "[build-embedded-writer] the desktop font profile did not apply; see writer's desktop-font-catalog.ts" >&2
    exit 1
  fi
  # `du -sk` rather than `stat`: the -f/-c format flag differs between BSD and
  # GNU, and this script also runs on the Windows packaging host under Git Bash.
  closure_kb="$(du -sk "${FONT_CLOSURE}" | awk '{print $1}')"
  if (( closure_kb > 160000 )); then
    echo "[build-embedded-writer] font closure is $(( closure_kb / 1024 ))MB, over the 160MB desktop budget" >&2
    exit 1
  fi
  echo "[build-embedded-writer] font closure $(( closure_kb / 1024 ))MB, no unlicensed glyphs"
fi

echo "[build-embedded-writer] synchronized public/writer at ${REVISION}"
