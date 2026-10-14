#!/usr/bin/env bash
# Runs makensis inside the scripts/nsis/Dockerfile image with the repository
# mounted at /work, rewriting every absolute path under the repository in the
# arguments to its /work equivalent. scripts/dist-win.mjs uses it through
# OFFICEDEX_MAKENSIS when the host's own makensis is unusable (see Dockerfile).
#
#   OFFICEDEX_MAKENSIS=scripts/nsis/makensis-docker.sh node scripts/dist-win.mjs --installer
#
# The image is built on first use; set OFFICEDEX_NSIS_IMAGE to use another tag.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/../.." && pwd)"
image="${OFFICEDEX_NSIS_IMAGE:-officedex-makensis:bookworm}"

if ! docker image inspect "$image" >/dev/null 2>&1; then
  echo "[makensis-docker] building $image" >&2
  build_args=()
  for proxy in http_proxy https_proxy HTTP_PROXY HTTPS_PROXY; do
    if [[ -n "${!proxy:-}" ]]; then
      # Inside the container the host's loopback proxy is host.docker.internal.
      build_args+=(--build-arg "$proxy=${!proxy//127.0.0.1/host.docker.internal}")
    fi
  done
  docker build -q "${build_args[@]}" -t "$image" "$script_dir" >/dev/null
fi

# The caller's working directory is normally build/windows/installer; keep it,
# translated into the mount.
cwd="$(pwd)"
case "$cwd" in
  "$repo_root"*) workdir="/work${cwd#"$repo_root"}" ;;
  *) echo "[makensis-docker] run this from inside $repo_root" >&2; exit 2 ;;
esac

args=()
for arg in "$@"; do
  args+=("${arg//$repo_root//work}")
done

exec docker run --rm -v "$repo_root:/work" -w "$workdir" "$image" "${args[@]}"
