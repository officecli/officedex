# docs/

This directory holds the documentation that is useful outside the core team:

| File | What it is |
|---|---|
| `DEVELOPER_ONBOARDING.md` | Architecture, repo layout, data flow and local workflow for a new contributor |
| `README.zh-CN.md` | Simplified-Chinese README |
| `not-implemented.md` | Ledger of UI controls that are wired to `notBuiltYet` (see `CLAUDE.md`) |
| `interaction-rules.md` | The implicit interaction decisions encoded in `App.tsx` / `Shell.tsx` |
| `uiport-scope.md` | Which desktop capabilities the `UiPort` contract covers, defers or drops |
| `aippt-*.md` | AI PPT design method, visual gap analysis, chart authoring plan and a worked example |
| `writer-js-api.md`, `pptx-stage-e2e.md`, `pptist-ai-typewriter-edit-verification.md`, `weboffice-design-component-gaps.md` | Component-level references and test notes |
| `security/` | Dependency risk reviews |
| `screenshots/`, `social-preview.png` | Images referenced by the README |

## Internal documents were moved out

Before the public release the internal planning, hand-over and audit material
that used to live here was moved to a private folder outside this repository
(`officedex-internal-docs/` next to the checkout on the maintainers' machines).
That covers the UI audit sessions (`ui-audit-2026-09-19/`), the `superpowers/`
plans, `audits/`, `handoff.md`, the e2e core-matrix reports, release/CI
runbooks, the acceptance test-case ledgers (`test-cases*.md`) and the HTML UI
prototypes.

Comments in `e2e/` and `src/` that still cite those paths refer to that private
folder. Nothing in the build, lint or test pipeline reads from it.
