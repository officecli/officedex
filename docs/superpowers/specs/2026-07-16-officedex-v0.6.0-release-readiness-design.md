# OfficeDex v0.6.0 Release Readiness Design

## Goal

Prepare and publish OfficeDex `v0.6.0` from the current `main` branch while preserving the new embedded PPTist editing experience, making the release reproducible, and closing the test, versioning, licensing, packaging, and release-verification gaps found in the pre-release audit.

## Release Scope

The release includes the current OfficeDex changes since `v0.5.43`, including PPTist-based PPTX preview/editing and autosave, plan recovery, invite-code support, the default Ant Design UI path, and launch/demo support.

The release does not claim that the WebOffice UI backend is production-ready. `UI_KIT=weboffice` remains an internal migration seam until business code actually imports the local UI facade.

## Source and License Model

The modified PPTist source currently exists only as uncommitted changes in the sibling `PPTist` checkout. OfficeDex `v0.6.0` will vendor the corresponding source under `third_party/pptist/` so the release tag contains the preferred form for modification and can reproduce the embedded bundle without relying on an unpublished local checkout.

Vendoring rules:

- Copy tracked and newly created PPTist source, configuration, tests, package manifests, and the upstream AGPL-3.0 license.
- Exclude `.git`, `node_modules`, `dist`, caches, local editor files, and other generated outputs.
- Preserve upstream copyright and license notices.
- Add a short `third_party/pptist/OFFICEDEX_CHANGES.md` describing the upstream base commit and the OfficeDex embed modifications.
- Build the embedded bundle from `third_party/pptist` and synchronize its `dist` into `public/pptist`.
- Keep `public/pptist` as the release-ready generated artifact because the GitHub release workflow packages OfficeDex directly from the tag.

OfficeDex licensing metadata will be made internally consistent:

- Keep OfficeDex's existing `GPL-3.0-only` declaration and treat PPTist as a separately identified AGPL-3.0 component. If the final packaging review cannot support that separation, the release is blocked pending an explicit project-level licensing decision; the implementation must not silently relicense OfficeDex.
- State clearly that the embedded PPTist component is AGPL-3.0 licensed and that its corresponding source is included in `third_party/pptist`.
- Replace the incorrect Apache statement in `NOTICE`.
- Add third-party notices for PPTist and bundled fonts, including the available upstream license/source references. Any font without a verifiable redistribution basis must be removed from the embedded build before release.
- Include license and notice files in the packaged desktop application.

## Test Isolation

Demo-only application tests will compile only with the `officedex_demo` build tag.

The existing mixed test file will be split so that:

- the normal event-recorder test remains in the ordinary test suite;
- demo generation and demo PPTist modification tests live in a `//go:build officedex_demo` test file;
- the normal suite cannot route demo test prompts into real OfficeCLI or hosted planner paths.

Both CI and release workflows will run:

1. `go test ./... -count=1`
2. `go test -tags officedex_demo ./... -count=1`

This makes missing build tags and demo-only regressions release-blocking.

## Versioning

All user-visible and package-level version carriers will be set to `0.6.0` before tagging:

- `package.json`
- `package-lock.json`
- `wails.json` product version
- build-time `main.appVersion` injected by the release workflow
- Git tag and release asset names

The built macOS application must report `0.6.0` in both `CFBundleShortVersionString` and `CFBundleVersion`. Windows metadata and the application runtime version must match the same value.

## Repository Cleanup

Remove files that are clearly local design or tool runtime output and are not required to build, test, document, or market the release:

- `.superpowers/brainstorm/**`
- root-level HTML design explorations

Keep intentional release materials under `marketing/ppt-launch-video/` and engineering specifications under `docs/superpowers/`.

Generated PPTist mocks will be retained only if the embedded runtime references them or tests require them. Otherwise they will be excluded from the release bundle to reduce size.

## Build and Packaging

The release build continues to default to Ant Design.

The packaging path must:

- install dependencies reproducibly with `npm ci`;
- build the renderer and embedded PPTist from committed source;
- build macOS universal and Windows amd64 applications;
- embed the correct OfficeCLI release binary;
- include license and notice files in the application bundle/archive;
- sign and notarize macOS artifacts through the existing GitHub Actions secrets;
- verify the bundled OfficeCLI architecture before publishing artifacts.

Local verification will use an ad-hoc signed macOS build. The GitHub release job remains responsible for Developer ID signing, notarization, DMG creation, and Windows artifact creation.

## Verification Gates

The `v0.6.0` tag will not be pushed until all locally available gates pass:

- clean OfficeDex worktree;
- `npm ci`;
- `npm run lint`;
- default AntD Vitest suite;
- `UI_KIT=weboffice` Vitest suite;
- default and WebOffice Vite production builds;
- normal and demo-tag Go test suites;
- `go vet ./...`;
- Windows amd64 and macOS Intel compilation checks;
- macOS application build, OfficeCLI bundling, executable verification, and deep codesign verification;
- package metadata reports `0.6.0`;
- embedded PPTist bundle is reproducible from `third_party/pptist`;
- no unexpected tracked or untracked release files;
- production dependency audit is recorded, with unresolved inherited findings explicitly documented.

One real hosted PPTX verification will run before tagging. It must cover:

1. creating a PPTX through the real OfficeCLI path;
2. opening the completed deck in the embedded PPTist editor;
3. applying an edit;
4. observing autosave completion;
5. reopening the artifact and confirming the saved edit persists.

If the hosted test fails because of an external service outage, the release remains blocked until the failure is classified with concrete logs and request identifiers.

## Release Execution

After all gates pass:

1. Commit the release-readiness changes on `main` in reviewable commits.
2. Push `main` to `origin`.
3. Create annotated tag `v0.6.0` at the verified commit.
4. Push the tag, triggering `.github/workflows/release.yml`.
5. Monitor the macOS and Windows build jobs to completion.
6. Verify the published GitHub Release contains the expected ZIP and DMG/Windows artifacts and that their version names are `v0.6.0`.

The release is complete only after the remote workflow succeeds and published artifacts are verified.

## Failure Handling

- Do not push the release tag if any local required gate fails.
- Do not bypass normal or demo Go failures.
- Do not publish a PPTist binary without its corresponding committed source and license notices.
- Do not reuse `v0.6.0` after a failed or incorrect published tag; delete an unpublished local tag if necessary, but request explicit confirmation before rewriting any tag already pushed to the remote.
- Preserve unrelated user work and existing local runtime data throughout the release process.
