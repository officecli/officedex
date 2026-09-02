#!/usr/bin/env bash
# Compatibility wrapper: this script was split into an arch-parameterized
# build-mac-dmg.sh when Intel packaging was added. docs/local-dmg-build-prompt.md
# and existing muscle memory still invoke this name, so keep it working and
# pin the architecture it always meant.
#
# New callers should use scripts/build-mac-dmg.sh directly:
#   bash scripts/build-mac-dmg.sh                  # host arch
#   TARGET_ARCH=x64 bash scripts/build-mac-dmg.sh  # Intel
set -euo pipefail
exec env TARGET_ARCH=arm64 bash "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/build-mac-dmg.sh" "$@"
