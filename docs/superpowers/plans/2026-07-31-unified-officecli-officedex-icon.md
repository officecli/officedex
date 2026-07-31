# Unified OfficeCLI and OfficeDex Icon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every included first-party OfficeCLI and OfficeDex icon derive from `officedex/build/appicon.png`, including desktop assets, three web surfaces, social previews, and current static promotional images.

**Architecture:** OfficeDex owns the canonical PNG and a deterministic Sharp-based generator. OfficeCLI keeps a checked vendored copy so its builds remain repository-local, then uses a second deterministic generator for favicons, OG art, and social previews. Static raster edits use a committed manifest of exact overlay rectangles; excluded GIF/video/raw/test/history paths are protected by hash snapshots.

**Tech Stack:** Node.js ESM, `sharp`, Node test runner, Vitest, Vite, Wails, macOS `sips`/`iconutil`, Git worktrees.

---

## File Map

### OfficeDex repository

- Create: `scripts/brand-assets.mjs` — canonical validation, resize, rounded-mask, SVG wrapper, ICNS generation, raster composition, verify mode.
- Create: `scripts/brand-assets.test.mjs` — focused generator and manifest tests.
- Create: `scripts/brand-promotions.json` — exact static-image overlay inventory.
- Modify: `package.json` — add `sharp`, `brand:generate`, `brand:verify`, and the focused script test.
- Modify: `package-lock.json` — npm lock update.
- Regenerate: `build/icon.png` and `build/icon.icns`.
- Regenerate: `public/officedex-logo.png` and `docs/screenshots/officedex-logo.png`.
- Regenerate: `docs/social-preview.png`.
- Regenerate: `docs/screenshots/hero-dialogue.png`.
- Regenerate: `docs/screenshots/settings-overview.png`.
- Regenerate: `docs/screenshots/features-grid-1.png`.
- Regenerate: `docs/screenshots/features-grid-2.png`.
- Regenerate: `docs/screenshots/features-grid-3.png`.
- Regenerate: `docs/screenshots/features-grid.png`.
- Regenerate: `docs/screenshots/preview-docx.png`.
- Regenerate: `docs/screenshots/preview-xlsx.png`.
- Regenerate: `docs/screenshots/vibeofficing.png`.
- Regenerate: `docs/screenshots/vibeofficing-analogy.png`.

### OfficeCLI internal repository

- Create: `platform/web/site/public/brand/officedex-icon-master.png` — vendored canonical copy.
- Create: `platform/web/site/public/brand/officedex-icon-master.sha256` — expected canonical hash.
- Create: `platform/web/site/scripts/brand-assets.mjs` — vendored-copy validation and web-asset generation.
- Create: `platform/web/site/scripts/brand-assets.test.mjs` — focused web asset tests.
- Create: `platform/web/site/public/og-cover.template.svg` — existing layout with a `{{BRAND_ICON_DATA_URI}}` placeholder.
- Modify: `platform/web/site/scripts/generate-officecli-social-preview.mjs` — composite the canonical icon instead of drawing the legacy mark.
- Modify: `platform/web/site/package.json` and `package-lock.json` — add `sharp`, `brand:generate`, and `brand:verify`.
- Regenerate: `platform/web/site/public/favicon.svg`.
- Regenerate: `platform/web/app/public/favicon.svg`.
- Regenerate: `platform/web/admin/public/favicon.svg`.
- Regenerate: `platform/web/site/public/officecli-logo.png`.
- Regenerate: `platform/web/site/public/og-cover.svg`.
- Regenerate: `platform/web/site/public/social-preview-officecli.png`.

### Residual-scan repositories and directories

- Verify only: `officecli/`, `officecli-npm/`, `officecli-dist/`, `officedex-dist/`, `homebrew-officecli/`, `officecli-ci/`, and `officedex-x-launch/`.
- Do not add icons to surfaces that currently have no first-party product icon.

---

### Task 1: Create isolated worktrees and record protected baselines

**Files:**
- No tracked file changes.

- [ ] **Step 1: Invoke the required worktree skill**

Use `superpowers:using-git-worktrees` before creating either worktree.

- [ ] **Step 2: Confirm the main checkouts and target files**

