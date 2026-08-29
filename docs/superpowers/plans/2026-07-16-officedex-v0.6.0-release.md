# OfficeDex v0.6.0 Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce, tag, and publish a reproducible OfficeDex `v0.6.0` release with working PPTist autosave, isolated demo tests, committed corresponding PPTist source, consistent licensing/version metadata, and verified macOS/Windows release artifacts.

**Architecture:** Treat the embedded PPTist application as a separately licensed vendored component under `third_party/pptist`, build its committed source through one reusable script, and keep `public/pptist` as the checked-in generated release artifact. Release gates run both normal and demo-tag Go suites, rebuild the embedded app, package license files, verify version metadata, run a real PPTX edit/autosave smoke, and only then push `main` and tag `v0.6.0`.

**Tech Stack:** Go 1.26, Wails v2, React 19, TypeScript, Vite 6, Vitest 3, Vue 3/PPTist, Playwright, GitHub Actions, macOS codesign/notarization.

---

## File Map

- `app_demo_flow_test.go`: retain normal-build event-recorder coverage only.
- `app_demo_flow_demo_test.go`: new demo-tag application tests and demo test fixture setup.
- `src/renderer/screens/DialogueScreens.test.tsx`: release regression for edit-triggered autosave.
- `src/renderer/screens/DialogueScreens.tsx`: enable autosave for real completed PPTX artifacts.
- `third_party/pptist/**`: committed corresponding source for the embedded AGPL component.
- `scripts/build-embedded-pptist.sh`: install, test, type-check, build, and synchronize the vendored PPTist bundle.
- `scripts/sync-embedded-pptist.mjs`: deterministic `dist` to `public/pptist` synchronization and OfficeDex CSS injection.
- `scripts/sync-embedded-pptist.test.mjs`: synchronization regression tests.
- `scripts/assets/officedex-embed.css`: source-controlled OfficeDex embed styling.
- `scripts/verify-font-licenses.mjs`: fail the build if a shipped font lacks a declared license file.
- `scripts/verify-font-licenses.test.mjs`: font-license manifest regression tests.
- `scripts/bundle-licenses.mjs`: copy OfficeDex/PPTist/third-party notices into release artifacts.
- `scripts/bundle-licenses.test.mjs`: packaging regression tests.
- `scripts/verify-release-version.mjs`: verify package, Wails, tag, and macOS bundle versions agree.
- `scripts/verify-release-version.test.mjs`: version-verifier regression tests.
- `NOTICE`, `THIRD_PARTY_NOTICES.md`: consistent project and component notices.
- `.github/workflows/ci.yml`, `.github/workflows/release.yml`: rebuild PPTist, run both Go suites, bundle licenses, and verify release version.
- `e2e/generation-real.spec.ts`: hosted PPTX edit/autosave/reopen release smoke.
- `docs/security/v0.6.0-dependency-risk.md`: record unresolved inherited production dependency advisories.

### Task 1: Isolate demo-only Go tests

**Files:**
- Modify: `app_demo_flow_test.go`
- Create: `app_demo_flow_demo_test.go`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `package.json`

- [ ] **Step 1: Reproduce the release-path failure**

Run:

```bash
env -u GOROOT go test ./... -count=1
```

Expected: FAIL in `TestDemoGenerateBypassesProviderValidation` and `TestDemoModifyPptistDeckRoutesPreparedTimelineEdit`; the second test may incorrectly route into the real planner.

- [ ] **Step 2: Split normal and demo-tag tests**

Keep only `TestRecordAndEmitTaskEventPersistsWithoutWailsContext` and its imports in `app_demo_flow_test.go`.

Create `app_demo_flow_demo_test.go` with this header and move the two demo tests, `demoTimelineAppSnapshotSlide`, and `newDemoTestApp` into it unchanged:

```go
//go:build officedex_demo

package main

import (
    "context"
    "path/filepath"
    "testing"

    "officedex/internal/demoflow"
    "officedex/internal/localstore"
    "officedex/internal/preview"
    "officedex/internal/settings"
    "officedex/internal/types"
)
```

- [ ] **Step 3: Verify both build modes**

Run:

