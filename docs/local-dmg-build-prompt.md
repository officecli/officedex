# Prompt: 在本机打出可分发的 OfficeDex arm64 DMG

把下面这一段完整发给 AI 助手。它包含所有前置条件、已知陷阱和验收标准，不需要重新调研。

---

## 你的任务

在本机（Apple Silicon Mac）打出一个 **arm64 版本的 OfficeDex DMG**：

1. 用**生产 Developer ID 证书**签名（team `Z35T9799TW`）
2. 经过 **Apple 公证 + stapler 装订**
3. 装到**没有开发者证书的 arm64 Mac 上首次打开时 Gatekeeper 直接放行**
4. 安装后 **PPTX 生成功能可用**（不只是能打开）

**不要走 CI、不要发 tag**，只在本机完成。

## 工作区布局（假设已就位）

`/Users/<you>/Workspace/shimo/vibe-officing/` 下并列几个仓库：

- `officedex/` —— Wails (Go + React) 主体，当前分支 `develop/1.0`
- `officecli-internal/` —— `officecli` Go 源码（内嵌 MOP worker）
- `presentation/` —— fegit presentation 源码 checkout，worker 需要它做 Vite SSR

## 证书与凭据

**Developer ID Application** 证书（team `Z35T9799TW`，2026-05 到 2027-02 有效期）在 `~/.officedex-signing/Certificates.p12`。导入后 `security find-identity -v -p codesigning` 能列出 `Developer ID Application: ChuXin Tec Co., Ltd. (Z35T9799TW)`。

**App Store Connect API key** 三件套（公证用）：
- `.p8` 文件：`~/.officedex-signing/AuthKey_N8D4S9TPUH.p8`
- Key ID：`N8D4S9TPUH`
- Issuer UUID：`69a6de82-693c-47e3-e053-5b8c7c11a4d1`

用环境变量传给 `notarize.mjs`：
```
NOTARIZE_API_KEY_PATH=~/.officedex-signing/AuthKey_N8D4S9TPUH.p8
NOTARIZE_API_KEY_ID=N8D4S9TPUH
NOTARIZE_API_ISSUER=69a6de82-693c-47e3-e053-5b8c7c11a4d1
```

## 一条命令跑完

在 `officedex/` 目录下：

```bash
NOTARIZE_API_KEY_PATH="$HOME/.officedex-signing/AuthKey_N8D4S9TPUH.p8" \
NOTARIZE_API_KEY_ID=N8D4S9TPUH \
NOTARIZE_API_ISSUER=69a6de82-693c-47e3-e053-5b8c7c11a4d1 \
bash scripts/build-mac-dmg.sh
```

产物：`dist-artifacts/OfficeDex-<version>-darwin-arm64.dmg`。

脚本按架构参数化，`TARGET_ARCH` 不设时取本机架构。打 Intel 包在同一条命令前面加 `TARGET_ARCH=x64` 即可（前提见下方“跨架构”一节）。`scripts/build-arm64-dmg.sh` 仍在，是钉死 arm64 的兼容包装。

脚本自动完成：prefetch officecli → stage 官方 Node 24 → stage presentation runtime → 本地重编 officecli → wails build (darwin/arm64) → bundle → 内层 Mach-O 签名 → .app 公证 + staple → 打 DMG → DMG 公证 + staple → spctl 验证。

## 已知陷阱（**这些不要重踩**）

### 网络

1. **系统代理会掐断公证上传**。`xcrun notarytool` 用 macOS URLSession，**读系统代理设置，无视 shell env**。上传目标是 AWS S3 `notary-submissions-prod`（us-west-2），237 MB 分片走本地代理（Clash / Surge / V2Ray 之类）会 `abortedUpload`。
   - 解决：`networksetup -setwebproxystate <interface> off` + `-setsecurewebproxystate <interface> off`，跑完再 on。
   - 或代理规则加 `DOMAIN-SUFFIX,amazonaws.com,DIRECT`。
   - 脚本已有 retry 兜底（4 次，递增 30/60/90 s），但根治要关代理。

2. **shell 里 unset 代理无效**。`HTTP_PROXY=` 只影响 Node/curl 之类，管不了 notarytool。用 `lsof -nP -iTCP -p <notarytool pid>` 能看到它真实的 TCP 目的地。