Run:

```bash
git -C /Users/luyang/Workspace/shimo/vibe-officing/officedex status --short --branch
git -C /Users/luyang/Workspace/shimo/vibe-officing/officecli-internal status --short --branch
git -C /Users/luyang/Workspace/shimo/vibe-officing/officecli-internal diff -- \
  platform/web/site/public \
  platform/web/app/public \
  platform/web/admin/public \
  platform/web/site/scripts/generate-officecli-social-preview.mjs
```

Expected: the OfficeCLI target asset files and generator have no user diff. If they do, stop and reconcile those exact files instead of creating an implementation worktree from stale content.

- [ ] **Step 3: Create the OfficeDex worktree**

Create branch `codex/unified-brand-icon` at the current OfficeDex `HEAD`, which includes design commit `83bd2c1`, in:

```text
/Users/luyang/.config/superpowers/worktrees/officedex/unified-brand-icon
```

- [ ] **Step 4: Create the OfficeCLI worktree**

Create branch `codex/unified-brand-icon` at the current `officecli-internal` `HEAD` in:

```text
/Users/luyang/.config/superpowers/worktrees/officecli-internal/unified-brand-icon
```

- [ ] **Step 5: Snapshot excluded-file hashes**

Run from the OfficeDex worktree:

```bash
find . -type f \( -iname '*.gif' -o -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' \) \
  -not -path './.git/*' -print0 | xargs -0 shasum -a 256 | sort \
  > /tmp/officedex-brand-excluded-before.sha256
```

Expected: a non-empty baseline file used again in Task 7.

---

### Task 2: Add the OfficeDex generator contract with failing tests

**Files:**
- Create: `scripts/brand-assets.test.mjs`
- Modify: `package.json`

- [ ] **Step 1: Install Sharp through the required proxy**

Run from the OfficeDex worktree:

```bash
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
npm install --save-dev sharp
```

Expected: `sharp` appears in `devDependencies`; `package-lock.json` changes.

- [ ] **Step 2: Write the failing generator tests**

Create `scripts/brand-assets.test.mjs` with these contracts:

```js
import assert from 'node:assert/strict'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'

import {
  CANONICAL_HEIGHT,
  CANONICAL_SHA256,
  CANONICAL_WIDTH,
  generateOfficeDexBrandAssets,
  verifyOfficeDexBrandAssets,
} from './brand-assets.mjs'

const repoRoot = path.resolve(import.meta.dirname, '..')

test('canonical OfficeDex icon is the approved 1254 square', async () => {
  const canonical = path.join(repoRoot, 'build/appicon.png')
  const metadata = await sharp(canonical).metadata()
  assert.equal(metadata.width, CANONICAL_WIDTH)
  assert.equal(metadata.height, CANONICAL_HEIGHT)
  assert.equal(CANONICAL_SHA256, 'ede76ed075d1715cb17adcc3359f6db9b149f389951e305a20842e6a49d8f489')
})

test('generator writes deterministic PNG and SVG outputs', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'officedex-brand-'))
  await generateOfficeDexBrandAssets({ repoRoot, outputRoot, includeIcns: false })
  await verifyOfficeDexBrandAssets({ repoRoot, outputRoot, includeIcns: false })

  const logo = await sharp(path.join(outputRoot, 'public/officedex-logo.png')).metadata()
  assert.deepEqual([logo.width, logo.height], [1254, 1254])
  assert.ok((await stat(path.join(outputRoot, 'build/icon.png'))).size > 0)
})

test('verification rejects a stale derivative', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'officedex-brand-stale-'))
  await generateOfficeDexBrandAssets({ repoRoot, outputRoot, includeIcns: false })
  await writeFile(path.join(outputRoot, 'public/officedex-logo.png'), 'stale')
  await assert.rejects(
    verifyOfficeDexBrandAssets({ repoRoot, outputRoot, includeIcns: false }),
    /officedex-logo\.png/,
  )
})

test('promotion manifest excludes GIF and video targets', async () => {
  const manifest = JSON.parse(await readFile(path.join(repoRoot, 'scripts/brand-promotions.json'), 'utf8'))
  for (const item of manifest.images) {
    assert.doesNotMatch(item.path, /\.(gif|mp4|mov|webm)$/i)
    assert.ok(item.overlays.length > 0)
  }
})
```

