# Unified OfficeCLI and OfficeDex Icon Design

**Date:** 2026-07-31

**Status:** Approved design, pending written-spec review

## Goal

Use the current OfficeDex icon everywhere OfficeCLI or OfficeDex already shows a first-party product icon, including desktop packaging, web surfaces, social previews, and static promotional images.

The canonical source is:

`officedex/build/appicon.png`

OfficeCLI and OfficeDex keep their existing product names, copy, layouts, domains, and product positioning. This project unifies the graphical icon mark only.

## Scope

### Included

- OfficeDex desktop packaging PNG and ICNS assets.
- OfficeDex favicon, in-app brand image, README logo, and static social preview.
- OfficeCLI website, application, and admin favicon assets.
- OfficeCLI website logo, OG cover, and social preview.
- Current static OfficeCLI and OfficeDex promotional PNG/JPG/SVG assets that visibly contain the legacy blue-green OfficeCLI icon.
- First-party static screenshots that contain a baked-in legacy icon, with icon-only replacement.
- Residual scans in the related OfficeCLI distribution and public repositories.

### Excluded

- GIF files.
- Video files and video source frames.
- `raw`, test-output, generated-output, cache, build-output, and historical-archive directories.
- Third-party PPTist logos and favicons.
- Office document demo content and generated document previews unless they are explicitly first-party brand promotional images.
- External badge-provider icons such as shields.io, GitHub, Discord, and X icons.
- Adding an icon to a surface that currently has no first-party product icon.
- Production deployment, release publication, or package release.

## Canonical Asset and Ownership

`officedex/build/appicon.png` is the only brand master. Its original 1254 by 1254 pixels are preserved without visual redesign.

OfficeDex owns the master and its desktop/application derivatives. OfficeCLI platform code stores a controlled vendored copy because its web builds must remain standalone and cannot depend on a sibling repository at build or runtime.

The vendored OfficeCLI copy records the expected SHA-256 of the OfficeDex master. Synchronization fails if the input does not match the approved dimensions or if the generated copy has a different hash.

## Architecture

### OfficeDex asset generator

Add a deterministic brand-asset generator under `officedex/scripts/`. It reads `build/appicon.png` and generates the OfficeDex-owned derivatives in place.

Expected responsibilities:

- Generate the desktop packaging PNG derivative.
- Generate the macOS ICNS derivative on macOS.
- Synchronize `public/officedex-logo.png`.
- Synchronize `docs/screenshots/officedex-logo.png`.
- Generate the favicon-compatible derivative used by `index.html`.
- Expose a verification mode that checks outputs without changing files.

### OfficeCLI platform asset generator

Add a deterministic brand-asset generator to `officecli-internal/platform/web/site/scripts/`. It reads the controlled vendored master and generates the OfficeCLI platform derivatives.

Expected responsibilities:

- Generate or wrap the three existing favicon assets for site, app, and admin while preserving their public URLs.
- Replace `platform/web/site/public/officecli-logo.png` with the unified icon.
- Regenerate `platform/web/site/public/og-cover.svg` with the OfficeDex icon and existing OfficeCLI text/layout.
- Regenerate `platform/web/site/public/social-preview-officecli.png` with the OfficeDex icon and existing OfficeCLI text/layout.
- Expose a verification mode that checks outputs without changing files.

Keeping existing public filenames avoids unnecessary changes to HTML, SEO configuration, static routing, and release infrastructure.

### Cross-repository synchronization

The OfficeDex generator provides an explicit synchronization command that copies the approved master into the OfficeCLI platform worktree and then invokes the OfficeCLI platform generator.

The OfficeCLI platform generator also works independently from its vendored copy so CI and repository-local builds do not require the multi-repository workspace layout.

## Static Promotional Image Handling

Create a manifest of current static first-party promotional images. Each entry records:

- file path;
- whether the image contains the legacy icon;
- editable source path when available;
- output dimensions and format;
- replacement region or render command;
- expected output hash after regeneration.

Processing rules:

1. If an editable SVG or existing generator is available, update the source and re-render the output.
2. If only a PNG or JPG exists, replace only the legacy icon region using deterministic image composition.
3. If a screenshot contains the legacy icon, replace only the icon pixels. Do not update unrelated interface content.
4. If an image contains product text but no graphical icon, leave it unchanged.
5. GIF, video, raw, test, historical, and generated-output paths never enter the manifest.

AI image generation is not used to redraw the logo. The exact canonical icon is composited so its geometry remains unchanged.

## Safety and Existing Workspace State

The main `officecli-internal` checkout contains substantial unrelated uncommitted work. Implementation therefore uses separate Git worktrees for OfficeDex and OfficeCLI platform changes.

Implementation must not clean, stash, reset, overwrite, or absorb unrelated changes from the main checkouts. Each repository receives focused commits that can be reviewed and integrated independently.

Generated files are written to a temporary directory first. The generator validates the complete output set before replacing repository files, preventing partially updated assets.

## Validation

### Automated asset checks

- Canonical dimensions are exactly 1254 by 1254.
- The OfficeCLI vendored master matches the canonical SHA-256.
- Every declared derivative exists, has the expected format, and has the expected dimensions.
- Re-running generation produces no Git diff.
- Existing favicon URLs remain loadable.
- OG and social preview dimensions remain unchanged.
- The legacy blue-green icon SVG definitions, filenames, and controlled raster assets no longer remain in included paths.
- Excluded GIF, video, raw, test-output, and historical paths remain byte-for-byte unchanged.

### Repository verification

- Run focused generator tests before implementation and observe the expected failure.
- Run OfficeDex unit tests, script tests, lint, and Vite build.
- Run OfficeCLI site, app, and admin focused tests and production builds.
- Run `git diff --check` in every changed repository.

### Visual verification

Open and inspect:

- OfficeDex desktop/app icon at large and small sizes.
- OfficeDex web favicon and in-app logo.
- OfficeCLI site, app, and admin favicons.
- OfficeCLI OG cover and social preview.
- Every promotional image marked as changed in the manifest.

For each browser-loaded image, verify that it completes with non-zero natural dimensions. Inspect favicon-scale rendering separately because details that work at 1024 pixels can become unclear at 16 or 32 pixels.

## Acceptance Criteria

- Every included first-party OfficeCLI and OfficeDex icon uses the graphical mark from `officedex/build/appicon.png`.
- OfficeCLI and OfficeDex names, wording, layouts, domains, and behavior are unchanged.
- No included web or static promotional asset displays the legacy blue-green OfficeCLI icon.
- Static assets without an icon are unchanged.
- GIF and video files are unchanged.
- Generators are deterministic and verification passes in both changed repositories.
- Existing unrelated working-tree changes are preserved.
- No release or production deployment occurs as part of this task.
