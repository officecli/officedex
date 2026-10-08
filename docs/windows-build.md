# Building OfficeDex for Windows (amd64)

Status: the package can be assembled end to end on a Mac and the parts only a
Windows host can prove run in the manual `Windows smoke` workflow. Nothing here
publishes a release; see `CONTRIBUTING.md`, Release flow, for how releases are
cut (from the release machine, by hand).

## What the package is

A loose tree beside `officedex.exe` — the layout the Go side already resolves
(`findBundledBinaryPath`, `writerResourceCandidates`, `runtimeenv`):

```
officedex.exe                     Wails app, WebView2 bootstrapper embedded (-webview2 embed)
officecli/officecli.exe           pinned officecli release, windows/amd64
mop-runtime/bin/node.exe          Node v24.18.0 win-x64, from node.org's zip
presentation/                     SSR tree staged for win32-x64, tools/bin/mop-convert.exe inside
word2mow/convert.exe              DOCX <-> MOW converter
office2modoc/office2modoc_ffi.dll office2modoc FFI, x86_64-pc-windows-msvc
writer-fonts/  skills/  licenses/
```

It ships two ways: `OfficeDex-v<x>-windows-amd64-installer.exe` (NSIS, what the
in-app updater installs) and `OfficeDex-v<x>-windows-amd64.zip` (portable).

## One command

```bash
npm run dist:win                      # stage, build, bundle, verify -> build/win32-x64/
npm run dist:win:installer            # the same, then the NSIS installer and the zip -> dist-artifacts/
```

`scripts/dist-win.mjs` is the whole flow; `--from <step>`, `--only a,b` and
`--dry-run` are there for iterating. Every step tells its tool it is building
for win32-x64, so the host's platform never leaks into the package
(`bundle-runtime.mjs --platform win32`, `PRESENTATION_TARGET_PLATFORM`,
`MOP_RUNTIME_PLATFORM`, …). On a Mac the frontend build needs the presentation
and writer checkouts beside the repository (as for macOS); `--skip-frontend`
reuses an existing `dist/`.

### Inputs the flow expects

| Input | Where | How it gets there |
| --- | --- | --- |
| Node win-x64 zip + checksums | `build/cache/pptxgenjs-runtime/node-v24.18.0-win-x64.zip`, `node-v24.18.0-SHASUMS256.txt` | download from nodejs.org/dist (the stage step verifies the zip against SHASUMS256) |
| `mop-convert.exe` | `build/cache/mop-convert/win32-x64/` | cross-built from ppt2mop, see below; digest pinned in `PROVISIONAL_CONVERTER_BUILDS` |
| `convert.exe` (word2mow) | `build/cache/word2mow/win32-x64/` | cross-built from word2mow, see below; digest pinned in `PROVISIONAL_CONVERTER_BUILDS` |
| win32-x64 native npm packages | `build/cache/presentation-natives/win32-x64/` | `npm run fetch:presentation-natives -- --platform win32 --arch x64` (the flow runs it); goes away once the presentation checkout lists win32 under `pnpm.supportedArchitectures` |
| `office2modoc_ffi.dll` | `build/cache/office2modoc/<version>/windows-amd64/` or the `officecli-internal` checkout's `third_party/office2modoc-ffi/<version>/x86_64-pc-windows-msvc/` | checked against the third_party manifest, or `OFFICE2MODOC_WINDOWS_SHA256` in `dist-win.mjs` |
| officecli | `build/officecli/officecli.exe` | fetched from the officecli-dist release pinned in `package.json` |

### What a Mac cannot do, and how the flow says so

- **Execute `node.exe`.** `stage-mop-runtime.mjs` normally copies the runtime to
  a scratch directory and runs `node --version` from there. For a win32 target
  on a Mac it checks the file instead (regular file, not a symlink, PE32+
  x86-64) and writes `relocationVerified: false` with
  `relocationUnverifiedReason` into `mop-runtime/runtime.json`.
  `verify-packaged-runtime.mjs` prints the runtime as `NOT EXECUTED on this
  host` rather than counting it present. Passing `probe: false` on a host that
  *could* run the runtime is refused, so this cannot green a native build.