- [ ] **Step 3: Add scripts to `package.json`**

Add:

```json
"brand:generate": "node scripts/brand-assets.mjs --write",
"brand:verify": "node scripts/brand-assets.mjs --verify"
```

Append `scripts/brand-assets.test.mjs` to `test:scripts`.

- [ ] **Step 4: Run the test and verify RED**

Run:

```bash
node --test scripts/brand-assets.test.mjs
```

Expected: FAIL because `scripts/brand-assets.mjs` and `scripts/brand-promotions.json` do not exist.

- [ ] **Step 5: Commit the failing contract**

```bash
git add package.json package-lock.json scripts/brand-assets.test.mjs
git commit -m "test: define OfficeDex brand asset contract"
```

---

### Task 3: Implement the OfficeDex generator and promotion manifest

**Files:**
- Create: `scripts/brand-assets.mjs`
- Create: `scripts/brand-promotions.json`

- [ ] **Step 1: Implement canonical validation and image helpers**

Create `scripts/brand-assets.mjs` with these exported contracts:

```js
import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)

export const CANONICAL_WIDTH = 1254
export const CANONICAL_HEIGHT = 1254
export const CANONICAL_SHA256 = 'ede76ed075d1715cb17adcc3359f6db9b149f389951e305a20842e6a49d8f489'

export async function sha256(filePath) {
  return crypto.createHash('sha256').update(await readFile(filePath)).digest('hex')
}

export async function validateCanonical(filePath) {
  const metadata = await sharp(filePath).metadata()
  if (metadata.width !== CANONICAL_WIDTH || metadata.height !== CANONICAL_HEIGHT) {
    throw new Error(`canonical dimensions must be ${CANONICAL_WIDTH}x${CANONICAL_HEIGHT}`)
  }
  const digest = await sha256(filePath)
  if (digest !== CANONICAL_SHA256) throw new Error(`canonical SHA-256 mismatch: ${digest}`)
}

export async function renderIcon(input, size, radius = 0) {
  let pipeline = sharp(input).resize(size, size, { fit: 'fill', kernel: sharp.kernel.lanczos3 }).png()
  if (radius > 0) {
    const mask = Buffer.from(`<svg width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="white"/></svg>`)
    pipeline = pipeline.composite([{ input: mask, blend: 'dest-in' }])
  }
  return pipeline.toBuffer()
}

export async function compositeIcon(basePath, outputPath, canonicalPath, overlays) {
  const composites = []
  for (const overlay of overlays) {
    composites.push({
      input: await renderIcon(canonicalPath, overlay.width, overlay.radius ?? Math.round(overlay.width * 0.2)),
      left: overlay.left,
      top: overlay.top,
    })
  }
  await sharp(basePath).composite(composites).toFile(outputPath)
}
```

Implement `generateOfficeDexBrandAssets({ repoRoot, outputRoot = repoRoot, includeIcns = process.platform === 'darwin' })`, `verifyOfficeDexBrandAssets(...)`, and CLI parsing for `--write`/`--verify`. Generate everything into a temporary directory and rename only after every output validates.

- [ ] **Step 2: Add the exact promotion manifest**

Create `scripts/brand-promotions.json`:

