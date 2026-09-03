#!/usr/bin/env bash

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GIT_COMMON_DIR="$(git -C "${ROOT}" rev-parse --path-format=absolute --git-common-dir)"
OFFICEDEX_MAIN_DIR="$(cd "$(dirname "${GIT_COMMON_DIR}")" && pwd)"
DEFAULT_PRESENTATION_SOURCE="$(cd "${OFFICEDEX_MAIN_DIR}/.." && pwd)/presentation"
SOURCE="${PRESENTATION_SOURCE_DIR:-${DEFAULT_PRESENTATION_SOURCE}}"

# The fegit presentation repository uses pnpm 11. Keep the npm fallback for
# prepared source archives, but never infer a source from the legacy `pptx`
# directory name.
if [[ -f "${SOURCE}/pnpm-lock.yaml" ]]; then
  SOURCE_PACKAGE_MANAGER="pnpm"
elif [[ -f "${SOURCE}/package-lock.json" ]]; then
  SOURCE_PACKAGE_MANAGER="npm"
else
  SOURCE_PACKAGE_MANAGER=""
fi

if [[ -z "${SOURCE_PACKAGE_MANAGER}" || ! -f "${SOURCE}/packages/presentation-app/src/main.ts" ]]; then
  echo "[build-embedded-presentation] fegit presentation source not found at ${SOURCE}" >&2
  echo "Set PRESENTATION_SOURCE_DIR to a local presentation checkout." >&2
  exit 1
fi

if [[ ! -f "${SOURCE}/mop/runtime/index.js" || ! -f "${SOURCE}/bos/dist/mop-wasm/pkg/mop_wasm.js" ]]; then
  echo "[build-embedded-presentation] local MOP/BOS runtime sources are incomplete at ${SOURCE}" >&2
  echo "Expected mop/runtime and bos/dist/mop-wasm/pkg from the presentation checkout." >&2
  exit 1
fi

VITE_BIN="${SOURCE}/node_modules/vite/bin/vite.js"
DIST_DIRECTORY="${ROOT}/build/presentation/dist"

if [[ -n "${PRESENTATION_SOURCE_REVISION:-}" ]]; then
  REVISION="${PRESENTATION_SOURCE_REVISION}"
elif git -C "${SOURCE}" rev-parse HEAD >/dev/null 2>&1; then
  REVISION="$(git -C "${SOURCE}" rev-parse HEAD)"
  if [[ -n "$(git -C "${SOURCE}" status --porcelain --untracked-files=normal)" ]]; then
    REVISION="${REVISION}-dirty"
  fi
else
  echo "[build-embedded-presentation] source revision is unavailable" >&2
  echo "Set PRESENTATION_SOURCE_REVISION when building from a source archive." >&2
  exit 1
fi

echo "[build-embedded-presentation] installing fegit presentation dependencies (${SOURCE_PACKAGE_MANAGER})"
(
  cd "${SOURCE}"
  if [[ "${SOURCE_PACKAGE_MANAGER}" == "pnpm" ]]; then
    # pnpm 迁移后各子包依赖写作 workspace:*，npm 无法解析，必须用 pnpm。
    # registry 默认走 npmmirror：直连 registry.npmjs.org 拉元数据会超时
    # （typescript 一个包的 metadata 就有 15MB），走 Clash 代理同样慢。
    # @shimo 作用域由 pptx 自己的 .npmrc 指向内网源，直连即可，不要代理。
    npm_config_registry="${PRESENTATION_NPM_REGISTRY:-https://registry.npmmirror.com}" \
      pnpm install --ignore-scripts
  else
    npm_config_proxy="${npm_config_proxy:-http://127.0.0.1:7890}" \
      npm_config_https_proxy="${npm_config_https_proxy:-http://127.0.0.1:7890}" \
      npm install --ignore-scripts \
        --@shimo:registry="${SHIMO_NPM_REGISTRY:-http://registry.npm.shimo.run/}"
  fi
)

echo "[build-embedded-presentation] building OfficeDex component"
if [[ ! -f "${VITE_BIN}" ]]; then
  echo "[build-embedded-presentation] Vite was not installed by npm install" >&2
  exit 1
fi
PRESENTATION_SOURCE_DIR="${SOURCE}" \
  PRESENTATION_DIST_DIR="${DIST_DIRECTORY}" \
  node "${VITE_BIN}" build --config "${ROOT}/presentation-component/vite.config.ts"

node "${ROOT}/scripts/sync-presentation-component.mjs" \
  --dist "${DIST_DIRECTORY}" \
  --public "${ROOT}/public/presentation" \
  --source-revision "${REVISION}"

echo "[build-embedded-presentation] synchronized public/presentation at ${REVISION}"
