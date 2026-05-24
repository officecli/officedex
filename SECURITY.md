# Security Policy

## Supported versions

OfficeDex is on a rolling release cadence. Only the most recent `0.x` release receives security fixes.

| Version | Supported |
|---|---|
| Latest `0.x` | ✅ |
| Older `0.x` | ❌ |

We will move to a wider support window once OfficeDex reaches `1.0`.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Instead, use one of the following private channels:

- **GitHub Security Advisories** — preferred: <https://github.com/officecli/officedex/security/advisories/new>
- Email: `security@officedex.app`

Please include:

- A description of the issue and the impact
- Steps to reproduce (or a proof-of-concept)
- Your platform (macOS / Windows version, OfficeDex version from **Settings → About**)
- Whether you'd like to be credited in the fix advisory

## Response expectations

- We will acknowledge receipt within **3 business days**.
- We will share a triage assessment (confirmed / not-applicable / need-more-info) within **7 business days**.
- For confirmed issues, we aim to release a fix within **30 days** for high-severity bugs and **90 days** otherwise.

## Scope

In scope:

- The OfficeDex desktop app (this repository)
- The bundled `officecli` invocation surface (argv handling, stdout parsing, embedded-binary integrity)
- Local persistence (`localstore` SQLite database, settings files)
- Auto-update path (`internal/appupdate`, manifest validation)
- Diagnostics bundle / issue-report submission

Out of scope (report to the respective project instead):

- Bugs in `officecli` itself → <https://github.com/officecli/officecli>
- Vulnerabilities in upstream dependencies (we will pick them up via Dependabot once disclosed upstream)

Thank you for helping keep OfficeDex users safe.