```json
{
  "images": [
    { "path": "docs/screenshots/hero-dialogue.png", "overlays": [{ "left": 76, "top": 150, "width": 64, "radius": 13 }] },
    { "path": "docs/screenshots/settings-overview.png", "overlays": [{ "left": 76, "top": 150, "width": 64, "radius": 13 }] },
    { "path": "docs/screenshots/features-grid-1.png", "overlays": [{ "left": 76, "top": 150, "width": 64, "radius": 13 }] },
    { "path": "docs/screenshots/features-grid-2.png", "overlays": [{ "left": 76, "top": 150, "width": 64, "radius": 13 }] },
    { "path": "docs/screenshots/features-grid-3.png", "overlays": [{ "left": 76, "top": 150, "width": 64, "radius": 13 }] },
    { "path": "docs/screenshots/features-grid.png", "overlays": [{ "left": 53, "top": 87, "width": 28, "radius": 6 }, { "left": 1298, "top": 87, "width": 28, "radius": 6 }, { "left": 2544, "top": 87, "width": 28, "radius": 6 }] },
    { "path": "docs/screenshots/preview-docx.png", "overlays": [{ "left": 80, "top": 144, "width": 64, "radius": 13 }] },
    { "path": "docs/screenshots/preview-xlsx.png", "overlays": [{ "left": 80, "top": 144, "width": 64, "radius": 13 }] },
    { "path": "docs/social-preview.png", "overlays": [{ "left": 58, "top": 124, "width": 136, "radius": 28 }, { "left": 550, "top": 58, "width": 28, "radius": 6 }] },
    { "path": "docs/screenshots/vibeofficing.png", "overlays": [{ "left": 118, "top": 67, "width": 136, "radius": 28 }, { "left": 616, "top": 557, "width": 88, "radius": 18 }] },
    { "path": "docs/screenshots/vibeofficing-analogy.png", "overlays": [{ "left": 839, "top": 486, "width": 116, "radius": 24 }] }
  ]
}
```

Treat these rectangles as acceptance coordinates. If visual verification shows a one-pixel mismatch, update the manifest and its test together before committing generated binaries.

- [ ] **Step 3: Generate desktop and documentation assets**

The generator must:

```js
await writeFile(path.join(tempRoot, 'build/icon.png'), await renderIcon(canonicalPath, 1024))
await writeFile(path.join(tempRoot, 'public/officedex-logo.png'), await readFile(canonicalPath))
await writeFile(path.join(tempRoot, 'docs/screenshots/officedex-logo.png'), await readFile(canonicalPath))
```

On macOS, create an iconset containing 16, 32, 128, 256, 512, and 1024 pixel derivatives, then run:

```bash
iconutil -c icns <temporary-iconset> -o build/icon.icns
```

- [ ] **Step 4: Run focused tests and generate assets**

```bash
node --test scripts/brand-assets.test.mjs
npm run brand:generate
npm run brand:verify
```

Expected: PASS; all listed binaries change only where the manifest declares an icon.

- [ ] **Step 5: Verify idempotence**

```bash
git status --short > /tmp/officedex-brand-status-before.txt
npm run brand:generate
git status --short > /tmp/officedex-brand-status-after.txt
diff -u /tmp/officedex-brand-status-before.txt /tmp/officedex-brand-status-after.txt
```

Expected: no diff.

- [ ] **Step 6: Commit OfficeDex generation**

```bash
git add scripts/brand-assets.mjs scripts/brand-assets.test.mjs scripts/brand-promotions.json \
  package.json package-lock.json build/icon.png build/icon.icns public/officedex-logo.png \
  docs/screenshots/officedex-logo.png docs/social-preview.png docs/screenshots/*.png
git commit -m "feat: unify OfficeDex brand icon assets"
```

---

### Task 4: Add the OfficeCLI web generator contract with failing tests

**Files:**
- Create: `platform/web/site/scripts/brand-assets.test.mjs`
- Modify: `platform/web/site/package.json`
- Modify: `platform/web/site/package-lock.json`

- [ ] **Step 1: Install Sharp through the required proxy**

```bash
cd /Users/luyang/.config/superpowers/worktrees/officecli-internal/unified-brand-icon/platform/web/site
HTTP_PROXY=http://127.0.0.1:7890 \
HTTPS_PROXY=http://127.0.0.1:7890 \
npm install --save-dev sharp
```

- [ ] **Step 2: Write the failing web asset tests**

Create `platform/web/site/scripts/brand-assets.test.mjs`:

