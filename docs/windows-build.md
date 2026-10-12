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
| `mop-convert.exe` | `build/cache/mop-convert/win32-x64/` | cross-built from ppt2mop, see below; digest pinned in `PINNED_CONVERTER_BUILDS` (`scripts/dist-win.mjs`) |
| `convert.exe` (word2mow) | `build/cache/word2mow/win32-x64/` | cross-built from word2mow, see below; digest pinned under `win32-x64` in `KNOWN_CONVERT_BUILDS` (`scripts/prefetch-word2mow-convert.mjs`) |
| win32-x64 native npm packages | `build/cache/presentation-natives/win32-x64/` | `npm run fetch:presentation-natives -- --platform win32 --arch x64` (the flow runs it); goes away once the presentation checkout lists win32 under `supportedArchitectures.os` in its `pnpm-workspace.yaml` (see below) |
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
build. Native slice packages for any other OS or CPU that vite's pnpm sibling
set drags in, and fsevents on a non-macOS target, are pruned from the staged
presentation tree (`pruneForeignNatives`; what was removed is listed as
`prunedNatives` in its runtime.json). The workspace packages' own
`node_modules` are pruned too: the worker loads the self-contained `dist-ssr`
bundles, and the dereferenced copies (a second presentation-engine inside
presentation-office-js, its @learnof deps, katex) were ~70MB nothing read and a
197-character-deep path. Test trees, docs, source maps and type declarations
inside `node_modules` go as well (`pruneDevelopmentFiles`).

**Path budget.** Windows caps paths at 260 characters unless a machine opts in
to long paths, and the installer writes under `C:\Program Files\OfficeDex\OfficeDex\`
or `C:\Users\<name>\AppData\Local\Programs\OfficeDex\`. `verify-packaged-runtime`
therefore refuses any file deeper than 150 characters below the resource root
on every platform (`MAX_RELATIVE_PATH`), naming the deepest offenders. The CI
runner additionally assembles under `$RUNNER_TEMP` because the 32-bit makensis
is not long-path aware.

### Presentation natives through pnpm instead

The presentation checkout's `pnpm-workspace.yaml` is gaining
`supportedArchitectures: { cpu: [arm64, x64] }` for the Intel package. pnpm
(the checkout pins 11.x) takes an `os` list in the same block and installs the
optional dependencies for every `os × cpu` combination, so

```yaml
supportedArchitectures:
  os: [current, win32]     # "current" keeps the host's own platform
  cpu: [arm64, x64]
```

would put `@esbuild/win32-x64`, `@rolldown/binding-win32-x64-msvc`,
`lightningcss-win32-x64-msvc` (and their arm64 siblings) into the store after
`pnpm install`, where `findNativePackage` already looks; `fetch-presentation-
natives` would then be unnecessary. Costs: the four extra packages per slice
(~50MB), and `win32-arm64` natives that nothing uses yet. The lockfile does not
change (the optional dependencies are already in it), so this is an install-time
setting only. It is a change to the presentation repository and is not made
here.

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

# ppt2mop: the shipped "mop-convert" is the pptx2mop binary under the release-desktop profile.
# Build from a revision that includes fix/windows-replace-open-pptx (31de542): earlier builds
# fail every export on Windows ("replace generated PPTX ...: Access is denied"), because
# handles on the temporary PPTX were still open when the repaired copy was moved over it.
cargo zigbuild --profile release-desktop -p pptx2mop --bin pptx2mop --target x86_64-pc-windows-gnu
#   -> target/x86_64-pc-windows-gnu/release-desktop/pptx2mop.exe, copied as mop-convert.exe
```

Copy the results into `build/cache/<converter>/win32-x64/` and, when the
source revision changes, update the digests: word2mow's under `win32-x64` in
`KNOWN_CONVERT_BUILDS` (`scripts/prefetch-word2mow-convert.mjs`), mop-convert's
in `PINNED_CONVERTER_BUILDS` (`scripts/dist-win.mjs`).