### Bundle 结构

3. **`stage-mop-runtime.mjs` 的 `cp` 必须 `dereference: true`**。Homebrew 的 `/opt/homebrew/bin/node` 是符号链接到 Cellar，直接 cp 会把链接嵌进 bundle，`codesign` 报 `invalid destination for symbolic link` 直接拒。已修，但改动别回退。

4. **不能用 Homebrew 的 Node** 做 MOP runtime。它链 22 个外部 dylib（libnode, openssl, icu4c...），用户机上根本没有。用 `build/cache/pptxgenjs-runtime/node-v24.18.0-darwin-arm64.tar.gz` 里的**官方自包含 Node**（`otool -L` 应为零外部依赖）。`build-mac-dmg.sh` 已强制用这个，并且按 `TARGET_ARCH` 取对应架构的 tarball。

5. **`bundle:officecli:mac` npm script 不能用于正式包**。它硬编码 `local-entitlements.plist`（`disable-library-validation`），是给 ad-hoc 开发签名用的，正式包不能弱化库验证。脚本已绕开，直接 `codesign-bundled-officecli.mjs --identity "Developer ID..."` 不带 entitlements。

### Entitlements

6. **嵌入的 Node 必须带 JIT entitlements**。V8 要 `allow-jit` + `allow-unsigned-executable-memory`，`build/darwin/node-entitlements.plist` 已定义。`buildNotarizationSigningPlan` 按路径匹配 `Contents/Resources/mop-runtime/` 前缀分配这个 entitlement。别把它塞给非 Node 二进制（mop-convert / rollup addon / esbuild 都是 Rust/Go，不需要 JIT）。

7. **确认 staged presentation tree 里没有第二个 `node`**。任何 `node` 副本会拿到 hardened runtime + 无 entitlements，第一次 JIT trap。`stage-presentation-runtime.mjs` 有 `find -type f \( -name node -o -name node.exe \)` 断言，别删。

### 签名发现

8. **`notarize.mjs` 找 Mach-O 不能依赖执行位**。npm 分发的 `rollup.darwin-arm64.node` 曾是 0644（后续可能又变），`.bundle` 后缀原生插件也没执行位。已改为 `find -type f | file --` 全量识别，且忽略 fat binary 的 `(for architecture X)` per-arch 行。

9. **`find` 输出可能超 `execFileSync` 的 1MB `maxBuffer`**。staged presentation tree 有几万文件。`runCapture` 已设 `maxBuffer: 256 MiB`。

### Vite / SSR

10. **worker 必须传 `cacheDir` 到 bundle 外**。`Contents/Resources/presentation/` 是只读且签名封印过的，Vite 默认 `<root>/node_modules/.vite` 会 EACCES 或破坏签名。已修：worker 里 `fssync.mkdtempSync(path.join(os.tmpdir(), "officedex-vite-"))`，同时把 `TMPDIR` 也指到那里让 esbuild 也走可写路径。worker 是 `//go:embed` 在 officecli 里的 —— 改 worker 必须**从 officecli-internal 重编 officecli**（脚本已包含此步）。

### 并发

11. **两个 build 并跑会互删产物**。脚本有 `build/.build-mac-dmg.lock` 目录锁，别绕过。该锁**不按架构区分**：arm64 和 x64 两个 build 共用 `build/bin/OfficeDex.app`，并跑一样会互相覆盖。

## 分步跑（调试用）

出错想定位问题时按阶段拆开：

```bash
# 只 stage，不签名不打包
npm run prefetch:officecli
MOP_RUNTIME_SOURCE=<...path to node-v24.x.tar.gz 解压后目录...> npm run stage:mop-runtime
npm run stage:presentation
(cd ../officecli-internal && env -u GOROOT go build -trimpath -o ../officedex/build/officecli/officecli ./cmd/officecli)

# 只跑签名 + 公证，复用已有 build/bin/OfficeDex.app
bash scripts/build-mac-dmg.sh --skip-build

# 只跑签名，不公证
SKIP_NOTARIZE=1 bash scripts/build-mac-dmg.sh --skip-build
```