```js
import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import sharp from 'sharp'

import { generateWebBrandAssets, verifyWebBrandAssets } from './brand-assets.mjs'

const siteRoot = path.resolve(import.meta.dirname, '..')

test('vendored master matches the approved OfficeDex hash', async () => {
  const expected = (await readFile(path.join(siteRoot, 'public/brand/officedex-icon-master.sha256'), 'utf8')).trim()
  assert.equal(expected, 'ede76ed075d1715cb17adcc3359f6db9b149f389951e305a20842e6a49d8f489')
})

test('generator preserves public filenames and dimensions', async () => {
  const outputRoot = await mkdtemp(path.join(os.tmpdir(), 'officecli-brand-'))
  await generateWebBrandAssets({ siteRoot, outputRoot })
  await verifyWebBrandAssets({ siteRoot, outputRoot })

  const logo = await sharp(path.join(outputRoot, 'site/public/officecli-logo.png')).metadata()
  const social = await sharp(path.join(outputRoot, 'site/public/social-preview-officecli.png')).metadata()
  assert.deepEqual([logo.width, logo.height], [1024, 1024])
  assert.deepEqual([social.width, social.height], [1280, 640])

  for (const relative of ['site/public/favicon.svg', 'app/public/favicon.svg', 'admin/public/favicon.svg']) {
    const svg = await readFile(path.join(outputRoot, relative), 'utf8')
    assert.match(svg, /data:image\/png;base64,/)
    assert.doesNotMatch(svg, /M26 48L71 31|drawOfficeCliMark/)
  }
})
```

- [ ] **Step 3: Add package scripts**

Add to the site package:

```json
"brand:generate": "node scripts/brand-assets.mjs --write",
"brand:verify": "node scripts/brand-assets.mjs --verify",
"test:brand": "node --test scripts/brand-assets.test.mjs"
```

- [ ] **Step 4: Run the test and verify RED**

```bash
npm run test:brand
```

Expected: FAIL because the generator and vendored master do not exist.

- [ ] **Step 5: Commit the failing contract**

```bash
git add platform/web/site/package.json platform/web/site/package-lock.json \
  platform/web/site/scripts/brand-assets.test.mjs
git commit -m "test: define OfficeCLI web brand asset contract"
```

---

### Task 5: Implement OfficeCLI favicon, OG, logo, and social generation

**Files:**
- Create: `platform/web/site/public/brand/officedex-icon-master.png`
- Create: `platform/web/site/public/brand/officedex-icon-master.sha256`
- Create: `platform/web/site/public/og-cover.template.svg`
- Create: `platform/web/site/scripts/brand-assets.mjs`
- Modify: `platform/web/site/scripts/generate-officecli-social-preview.mjs`
- Regenerate the six public assets listed in the file map.

- [ ] **Step 1: Vendor the canonical source from the OfficeDex worktree**

```bash
mkdir -p platform/web/site/public/brand
cp /Users/luyang/.config/superpowers/worktrees/officedex/unified-brand-icon/build/appicon.png \
  platform/web/site/public/brand/officedex-icon-master.png
printf '%s\n' 'ede76ed075d1715cb17adcc3359f6db9b149f389951e305a20842e6a49d8f489' \
  > platform/web/site/public/brand/officedex-icon-master.sha256
```

- [ ] **Step 2: Create the OG template**

Copy the existing `public/og-cover.svg` to `public/og-cover.template.svg`. Replace only the legacy icon drawing groups on the left with:

```svg
<image
  x="108"
  y="88"
  width="420"
  height="420"
  preserveAspectRatio="xMidYMid meet"
  href="{{BRAND_ICON_DATA_URI}}"
/>
```

Keep the OfficeCLI wording, canvas size, background, command, and all right-side layout unchanged.

- [ ] **Step 3: Implement the web generator**

Create `platform/web/site/scripts/brand-assets.mjs` exporting `generateWebBrandAssets` and `verifyWebBrandAssets`. Use Sharp to produce:

```js
const master = path.join(siteRoot, 'public/brand/officedex-icon-master.png')
const faviconPng = await sharp(master).resize(128, 128).png().toBuffer()
const faviconSvg = `<svg width="128" height="128" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg"><image width="128" height="128" href="data:image/png;base64,${faviconPng.toString('base64')}"/></svg>\n`
```

Write the same SVG bytes to site, app, and admin favicon paths. Resize the master to 1024 for `officecli-logo.png`. Replace `{{BRAND_ICON_DATA_URI}}` in the OG template with a base64 420-pixel PNG.

- [ ] **Step 4: Replace the social preview legacy drawing**

In `generate-officecli-social-preview.mjs`:

- remove the `drawOfficeCliMark(106, 146, 338)` call;
- leave all OfficeCLI text and background drawing unchanged;
- import Sharp;
- encode the current canvas to a buffer;
- composite a 338 by 338 rounded canonical icon at left 106, top 146;
- write the composited 1280 by 640 PNG.

Use:

```js
const base = encodePNG(WIDTH, HEIGHT, canvas)
const icon = await sharp(masterPath)
  .resize(338, 338, { kernel: sharp.kernel.lanczos3 })
  .composite([{ input: Buffer.from('<svg width="338" height="338"><rect width="338" height="338" rx="68" fill="white"/></svg>'), blend: 'dest-in' }])
  .png()
  .toBuffer()
