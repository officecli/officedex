# Canvas Vibe Runtime Release Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish OfficeCLI `v0.2.118` with the real PPTX Vibe Tree protocol and OfficeDex `v0.6.1` with a release gate that proves its bundled runtime can enter Canvas Node mode.

**Architecture:** OfficeCLI remains the owner of staged PPTX generation and emits `task.vibe_tree` / `task.vibe_slide`; OfficeDex remains an event-driven renderer and enters Canvas mode only after receiving those events. A new OfficeDex release-contract script interrogates the exact fetched or packaged OfficeCLI binary over JSON-RPC before packaging, preventing another UI/runtime mismatch.

**Tech Stack:** Go 1.25+, JSON-RPC/LSP framing, Node.js 20, Wails v2, React 19, Vitest, Playwright, GitHub Actions, GoReleaser.

---

### Task 1: Create isolated worktrees and establish clean baselines

**Files:**
- No production files changed.
- Worktree roots: `/Users/luyang/.config/superpowers/worktrees/officecli-internal/canvas-vibe-0.2.118` and `/Users/luyang/.config/superpowers/worktrees/officedex/canvas-vibe-0.6.1`.

- [ ] **Step 1: Verify both source checkouts are normal checkouts, not existing linked worktrees**

```bash
for repo in officecli-internal officedex; do
  cd "/Users/luyang/Workspace/shimo/vibe-officing/$repo"
  git rev-parse --git-dir
  git rev-parse --git-common-dir
  git rev-parse --show-superproject-working-tree
  git status --short --branch
done
```

Expected: `officecli-internal` shows the existing dirty state, while `officedex` is clean except for the committed design/plan work. Neither checkout is a linked worktree.

- [ ] **Step 2: Create isolated branches without modifying the dirty OfficeCLI checkout**

```bash
git -C /Users/luyang/Workspace/shimo/vibe-officing/officecli-internal worktree add \
  /Users/luyang/.config/superpowers/worktrees/officecli-internal/canvas-vibe-0.2.118 \
  -b codex/canvas-vibe-0.2.118 origin/main

git -C /Users/luyang/Workspace/shimo/vibe-officing/officedex worktree add \
  /Users/luyang/.config/superpowers/worktrees/officedex/canvas-vibe-0.6.1 \
  -b codex/canvas-vibe-0.6.1 main
```

Expected: both worktrees are created; the original `officecli-internal` dirty tree remains byte-for-byte untouched.

- [ ] **Step 3: Install dependencies using the required local proxy**

```bash
cd /Users/luyang/.config/superpowers/worktrees/officecli-internal/canvas-vibe-0.2.118
env -u GOROOT GOPROXY=https://proxy.golang.org,direct go mod download

cd /Users/luyang/.config/superpowers/worktrees/officedex/canvas-vibe-0.6.1
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm ci
```

Expected: dependency setup exits zero.

- [ ] **Step 4: Run focused clean-baseline tests**

```bash
cd /Users/luyang/.config/superpowers/worktrees/officecli-internal/canvas-vibe-0.2.118
env -u GOROOT go test ./internal/cli -run 'TestAgentBridge' -count=1

cd /Users/luyang/.config/superpowers/worktrees/officedex/canvas-vibe-0.6.1
npm run lint
npx vitest run src/renderer/taskState.test.ts src/renderer/screens/DialogueScreens.test.tsx
```

Expected: all baseline checks pass. If not, stop and report the baseline failure before implementation.

### Task 2: Add failing OfficeCLI protocol regression tests

**Files:**
- Modify: `internal/cli/agent_bridge_test.go`
- Modify: `internal/cli/types.go`

- [ ] **Step 1: Add a failing bridge test for the required request and capability contract**

Add tests that decode an `office.generate` request containing `"generation_mode":"plan"`, build the `GenerateJob`, and assert:

```go
if job.GenerationMode != "plan" {
    t.Fatalf("GenerationMode = %q, want plan", job.GenerationMode)
}
```

Also initialize the bridge and assert that the advertised event types contain `task.vibe_tree` and the `office.generate` input schema contains `generation_mode`.

- [ ] **Step 2: Run the tests and verify the intended RED state**

```bash
env -u GOROOT go test ./internal/cli -run 'TestAgentBridge.*(GenerationMode|VibeCapability)' -count=1
```

Expected: FAIL because `bridgeInvokeArgs` and `GenerateJob` do not yet carry `generation_mode`, and initialization does not advertise `task.vibe_tree`.

- [ ] **Step 3: Add only the data-carrier fields needed by the tests**

```go
// internal/cli/agent_bridge.go, bridgeInvokeArgs
GenerationMode string `json:"generation_mode,omitempty"`

// internal/cli/types.go, GenerateJob
GenerationMode string
```

