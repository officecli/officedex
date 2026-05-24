# Changelog

All notable changes to OfficeDex will be documented in this file.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- Apache 2.0 LICENSE + NOTICE.
- CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue/PR templates, Dependabot.

[Unreleased]: https://github.com/officecli/officedex/commits/main
