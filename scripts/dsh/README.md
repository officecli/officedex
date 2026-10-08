# `scripts/dsh/` — the dev-real browser control plane

`scripts/dev-real.mjs` puts the renderer in an ordinary browser tab with a real
bridge (real officecli, real word2mow, real preview tokens). These two scripts
are the eyes and hands on top of it, so a UI round is "point, inspect, change,
re-shoot" instead of guesswork.

## Start

```bash
# 1. app + bridge (from the previous session's scratchpad invocation)
node scripts/dev-real.mjs <doc.docx> --port 3210

# 2. browser control plane, pointed at the URL dev-real printed
PLAY_URL="http://127.0.0.1:3210/?offlinePreview=1&previewToken=…&fileName=…&documentType=docx" \
  node scripts/dsh/play.mjs serve
```

`play.mjs serve` is a daemon on `127.0.0.1:3299`. It keeps the page alive
between commands, so scroll position, selection and console history survive.
`PLAY_HEADLESS=0` opens a real window.

## Commands

`node scripts/dsh/play.mjs <command> '<json>'`

| command | what it does |
|---|---|
| `state` | url, frames, viewport, recent console errors and failed requests |
| `shot {name, clip, fullPage, scale, pad, …selector}` | full page, a `{x,y,width,height}` region, or one element (with padding) |
| `styles {…selector, props?}` | rect, path, text, attributes and computed styles of one element |
| `dom {selector, depth}` | indented element tree with boxes and own text |
| `a11y {frame?}` | role / accessible name / rect for interactive and heading nodes |
| `eval {code, frame?}` | run `() => …` (async ok) in a frame |
| `hitTest {at:[x,y]}` | what the browser would actually hit at a point |
| `click` / `hover` / `drag` / `type` / `press` / `scroll` | real input, by element or coordinates |
| `viewport {width,height}` | resize the page |
| `reload {waitMs}` | reload; the preview URL reopens the document |
| `waitFor {…selector}` / `waitFor {code}` | poll until an element or expression is truthy |
| `console {types,since,limit}` / `network {since}` / `clear` | history inspection |

### Element descriptions

Every element command takes the same object, and lookups run main frame first,
then iframes — which matters because the document lives in
`/writer/index.html`:

```jsonc
{ "selector": ".wb-doc__name" }
{ "text": "rollout-memo.docx" }          // deepest element owning that text
{ "role": "button", "name": "保存" }
{ "frame": "/writer/index.html", "selector": "h1" }
```

Screenshots land in `build/dev-real/shots/` (2× DPI) and are reported by path.

## Hot updates

Editing `src/renderer/**` hot-updates the running page — CSS swaps in place and
JSX keeps component state, no reload. `play.mjs reload` is only the fallback for
a wedged page or after a change HMR cannot accept.

This used to be broken: `VITE_OFFICEDEX_REAL_E2E_ENDPOINT` (which `dev-real.mjs`
must set, it is what selects the real RPC transport and the
`/__officedex_bridge` proxy) also forced `server.hmr = false` in
`vite.config.ts`. The two are now separate: the official suite opts out with
`OFFICEDEX_E2E_NO_HMR=1` in `scripts/run-real-e2e.mjs`, and interactive sessions
get hot updates.

## Known limits

- **Bundled Writer changes still need a Writer rebuild.** The document surface
  loads `/writer/index.html` as a prebuilt bundle; HMR does not reach inside it.
- **Viewport emulation does not change `innerWidth` for the embed.** Media-query
  behaviour still has to be checked in a real window (`npm run dev`).
- Native-window behaviour (traffic-light reserve, drag regions, real zoom) is
  not visible here at all — `npm run dev` only.