Map the request field in `buildGenerateJobFromRequest` with normalized lowercase whitespace trimming.

- [ ] **Step 4: Run the tests again**

```bash
env -u GOROOT go test ./internal/cli -run 'TestAgentBridge.*(GenerationMode|VibeCapability)' -count=1
```

Expected: the request-carrier assertion passes; the capability assertion remains RED until Task 3 adds the event protocol.

- [ ] **Step 5: Commit the request contract**

```bash
git add internal/cli/agent_bridge.go internal/cli/agent_bridge_test.go internal/cli/types.go
git commit -m "test: define PPTX Vibe generation contract"
```

### Task 3: Port the complete staged Vibe Tree implementation

**Files:**
- Create: `internal/cli/vibe_tree.go`
- Create: `internal/cli/vibe_flow.go`
- Create: `internal/cli/vibe_llm_synthesis.go`
- Create: `internal/cli/vibe_generate_cmd.go`
- Create: `internal/cli/vibe_magic.go`
- Create: `pkg/officegen/pptist_layout.go`
- Test: `internal/cli/vibe_tree_test.go`
- Test: `internal/cli/vibe_flow_test.go`
- Test: `internal/cli/vibe_magic_test.go`
- Test: `internal/cli/vibe_report_test.go`
- Modify: `internal/cli/agent_bridge.go`
- Modify: `internal/cli/agent_bridge_test.go`
- Modify: `internal/cli/app.go`
- Modify: `internal/cli/generate_runner.go`
- Modify: `internal/cli/ppt_prompt_prepare.go`
- Modify: `internal/cli/render_runner.go`
- Modify: `internal/cli/types.go`
- Modify: `internal/runtime/agent_render.go`
- Modify: `pkg/officegen/pptx_generator.go`
- Modify: `pkg/officegen/pptx_narrative_layouts.go`
- Modify: `pkg/officegen/pptx_style.go`

- [ ] **Step 1: Add a failing deterministic staged-flow test**

The test must invoke an interactive PPTX `GenerateJob` with `Mode: "best"`, `GenerationMode: "plan"`, and the deterministic magic prompt, then assert the event sequence contains at least one `task.vibe_tree` before `task.completed`.

```go
if firstVibeTree < 0 {
    t.Fatal("missing task.vibe_tree")
}
if completedAt < firstVibeTree {
    t.Fatalf("task.completed emitted before task.vibe_tree")
}
```

- [ ] **Step 2: Verify RED**

```bash
env -u GOROOT go test ./internal/cli -run 'TestAgentBridge.*Vibe.*Lifecycle' -count=1
```

Expected: FAIL because the staged flow and event emitters do not exist in the isolated worktree.

- [ ] **Step 3: Port the already-developed Vibe files from the protected source checkout**

Use `/Users/luyang/Workspace/shimo/vibe-officing/officecli-internal` only as a read-only source. Copy the seven new implementation files and four new test files listed above, then apply only Vibe/PPTist-related hunks from tracked files. Reject hunks involving platform UI, distribution docs, npm installer policy, or unrelated modify/runtime refactors.

The bridge routing condition must remain exactly:

```go
return prompter != nil &&
    job.DocumentType == engine.DocumentTypePPTX &&
    strings.EqualFold(strings.TrimSpace(job.Mode), "best") &&
    strings.EqualFold(strings.TrimSpace(job.GenerationMode), "plan")
```

The bridge must advertise and emit:

```go
bridgeEventTaskVibeTree  = "task.vibe_tree"
bridgeEventTaskVibeSlide = "task.vibe_slide"
```

- [ ] **Step 4: Format and run focused tests**

```bash
gofmt -w \
  internal/cli/agent_bridge.go internal/cli/app.go internal/cli/generate_runner.go \
  internal/cli/ppt_prompt_prepare.go internal/cli/render_runner.go internal/cli/types.go \
  internal/cli/vibe_tree.go internal/cli/vibe_flow.go internal/cli/vibe_llm_synthesis.go \
  internal/cli/vibe_generate_cmd.go internal/cli/vibe_magic.go \
  internal/cli/vibe_tree_test.go internal/cli/vibe_flow_test.go internal/cli/vibe_magic_test.go \
  internal/cli/vibe_report_test.go internal/runtime/agent_render.go \
  pkg/officegen/pptist_layout.go pkg/officegen/pptx_generator.go \
  pkg/officegen/pptx_narrative_layouts.go pkg/officegen/pptx_style.go
env -u GOROOT go test ./internal/cli ./internal/runtime ./pkg/officegen -count=1
```