```bash
env -u GOROOT go test ./... -count=1
env -u GOROOT go test -tags officedex_demo ./... -count=1
```

Expected: both commands PASS; the normal suite completes without invoking a hosted planner.

- [ ] **Step 4: Make both suites release gates**

Add this package script:

```json
"test:go": "env -u GOROOT go test ./... -count=1 && env -u GOROOT go test -tags officedex_demo ./... -count=1"
```

On GitHub Actions, use the platform-neutral commands directly:

```yaml
- name: Go tests (normal build)
  run: go test ./... -count=1

- name: Go tests (demo build)
  run: go test -tags officedex_demo ./... -count=1
```

- [ ] **Step 5: Commit**

```bash
git add app_demo_flow_test.go app_demo_flow_demo_test.go package.json .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "test: isolate OfficeDex demo build coverage"
```

### Task 2: Restore immediate PPTist autosave

**Files:**
- Modify: `src/renderer/screens/DialogueScreens.test.tsx`
- Modify: `src/renderer/screens/DialogueScreens.tsx`

- [ ] **Step 1: Replace the manual-save expectation with an autosave regression**

In the completed PPTist follow-up edit test, after dispatching `pptist:edit-run-completed`, require an export targeted at the original artifact path:

```ts
const autosaveMessage = postMessage.mock.calls.find(([msg]) => {
  const payload = msg as { type?: string; requestId?: string; targetFilePath?: string };
  return payload.type === "pptist:export-pptx" && payload.targetFilePath === artifact.filePath;
})?.[0] as { requestId: string; fileName?: string; targetFilePath: string };

expect(autosaveMessage.requestId).toBeTruthy();
expect(autosaveMessage.fileName).toBe(artifact.fileName);

await act(async () => {
  window.dispatchEvent(new MessageEvent("message", {
    source: iframe.contentWindow,
    data: {
      type: "pptist:export-result",
      requestId: autosaveMessage.requestId,
      targetFilePath: artifact.filePath,
      buffer: new Uint8Array([1, 2, 3]).buffer,
      fileName: artifact.fileName,
    },
  }));
  await Promise.resolve();
});

expect(savePptxSpy).toHaveBeenCalledWith(
  new Uint8Array([1, 2, 3]),
  artifact.fileName,
  { targetFilePath: artifact.filePath },
);
expect(screen.getByText("Saved locally.")).toBeTruthy();
```

- [ ] **Step 2: Run the focused test and verify RED**

```bash
npx vitest run src/renderer/screens/DialogueScreens.test.tsx -t "turns completed Vibe PPTX into an Edit with AI workspace after every page is generated"
```

Expected: FAIL because `autosaveEnabled={false}` prevents the target-path export.

- [ ] **Step 3: Enable autosave only for persisted completed artifacts**

Change the production panel prop to:

```tsx
autosaveEnabled={Boolean(hasPptxFile && artifact?.filePath && task.status === "completed")}
```

Leave `PerfPptistCompletedScreen` autosave disabled because it is a non-persistent performance/demo surface.

- [ ] **Step 4: Verify GREEN and the component autosave suite**

```bash
npx vitest run src/renderer/screens/DialogueScreens.test.tsx -t "turns completed Vibe PPTX into an Edit with AI workspace after every page is generated"
npx vitest run src/renderer/components/PptistEmbedPanel.test.tsx
```