- **Run `makensis`.** Homebrew's makensis (3.13) aborts with `std::bad_alloc` on
  current macOS before reading a line of script, bottle and source build alike.
  The Mac flow therefore runs Debian's NSIS in a container:
  `OFFICEDEX_MAKENSIS=scripts/nsis/makensis-docker.sh npm run dist:win:installer`
  (`scripts/nsis/Dockerfile`; the image is built on first use). On Windows,
  `makensis` from PATH is used as is.
- **Launch the app.** That is the smoke workflow's job.

Every `.exe`, `.dll` and `.node` in the finished tree is checked to be PE32+
x86-64 (`auditPortableExecutables`); a Mach-O or an arm64 image fails the
build. Natives for other platforms that vite's pnpm sibling set drags in are
pruned from the staged presentation tree (`pruneForeignPlatformNatives`).

## The two Rust converters

Both cross-compile from a Mac with `cargo-zigbuild` to
`x86_64-pc-windows-gnu`; no Windows machine and no MSVC are involved. The
toolchain, installed once:

```bash
brew install zig llvm            # zig 0.17.0; llvm for llvm-dlltool
rustup target add x86_64-pc-windows-gnu
rustup run stable cargo install cargo-zigbuild   # 0.23.4
```

Both repositories pull private crates from the company registry declared in
their `cargo.config`; cargo only reads it as `.cargo/config.toml`, so copy it
there first (ppt2mop already has it). `--offline` works when the registry is
unreachable and the crates are in the local cargo cache. The `RUSTFLAGS` below
remap the workspace, the cargo home and each registry source directory so
neither a developer's home directory nor a registry host name ends up in the
binary — the same policy as ppt2mop's own `scripts/build-macos.sh`.

```bash
export PATH="$HOME/.cargo/bin:/opt/homebrew/opt/llvm/bin:$PATH"
remaps="--remap-path-prefix=$PWD=/src --remap-path-prefix=$HOME/.cargo=/cargo"
i=0; for d in "$HOME"/.cargo/registry/src/*/; do i=$((i+1)); remaps="$remaps --remap-path-prefix=${d%/}=/cargo/registry/src/r$i"; done
export RUSTFLAGS="-Cdlltool=/opt/homebrew/opt/llvm/bin/llvm-dlltool $remaps"

# word2mow, in a clean worktree of the revision KNOWN_CONVERT_BUILDS names
cargo zigbuild -p word2mow --bin convert --release --target x86_64-pc-windows-gnu
#   -> target/x86_64-pc-windows-gnu/release/convert.exe

# ppt2mop: the shipped "mop-convert" is the pptx2mop binary under the release-desktop profile
cargo zigbuild --profile release-desktop -p pptx2mop --bin pptx2mop --target x86_64-pc-windows-gnu
#   -> target/x86_64-pc-windows-gnu/release-desktop/pptx2mop.exe, copied as mop-convert.exe
```

Copy the results into `build/cache/<converter>/win32-x64/` and update the
digests in `PROVISIONAL_CONVERTER_BUILDS` (`scripts/dist-win.mjs`) when the
source revision changes. The word2mow entry belongs in `KNOWN_CONVERT_BUILDS`
(`scripts/prefetch-word2mow-convert.mjs`) and is parked in `dist-win.mjs` only
while that table is being edited on the Intel branch.

## Proving it on Windows: the smoke workflow

`.github/workflows/windows-smoke.yml` is manual (`workflow_dispatch`) and
publishes nothing. GitHub-hosted runners reach neither the presentation
repository nor the Rust registry, so the Mac hands over an **inputs archive**:

