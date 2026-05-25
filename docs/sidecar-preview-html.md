# Sidecar Preview HTML Contract

This document specifies the `*.preview.html` sidecar that `officecli` writes
next to every generated artifact and that `officedex` consumes through the
`RenderPreviewHtml` Wails binding (`app.go`). It is the single source of truth
for the contract between the two repositories.

## When officecli MUST emit a sidecar

`officedex` requests sidecars by passing `emit_preview: true` in the
`office.generate` args (see `internal/bridge/client.go`). When this flag is
set, officecli MUST write a sidecar for every produced artifact whose
extension is in the preview allowlist (`pptx`, `docx`, `xlsx`, currently).

Sidecars for other extensions are silently ignored by the renderer and SHOULD
NOT be written.

## File location

For an artifact at `<dir>/<basename><.ext>`, the sidecar MUST be written to
`<dir>/<basename>.preview.html` — the same directory, the same basename, with
`.ext` replaced by `.preview.html`.

Examples:

| Artifact                          | Sidecar                                  |
| --------------------------------- | ---------------------------------------- |
| `/Out/quarterly-review.pptx`      | `/Out/quarterly-review.preview.html`     |
| `/Out/2026-roadmap.docx`          | `/Out/2026-roadmap.preview.html`         |
| `/Out/financials Q1.xlsx`         | `/Out/financials Q1.preview.html`        |

The sidecar SHOULD be written atomically (write to a temp file in the same
directory then rename) so the renderer cannot observe a partial file.

## HTML structure

The sidecar is loaded into a sandboxed `<iframe srcdoc>` with
`sandbox="allow-same-origin allow-scripts"`. It MUST be a complete HTML
document.

Recommended minimum skeleton:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>quarterly-review.pptx</title>
    <style>
      /* preview-only CSS; inline for portability */
    </style>
  </head>
  <body>
    <!-- slides / pages / sheets rendered as plain HTML -->
  </body>
</html>
```

### Slide / page layout

For PPTX, render one container element per slide, in order:

```html
<section class="slide" data-slide-index="1">
  <h1 class="slide-title">…</h1>
  …
</section>
```

The renderer applies its own zoom (`body.style.zoom`) and fits content to the
viewport, so the sidecar SHOULD use a fixed slide width (e.g. `960px`) and
let the renderer handle scaling.

### Encoding

UTF-8 only. Always declare `<meta charset="utf-8" />` early in `<head>`.

## Resource references

The sidecar runs inside an iframe that has no filesystem access. To make
embedded images load, `officedex` post-processes the sidecar before handing
it to the renderer (see `inlineSidecarResources` in `app.go`). The rules:

1. **Relative `<img src="…">` and `<link href="…">` are inlined.** A relative
   URL is one that does not start with `http://`, `https://`, `data:`, `//`,
   `/`, or `#`. The referenced file is read from the sidecar's own directory
   (parent-directory traversal is refused) and replaced by a
   `data:<mime>;base64,…` URL.
2. **Allowed extensions:** `png`, `jpg`, `jpeg`, `gif`, `webp`, `bmp`, `svg`,
   `css`. Other extensions are left as-is and the iframe will surface a
   broken-resource error.
3. **Absolute URLs are preserved untouched.** Only use them for assets that
   the iframe can legitimately fetch (well-known CDNs); avoid them when the
   user might be offline.
4. **Missing files are tolerated.** If officedex cannot read a referenced
   file, the `src`/`href` is preserved, the iframe shows a broken image, and
   the preview still loads.

### Recommended layout for media

```
quarterly-review.pptx
quarterly-review.preview.html
quarterly-review.preview/             ← scoped sub-directory is fine
  ├── slide-1-chart.png
  ├── slide-2-logo.svg
  └── theme.css
```

References inside the HTML:

```html
<link rel="stylesheet" href="quarterly-review.preview/theme.css" />
<img src="quarterly-review.preview/slide-1-chart.png" alt="" />
```

Both will be inlined by `officedex` before reaching the iframe.

> Subdirectories under the sidecar's own directory are allowed; references
> that escape it (`../something`) are refused for safety.

### What about fonts?

The current allowlist intentionally excludes `woff`, `woff2`, `ttf`. The
iframe cannot load them from disk and the renderer does not yet inline them.
Use web-safe font stacks (e.g. `system-ui, sans-serif`) instead of embedded
fonts.

## Security

* The iframe is sandboxed; no top-level navigation, no popups, no plugins.
* `allow-scripts` is granted because some templates rely on small inline
  scripts for layout sizing. **Do not** embed third-party trackers or fetch
  remote scripts at preview time.
* Never include user-provided HTML without escaping. The sidecar runs in the
  same origin as the iframe document only, but any XSS inside it can still
  read its own DOM.

## Lifecycle

* officecli writes the sidecar **after** the primary artifact is fsync'd, so
  the artifact never appears in the renderer without a usable preview path.
* officecli SHOULD delete the sidecar when the corresponding artifact is
  deleted. officedex does not currently clean up orphan sidecars.
* If sidecar generation fails, officecli MUST still produce the primary
  artifact; the renderer falls back to "Preview not generated for this slide
  deck — open it with your system application instead."

## Renderer behaviour summary

| State                       | Renderer behaviour                                         |
| --------------------------- | ---------------------------------------------------------- |
| Sidecar present, parses     | Display in zoom-fitted iframe                              |
| Sidecar missing             | ErrorState with "open externally" CTA                      |
| Sidecar unreadable          | ErrorState surfaced from `RenderPreviewHtml`               |
| Sidecar has broken image    | Image shows as broken; rest of preview still renders       |

See `src/renderer/preview/viewers/PptxViewer.tsx` for the canonical consumer
path.
