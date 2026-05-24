# Changelog

All notable changes to OfficeDex will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-source preparation: MIT LICENSE, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates, Dependabot.

### Changed
- README badges now point to live GitHub Releases.

## [0.2.1] - 2026-05-23

### Fixed
- Settings: provider type choice is preserved when switching to a custom endpoint.

### Changed
- Settings: single-column layout, dropped the sidebar navigation.
- Bundled `officecli` bumped to `0.2.92`.

## [0.2.0] - 2026-05-23

First public release. Headline capabilities:

### Added
- Conversational document generation via bundled OfficeCLI (DOCX, PPTX, XLSX, IMG, Report).
- Inline preview for generated artifacts — no need to open Word / PowerPoint.
- Notion-styled desktop UI (Wails v2 + React 19), bottom-bar credit meter, dialogue-first task flow.
- Internationalization framework with `zh` / `en` locales and Ant Design integration (~290 keys).
- Diagnostics bundle export with PII scrubbing — opt-in `apiKey` / path / token redaction.
- One-click issue reporting (tiny `request_id` JSON pointer, no zip upload required).
- Per-task credit cost display and refresh after generation.
- Anonymous / logged-in / API-key login modes with hosted credit-balance snapshot.
- Auto-update path: ring-buffered checker, manifest validation, app-update prompt on schema rejection.
- macOS universal + Windows amd64 builds, tag-driven release pipeline syncing into `officecli/officedex-dist`.

### Tech notes
- SQLite `localstore` with `schemaV2` migration adding `request_id` to `task_events`.
- Bridge client with explicit `Close()`, bounded async logfile tee for diagnostics.
- Wails-generated typed bindings, `tsc --noEmit` strict mode.
- CI runs lint + vitest + `go test` on every PR.

[Unreleased]: https://github.com/officecli/officedex/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/officecli/officedex/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/officecli/officedex/releases/tag/v0.2.0