Expected: PASS, including serialized/coalesced autosave coverage.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/screens/DialogueScreens.tsx src/renderer/screens/DialogueScreens.test.tsx
git commit -m "fix: restore immediate PPTist autosave"
```

### Task 3: Vendor and reproducibly build PPTist source

**Files:**
- Create: `third_party/pptist/**`
- Create: `third_party/pptist/OFFICEDEX_CHANGES.md`
- Create: `scripts/assets/officedex-embed.css`
- Create: `scripts/sync-embedded-pptist.mjs`
- Create: `scripts/sync-embedded-pptist.test.mjs`
- Create: `scripts/build-embedded-pptist.sh`
- Modify: `scripts/build-local-app.sh`
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write synchronization tests**

Create a Node test that builds a temporary fake `dist` containing `index.html` and an asset, calls the exported synchronization function, and asserts:

```js
assert.match(outputHtml, /officedex-embed\.css/);
assert.match(outputHtml, /<script type="module"/);
assert.equal(await readFile(path.join(publicDir, "assets", "app.js"), "utf8"), "bundle");
```

Add a second test proving stale destination files are deleted.

- [ ] **Step 2: Run the synchronization test and verify RED**

```bash
node --test scripts/sync-embedded-pptist.test.mjs
```

Expected: FAIL because `scripts/sync-embedded-pptist.mjs` does not exist.

- [ ] **Step 3: Implement deterministic synchronization**

Implement `syncEmbeddedPptist({ distDir, publicDir, embedCssPath })` with `fs.promises.rm`, `cp`, `readFile`, and `writeFile`. It must delete the destination, copy the complete `dist`, copy the CSS as `officedex-embed.css`, and insert exactly one stylesheet link immediately before the module script.

The CLI form must accept:

```bash
node scripts/sync-embedded-pptist.mjs \
  --dist third_party/pptist/dist \
  --public public/pptist \
  --css scripts/assets/officedex-embed.css
```

- [ ] **Step 4: Verify GREEN**

```bash
node --test scripts/sync-embedded-pptist.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Vendor the corresponding source snapshot**

Run from the OfficeDex repository:

```bash
mkdir -p third_party/pptist
rsync -a --delete \
  --exclude '.git/' \
  --exclude 'node_modules/' \
  --exclude 'dist/' \
  --exclude '*.tsbuildinfo' \
  --exclude '.DS_Store' \
  ../PPTist/ third_party/pptist/
```

Record upstream base commit `f1cfabe7f8b368ae22b996c951b9aa0b87de69e1` and describe the OfficeDex iframe protocol, import-performance, locale, edit-animation, thumbnail, and autosave changes in `OFFICEDEX_CHANGES.md`.

- [ ] **Step 6: Add one reusable build entrypoint**

`scripts/build-embedded-pptist.sh` must run:

```bash
#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PPTIST="$ROOT/third_party/pptist"

cd "$PPTIST"
npm ci
node --test tests/*.test.ts
npm run type-check
npm run build-only

cd "$ROOT"
node scripts/verify-font-licenses.mjs third_party/pptist/src/assets/fonts
node scripts/sync-embedded-pptist.mjs \
  --dist third_party/pptist/dist \
  --public public/pptist \
  --css scripts/assets/officedex-embed.css
```

Add:

```json
"build:pptist": "bash scripts/build-embedded-pptist.sh"
```

Replace the sibling `../PPTist` build/sync block in `scripts/build-local-app.sh` with `npm run build:pptist`.

- [ ] **Step 7: Rebuild and prove reproducibility**

```bash
env HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm run build:pptist
git diff --exit-code -- public/pptist
```

Expected: the first build may update the tracked bundle; after staging that bundle, a second build produces no diff.

- [ ] **Step 8: Add CI/release rebuild gates**

After root `npm ci`, run:

```yaml
- name: Build embedded PPTist from committed source
  run: npm run build:pptist

- name: Verify embedded PPTist bundle is reproducible
  shell: bash
  run: git diff --exit-code -- public/pptist
```

- [ ] **Step 9: Commit**

```bash
git add third_party/pptist scripts/assets/officedex-embed.css scripts/sync-embedded-pptist.mjs scripts/sync-embedded-pptist.test.mjs scripts/build-embedded-pptist.sh scripts/build-local-app.sh package.json package-lock.json public/pptist .github/workflows/ci.yml .github/workflows/release.yml
git commit -m "build: vendor reproducible PPTist source"
```

### Task 4: Enforce font-license completeness

**Files:**
- Create: `third_party/pptist/src/assets/fonts/LICENSES.json`
- Create: `third_party/pptist/src/assets/fonts/licenses/**`
- Create: `scripts/verify-font-licenses.mjs`
- Create: `scripts/verify-font-licenses.test.mjs`
- Modify: `third_party/pptist/src/assets/styles/font.scss`

- [ ] **Step 1: Write verifier tests**

The test fixture must cover one licensed font and one missing-license font. Expected manifest shape:

```json
{
  "Inter.woff2": {
    "family": "Inter",
    "license": "SIL Open Font License 1.1",
    "licenseFile": "licenses/Inter-OFL-1.1.txt",
    "source": "https://github.com/rsms/inter"
  }
}
```

Assert that a complete fixture passes and an unmapped `.woff2` throws `Missing font license metadata`.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/verify-font-licenses.test.mjs
```

Expected: FAIL because the verifier is absent.

- [ ] **Step 3: Implement and populate the verifier**

The verifier must require every shipped `.woff2` file to have `family`, `license`, `licenseFile`, and `source`, and require every referenced license file to exist.

Populate metadata and license texts from official font project sources. Remove any font file and its `$fonts` entry when an official redistribution license cannot be verified. Do not accept a third-party download page as license evidence.

- [ ] **Step 4: Verify all shipped fonts**

```bash
node --test scripts/verify-font-licenses.test.mjs
node scripts/verify-font-licenses.mjs third_party/pptist/src/assets/fonts
npm run build:pptist
```

Expected: PASS; `public/pptist/assets` contains only fonts represented in `LICENSES.json`.

- [ ] **Step 5: Commit**

```bash
git add third_party/pptist/src/assets/fonts third_party/pptist/src/assets/styles/font.scss scripts/verify-font-licenses.mjs scripts/verify-font-licenses.test.mjs public/pptist
git commit -m "docs: complete embedded font licensing"
```

### Task 5: Correct notices and bundle licenses

**Files:**
- Modify: `NOTICE`
- Create: `THIRD_PARTY_NOTICES.md`
- Create: `scripts/bundle-licenses.mjs`
- Create: `scripts/bundle-licenses.test.mjs`
- Modify: `package.json`
- Modify: `scripts/build-local-app.sh`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write packaging tests**

Create temporary macOS-style and directory-style targets. Assert the script copies these exact files:

```text
OfficeDex-GPL-3.0.txt
OfficeDex-NOTICE.txt
THIRD_PARTY_NOTICES.md
PPTist-AGPL-3.0.txt
PPTist-OFFICEDEX_CHANGES.md
PPTist-font-licenses/
```

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/bundle-licenses.test.mjs
```

Expected: FAIL because the bundler is absent.

- [ ] **Step 3: Implement notice and license bundling**

Correct `NOTICE` to state OfficeDex is GPL-3.0-only, OfficeCLI is separately licensed, and embedded PPTist is AGPL-3.0 with source at `third_party/pptist`.

`scripts/bundle-licenses.mjs --target <path>` must resolve the destination as:

- `<App.app>/Contents/Resources/licenses` for a `.app` target;
- `<directory>/licenses` for a Windows/archive directory target.

Add:

```json
"bundle:licenses:mac": "node scripts/bundle-licenses.mjs --target build/bin/OfficeDex.app",
"bundle:licenses:win": "node scripts/bundle-licenses.mjs --target build/bin"
```

- [ ] **Step 4: Integrate before final signing/archive**

For macOS, bundle licenses before `codesign-bundled-officecli.mjs` re-seals the application. For Windows, bundle licenses after Wails build and before `Compress-Archive`.

- [ ] **Step 5: Verify GREEN**

```bash
node --test scripts/bundle-licenses.test.mjs
npm run bundle:licenses:mac
find build/bin/OfficeDex.app/Contents/Resources/licenses -type f -maxdepth 3 -print
```

Expected: all declared license and notice files exist in the bundle.

- [ ] **Step 6: Commit**

```bash
git add LICENSE NOTICE THIRD_PARTY_NOTICES.md scripts/bundle-licenses.mjs scripts/bundle-licenses.test.mjs package.json package-lock.json scripts/build-local-app.sh .github/workflows/release.yml
git commit -m "build: bundle release license notices"
```

### Task 6: Set version 0.6.0 and verify metadata

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `wails.json`
- Create: `scripts/verify-release-version.mjs`
- Create: `scripts/verify-release-version.test.mjs`
- Modify: `.github/workflows/release.yml`

- [ ] **Step 1: Write version-verifier tests**

Use temporary `package.json`, `wails.json`, and `Info.plist` fixtures. Assert matching `0.6.0` passes and mismatched `0.5.43` throws a message naming the mismatched carrier.

- [ ] **Step 2: Verify RED**

```bash
node --test scripts/verify-release-version.test.mjs
```

Expected: FAIL because the verifier is absent.

- [ ] **Step 3: Implement the verifier and bump versions**

Run:

```bash
npm version 0.6.0 --no-git-tag-version
```

Set `wails.json` `info.productVersion` to `0.6.0`.

The verifier CLI must accept:

```bash
node scripts/verify-release-version.mjs \
  --expected 0.6.0 \
  --package package.json \
  --wails wails.json \
  --app build/bin/OfficeDex.app
```

On macOS read `CFBundleShortVersionString` and `CFBundleVersion` through `/usr/libexec/PlistBuddy`.

- [ ] **Step 4: Update safe dependency patches**

Run through the configured local proxy:

```bash
env HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
  npm install --save-dev vite@6.4.3 vitest@3.2.7
env HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
  npm audit fix
```

Do not use `--force`; the PDF.js major migration and SheetJS replacement are outside this release's safe patch scope.

- [ ] **Step 5: Verify GREEN**

```bash
node --test scripts/verify-release-version.test.mjs
npm ci
npm run lint
npm test -- --run
```

Expected: PASS with package and Wails versions equal to `0.6.0`.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json wails.json scripts/verify-release-version.mjs scripts/verify-release-version.test.mjs .github/workflows/release.yml
git commit -m "release: prepare OfficeDex 0.6.0 metadata"
```

### Task 7: Document inherited dependency risk and clean release-only artifacts

**Files:**
- Create: `docs/security/v0.6.0-dependency-risk.md`
- Delete: `.superpowers/brainstorm/**`
- Delete: root HTML design exploration files

- [ ] **Step 1: Record the post-update production audit**

Run:

```bash
npm audit --omit=dev --json
```

Document remaining advisories, affected runtime paths, and release rationale. Explicitly record that `pdfjs-dist` requires a breaking major migration and npm `xlsx` has no fixed registry release.

- [ ] **Step 2: Remove local-only artifacts**

Remove these tracked paths:

```text
.superpowers/brainstorm/
ai-edit-panel-layout-option-b-refined.html
ai-edit-panel-layout-options.html
deck-animation-options-v2.html
deck-animation-options.html
node-draw-animation-demo.html
ppt-complete-layout-options.html
```

Keep `marketing/ppt-launch-video/` and `docs/superpowers/`.

- [ ] **Step 3: Verify repository hygiene**

```bash
git diff --check
git status --short
```

Expected: only intentional release changes remain; no `.superpowers/brainstorm/state/server-info` or root design prototypes.

- [ ] **Step 4: Commit**

```bash
git add -A docs/security .superpowers '*.html'
git commit -m "chore: clean OfficeDex 0.6.0 release tree"
```

### Task 8: Add the real PPTX edit/autosave/reopen release smoke

**Files:**
- Modify: `e2e/generation-real.spec.ts`
- Modify: `e2e/support/real-e2e.ts`

- [ ] **Step 1: Add the hosted PPTX release assertion**

For the PPTX generation case, after completion:

```ts
const verifiedTitle = "OfficeDex v0.6.0 Verified";
const editInput = page.getByPlaceholder(/Ask to modify this PPT/i);
await editInput.fill(`将第一页的标题改为“${verifiedTitle}”`);
await page.getByRole("button", { name: /Send edit request/i }).click();
await expect(page.getByText(/Saved locally\./i).last()).toBeVisible({ timeout: 180_000 });

await page.reload();
await dismissOnboarding(page);
await expect(page.locator("iframe[title='PPTist Embed']")).toBeVisible({ timeout: 120_000 });
const pptist = page.frameLocator("iframe[title='PPTist Embed']");
await expect(pptist.getByText(verifiedTitle).first()).toBeVisible({ timeout: 120_000 });
```

Use the deterministic Chinese title-edit grammar so the edit does not require a second hosted planner call.

- [ ] **Step 2: Confirm the autosave behavior already had a focused RED**

Task 2 must have recorded the focused `DialogueScreens.test.tsx` failure before
the production prop change. This E2E extends that same proven regression into a
hosted acceptance smoke after the unit-level RED/GREEN cycle; it does not add a
second production behavior change.

- [ ] **Step 3: Run the release smoke after Tasks 2–7**

```bash
env HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
  OFFICEDEX_E2E_RUN_HOSTED_PPTX=1 \
  npm run test:e2e -- e2e/generation-real.spec.ts --grep "real pptx"
```

Expected: PASS with a generated artifact report and persisted edited title after reload.

- [ ] **Step 4: Commit**

```bash
git add e2e/generation-real.spec.ts e2e/support/real-e2e.ts
git commit -m "test: verify PPTX edit autosave before release"
```

### Task 9: Run the full local release gate

**Files:**
- Modify only if verification exposes a release blocker.

- [ ] **Step 1: Reinstall and rebuild from committed source**

```bash
env HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm ci
env HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm run build:pptist
git diff --exit-code -- public/pptist
```

- [ ] **Step 2: Run code-quality and test matrices**

```bash
npm run lint
npm test -- --run
UI_KIT=weboffice npm test -- --run
env -u GOROOT go test ./... -count=1
env -u GOROOT go test -tags officedex_demo ./... -count=1
env -u GOROOT go vet ./...
```

- [ ] **Step 3: Run build matrices**

```bash
npx vite build
UI_KIT=weboffice npx vite build --outDir /tmp/officedex-v0.6.0-weboffice
env -u GOROOT GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build ./...
env -u GOROOT GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build ./...
```

- [ ] **Step 4: Build and verify the macOS application**

```bash
env -u GOROOT /Users/luyang/go/bin/wails build \
  -platform darwin/arm64 \
  -trimpath \
  -ldflags "-X main.appVersion=0.6.0"
npm run bundle:licenses:mac
npm run bundle:officecli:mac
node scripts/verify-wails-app.mjs build/bin/OfficeDex.app
node scripts/verify-release-version.mjs --expected 0.6.0 --package package.json --wails wails.json --app build/bin/OfficeDex.app
codesign --verify --deep --strict --verbose=4 build/bin/OfficeDex.app
```

- [ ] **Step 5: Run final hygiene/security checks**

```bash
npm audit --omit=dev
git diff --check
git status --short --branch
```

Expected: the worktree is clean after committing verification fixes; only documented inherited audit findings remain.

### Task 10: Push main, tag v0.6.0, and verify the published release

**Files:**
- No source changes expected.

- [ ] **Step 1: Confirm the release commit and remote state**

```bash
git fetch origin --tags --prune
git status --short --branch
git log --oneline origin/main..HEAD
git tag -l v0.6.0
```

Expected: clean worktree, reviewed commits ahead of `origin/main`, and no existing `v0.6.0` tag.

- [ ] **Step 2: Push main**

```bash
git push origin main
```

- [ ] **Step 3: Wait for main CI to pass**

Use the available GitHub API/CLI or browser session to verify the `CI` workflow for the pushed release commit succeeds. Do not tag while CI is pending or failed.

- [ ] **Step 4: Create and push the annotated release tag**

```bash
git tag -a v0.6.0 -m "OfficeDex v0.6.0"
git push origin v0.6.0
```

- [ ] **Step 5: Monitor all release jobs**

Verify these jobs succeed:

```text
Build (macOS-universal)
Build (Windows-amd64)
Publish GitHub Release
Sync to officedex-dist
```

- [ ] **Step 6: Verify published artifacts and manifest**

Confirm the GitHub Release contains:

```text
OfficeDex-v0.6.0-darwin-universal.zip
OfficeDex-v0.6.0-darwin-universal.dmg
OfficeDex-v0.6.0-windows-amd64.zip
```

Download or inspect the published artifacts and verify license files are present. Verify `officedex-dist/manifest.json` reports version `0.6.0`, correct asset URLs, sizes, and checksums.

- [ ] **Step 7: Final status**

Report the release URL, release commit SHA, workflow run IDs, artifact names/sizes, manifest version, and any explicitly accepted dependency advisories.