const output = await sharp(base).composite([{ input: icon, left: 106, top: 146 }]).png().toBuffer()
```

- [ ] **Step 5: Generate and verify all OfficeCLI assets**

```bash
cd platform/web/site
npm run test:brand
npm run brand:generate
npm run brand:verify
node scripts/generate-officecli-social-preview.mjs
npm run brand:verify
```

Expected: PASS; favicon URLs and filenames remain unchanged.

- [ ] **Step 6: Verify idempotence**

```bash
git status --short > /tmp/officecli-brand-status-before.txt
npm run brand:generate
git status --short > /tmp/officecli-brand-status-after.txt
diff -u /tmp/officecli-brand-status-before.txt /tmp/officecli-brand-status-after.txt
```

Expected: no diff.

- [ ] **Step 7: Commit OfficeCLI generation**

```bash
git add platform/web/site/public/brand platform/web/site/public/og-cover.template.svg \
  platform/web/site/scripts/brand-assets.mjs platform/web/site/scripts/brand-assets.test.mjs \
  platform/web/site/scripts/generate-officecli-social-preview.mjs \
  platform/web/site/public/favicon.svg platform/web/app/public/favicon.svg \
  platform/web/admin/public/favicon.svg platform/web/site/public/officecli-logo.png \
  platform/web/site/public/og-cover.svg platform/web/site/public/social-preview-officecli.png \
  platform/web/site/package.json platform/web/site/package-lock.json
