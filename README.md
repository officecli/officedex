# OfficeDex

OfficeDex is the desktop GUI for OfficeCLI. It is an Electron + React client that talks to the local `officecli agent-bridge` JSON-RPC process and keeps document generation, hosted runtime access, publishing, and review logic in the OfficeCLI binary.

## Development

```bash
npm install
npm run dev
```

During development OfficeDex resolves the CLI from `OFFICECLI_DESKTOP_BINARY` first, then `officecli` on `PATH`.

## Packaging

OfficeCLI is downloaded at runtime; nothing extra needs to ship with the app bundle.

```bash
npm run dist:mac
```

Windows builds use `npm run dist:win`.

Generated documents are written to the app data workspace by default, for example `~/Library/Application Support/OfficeDex/workspace` on macOS.

## OfficeCLI runtime

OfficeDex resolves the `officecli` binary automatically the first time it launches:

- The matching release for the current platform is downloaded from GitHub Releases. The default source repository is `officecli/officecli`.
- Downloads are stored under `app.getPath('userData')/runtime/` (for example `~/Library/Application Support/OfficeDex/runtime/` on macOS).
- The Settings page surfaces the current runtime version, last check timestamp, resolved binary path, and offers buttons to check for updates, install a newer release, choose a local binary, or revert to the auto-downloaded copy.

### Environment overrides

- `OFFICECLI_RELEASE_REPO` — change the GitHub source repo (format `owner/repo`). Useful for staging or fork releases.
- `OFFICECLI_DESKTOP_BINARY` — point directly at a local development binary. When set, OfficeDex skips the download flow and uses the binary at the given path.

Users can also pin a custom binary by setting **Custom binary path** in Settings → OfficeCLI Runtime; this overrides both the environment variable and the auto-downloaded copy.

### Asset naming convention

Releases must publish raw binaries (no archives) named with the pattern `officecli-{darwin|win32|linux}-{arm64|x64}{.exe}`, for example:

- `officecli-darwin-arm64`
- `officecli-darwin-x64`
- `officecli-linux-x64`
- `officecli-win32-x64.exe`

## Releasing

GitHub Actions builds release artifacts for macOS and Windows via `.github/workflows/release.yml`.

- 推送 `v*` tag（例如 `git tag v0.1.1 && git push origin v0.1.1`）会触发完整发布流程：构建 → 打包 → 上传 artifact → 自动创建 GitHub Release 并附带 `.dmg`、`.zip`、`.exe` 等产物。
- 在 GitHub 网页 Actions 页通过 `workflow_dispatch` 手动触发时，会跑完整个矩阵但不创建 Release，仅保留 workflow artifact，便于测试。
- OfficeCLI 二进制不再随 OfficeDex 一起分发，应用首次启动时按上面的方式从 `officecli/officecli` Releases 自动下载。

