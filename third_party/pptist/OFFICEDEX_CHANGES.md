# OfficeDex changes to PPTist

OfficeDex embeds a modified build of [PPTist](https://github.com/pipipi-pikachu/PPTist),
licensed under the GNU Affero General Public License v3.0. This directory is the
corresponding source used to build `public/pptist` for OfficeDex releases.

- Upstream base commit: `f1cfabe7f8b368ae22b996c951b9aa0b87de69e1`
- Vendored by OfficeDex for release `v0.6.0`
- Build entrypoint: `npm run build:pptist` from the OfficeDex repository root

The OfficeDex-specific changes include:

- a same-origin iframe protocol for loading PPTX bytes or cached slides, reading
  snapshots, selecting elements, applying edit operations, exporting PPTX data,
  and reporting dirty/edit/thumbnail/import state to the desktop host;
- immediate dirty notifications so manual and AI edits can use the host's
  serialized autosave coordinator;
- animated AI text edits, edit-run progress events, reduced-motion handling, and
  a lightweight slide preview surface;
- embedded locale control and OfficeDex-specific embed/edit/read-only layout
  behavior;
- large-PPTX import, canvas, image, and thumbnail performance modes;
- reliable thumbnail loading and viewport sizing for the embedded desktop layout;
- a curated set of redistributable fonts with committed upstream license texts;
- CJK faces (SourceHanSans, SourceHanSerif, ZhuQueFangSong, LXGWWenKai,
  LXGWNeoZhiSong, LXGWNeoXiHei) resolved through `local()` to host-installed
  fonts rather than shipped as webfonts, since the desktop app can rely on the
  operating system's font stack. The font picker still offers every family.

OfficeDex injects `scripts/assets/officedex-embed.css` after the PPTist build.
The generated `public/pptist` directory is retained in Git for release review,
but this vendored source and the root build script are the preferred form for
rebuilding it.