git commit -m "feat: unify OfficeCLI web brand icon"
```

---

### Task 6: Add residual scans and build verification

**Files:**
- Modify: `scripts/brand-assets.test.mjs`
- Modify: `platform/web/site/scripts/brand-assets.test.mjs`

- [ ] **Step 1: Add legacy SVG signature scans**

In the OfficeCLI test, scan included text assets and fail on the legacy definitions:

```js
const legacyPatterns = [/M26 48L71 31/, /M132 248L324 166/, /drawOfficeCliMark\s*\(/]
```

Allow no matches under:

```text
platform/web/site/public
platform/web/app/public
platform/web/admin/public
platform/web/site/scripts
```

Exclude the design and implementation plan documents from this scan because they intentionally describe the legacy state.

- [ ] **Step 2: Scan other repositories without changing them**

Run from the workspace root:

```bash
rg -n --hidden \
  -g '!**/.git/**' -g '!**/node_modules/**' -g '!**/dist/**' \
  -g '!**/raw/**' -g '!**/test-results/**' -g '!**/output*/**' \
  '(M26 48L71 31|M132 248L324 166|drawOfficeCliMark|officecli-logo\.png|legacy.*icon)' \
  officecli officecli-npm officecli-dist officedex-dist homebrew-officecli officecli-ci officedex-x-launch
```

Expected: no first-party legacy icon asset requiring replacement. Textual references to the current `officecli-logo.png` filename are acceptable only if the file now contains the canonical icon.

- [ ] **Step 3: Run OfficeDex verification**

```bash
cd /Users/luyang/.config/superpowers/worktrees/officedex/unified-brand-icon
npm run brand:verify
node --test scripts/brand-assets.test.mjs
npm run test:scripts
npm run test
npm run lint
npx vite build
git diff --check
```

Expected: all commands exit 0. If a broad pre-existing test fails, establish the worktree baseline from its parent commit and report it separately; do not weaken the focused brand tests.

- [ ] **Step 4: Run OfficeCLI verification**

```bash
cd /Users/luyang/.config/superpowers/worktrees/officecli-internal/unified-brand-icon/platform/web/site
npm run test:brand
npm run test
npm run lint
npm run build

cd ../app
npm run test
npm run lint
npm run build

cd ../admin
npm run test
npm run lint
npm run build

cd /Users/luyang/.config/superpowers/worktrees/officecli-internal/unified-brand-icon
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 5: Verify excluded files did not change**

```bash
cd /Users/luyang/.config/superpowers/worktrees/officedex/unified-brand-icon
find . -type f \( -iname '*.gif' -o -iname '*.mp4' -o -iname '*.mov' -o -iname '*.webm' \) \
  -not -path './.git/*' -print0 | xargs -0 shasum -a 256 | sort \
  > /tmp/officedex-brand-excluded-after.sha256
diff -u /tmp/officedex-brand-excluded-before.sha256 /tmp/officedex-brand-excluded-after.sha256
```

Expected: no diff.

- [ ] **Step 6: Commit scan improvements if tests changed**

Commit focused test changes in their owning repositories with:

```bash
git commit -am "test: prevent legacy brand icon regressions"
```

---

### Task 7: Browser and image visual QA

**Files:**
- No source changes unless QA identifies an overlay-coordinate defect.

- [ ] **Step 1: Start the three OfficeCLI web surfaces**

Run site, app, and admin dev servers on separate ports. Use the configured proxy for any npm operation that needs network access.

- [ ] **Step 2: Inspect favicon loading in the browser**

For site, app, and admin, verify in the DOM that the favicon URL returns HTTP 200 and the loaded image has non-zero dimensions. Confirm the same OfficeDex graphical mark is recognizable at 16, 32, and 128 pixels.

- [ ] **Step 3: Inspect OG and social assets**

Open:

```text
http://localhost:<site-port>/og-cover.svg
http://localhost:<site-port>/social-preview-officecli.png
```

Confirm OfficeCLI wording/layout is unchanged and only the icon mark changed.

- [ ] **Step 4: Inspect all changed OfficeDex raster assets**

Create a contact sheet containing every path in `scripts/brand-promotions.json`, plus `build/icon.png`, `public/officedex-logo.png`, and `docs/screenshots/officedex-logo.png`. Check that:

- no purple-grid or blue-green terminal icon remains;
- the canonical icon is not stretched;
- overlay corners are rounded on light backgrounds;
- no old icon edge or glow remains outside the replacement rectangle;
- surrounding text and UI pixels are unchanged.

Also inspect all `officedex-x-launch/*.png`, `marketing/ppt-launch-video/exports/*.{png,jpg}`, and `marketing/ppt-launch-video/graphics/rendered/*.png` as verify-only assets. They should remain unchanged unless a visible legacy icon is found during this final review.

- [ ] **Step 5: Correct manifest coordinates through RED/GREEN if needed**

If any overlay is misaligned, add a focused assertion for its rectangle, observe the failure, update only that manifest entry, regenerate, and re-run Task 6 plus the contact-sheet review.

---

### Task 8: Final review and integration handoff

**Files:**
- No new files expected.

- [ ] **Step 1: Invoke verification-before-completion**

Use `superpowers:verification-before-completion` and re-run the exact final commands from Task 6. Do not rely on earlier output.

- [ ] **Step 2: Review repository diffs**

```bash
git -C /Users/luyang/.config/superpowers/worktrees/officedex/unified-brand-icon status --short --branch
git -C /Users/luyang/.config/superpowers/worktrees/officedex/unified-brand-icon diff --stat HEAD~3..HEAD
git -C /Users/luyang/.config/superpowers/worktrees/officecli-internal/unified-brand-icon status --short --branch
git -C /Users/luyang/.config/superpowers/worktrees/officecli-internal/unified-brand-icon diff --stat HEAD~3..HEAD
```

Confirm no unrelated files entered either branch.

- [ ] **Step 3: Invoke requesting-code-review**

Use `superpowers:requesting-code-review` for the cross-repository change. Resolve any correctness or scope findings before integration.

- [ ] **Step 4: Invoke finishing-a-development-branch**

Use `superpowers:finishing-a-development-branch` to present merge/cherry-pick/PR options. Do not merge into the dirty main checkouts without explicit user approval.