Expected: PASS with the staged-flow, tree, magic, and bridge lifecycle tests green.

- [ ] **Step 5: Run the full OfficeCLI suite**

```bash
env -u GOROOT go test ./... -count=1
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the runtime implementation**

```bash
git add internal/cli internal/runtime pkg/officegen
git diff --cached --check
git commit -m "feat: add staged PPTX Vibe Tree runtime"
```

### Task 4: Version and publish OfficeCLI `v0.2.118`

**Files:**
- Modify: `packages/npm/officecli/package.json`
- Modify: `packages/npm/officecli/package-lock.json`

- [ ] **Step 1: Add a release-version check before changing metadata**

```bash
cd packages/npm/officecli
RELEASE_TAG=v0.2.118 npm run check:release-version
```

Expected: FAIL because package metadata still reports `0.2.117`.

- [ ] **Step 2: Bump npm wrapper metadata mechanically**

```bash
cd packages/npm/officecli
npm version 0.2.118 --no-git-tag-version
RELEASE_TAG=v0.2.118 npm run check:release-version
npm test
```

Expected: metadata and lockfile report `0.2.118`; tests pass.

- [ ] **Step 3: Re-run full source verification and build a local binary**

```bash
cd /Users/luyang/.config/superpowers/worktrees/officecli-internal/canvas-vibe-0.2.118
env -u GOROOT go test ./... -count=1
env -u GOROOT go build -o /private/tmp/officecli-0.2.118-candidate ./cmd/officecli
/private/tmp/officecli-0.2.118-candidate --version
```

Expected: tests and build pass. The untagged local binary may report a development version; protocol verification is performed separately.

- [ ] **Step 4: Commit, push the release branch, and create the immutable tag**

```bash
git add packages/npm/officecli/package.json packages/npm/officecli/package-lock.json
git commit -m "release: prepare OfficeCLI 0.2.118"
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push -u origin codex/canvas-vibe-0.2.118
git push origin HEAD:main
git tag -a v0.2.118 -m "OfficeCLI 0.2.118"
git push origin v0.2.118
```

Expected: the reviewed branch, private source `main`, and tag are present on `officecli/officecli-internal` without touching the original dirty checkout. The original local `main` may report divergence afterward because its five unrelated local commits were deliberately not pushed as part of this fix.

- [ ] **Step 5: Dispatch the public release control plane**

```bash
gh workflow run "CLI Release" -R officecli/officecli-ci -f version=v0.2.118
```

Expected: a new `CLI Release` run starts and completes successfully.

- [ ] **Step 6: Verify public runtime assets**

```bash
gh release view v0.2.118 -R officecli/officecli-dist --json tagName,isDraft,isPrerelease,assets
```

Download macOS arm64/amd64 and Windows amd64 assets through `127.0.0.1:7890` if necessary, then run each available local binary with `--version` and verify it reports `0.2.118`.

### Task 5: Add an OfficeDex release contract gate

**Files:**
- Create: `scripts/verify-officecli-canvas-contract.mjs`
- Create: `scripts/verify-officecli-canvas-contract.test.mjs`
- Modify: `package.json`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write failing script tests**

Test these exported checks with fixture initialization responses:

```js
assert.throws(() => verifyInitializeResult({ capabilities: { event_types: [] } }, "0.2.118"), /task\.vibe_tree/);
assert.throws(() => verifyInitializeResult({ capabilities: { event_types: ["task.vibe_tree"] } }, "0.2.118"), /generation_mode/);
assert.doesNotThrow(() => verifyInitializeResult(validInitializeResult, "0.2.118"));
```

Also test version-output validation for wrong and matching versions.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/verify-officecli-canvas-contract.test.mjs
```

Expected: FAIL because the verifier module does not exist.

- [ ] **Step 3: Implement the verifier**

The script must:

1. run `<binary> --version` and require the expected semantic version;
2. start `<binary> agent-bridge`;
3. send an LSP-framed JSON-RPC `initialize` request;
4. parse the response within a bounded timeout;
5. require `task.vibe_tree` in event capabilities; and
6. require `generation_mode` in the `office.generate` input schema.

Expose pure `verifyVersionOutput` and `verifyInitializeResult` functions so unit tests do not spawn a process.

- [ ] **Step 4: Run script tests and the real fetched-binary contract**

```bash
node --test scripts/verify-officecli-canvas-contract.test.mjs
npm run prefetch:officecli
node scripts/verify-officecli-canvas-contract.mjs \
  --binary build/officecli/officecli \
  --expected 0.2.118
```

Expected: tests pass and the real binary prints a successful Canvas contract verification.

- [ ] **Step 5: Wire the gate into release packaging**