## 验证清单（**每一项都必须过**）

产物路径：`dist-artifacts/OfficeDex-<version>-darwin-arm64.dmg`

```bash
DMG=dist-artifacts/OfficeDex-1.0.0-darwin-arm64.dmg
APP=build/bin/OfficeDex.app

# 1. 签名深度校验
codesign --verify --deep --strict --verbose=2 "$APP"                # 期望 "satisfies its Designated Requirement"
# 2. Gatekeeper 会不会放行（模拟没证书的机器）
spctl --assess --type execute --verbose "$APP"                       # 期望 "accepted; source=Notarized Developer ID"
spctl --assess --type open --context context:primary-signature -v "$DMG"
# 3. 装订成功
xcrun stapler validate "$APP"                                        # 期望 "The validate action worked!"
xcrun stapler validate "$DMG"
# 4. JIT entitlements 落在了内嵌 Node 上
codesign -d --entitlements - --xml "$APP/Contents/Resources/mop-runtime/bin/node" | plutil -p -
                                                                     # 应含 allow-jit=true, allow-unsigned-executable-memory=true
# 5. 只读 bundle 冒烟：证明 worker cacheDir 修复到位
PROBE=/tmp/officedex-ro-probe.app
rm -rf "$PROBE" && cp -R "$APP" "$PROBE" && chmod -R a-w "$PROBE"
# 用 Resources/mop-runtime/bin/node 跑一个只 import vite + ssrLoadModule engine.ts 的小脚本，
# 校验它能在只读 bundle 下起 Vite SSR 且 codesign --verify 仍通过。
```

**装机测试**：把 dmg 拷到另一台 arm64 Mac（**没有你证书的**）—— 双击、拖到 Applications、首次打开不应弹 "无法验证" 对话框。触发一次 PPT 生成，观察不会报 `mop-convert was not found`。

## 常见错误 → 直接对应的解决

| 错 | 原因 | 修法 |
|---|---|---|
| `abortedUpload ... SotoS3` | 系统代理干扰 | 关代理或加 AWS bypass |
| `invalid destination for symbolic link` | node 符号链接嵌进 bundle | 确认用官方 tarball，`dereference: true` |
| `bad CPU type` | 打了架构不匹配的原生件 | 只做 arm64 就别嵌 x86 slice |
| `mop-convert was not found` | `pptx/tools/bin/mop-convert` 没了 | 从 git object 恢复 blob `b2e6571`；或走 pptx-dist artifact |
| Node 崩在 `mmap ... PROT_EXEC` | JIT entitlement 没进去 | 检查 `buildNotarizationSigningPlan` 是否对 Resources/mop-runtime/ 分配了 nodeEntitlements |
| 首次生成 PPT 后 `codesign --verify` 突然失败 | Vite 写进了 bundle | 检查 worker 的 `cacheDir` / `TMPDIR` 是否指向 bundle 外 |
| `ENOBUFS` from `spawnSync find` | staged tree 太大 | `runCapture` 的 `maxBuffer` 设够大（≥ 128 MB） |
| notarytool 一直 `In Progress` 很久 | 上传中断了但客户端不知道 | 参考 Submission ID 用 `notarytool info` 单独查；上传断的会永远卡 In Progress，直接重提交即可 |

## 时间预算

- 从零 build（clean + full）：约 15-25 分钟
- `--skip-build` 只签名+公证：约 8-15 分钟
- 网络卡顿会加时；有 retry 兜底

## 完成的样子

脚本最后一行输出：

```
[build-mac-dmg/arm64] done: /Users/.../dist-artifacts/OfficeDex-1.0.0-darwin-arm64.dmg
```

上面输出里应该看到：
- `spctl` 输出 `accepted`
- DMG 有 sha256（记录到发布记录）
- 磁盘上 dmg 约 200-250 MB

## 我需要你怎么做

按上面执行，出错时**先查"常见错误"表**再自行排查。任何偏离脚本默认路径的改动（换 identity、换代理策略、修改 worker、改 stage 内容）都要在报告里说明清楚。**任何时候都不要提交、上传、外传 `~/.officedex-signing/` 里的文件或环境变量值。**
