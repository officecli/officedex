# Changelog

All notable changes to OfficeDex will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

_No unreleased changes._

## [0.5.7] - 2026-05-29

### Added
- Guided slot fill for image generation templates. When a template defines structured slots, the composer now renders a per-field form with a live preview instead of dropping a several-hundred-word prompt into the textarea. Unfilled slots show their default value or a `[label]` placeholder (never the raw `{{key}}`), required slots block submission, and values containing `{{` are rejected. The raw prompt stays available as an editable escape hatch, and "reset to template" re-applies the slot form. Templates without slots keep the existing raw-textarea behavior.

## [0.5.5] - 2026-05-28

### Changed
- Move the sidebar credit meter above Profile so account actions stay beneath current usage.
- Move Settings → About to the bottom of Settings, after diagnostics and reset controls.

## [0.5.3] - 2026-05-27

### Added
- Onboarding now tests the official provider before completion and guides users into proxy setup when the Settings-equivalent provider test does not pass.
- Added a draft-settings provider test path so onboarding can test the selected provider/proxy values before they are saved.

### Changed
- Proxy settings now default to `http://127.0.0.1:7890` when users enable proxy configuration, matching the startup guidance flow.

## [0.5.1] - 2026-05-26

### Fixed
- **macOS "is damaged" Gatekeeper error on download** — the CI release pipeline now signs the bundled `officecli` / `extrender` binaries and the outer `.app` with the Developer ID identity (hardened runtime + timestamp), submits both the `.app` and the `.dmg` to Apple's notary service via an App Store Connect API key, and staples the resulting tickets. Prior releases shipped ad-hoc-signed artifacts that Gatekeeper rejected as "damaged" after Chrome (or any browser) attached `com.apple.quarantine`.

### Changed
- `scripts/notarize.mjs` accepts App Store Connect API key credentials (`NOTARIZE_API_KEY_PATH` / `NOTARIZE_API_KEY_ID` / `NOTARIZE_API_ISSUER`) for CI use, in addition to the existing `OfficeDex-Notarize` keychain profile for local builds. It also handles `.dmg` targets directly.

## [0.5.0] - 2026-05-26

### Added
- **Continue editing on completed image** — completing an image generation now shows an inline composer at the bottom of the dialogue. Submitting a follow-up prompt auto-attaches the prior image as a reference, so the conversation itself becomes the iterate-on-this-image flow. Open a new conversation to start fresh.
- **Per-task time-stamped output directories** — each generation now resolves to `<output-dir>/<yyyymmdd-HHMMSS>-<slug>-<shortid>/`. Follow-up edits land alongside the original artifact and directories sort chronologically.
- **Automated macOS code signing + notarization** in the `dist:mac` build script (`scripts/notarize.mjs`), so local mac builds match the signed CI output.

### Fixed
- Workspace Output Directory picker now opens a directory dialog (was inadvertently opening a file picker).

### Changed
- Drop `gif` from the img reference-image accepted extensions (officecli pipeline does not support animated input).
- Preview pane left-column min-width widened from 320px to 480px for readable dialogue when the preview is open.
- README: tighten VibeOfficing tagline to "The First AI-Native …".

## Project Foundation (v0.1.0 – v0.4.1)

Initial open-source release of OfficeDex — the desktop client for OfficeCLI.

### Added
- Conversational document generation via bundled OfficeCLI (DOCX, PPTX, XLSX, IMG, Report).
- Inline preview for generated artifacts — no need to open Word / PowerPoint / Excel.
- Notion-styled desktop UI (Wails v2 + React 19), bottom-bar credit meter, dialogue-first task flow.
- Three login modes — anonymous trial, signed-in hosted credits, or bring-your-own API key.
- Per-task credit cost display and balance meter with hide/show privacy toggle.
- Internationalization framework with `zh` / `en` locales and Ant Design integration.
- Diagnostics bundle export with PII scrubbing — opt-in `apiKey` / path / token redaction.
- One-click issue reporting (tiny `request_id` JSON pointer, no zip upload required).
- Auto-update path: ring-buffered checker, manifest validation, schema-rejection prompt.
- macOS universal + Windows amd64 builds, tag-driven release pipeline.

### Project scaffolding
- GNU General Public License v3.0 LICENSE + NOTICE.
- CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates, Dependabot.

[Unreleased]: https://github.com/officecli/officedex/compare/v0.5.5...HEAD
[0.5.5]: https://github.com/officecli/officedex/compare/v0.5.4...v0.5.5
[0.5.3]: https://github.com/officecli/officedex/compare/v0.5.2...v0.5.3
[0.5.1]: https://github.com/officecli/officedex/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/officecli/officedex/compare/v0.4.1...v0.5.0
