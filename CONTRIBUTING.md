# Contributing to OfficeDex

Thanks for taking the time to contribute! This document covers everything you need to get a development build running and submit a clean pull request.

## Table of contents

- [Ground rules](#ground-rules)
- [Getting set up](#getting-set-up)
- [Project layout](#project-layout)
- [Running the app](#running-the-app)
- [Testing & linting](#testing--linting)
- [Commit style](#commit-style)
- [Pull-request checklist](#pull-request-checklist)
- [Release flow](#release-flow)
- [Reporting bugs / security issues](#reporting-bugs--security-issues)

## Ground rules

- Be respectful — see [Code of Conduct](./CODE_OF_CONDUCT.md).
- File an issue (or check the Discussions tab) **before** spending time on a non-trivial change so we can align on direction.
- Prefer small, focused PRs. One concern per PR.
- All UI changes must follow the approved OD-UI-1.2 r10 prototype and standard (see `CLAUDE.md`). Its tokens are projected into [`src/shell/tokens.css`](./src/shell/tokens.css) — read that file; do not hard-code colours or type sizes outside it.

## Getting set up

Prerequisites:

| Tool | Version | Why |
|---|---|---|
| Go | matches `go.mod` (currently 1.22+) | Wails backend, IPC, persistence |
| Node.js | 20 LTS | Renderer (Vite + React 19) and build scripts |
| Wails CLI | v2.12.0 | `go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0` |
| Xcode CLT (macOS) or WebView2 (Windows) | latest | Webview runtime |

```bash
git clone https://github.com/officecli/officedex.git
cd officedex
npm ci
```

> **Note on the `@shimo` scope.** Three `@shimo/*` packages (`@shimo/sdk-sheet`,
> `@shimo/editor-sdk-core`, `@shimo/simple-i18n`) are currently published only to an internal npm registry, so
> `npm ci` cannot complete from outside the organisation yet. Internal
> developers copy `.npmrc.example` to `.npmrc` (git-ignored) to point the
> scope at that registry. We are working on a public distribution; until then
> external contributors can still read, review and build the Go side, but a
> full renderer install needs those packages.

The first build will run `scripts/fetch-officecli.mjs` to download a pinned `officecli` binary into `build/officecli/`. The version comes from `package.json#officecliVersion`.

## Project layout

```
.
├── app.go                  # Wails app shell + bindings exposed to renderer
├── main.go                 # entrypoint, embeds dist/, injects appVersion
├── internal/               # Go: bridge, login, localstore, diagnostics, etc.
├── src/renderer/           # React 19 + Vite renderer (TypeScript)
├── src/renderer/i18n/      # zh.ts / en.ts dictionaries (keys must align)
├── src/renderer/styles/    # split CSS modules (tokens → shell → screens)
├── scripts/                # fetch-officecli, codesign, build-manifest
├── e2e/                    # Playwright tests
└── .github/workflows/      # CI (lint+test) and Release (tag → build → publish)
```

## Running the app

```bash
npm run dev          # wails dev — full desktop loop with hot reload
npm run dev:browser  # vite-only — renderer in a browser tab (no Go bridge)
```

For a one-off production build:

```bash
npm run build              # current platform
npm run dist:mac           # macOS universal, with codesign step
npm run dist:win           # Windows amd64
```

## Testing & linting

```bash
npm run lint               # tsc --noEmit (strict TypeScript)
npm run test:acceptance:regressions # historical edit/review/routing/save regressions
npx vitest run             # renderer unit tests
go test . ./internal/... -count=1 # owned Go sources, excluding release archives
npm run test:e2e           # Playwright (requires `npm run test:e2e:install` first)
npm run test:all           # everything in one shot
```

CI runs lint + vitest + `go test` on every PR. E2E is currently local-only.

Fresh macOS builds also run lint and the acceptance regression suite before
building. Its browser test needs the Playwright Chromium installed by
`npx playwright install chromium`; it opens isolated pages without a dev server.
The cumulative gate runs all renderer tests, Go source tests, actual browser
shortcut/style checks, and the sibling officecli DOCX/modify/PPTX conversion and
recovery tests. It requires the matching officecli checkout and real MOP runtime;
missing prerequisites fail the gate. Original QA21/22 negative PPTX packages and
QA23 DOCX before/after packages are checked in as regression fixtures.
Repackaging an already built app (`--skip-build`) does not rerun source checks;
it is only valid for the unchanged binary that already passed this gate.

An acceptance issue is closed only for the paths actually verified. Preserve
the original prompt and source/result bytes, and distinguish “not reproduced”
from “fixed”. For edits, cover attachment, mention, selected text and active
document, both Full access and Review, single and batch targets, Apply/Reject/
Undo, failed writes, queue transitions and restart recovery. Verify source
contents after reopening; a completed worker or an artifact card alone is not
proof of a saved edit. For embedded editors, verify shortcuts with focus in the
title/body/notes as well as the shell; clicking Save does not cover the shortcut.
Source-level and browser tests do not replace native signed-client acceptance.

### i18n contract

Renderer strings live in `src/renderer/i18n/zh.ts` and `en.ts`. `i18n.test.ts` enforces that both files declare the same keys — if you add a key on one side, add it on the other.

## Commit style

We loosely follow Conventional Commits — the type prefix matters more than perfect grammar:

```
<type>(<scope>): short summary

Longer body explaining the why, not the what.
```

Common types: `feat`, `fix`, `refactor`, `chore`, `docs`, `test`, `ci`, `perf`.

Scope is optional but useful: `settings`, `report`, `bridge`, `login`, `i18n`, `ci`, etc.

Please do not add `Co-Authored-By: Claude` (or other AI) trailers.

## Pull-request checklist

Before opening a PR, please confirm:

- [ ] `npm run lint` passes
- [ ] `npx vitest run` and `go test ./...` pass
- [ ] If you touched any renderer string, both `zh.ts` and `en.ts` are updated
- [ ] If you touched UI, the change still matches `src/shell/tokens.css`
- [ ] The PR description explains the user-facing impact, not just the diff
- [ ] Linked issue (or `Fixes #NNN`) when applicable

CI must be green before review. Maintainers will squash-merge once approved.

## Release flow

There are two selectable update channels: `stable` at `officedex-dist/manifest.json`, and `beta` (shown as **Test**) at `officedex-dist/channels/beta/manifest.json`. Each has its own signature and archive directory; both use GitHub Release assets on `officecli/officedex`. Stable remains the build default. Releases are compiled, signed and notarized locally; do not publish through GitHub Actions.

Versions are plain `x.y.z`; the client compares three numeric segments and ignores a `-beta` suffix, so pre-release suffixes never trigger an update and are refused by the publish scripts.

### Shipping a release (macOS arm64 and Intel; Windows is built but not yet shipped)

Before final-package acceptance **and again before publishing a Release or update
manifest**, launch the exact signed app being accepted and trigger an engine
operation (for example, run a minimal document-generation smoke task). Inspect its PID and
run the following check with the active profile's settings file:

```bash
ps -axo pid=,ppid=,comm=
node scripts/verify-running-engine.mjs \
  --app /absolute/path/OfficeDex.app --pid <app-pid> \
  --settings "$HOME/Library/Application Support/OfficeDex/settings.json" \
  --expected-version X.Y.Z --out /absolute/path/engine-verification.json
```

This gate requires an actual OfficeCLI descendant of the selected app, rejects
engines outside that bundle and persisted `bridgeBinaryPath` overrides, and
records app/engine paths, PIDs, SHA-256 and the engine's full build version. Clear
obsolete overrides while the app is stopped, then restart it; do not pin settings
to a release-specific path. Preserve the JSON with the source revision and final
package provenance. Re-run after any restart, settings change or bundle rebuild.
For browser E2E, also record its explicitly selected engine; that isolated host
does not validate the native app's profile. On 2026-10-12 an old native profile
selected a September build while E2E correctly used the October bundled engine.
An app version label or a standalone `officecli version` is insufficient.

1. Bump `version` in `package.json` and `productVersion` in `wails.json`.
2. Compile and notarize on this machine: `bash scripts/build-mac-dmg.sh` for Apple Silicon, then `TARGET_ARCH=x64 bash scripts/build-mac-dmg.sh` for Intel (see below; the two share `build/bin`, so one after the other). Each writes `dist-artifacts/OfficeDex-<v>-darwin-<arch>.dmg` and the updater zip `OfficeDex-v<v>-darwin-<arch>.zip`.
3. Create the GitHub Release with all four files, keeping the file names (the manifest derives asset URLs from `releases/download/v<v>/<basename>`). Not a pre-release: `releases/latest` must move to it.
   ```
   gh release create v1.0.13 --title "OfficeDex 1.0.13" --notes-file notes.md \
     dist-artifacts/OfficeDex-1.0.13-darwin-arm64.dmg \
     dist-artifacts/OfficeDex-v1.0.13-darwin-arm64.zip \
     dist-artifacts/OfficeDex-1.0.13-darwin-x64.dmg \
     dist-artifacts/OfficeDex-v1.0.13-darwin-x64.zip
   ```
   An arch that is finished later goes onto the same release: `gh release upload v1.0.13 dist-artifacts/OfficeDex-1.0.13-darwin-x64.dmg dist-artifacts/OfficeDex-v1.0.13-darwin-x64.zip`.
4. Write the signed manifest into `officedex-dist` and push it:
   ```
   node scripts/publish-update-channel.mjs --channel stable \
     --darwin-arm64 dist-artifacts/OfficeDex-v1.0.13-darwin-arm64.zip \
     --darwin-amd64 dist-artifacts/OfficeDex-v1.0.13-darwin-x64.zip \
     --notes "..." --dist ../officedex-dist --commit
   git -C ../officedex-dist push
   ```
   The manifest signing key comes from `~/.officedex-signing/manifest-signing-key.pem` (or `OFFICEDEX_MANIFEST_SIGNING_KEY`); never commit it. Same-version publishes merge assets, so an Intel zip can be added to the same manifest later with just `--darwin-amd64` (the updater looks assets up by `GOOS-GOARCH`, hence `amd64` here and `x64` in the file name). `--dry-run [--out-dir dir]` builds and signs without writing.
5. Check anonymously that `manifest.json` and `manifest.json.sig` are both served (`?cb=<random>` to skip caches) and that the release assets download.

### Intel (darwin-x64) packages from an Apple Silicon machine

`TARGET_ARCH=x64 bash scripts/build-mac-dmg.sh` cross-compiles the Go side and officecli, but every native payload must already exist for x64; the script asserts each one (with `lipo -archs`) before the long build and names the missing piece. Prepare them once, and again whenever the upstream revision changes:

- **MOP Node runtime**: `node-v24.18.0-darwin-x64.tar.gz` and `node-v24.18.0-SHASUMS256.txt` from nodejs.org in `build/cache/pptxgenjs-runtime/` (the pinned version is `PINNED_NODE_VERSION` in `scripts/stage-mop-runtime.mjs`).
- **mop-convert** (ppt2mop): in the ppt2mop checkout
  ```
  cargo build --release -p pptx2mop --target x86_64-apple-darwin   # add --offline when the private crate registry is unreachable
  cp target/x86_64-apple-darwin/release/pptx2mop <officedex>/build/cache/mop-convert/darwin-x64/mop-convert
  ```
  (`MOP_CONVERT_BIN=<path>` overrides the cache lookup.)
- **word2mow convert**: the build is pinned by sha256 in `KNOWN_CONVERT_BUILDS` (`scripts/prefetch-word2mow-convert.mjs`), so the registered binary is the one to use. To produce a new one, build from a clean checkout of the pinned revision -- the binary embeds its build path, so a dirty tree or another path yields another digest:
  ```
  git -C ../word2mow worktree add --detach /tmp/word2mow-clean <revision>
  cd /tmp/word2mow-clean && cargo --config cargo.config build --offline --release -p word2mow --bin convert --target x86_64-apple-darwin
  cp target/x86_64-apple-darwin/release/convert <officedex>/build/cache/word2mow/darwin-x64/convert
  git -C ../word2mow worktree remove --force /tmp/word2mow-clean
  ```
  then register its `shasum -a 256` and revision under `darwin-x64`. `OFFICEDEX_WORD2MOW_CONVERT_SRC=<path>` overrides the cache lookup; the digest check still applies.
- **office2modoc FFI**: `OFFICE2MODOC_TARGET=x86_64-apple-darwin node scripts/stage-office2modoc-ffi.mjs` copies the checksummed dylib from `../officecli-internal/third_party/office2modoc-ffi/<version>/` (`OFFICE2MODOC_SOURCE_ROOT` overrides) into `build/cache/office2modoc/<version>/darwin-x64/`.
- **presentation natives**: the presentation checkout must hold the darwin-x64 esbuild / rollup / rolldown / lightningcss packages next to the arm64 ones. Add `supportedArchitectures: { cpu: [arm64, x64] }` to its `pnpm-workspace.yaml` and run `pnpm install` there; `stage:presentation` fails naming the missing package otherwise.

The build runs from a linked worktree as well: sibling checkouts (officecli-internal, presentation, ppt2mop) are resolved next to the main worktree, and `OFFICECLI_INTERNAL_DIR` / `PRESENTATION_SOURCE_DIR` override them. The MOP worker smoke inside the build draws a deck with the staged x64 Node and mop-convert; on an Apple Silicon host Rosetta runs them, so it is not skipped. For a manual check install the DMG and launch the app (its binary is x64-only, so macOS runs it under Rosetta), then generate a PPTX, open and save a DOCX and generate an XLSX; `lipo -archs` on `officedex`, `officecli`, `mop-runtime/bin/node`, `presentation/tools/bin/mop-convert`, `word2mow/convert` and `liboffice2modoc_ffi.dylib` inside the bundle must all say `x86_64`. None of this replaces a run on an Intel Mac before a release.

### Windows (windows-amd64) packages

The Windows package is assembled by `npm run dist:win` (`scripts/dist-win.mjs`), on a Mac or on a Windows machine; `npm run dist:win:installer` adds the NSIS installer `OfficeDex-v<v>-windows-amd64-installer.exe` and the portable `OfficeDex-v<v>-windows-amd64.zip` in `dist-artifacts/`. The inputs it needs (the win-x64 Node zip, the two cross-built Rust converters with their pinned digests, the win32-x64 presentation natives, the office2modoc DLL), what a Mac cannot verify and how a Windows host proves it, the updater's installer contract and the open decisions (Authenticode certificate, install scope, zip vs installer) are all in [docs/windows-build.md](docs/windows-build.md). The Windows checks that need a Windows host run in the private `officecli/officedex-private-builds` repository, never in this public one (its logs and artifacts would expose an unsigned package with private components). Nothing Windows is published yet: the update manifest's `windows-amd64` asset must be the installer (`--windows <installer.exe>`), and it is not added until a signed build has passed acceptance on a Windows 10/11 machine.

Clients on 0.6.x poll the same root manifest and upgrade straight to the current version. Clients on 1.0.6–1.0.12 polled the legacy OBS channel; it was written one last time (`--channel 1.0`) with a stable-channel build and is frozen. `officedex-dist/channels/1.0/` is the even older bridge for 1.0.1–1.0.5 and stays untouched.

### App icon resources and macOS appearance

The native icon source is `resources/dmg/OfficeDex.icon` (the foreground SVG is
inside `Assets/`). Run `bash scripts/generate-app-icons.sh` with Apple Icon Composer
installed, or set `ICTOOL` to its `Contents/Executables/ictool`, to regenerate
`build/appicon.png`, `build/icon.png`, and `build/icon.icns`. A full Xcode installation
is not required. These generated files are committed, so ordinary builds do not
need Icon Composer. Wails builds the bundled ICNS from `build/appicon.png`.

The white foreground must stay flat: its layer has `glass: false`, and the group
disables specular, shadow, blur and translucency. Pre-render it with Icon Composer
before generating ICNS sizes. A raw SVG raster makes macOS 26 synthesize a bevel
on the white logo; plist compatibility flags do not prevent it. The black enclosure
retains the system's thin edge lighting. Do not replace this with Finder custom-icon
metadata, which fails strict code-signature verification.

Before publishing an icon change, mount the final DMG and inspect the actual
system-resolved appearance (use the mounted app's real path):

```bash
swift scripts/preview-mac-app-icon.swift "/Volumes/OfficeDex/OfficeDex.app" /tmp/officedex-system-icon.png
```

Check the rendered PNG for a black tile, a uniformly white foreground with no bevel
or vertical gray gradient, and no gray outer tile. Also inspect the mounted installer
in Finder and the app extracted from the update ZIP; source-image inspection alone
is insufficient. `swift scripts/verify-mac-app-icon.swift <app>` checks the white
interior in the system-resolved image before a release is signed.

### Building and testing a test-channel package

1. Allocate the next unused plain `x.y.z` version across **both** channels. Set `package.json`, the root versions in `package-lock.json`, and `wails.json`. Never reuse a version for different bytes, or use `-beta.N`: clients compare numeric versions only.
2. Build locally with `UPDATE_CHANNEL=beta TARGET_ARCH=arm64 bash scripts/build-mac-dmg.sh`. This bakes the test feed; it does not publish anything. Share the resulting signed, notarized DMG for installation testing.
3. In **Settings → About & support → Update channel**, choose Stable or Test. The choice is persisted and overrides the package default on future launches. Existing installations without a choice follow the package default. Checks, downloads and installation hand-offs must finish before changing channels. A successful switch clears the previous feed's release/download references and checks the selected feed immediately.
4. Switching back to Stable does **not** downgrade a newer test build. The next strictly higher stable version will be offered. Promoting the exact same tested bytes requires a newly numbered stable build if test installations must receive it through the updater.

For local acceptance before publishing a feed, switching to Test can report a missing/unavailable manifest; that is expected. There is no fallback to another channel. The first testers on older clients without the selector must install this DMG manually. Both channels still require Ed25519 manifest signatures, HTTPS and SHA-256 asset verification. `OFFICEDEX_UPDATE_MANIFEST_URL` remains a developer override; channel changes are refused while it is set.

Only when test-channel publication is explicitly requested:

```bash
# Keep test releases out of releases/latest and the stable manifest.
gh release create vX.Y.Z --prerelease --latest=false --title "OfficeDex X.Y.Z (Test)" \
  dist-artifacts/OfficeDex-X.Y.Z-darwin-arm64.dmg \
  dist-artifacts/OfficeDex-vX.Y.Z-darwin-arm64.zip
node scripts/publish-update-channel.mjs --channel beta --version X.Y.Z \
  --darwin-arm64 dist-artifacts/OfficeDex-vX.Y.Z-darwin-arm64.zip \
  --dist ../officedex-dist --commit
git -C ../officedex-dist push
```

The publisher stages only `channels/beta/` for Test, or the root manifest/signature and `archive/` for Stable. It refuses a nonempty Git index before publication with `--commit`. Do not write new versions to OBS or either legacy `channels/1.0/` location. A local-only validation can use `--dry-run --out-dir <scratch-dir>` to generate and verify signatures without changing any feed.

### What the updater refuses

The update chain is designed so that someone who can write to the OBS bucket or to `officedex-dist` still cannot get a build installed:

- **Manifest signature.** `internal/appupdate` fetches `<manifest>.sig` next to the manifest and verifies an Ed25519 signature over the exact manifest bytes with the public key baked into the binary (`releaseManifestPublicKey` in `app_update_channel.go`, format in `internal/appupdate/signature.go`). No signature, a wrong key, or a changed byte rejects the manifest before it is parsed. The publish script refuses to sign with a key that does not match the baked one.
- **Asset integrity.** Every asset must carry a 64-hex `sha256` and an `https` URL; the download must match the sha256 and the declared `size`. A manifest without a sha256 is not "unverified", it is refused.
- **macOS install.** Before the quarantine attribute is removed, `app_update_darwin.go` runs `codesign --verify --deep --strict` on the extracted bundle and requires its Team ID to equal the running app's (`verifyUpdateBundle`). A mismatch deletes the download. Consequence: ad-hoc / `SKIP_SIGN=1` builds have no Team ID and will not self-update.
- **officecli runtime.** `internal/runtime` only offers a GitHub release that ships `checksums.txt`, fetches it over https, and refuses to install a tarball whose sha256 is missing from it or does not match.

### Manifest signing key

- Generate once: `node scripts/manifest-signing.mjs keygen` writes `~/.officedex-signing/manifest-signing-key.pem` (mode 0600) and prints the public key. Bake that public key into `releaseManifestPublicKey` in `app_update_channel.go`; `scripts/manifest-signing.test.mjs` and `app_update_channel_test.go` check it parses.
- Rotating the key orphans every installed client (they only trust the baked key), so a rotation is a product decision that needs a transition release that trusts both keys. Do not run `keygen --force` casually.
- Testing with a throwaway key: `node scripts/manifest-signing.mjs keygen --out /tmp/dev.pem`, build with `-ldflags "-X main.appUpdateManifestPublicKey=$(cat /tmp/dev.pem.pub)"`, and publish / dry-run with `--signing-key /tmp/dev.pem --public-key $(cat /tmp/dev.pem.pub)`. `node scripts/manifest-signing.mjs verify --in manifest.json --sig manifest.json.sig [--public-key …]` checks a pair by hand.

### OBS bucket: manual follow-ups

Two things the code cannot do and a human with the Huawei Cloud console must:

1. **Turn off anonymous listing on the bucket.** Objects are public-read on purpose (the updater sends no credentials), but the bucket itself is currently listable by anyone (`node scripts/obs-client.mjs probe <bucket>` with the bucket from `OBS_BUCKET` in `scripts/update-channel.mjs` prints `public list: HTTP 200 (bucket listing is PUBLIC)`). Set the bucket policy / ACL so anonymous users can `GetObject` but not `ListBucket`; the probe should then print `private, good`.
2. **Move 1.0 to a dedicated, non-`test` bucket.** The current bucket (see `OBS_BUCKET`) is a shared test bucket. Create a bucket owned by the release process alone (e.g. `officedex-release`, same region as today, public-read objects, no listing, versioning on) and copy `officedex/channels/1.0/` and `officedex/releases/download/` into it.

   When the bucket changes, the client's manifest URL changes with it. Update, in this order and in one commit:
   - `OBS_BUCKET` (and `OBS_REGION` if it moves) in `scripts/update-channel.mjs` — `MANIFEST_URLS` and the asset base URL derive from it;
   - `channel10UpdateManifestURL` in `app_update_channel.go` — `scripts/update-channel.test.mjs` fails until the two agree;
   - this section and `AGENTS.md`.

   Installed clients keep polling the old URL until they have installed a build that bakes the new one, so publish one last signed manifest to the old bucket that points at a build carrying the new URL before the old objects are removed (the same bridge the 1.0.5 → OBS move used).

## Reporting bugs / security issues

- Functional bugs and feature requests → [GitHub Issues](https://github.com/officecli/officedex/issues) using the templates.
- Security vulnerabilities → please **do not** open a public issue. See [SECURITY.md](./SECURITY.md).

Thanks again for contributing. 🎉
