#!/usr/bin/env bash
# Historical acceptance is cumulative. Keep renderer, disk writes, conversion
# and actual iframe key dispatch in the release gate, not only the latest cases.
set -euo pipefail
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cli="${OFFICECLI_SOURCE_DIR:-${root}/../officecli-internal}"
cd "${root}"
if [[ ! -f "${cli}/internal/runtime/modify/docx_exact_test.go" ]]; then
  echo "Acceptance requires the matching officecli source checkout: ${cli}" >&2
  exit 1
fi
./node_modules/.bin/vitest run
node scripts/verify-bridge-types.mjs
node --test scripts/embedded-frame-clock.test.mjs scripts/sync-writer-component.test.mjs scripts/sync-presentation-component.test.mjs scripts/verify-editor-shortcuts.browser.test.mjs scripts/verify-shell-styles.test.mjs
# ./... also traverses local dist-artifacts source archives. Test owned sources.
env -u GOROOT go test . ./internal/... -count=1
(
  cd "${cli}"
  env -u GOROOT go test ./pkg/ooxmledit ./internal/runtime/modify ./internal/cli ./internal/runtime \
    -run 'DOCX|Docx|Modify|PPTX.*(Exact|Resume|Recovery|Content|Notes|Sentence|Requirement|Incomplete|Expansion)|Test(BuildRenderJobPreservesExact|Expansion|ConcurrencyLimit|ResumeRequests|ResumeReuses|GenerateResume)' -count=1
)