Add `verify:officecli:canvas` to `package.json` and run it immediately after `Prefetch officecli binary` in `.github/workflows/release.yml` on both platforms. Pass the platform-specific binary path and `package.json`'s `officecliVersion`.

- [ ] **Step 6: Commit the release gate**

```bash
git add scripts/verify-officecli-canvas-contract.mjs scripts/verify-officecli-canvas-contract.test.mjs package.json .github/workflows/release.yml
git diff --cached --check
git commit -m "build: verify bundled OfficeCLI Canvas protocol"
```

### Task 6: Pin OfficeDex to OfficeCLI `0.2.118` and verify the real Canvas path

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `e2e/canvas-runtime-contract-real.spec.ts`

- [ ] **Step 1: Add a deterministic real E2E test**

Submit the exact OfficeCLI magic prompt as a PPTX plan request and assert `.living-tree-cockpit` becomes visible before cancelling. The test must use the normal build, not the `officedex_demo` build, so the event comes from the real OfficeCLI binary.

- [ ] **Step 2: Run the E2E against `0.2.117` and verify RED**

```bash
OFFICECLI_VERSION=0.2.117 \
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
node scripts/run-real-e2e.mjs e2e/canvas-runtime-contract-real.spec.ts
```

Expected: FAIL because `0.2.117` never emits `task.vibe_tree`.

- [ ] **Step 3: Bump OfficeDex runtime and application metadata**

Set `officecliVersion` to `0.2.118` and application version to `0.6.1` in both `package.json` and `package-lock.json`. Keep the default UI backend as Ant Design.

- [ ] **Step 4: Verify GREEN against the newly published runtime**

```bash
rm -rf build/officecli
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm run prefetch:officecli
npm run verify:officecli:canvas
node scripts/run-real-e2e.mjs e2e/canvas-runtime-contract-real.spec.ts
```

Expected: contract verification passes, Canvas becomes visible, and the test cancels cleanly.

- [ ] **Step 5: Run full OfficeDex verification**

```bash
npm run lint
npm run test:scripts
npx vitest run
env -u GOROOT go test ./... -count=1
env -u GOROOT go test -tags officedex_demo ./... -count=1
bash scripts/build-local-app.sh
codesign --verify --deep --strict --verbose=4 build/bin/OfficeDex.app
```

Expected: all commands exit zero; the packaged app contains OfficeCLI `0.2.118`.

- [ ] **Step 6: Commit the OfficeDex patch release**

```bash
git add package.json package-lock.json e2e/canvas-runtime-contract-real.spec.ts
git diff --cached --check
git commit -m "release: prepare OfficeDex 0.6.1"
```

### Task 7: Publish and verify OfficeDex `v0.6.1`

**Files:**
- Release outputs only; no new source files expected.

- [ ] **Step 1: Review the complete branch diff against `v0.6.0`**

```bash
git diff --check v0.6.0..HEAD
git diff --stat v0.6.0..HEAD
git log --oneline v0.6.0..HEAD
```

Expected: only the design, plan, runtime contract gate, E2E regression, and `0.6.1` metadata changes appear.

- [ ] **Step 2: Push and tag**

```bash
git fetch origin main
git merge-base --is-ancestor origin/main HEAD
git push -u origin codex/canvas-vibe-0.6.1
git push origin HEAD:main
git tag -a v0.6.1 -m "OfficeDex 0.6.1"
git push origin v0.6.1
```

- [ ] **Step 3: Monitor the release workflow to completion**

```bash
gh run list -R officecli/officedex --workflow Release --limit 5
gh run watch -R officecli/officedex <run-id> --exit-status
```

Expected: macOS build/sign/notarize, Windows build, GitHub Release, and dist sync all succeed.

- [ ] **Step 4: Verify published assets and bundled runtimes**

```bash
gh release view v0.6.1 -R officecli/officedex --json tagName,isDraft,isPrerelease,publishedAt,assets
```

Download the macOS and Windows ZIPs, extract their OfficeCLI binaries, run the contract verifier against each executable available on the current host, and inspect the other platform's bundled `version.json` or binary strings. Confirm checksums and sizes match `officedex-dist/manifest.json`.

- [ ] **Step 5: Verify the public update manifest**

```bash
curl --proxy http://127.0.0.1:7890 -fsSL \
  https://raw.githubusercontent.com/officecli/officedex-dist/main/manifest.json
```

Expected: version `0.6.1`, correct asset URLs, sizes, and SHA-256 values.

- [ ] **Step 6: Record final release evidence**

Report the OfficeCLI release/tag/run, OfficeDex release/tag/run, exact bundled runtime versions, focused Canvas E2E result, package checksums, and any non-blocking limitations.