```bash
npm run dist:win                       # stages everything (needs the sibling checkouts)
npm run windows:inputs:pack            # -> dist-artifacts/officedex-windows-inputs-<rev>.tar.gz + sha256
```

It contains `dist/`, the staged `presentation/` (win32-x64), `writer-fonts/`,
`mop-convert.exe`, `convert.exe` and a manifest with every file's sha256. Put
it somewhere the runner can fetch it — any HTTPS URL, or as an asset on a
**draft** GitHub release in this repository (drafts are not public and are not
a release) — and dispatch the workflow with `inputs_url` + `inputs_sha256`, or
`inputs_release_tag`.

The runner then: runs `go vet` and `go test ./...` on Windows; runs the
Windows-relevant `node:test` files; unpacks and verifies the archive; downloads
the Node zip; takes `office2modoc_ffi.dll` from `officecli-internal` (secrets
`OFFICECLI_INTERNAL_TOKEN` / `OFFICECLI_INTERNAL_REF`, both already used by
`release.yml`); runs `dist-win.mjs --inputs … --installer --zip` natively —
which executes the staged `node.exe` for real and builds the installer with
the runner's makensis; runs `officedex.exe --verify-runtime`; launches the app
and requires it to stay up; and runs officecli's
`TestPPTXMOPSkillEndToEndSmoke` against the packaged presentation tree with
the packaged `node.exe` and `mop-convert.exe` first on PATH. Artifacts are
uploaded to the run for inspection. **No new secret is needed.**

The same steps on a Windows PC:

```bash
node scripts/windows-inputs.mjs unpack <archive> --sha256 <hex>
node scripts/dist-win.mjs --inputs build/windows-inputs --installer --zip
node scripts/windows-smoke.mjs verify-runtime
node scripts/windows-smoke.mjs launch
node scripts/windows-smoke.mjs mop-smoke --officecli-source <officecli-internal checkout>
```

## Installer and updater

- `build/windows/installer/project.nsi` is Wails' template with one change: the
  Section installs the whole staged tree (`File /r`) instead of the single exe,
  and the output path and product version come from `dist-win.mjs`. Default
  scope is machine-wide (`Program Files`, UAC prompt); `--install-scope user`
  installs under `%LOCALAPPDATA%\Programs` without elevation — which one ships
  is an open decision (see below).
- The in-app updater (`app_update_windows.go`) accepts only an `.exe` asset,
  writes a batch trampoline that waits for the app's PID to exit, runs the
  installer silently (`/S /D=<the running copy's directory>`) and relaunches
  it. The manifest's `windows-amd64` asset must therefore be the installer, not
  the zip (`scripts/build-manifest.mjs --windows <installer.exe>`).
- Authenticode verification of the downloaded installer is a `TODO` in
  `app_update_windows.go`: there is no code-signing certificate yet, so a
  signature gate would refuse every update. The manifest signature plus the
  pinned sha256 are the integrity check until then.

## Open decisions (not made here)

1. **Authenticode certificate.** Unsigned exe and installer will be flagged by
   SmartScreen on Windows 10/11. EV certificates get reputation immediately;
   OV ones accrue it. Once a certificate exists: sign `officedex.exe`,
   `officecli.exe`, both converters, the DLL and the installer in `dist-win.mjs`
   (signtool runs on Windows; the smoke workflow is the natural place), and
   implement the updater's Authenticode check.
2. **Install scope**: machine (UAC prompt, shared install) or user (no prompt,
   per-user). The updater works with either, since it installs over the
   running copy's directory.
3. **Ship the portable zip as well as the installer**, or installer only. The
   updater only consumes the installer.
4. **WebView2 install mode.** The build embeds Microsoft's bootstrapper
   (`-webview2 embed`, reasoning in `main.go`). The alternative, `download`,
   fetches the bootstrapper at first start.
5. A Windows 10/11 x64 acceptance machine or VM. The smoke workflow proves the
   pipeline runs; it does not look at the window.
