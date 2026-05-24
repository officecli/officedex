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
- All UI changes must follow [`DESIGN.md`](./DESIGN.md) — Notion-style tokens (purple `#5645d4`, DM Serif Display headings, 8 px rectangular buttons, 12 px card radii, warm neutrals).

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
- [ ] If you touched UI, the change still matches `DESIGN.md` tokens
- [ ] The PR description explains the user-facing impact, not just the diff
- [ ] Linked issue (or `Fixes #NNN`) when applicable

CI must be green before review. Maintainers will squash-merge once approved.

## Release flow

Releases are tag-driven. See [`.github/workflows/release.yml`](./.github/workflows/release.yml).

1. Bump `version` in `package.json`
2. Commit: `chore(release): vX.Y.Z`
3. Tag: `git tag vX.Y.Z && git push origin vX.Y.Z`
4. GitHub Actions builds macOS-universal + Windows-amd64, publishes a GitHub Release, and syncs the manifest into the `officedex-dist` repo for in-app updates.

## Reporting bugs / security issues

- Functional bugs and feature requests → [GitHub Issues](https://github.com/officecli/officedex/issues) using the templates.
- Security vulnerabilities → please **do not** open a public issue. See [SECURITY.md](./SECURITY.md).

Thanks again for contributing. 🎉