## Proving it on Windows

Two facts shape this:

- **This repository is public.** Workflow logs and run artifacts of a public
  repository can be read by anyone signed in to GitHub, and the Windows package
  contains private components (presentation SSR runtime, mop-convert,
  office2modoc DLL, Writer payloads), unsigned. So no workflow in this
  repository builds or verifies the Windows package; the manual
  `windows-smoke.yml` that briefly existed here was removed for that reason.
- **`npm ci` needs the company's private npm registry** (the `@shimo` scope,
  `.npmrc.example`), which GitHub-hosted runners cannot reach.

Both are solved the same way as for the macOS test builds: the private
repository **officecli/officedex-private-builds** runs the Windows checks. It
vendors the three `@shimo/*` tarballs integrity-verified against this
repository's lockfile (`ci/stage-private-npm.mjs`), takes the parts only a Mac
can produce as a private release asset, and its artifacts are readable only by
people with access to that repository. The workflow there
(`private-windows-smoke.yml`) is a thin shell around the scripts in this
repository, which is why they stay here:

| Script | Role |
| --- | --- |
| `scripts/windows-inputs.mjs` | `pack` on the Mac: `dist/`, the staged win32-x64 `presentation/`, `writer-fonts/`, `mop-convert.exe`, `convert.exe` plus a per-file sha256 manifest; `unpack` on the runner |
| `scripts/dist-win.mjs --inputs <dir> --installer --zip` | assembles the package natively: the staged `node.exe` is executed from a relocated copy, every image is audited as PE32+ x86-64, makensis builds the installer |
| `scripts/windows-smoke.mjs` | `verify-runtime` (`officedex.exe --verify-runtime`), `launch` (the window process must stay up), `mop-smoke` (officecli's `TestPPTXMOPSkillEndToEndSmoke` against the packaged tree with the packaged `node.exe` and `mop-convert.exe` first on PATH), `report` (scrubbed JSON summaries) |

### On the Mac: produce the inputs

```bash
npm run dist:win                       # stages everything (needs the presentation/writer checkouts)
npm run windows:inputs:pack            # -> dist-artifacts/officedex-windows-inputs-<rev>.tar.gz, prints its sha256
```

The archive goes to the private builds repository as a pre-release asset
(`inputs-windows-amd64-<rev>`), together with a push of the source commit to a
`source/windows-amd64-<rev>` branch there when the commit is not on this
repository's `main`. The private repository's README has the exact commands and
the `gh workflow run` invocation.

### On a Windows machine instead

The same scripts run on a Windows 10/11 x64 machine on the company network
(Go from `go.mod`, Node 22, NSIS on PATH, `.npmrc` from `.npmrc.example`,
checkouts of this repository and of `officecli-internal`):

```powershell
npm ci
go install github.com/wailsapp/wails/v2/cmd/wails@v2.12.0
node scripts/windows-inputs.mjs unpack <archive.tar.gz> --sha256 <hex>
# node-v24.18.0-win-x64.zip + SHASUMS256.txt from nodejs.org/dist/v24.18.0/ into build\cache\pptxgenjs-runtime\
#   (save the checksums as node-v24.18.0-SHASUMS256.txt)
$env:OFFICE2MODOC_WINDOWS_DLL = "<officecli-internal>\third_party\office2modoc-ffi\0.1.34\x86_64-pc-windows-msvc\office2modoc_ffi.dll"
node scripts/dist-win.mjs --inputs build/windows-inputs --installer --zip
node scripts/windows-smoke.mjs verify-runtime
node scripts/windows-smoke.mjs launch --seconds 20
node scripts/windows-smoke.mjs mop-smoke --officecli-source <officecli-internal>
node scripts/windows-smoke.mjs report
```

`go test ./...` and `go vet ./...` on the Windows machine complete the set.
Keep the installer and zip off public storage until they are signed.

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
