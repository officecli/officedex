# Changelog

All notable changes to OfficeDex will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.9] - 2026-08-19

### Fixed
- Generating several documents in a row no longer leaves the earlier ones stuck on a spinner. Starting a new generation, opening the image template panel, or switching projects used to stop the OfficeCLI process that was still working on them.
- Tasks interrupted by a quit, a settings change, or a crashed OfficeCLI process are now reported as failed instead of staying "in progress" forever, including tasks left over from a previous session.

## [0.5.37] - 2026-06-12

### Changed
- Smart generation now shows multi-step follow-up questions with richer answer choices and keeps reviewed plans available after a run finishes.
- Bundled the latest OfficeCLI runtime.

## [0.5.36] - 2026-06-12

### Fixed
- Smart generation now keeps reviewed plans available while handling richer follow-up questions from the bundled OfficeCLI runtime.

## [0.5.35] - 2026-06-12

### Changed
- Image template generation now keeps the template gallery and creation controls in separate panes, making longer template catalogs easier to browse while preparing a prompt.
- Bundled the latest OfficeCLI runtime.

## [0.5.34] - 2026-06-12

### Fixed
- OfficeDex now uses the new rounded document-and-terminal icon inside the app chrome, favicon, and README surfaces, matching the desktop app icon.

## [0.5.33] - 2026-06-12

### Changed
- OfficeDex now uses the new rounded document-and-terminal app icon for desktop builds.
- The main workspace has a tighter visual rhythm across navigation, settings, onboarding, and dialogue surfaces.

### Fixed
- Starting a new chat from an already empty chat now feels responsive instead of appearing to do nothing.
- Local macOS app builds now include the bundled OfficeCLI runtime, so the app is ready to generate immediately after launch.

## [0.5.32] - 2026-06-11

### Added
- Project and chat conversations can now be deleted from the sidebar.
- Image generation now includes a Start from scratch option alongside image templates.

### Changed
- Image templates now open in a split workspace with a photo-wall picker and a dedicated form area.
- Smart generation is now the default starting point, with a cleaner prompt flow for reviewed generation.
- Image template editing now keeps the preview available without leaving the editing flow.

### Fixed
- Questions from a running task now appear as a clear answer composer below progress.
- Historical project artifacts can be previewed after returning to a stored workspace.
- The first running conversation no longer duplicates when project history refreshes after an early start event.

## [0.5.30] - 2026-06-10

### Changed
- Settings sections now show focused content for the selected menu item instead of mixing every setting in one long panel.
- Settings navigation now keeps the selected section highlighted while leaving unrelated controls out of view.

## [0.5.29] - 2026-06-10

### Changed
- Bundled the latest OfficeCLI runtime.

## [0.5.28] - 2026-06-10

### Changed
- Bundled the latest OfficeCLI runtime.

## [0.5.27] - 2026-06-10

### Changed
- Sidebar history and footer controls now stay visually stable while moving the pointer across rows and actions.
- Image template cards are easier to scan, with cleaner thumbnails and lighter picker controls.
- Update banner actions now stay aligned when progress or error details wrap onto multiple lines.
- Settings now has a compact left-side section menu for faster navigation.
- Settings content now uses the available workspace width with less empty space.

## [0.5.26] - 2026-06-09

### Added
- Local image templates can now be deleted directly from the image template picker.

### Changed
- OfficeDex now uses the new app logo across the desktop app, app icon, favicon, and README surfaces.
- Image template slot fields now pre-fill each field with the template default value, so users can generate from defaults immediately and edit only the fields they want to customize.
- Image template fallback thumbnails now use the abstract card artwork without the center circle or file icon.

## [0.5.24] - 2026-06-09

### Changed
- Image template slot fields now show their default values as placeholders instead of pre-filled text, making templates easier to customize before generating.

### Fixed
- Image template cards now show a polished placeholder when a local template has no thumbnail or a thumbnail fails to load.

