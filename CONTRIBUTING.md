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
npx vitest run             # renderer unit tests
go test ./... -count=1     # Go tests
npm run test:e2e           # Playwright (requires `npm run test:e2e:install` first)
npm run test:all           # everything in one shot
```

CI runs lint + vitest + `go test` on every PR. E2E is currently local-only.

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

### Shipping a release (macOS arm64 today; Intel and Windows are "coming soon")

1. Bump `version` in `package.json` and `productVersion` in `wails.json`.
2. Compile and notarize on this machine: `bash scripts/build-mac-dmg.sh` (Intel: `TARGET_ARCH=x64`). That writes `dist-artifacts/OfficeDex-<v>-darwin-<arch>.dmg` and the updater zip `OfficeDex-v<v>-darwin-<arch>.zip`.
3. Create the GitHub Release with both files, keeping the file names (the manifest derives asset URLs from `releases/download/v<v>/<basename>`). Not a pre-release: `releases/latest` must move to it.
   ```
   gh release create v1.0.13 --title "OfficeDex 1.0.13" --notes-file notes.md \
     dist-artifacts/OfficeDex-1.0.13-darwin-arm64.dmg \
     dist-artifacts/OfficeDex-v1.0.13-darwin-arm64.zip
   ```
4. Write the signed manifest into `officedex-dist` and push it:
   ```
   node scripts/publish-update-channel.mjs --channel stable \
     --darwin-arm64 dist-artifacts/OfficeDex-v1.0.13-darwin-arm64.zip \
     --notes "..." --dist ../officedex-dist --commit
   git -C ../officedex-dist push
   ```
   The manifest signing key comes from `~/.officedex-signing/manifest-signing-key.pem` (or `OFFICEDEX_MANIFEST_SIGNING_KEY`); never commit it. Same-version publishes merge assets, so an Intel zip can be added to the same manifest later. `--dry-run [--out-dir dir]` builds and signs without writing.
5. Check anonymously that `manifest.json` and `manifest.json.sig` are both served (`?cb=<random>` to skip caches) and that the release assets download.

Clients on 0.6.x poll the same root manifest and upgrade straight to the current version. Clients on 1.0.6–1.0.12 polled the legacy OBS channel; it was written one last time (`--channel 1.0`) with a stable-channel build and is frozen. `officedex-dist/channels/1.0/` is the even older bridge for 1.0.1–1.0.5 and stays untouched.

### App icon resources and macOS appearance

The icon master is `resources/dmg/app-icon.svg`. Run `bash scripts/generate-app-icons.sh`
on macOS with `rsvg-convert` installed to regenerate `build/appicon.png`,
`build/icon.png`, and `build/icon.icns`. Wails builds the bundled ICNS from
`build/appicon.png`.

The circular logo touches all four sides of a white rounded tile; the area outside
the tile stays transparent. This is intentional: macOS 26 adds a gray tile around
the old circle-only icon. Checking PNG transparency or decoding the ICNS does not
reveal that system treatment. Do not replace this with Finder custom-icon metadata,
which fails strict code-signature verification.

Before publishing an icon change, mount the final DMG and inspect the actual
system-resolved appearance (use the mounted app's real path):

```bash
swift scripts/preview-mac-app-icon.swift "/Volumes/OfficeDex/OfficeDex.app" /tmp/officedex-system-icon.png
```

Check the rendered PNG for a white tile and a logo filling its width. macOS may
apply its own lighting effects. Also inspect the mounted installer in Finder and
the app extracted from the update ZIP; source-image inspection alone is insufficient.

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