## [0.5.23] - 2026-06-09

### Changed
- Updated the generated-image footer watermark wording.
- Bundled the latest OfficeCLI runtime.

### Fixed
- Stabilized the release test suite on GitHub macOS runners.

## [0.5.22] - 2026-06-09

### Changed
- Updated the generated-image footer watermark wording.
- Bundled the latest OfficeCLI runtime.

## [0.5.21] - 2026-06-09

### Changed
- Temporarily hid GIF generation from the new-generation format picker.

## [0.5.20] - 2026-06-08

### Added
- Paid users can now manage image watermark controls from Settings.

### Changed
- Free image generations now include clearer OfficeDex watermarks.
- Bundled the latest OfficeCLI runtime.
- Removed the custom watermark text setting to keep watermark behavior predictable.

### Fixed
- Watermark opt-out now follows explicit paid-user status consistently.

## [0.5.19] - 2026-06-05

### Fixed
- Failed generations now show a Retry button that resubmits the original request, including saved attachments and image options.

## [0.5.18] - 2026-06-05

### Fixed
- Completed image cards now keep the more actions button directly beside Show in folder without wrapping it onto a separate line.

## [0.5.17] - 2026-06-05

### Fixed
- Completed image cards now keep the template review action inside the more actions menu, so long labels no longer spill outside the result card.

## [0.5.16] - 2026-06-05

### Added
- Image template results can now be saved and submitted from the desktop client.

### Changed
- Bundled the latest OfficeCLI runtime.

## [0.5.15] - 2026-06-03

### Fixed
- Historical conversation switches now force the actual workspace scroll container to the true bottom.

## [0.5.14] - 2026-06-03

### Fixed
- Historical conversations keep scrolling to the bottom while restored preview content finishes loading.

## [0.5.13] - 2026-06-03

### Fixed
- Switching to a historical conversation now scrolls the workspace to the true bottom, including the continuation composer.
- Conversation and generated-image copy actions now show top-level success or failure feedback.

## [0.5.8] - 2026-05-29

### Added
- Language switcher in Settings with full English/Simplified Chinese localization across the UI.
- Desktop notifications for long-running generation and rendering tasks.
- Image generation template picker now shows a loading spinner, a refresh button, and localized template labels.

### Changed
- Reworked the sidebar and follow-up replies to be conversation-centric so multi-turn threads stay grouped.
- Refresh the runtime bridge after authentication state changes so newly logged-in sessions pick up bindings without a restart.

### Fixed
- Bundle a universal2 (Intel + Apple Silicon) officecli binary so the generation CLI no longer crashes with "bad CPU type in executable" on Intel Macs.
- Bundle a universal2 extrender binary so rich document previews (e.g. PPTX) render as slides instead of falling back to plain text on Intel Macs. Release builds now fail if either bundled binary is missing an architecture slice.

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

[Unreleased]: https://github.com/officecli/officedex/compare/v0.5.27...HEAD
[0.5.27]: https://github.com/officecli/officedex/compare/v0.5.26...v0.5.27
[0.5.26]: https://github.com/officecli/officedex/compare/v0.5.25...v0.5.26
[0.5.17]: https://github.com/officecli/officedex/compare/v0.5.16...v0.5.17
[0.5.16]: https://github.com/officecli/officedex/compare/v0.5.15...v0.5.16
[0.5.15]: https://github.com/officecli/officedex/compare/v0.5.14...v0.5.15
[0.5.14]: https://github.com/officecli/officedex/compare/v0.5.13...v0.5.14
[0.5.13]: https://github.com/officecli/officedex/compare/v0.5.12...v0.5.13
[0.5.5]: https://github.com/officecli/officedex/compare/v0.5.4...v0.5.5
[0.5.3]: https://github.com/officecli/officedex/compare/v0.5.2...v0.5.3
[0.5.1]: https://github.com/officecli/officedex/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/officecli/officedex/compare/v0.4.1...v0.5.0
