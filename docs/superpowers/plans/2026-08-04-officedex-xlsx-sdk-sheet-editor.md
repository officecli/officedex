# OfficeDex XLSX 石墨表格编辑器 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 OfficeDex 的 XLSX 只读 HTML 预览替换为 `@shimo/sdk-sheet` 编辑器，并通过本地 `office2modoc-ffi` 二进制安全覆盖保存原 XLSX。

**Architecture:** Renderer 只持有 opaque preview token、编辑会话 ID 和 MODoc 字符串；Go 后端通过现有 `preview.Registry` 解析受信任路径。`internal/office2modoc` 在 Apple Silicon macOS 上延迟 `dlopen` dylib，`internal/xlsxeditor` 负责会话、并发修改检测、XLSX 校验和同目录原子替换。

**Tech Stack:** Go 1.25、cgo/dlopen、Wails v2、React 19、TypeScript、Vitest、`@shimo/sdk-sheet@5.0.14-jsapi.4`、`@shimo/editor-sdk-core@0.0.1-124-jsapi.51`、`@shimo/simple-i18n@4.0.27`、`office2modoc-ffi version-0.1.34-260702-1130`

---

## 文件结构

- `.npmrc`：仅为 `@shimo` scope 指定石墨 npm registry。
- `package.json`、`package-lock.json`：锁定 Sheet SDK 与 core SDK 版本。
- `vite.config.ts`：仅在 Vite dev server 下提供 `/sdk-sheet/*` chunk；不修改正式 build/package 流程。
- `internal/office2modoc/types.go`：稳定的转换请求、限制和状态错误。
- `internal/office2modoc/path.go`：环境变量与本地缓存路径解析。
- `internal/office2modoc/native_darwin_arm64.go`：cgo `dlopen`/`dlsym` 和 ABI 调用。
- `internal/office2modoc/native_stub.go`：非 `darwin/arm64` 明确报错。
- `internal/office2modoc/converter.go`：延迟加载、串行调用和状态映射。
- `internal/xlsxeditor/atomic.go`：输出校验、权限继承、同步和原子替换。
- `internal/xlsxeditor/service.go`：token 绑定会话、MODoc 导入导出、指纹校验和清理。
- `app.go`：Wails 三个窄接口和应用生命周期接线。
- `src/shared/types.ts`、`src/renderer/bridge.ts`：renderer 侧类型与桥接。
- `src/renderer/preview/viewers/sheetSdk.ts`：SDK 初始化配置和生命周期边界。
- `src/renderer/preview/viewers/XlsxViewer.tsx`：加载、编辑、dirty、保存和快捷键 UI。
- `src/renderer/components/PreviewPanel.tsx`、`src/renderer/App.tsx`：未保存关闭与 artifact 切换保护。
- `src/renderer/preview/PreviewApp.css`：编辑器容器和保存状态样式。

## Task 1: 安装锁定依赖与本地开发二进制

**Files:**
- Create: `.npmrc`
- Modify: `package.json`
- Modify: `package-lock.json`
- Local only: `build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib`

- [ ] **Step 1: 配置私有 scope registry**

```ini
@shimo:registry=http://registry.npm.shimo.run
```

- [ ] **Step 2: 通过项目代理安装精确版本**

Run:

```bash
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 \
  npm install --save-exact \
  @shimo/sdk-sheet@5.0.14-jsapi.4 \
  @shimo/editor-sdk-core@0.0.1-124-jsapi.51 \
  @shimo/simple-i18n@4.0.27
```

Expected: `package.json` 和 `package-lock.json` 只新增上述三个生产依赖及其传递依赖。

- [ ] **Step 3: 只把 Apple arm64 发布二进制放入 ignored cache**

从 release `version-0.1.34-260702-1130` 下载页面选择 **Binary files for aarch64-apple-darwin**，不要选择任何 Source code 附件，然后执行：

```bash
archive="$HOME/Downloads/office2modoc-aarch64-apple-darwin-version-0.1.34-260702-1130.tar.gz"
extract_dir="$(mktemp -d /tmp/office2modoc-local.XXXXXX)"
tar -xzf "$archive" -C "$extract_dir"
mkdir -p build/cache/office2modoc/0.1.34/darwin-arm64
dylib_source="$(find "$extract_dir" -type f -name liboffice2modoc_ffi.dylib -print -quit)"
test -n "$dylib_source"
install -m 0755 "$dylib_source" \
  build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib
shasum -a 256 build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib
```

Expected SHA-256:

```text
f4fba6e545adbad11a70fc1b6dc14280f93c4f2a20e18d6f8db0a254df9eb1d9
```

- [ ] **Step 4: 验证依赖和 ABI 符号**

Run:

```bash
npm ls @shimo/sdk-sheet @shimo/editor-sdk-core @shimo/simple-i18n
nm -gU build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib \
  | rg '(_shimo_import|_shimo_export)$'
git status --short
```

Expected: npm 显示精确版本；两个符号都存在；`git status` 不显示 dylib。

- [ ] **Step 5: 提交依赖配置**

```bash
git add .npmrc package.json package-lock.json
git commit -m "build: add sdk sheet dependencies"
```

## Task 2: 建立 office2modoc 稳定 Go 边界

**Files:**
- Create: `internal/office2modoc/types.go`
- Create: `internal/office2modoc/path.go`
- Create: `internal/office2modoc/converter.go`
- Create: `internal/office2modoc/converter_test.go`

- [ ] **Step 1: 先写路径、状态码和串行调用失败测试**

测试必须覆盖：

```go
func TestResolveLibraryPathPrefersEnvironment(t *testing.T)
func TestResolveLibraryPathUsesRepositoryCache(t *testing.T)
func TestStatusErrorMapsImportCodes(t *testing.T)
func TestStatusErrorMapsExportCodes(t *testing.T)
func TestConverterSerializesNativeCalls(t *testing.T)
func TestConverterRejectsOversizedInput(t *testing.T)
```

关键断言：

```go
t.Setenv("OFFICE2MODOC_FFI_PATH", override)
got, err := ResolveLibraryPath(repoRoot)
if err != nil || got != override { t.Fatalf("got %q, %v", got, err) }

if !errors.Is(StatusError("import", 11), ErrPasswordProtected) {
    t.Fatal("status 11 must map to ErrPasswordProtected")
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `env -u GOROOT go test ./internal/office2modoc -count=1`

Expected: FAIL，提示 `ResolveLibraryPath`、`StatusError` 或 `NewConverter` 尚未定义。

- [ ] **Step 3: 实现稳定类型和限制**

`types.go` 至少定义：

```go
const (
    DefaultRelativeLibraryPath = "build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib"
    ImportLimitJSON = `{"slideSize":10000,"wordCharCount":100000000,"excelSingleSheetCell":2000000,"excelAllSheetCell":5000000}`
    MaxOfficeBytes int64 = 100 << 20
    MaxModocBytes  int64 = 256 << 20
)

type ImportParams struct {
    RequestID, InputOfficePath, ShimoPath, TempPath, Password, Lang string
}
type ExportParams struct {
    RequestID, OutputOfficePath, ShimoPath, TempPath, Password, Lang string
}
type Native interface {
    Import(ImportParams) (uint8, error)
    Export(ExportParams) (uint8, error)
    Close() error
}
```

`Converter` 对外方法固定为：

```go
func (c *Converter) ImportXlsx(ctx context.Context, inputOfficePath, shimoPath, tempPath string) error
func (c *Converter) ExportXlsx(ctx context.Context, outputOfficePath, shimoPath, tempPath string) error
func (c *Converter) Close() error
```

状态码映射：import `0` 成功、`10` 无效格式、`11` 密码保护、`30` 单表超限、`31` 全表超限；export `0` 成功、`10` 无效格式；其他非零值返回包含 operation 和 status 的通用错误。

- [ ] **Step 4: 实现路径解析和串行 Converter**

`ResolveLibraryPath` 只接受绝对的环境变量覆盖；默认路径使用传入 repo root 拼接。`Converter` 持有 `sync.Mutex` 和延迟 `Native` factory，`ImportXlsx`/`ExportXlsx` 在锁内调用，固定 `file_type=1`、`to_type=xlsx`、`lang=zh-CN` 和 `ImportLimitJSON`。

- [ ] **Step 5: 运行测试确认通过**

Run: `env -u GOROOT go test ./internal/office2modoc -count=1`

Expected: PASS。

- [ ] **Step 6: 提交稳定边界**

```bash
git add internal/office2modoc
git commit -m "feat: add office2modoc conversion boundary"
```

## Task 3: 实现 Apple arm64 动态 FFI 加载

**Files:**
- Create: `internal/office2modoc/native_darwin_arm64.go`
- Create: `internal/office2modoc/native_stub.go`
- Create: `internal/office2modoc/native_darwin_arm64_test.go`

- [ ] **Step 1: 写缺文件、非 dylib 和真实符号加载测试**

```go
func TestOpenNativeRejectsMissingFile(t *testing.T)
func TestOpenNativeRejectsDirectory(t *testing.T)
func TestOpenNativeLoadsConfiguredLibrary(t *testing.T) {
    path := os.Getenv("OFFICE2MODOC_FFI_PATH")
    if path == "" { t.Skip("local dylib not configured") }
    native, err := openNative(path)
    if err != nil { t.Fatal(err) }
    t.Cleanup(func() { _ = native.Close() })
}
```

- [ ] **Step 2: 运行测试确认失败**

Run: `env -u GOROOT CGO_ENABLED=1 go test ./internal/office2modoc -count=1`

Expected: FAIL，`openNative` 未定义。

- [ ] **Step 3: 实现 cgo ABI shim**

`native_darwin_arm64.go` 使用 `//go:build darwin && arm64`，C preamble 只重新声明发布头文件中的 `ImportParam_t`、`ExportParam_t`，并提供：

```c
void *office2modoc_open(const char *path, char **error_message);
uint8_t office2modoc_import(void *handle, const ImportParam_t *param, char **error_message);
uint8_t office2modoc_export(void *handle, const ExportParam_t *param, char **error_message);
void office2modoc_close(void *handle);
```

`office2modoc_open` 必须 `dlsym` 验证 `shimo_import` 和 `shimo_export`；Go 侧用 `C.CString`/`C.free` 管理每个参数，不能把 Go 指针留给 C。

- [ ] **Step 4: 实现非目标平台 stub**

`native_stub.go` 使用：

```go
//go:build !darwin || !arm64

func openNative(string) (Native, error) {
    return nil, fmt.Errorf("office2modoc: unsupported platform %s/%s", runtime.GOOS, runtime.GOARCH)
}
```

- [ ] **Step 5: 运行单测和本地加载验证**

Run:

```bash
OFFICE2MODOC_FFI_PATH="$PWD/build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib" \
  env -u GOROOT CGO_ENABLED=1 go test ./internal/office2modoc -count=1
```

Expected: PASS，真实 dylib 能打开且关闭。

Run:

```bash
GOOS=linux GOARCH=amd64 CGO_ENABLED=0 \
  env -u GOROOT go test -c ./internal/office2modoc -o /tmp/office2modoc-linux.test
```

Expected: 非目标平台 stub 可编译，不链接 macOS dylib。

- [ ] **Step 6: 提交动态加载器**

```bash
git add internal/office2modoc
git commit -m "feat: load office2modoc ffi dynamically"
```

## Task 4: 实现安全 XLSX 原子替换

**Files:**
- Create: `internal/xlsxeditor/atomic.go`
- Create: `internal/xlsxeditor/atomic_test.go`

- [ ] **Step 1: 写 XLSX 校验和原文件保护测试**

覆盖以下场景：

```go
func TestValidateXlsxRequiresContentTypesAndWorkbook(t *testing.T)
func TestReplaceAtomicallyPreservesMode(t *testing.T)
func TestReplaceAtomicallyLeavesOriginalOnInvalidExport(t *testing.T)
func TestReplaceAtomicallyLeavesOriginalWhenRenameFails(t *testing.T)
```

测试 fixture 用 `archive/zip` 创建包含或缺少 `[Content_Types].xml`、`xl/workbook.xml` 的最小 ZIP，不引入新的 XLSX 库。

- [ ] **Step 2: 运行测试确认失败**

Run: `env -u GOROOT go test ./internal/xlsxeditor -count=1`

Expected: FAIL，`validateXlsx` 和 `replaceAtomically` 未定义。

- [ ] **Step 3: 实现校验和替换**

```go
func validateXlsx(path string) error
func replaceAtomically(originalPath, exportedPath string) error
```

实现顺序必须是：校验 ZIP 条目 → 读取原 mode → chmod 临时文件 → 打开并 `Sync` 临时文件 → `os.Rename` → 打开父目录并 `Sync`。临时导出文件名必须由 `os.CreateTemp(filepath.Dir(original), ".officedex-xlsx-*.xlsx")` 创建，确保同文件系统 rename。

- [ ] **Step 4: 运行测试确认通过**

Run: `env -u GOROOT go test ./internal/xlsxeditor -count=1`

Expected: PASS。

- [ ] **Step 5: 提交原子替换层**

```bash
git add internal/xlsxeditor/atomic.go internal/xlsxeditor/atomic_test.go
git commit -m "feat: add safe xlsx atomic replacement"
```

## Task 5: 实现 token 绑定 XLSX 编辑会话

**Files:**
- Create: `internal/xlsxeditor/service.go`
- Create: `internal/xlsxeditor/service_test.go`

- [ ] **Step 1: 写准备、保存、冲突和清理失败测试**

定义 fake resolver 与 fake converter，覆盖：

```go
func TestPrepareRequiresXlsxPreviewToken(t *testing.T)
func TestPrepareImportsModocAndBindsCanonicalPath(t *testing.T)
func TestSaveRejectsTokenOrSessionMismatch(t *testing.T)
func TestSaveRejectsOversizedModoc(t *testing.T)
func TestSaveRejectsExternalFileModification(t *testing.T)
func TestSaveKeepsOriginalWhenExportFails(t *testing.T)
func TestSaveReplacesOriginalAndRefreshesFingerprint(t *testing.T)
func TestCloseRemovesSessionDirectory(t *testing.T)
func TestCloseByTokenRemovesAllBoundSessions(t *testing.T)
func TestCloseAllClosesConverter(t *testing.T)
func TestCleanupStaleOnlyRemovesOwnedOldDirectories(t *testing.T)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `env -u GOROOT go test ./internal/xlsxeditor -count=1`

Expected: FAIL，`NewService`、`Prepare`、`Save` 或 `Close` 未定义。

- [ ] **Step 3: 实现接口和会话模型**

```go
type PreviewResolver interface {
    ResolveToken(string) (preview.ArtifactEntry, error)
}
type Converter interface {
    ImportXlsx(context.Context, string, string, string) error
    ExportXlsx(context.Context, string, string, string) error
    Close() error
}
type PrepareResult struct {
    SessionID   string `json:"sessionId"`
    ModocContent string `json:"modocContent"`
}
type SaveResult struct { FilePath string `json:"filePath"` }
```

会话保存 `previewToken`、canonical path、私有 temp dir 和 `size + modtime + SHA-256` 指纹。`Prepare` 验证普通 `.xlsx` 文件和 100 MiB 上限；`Save` 在导出前重新计算指纹，冲突时返回稳定错误且不写原文件。

- [ ] **Step 4: 实现保存和清理流程**

`Save` 将 renderer 的 MODoc 写入会话文件，限制 256 MiB；调用 converter 导出到原文件同目录临时 XLSX；调用 Task 4 的安全替换；成功后刷新指纹。`Close`、`CloseByToken` 只删除服务自己创建、记录在 session map 中的目录；`CloseAll` 删除全部活动目录并调用 converter `Close`。启动清理只匹配固定前缀 `officedex-xlsx-session-*` 且年龄超过 24 小时。

- [ ] **Step 5: 运行测试确认通过并检查竞争条件**

Run:

```bash
env -u GOROOT go test ./internal/xlsxeditor -count=1
env -u GOROOT go test -race ./internal/xlsxeditor ./internal/office2modoc -count=1
```

Expected: PASS，无 race。

- [ ] **Step 6: 提交会话服务**

```bash
git add internal/xlsxeditor
git commit -m "feat: add xlsx editing sessions"
```

## Task 6: 接入 App/Wails 三个窄接口

**Files:**
- Modify: `app.go`
- Create: `app_xlsx_editor_test.go`

- [ ] **Step 1: 写 App 接线失败测试**

通过可替换的 `xlsxEditorService` fake 验证：

```go
func TestPrepareXlsxEditorDelegatesOpaqueToken(t *testing.T)
func TestSaveXlsxEditorDelegatesSessionAndContent(t *testing.T)
func TestCloseXlsxEditorClosesBoundSession(t *testing.T)
func TestRevokePreviewTokenAlsoClosesXlsxSessions(t *testing.T)
func TestShutdownClosesAllXlsxSessions(t *testing.T)
```

- [ ] **Step 2: 运行测试确认失败**

Run: `env -u GOROOT go test . -run 'Test(Prepare|Save|Close|Revoke).*Xlsx' -count=1`

Expected: FAIL，App 方法或 service 字段不存在。

- [ ] **Step 3: 在 NewApp 中构造延迟加载服务**

`NewApp` 不得因为 dylib 缺失而失败。构造 `office2modoc.Converter` 时只保存 repo root/factory，第一次 `PrepareXlsxEditor` 才解析和加载 dylib。`startup` 调用 `CleanupStale`；`shutdown` 调用 `CloseAll`。

探索分支的默认 repo root 使用 `os.Getwd()`（`wails dev` 从仓库根运行）；`OFFICE2MODOC_FFI_PATH` 仍可完全覆盖 dylib 位置，因此不把该 cwd 假设带入正式安装包设计。

- [ ] **Step 4: 增加 Wails DTO 和方法**

```go
type SaveXlsxEditorInput struct {
    PreviewToken string `json:"previewToken"`
    SessionID string `json:"sessionId"`
    ModocContent string `json:"modocContent"`
}
type CloseXlsxEditorInput struct {
    PreviewToken string `json:"previewToken"`
    SessionID string `json:"sessionId"`
}

func (a *App) PrepareXlsxEditor(previewToken string) (xlsxeditor.PrepareResult, error)
func (a *App) SaveXlsxEditor(input SaveXlsxEditorInput) (xlsxeditor.SaveResult, error)
func (a *App) CloseXlsxEditor(input CloseXlsxEditorInput) error
```

`RevokePreviewToken` 必须先 `CloseByToken(token)`，再撤销 registry token。

- [ ] **Step 5: 运行 focused 和全量 Go 测试**

Run:

```bash
env -u GOROOT go test . -run 'Test(Prepare|Save|Close|Revoke).*Xlsx' -count=1
env -u GOROOT go test ./... -count=1
```

Expected: PASS。

- [ ] **Step 6: 提交 Wails 接线**

```bash
git add app.go app_xlsx_editor_test.go
git commit -m "feat: expose xlsx editor wails api"
```

## Task 7: 增加 renderer bridge 和 Sheet SDK 开发资源

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/renderer/bridge.ts`
- Modify: `vite.config.ts`
- Create: `src/renderer/preview/viewers/sheetSdk.ts`
- Create: `src/renderer/preview/viewers/sheetSdk.test.ts`

- [ ] **Step 1: 写 SDK 配置和 bridge 失败测试**

`sheetSdk.test.ts` mock `createSheetSDK`，断言先注册 `fe-common/zh-CN` 与 `lizard-service-sheet-sdk/zh-CN` 两个资源脚本，再按 `init → mount → ready` 初始化；并断言配置包含 editor mode、传入 MODoc、隐藏协作相关能力和 `disabledShortcuts: ['mod+s', 'mod+shift+s', 'mod+shift+e']`。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/preview/viewers/sheetSdk.test.ts`

Expected: FAIL，`createOfflineSheetEditor` 未定义。

- [ ] **Step 3: 增加 renderer 类型和三种 bridge 实现**

`DesktopAPI` 新增：

```ts
prepareXlsxEditor(previewToken: string): Promise<{ sessionId: string; modocContent: string }>;
saveXlsxEditor(input: { previewToken: string; sessionId: string; modocContent: string }): Promise<{ filePath: string }>;
closeXlsxEditor(input: { previewToken: string; sessionId: string }): Promise<void>;
```

`createWailsAPI` 使用 optional generated binding；`createRealE2EAPI` 映射同名 RPC；browser fallback 返回明确的 `XLSX editing requires the Wails desktop runtime.` 错误。

- [ ] **Step 4: 实现离线 SDK 初始化边界**

`sheetSdk.ts` 静态导入 `@shimo/sdk-sheet/lib/index.css`，从 `@shimo/simple-i18n` 导入 `getS18n`，并通过带类型的 `globalThis` 交叉类型设置 `s18n = { getS18n }`；随后按顺序加载 `/sdk-sheet-locales/fe-common/zh-CN.js` 与 `/sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js`，最后动态导入 `createSheetSDK`。复用 `lizard-service-ai2/apps/copilot-demo/src/components/sheet-editor.tsx` 的非 Copilot 配置。评论设为 hidden，不传 collaboration/file/user，关闭 form/importRange/history/follow/mention/lock/combineSheets。

```ts
const sheetLocaleGlobal = globalThis as typeof globalThis & {
  s18n?: { getS18n: typeof getS18n };
};
sheetLocaleGlobal.s18n = { getS18n };
await loadScriptOnce("/sdk-sheet-locales/fe-common/zh-CN.js");
await loadScriptOnce("/sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js");
```

- [ ] **Step 5: 只给 dev server 提供 SDK chunks**

在 `vite.config.ts` 添加 `apply: "serve"` 的本地 plugin：从 `node_modules/@shimo/sdk-sheet/lib` 响应 `/sdk-sheet/*.js`，从 `node_modules/@shimo/sdk-sheet/locales` 响应 `/sdk-sheet-locales/*.js`。路径必须 `decodeURIComponent` 后 `path.resolve`，并验证结果仍在对应 root 内；只允许普通 `.js` 文件，其他请求返回 404。不要添加 `build.rollupOptions`、copy plugin、prebuild 或 package 脚本。

- [ ] **Step 6: 运行测试和 dev asset 探针**

Run:

```bash
npx vitest run src/renderer/preview/viewers/sheetSdk.test.ts
HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm run dev:browser
curl -f http://127.0.0.1:3100/sdk-sheet/p2.chunk.js -o /tmp/officedex-p2.chunk.js
curl -f http://127.0.0.1:3100/sdk-sheet-locales/lizard-service-sheet-sdk/zh-CN.js \
  -o /tmp/officedex-sheet-zh-CN.js
```

Expected: Vitest PASS；curl 返回非空 JS。验证后停止 dev server。

- [ ] **Step 7: 提交 bridge 和 SDK host**

```bash
git add src/shared/types.ts src/renderer/bridge.ts vite.config.ts \
  src/renderer/preview/viewers/sheetSdk.ts \
  src/renderer/preview/viewers/sheetSdk.test.ts
git commit -m "feat: add offline sdk sheet host"
```

## Task 8: 用可保存编辑器替换 XlsxViewer

**Files:**
- Modify: `src/renderer/preview/viewers/XlsxViewer.tsx`
- Create: `src/renderer/preview/viewers/XlsxViewer.test.tsx`
- Modify: `src/renderer/preview/PreviewApp.css`

- [ ] **Step 1: 写编辑器生命周期和保存失败测试**

mock `officecli` 和 `createOfflineSheetEditor`，覆盖：

```ts
it("prepares modoc and mounts the sdk editor")
it("marks dirty from content.addChangeListener")
it("serializes current content and saves once")
it("keeps dirty and shows failure when save rejects")
it("ignores repeated save clicks while saving")
it("handles Cmd+S only while the editor is focused")
it("closes the backend session and destroys the editor on unmount")
it("renders retry and external-open actions when prepare fails")
```

保存 mock 必须验证：

```ts
expect(officecli.saveXlsxEditor).toHaveBeenCalledWith({
  previewToken: "preview-token",
  sessionId: "session-1",
  modocContent: "serialized-modoc",
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run src/renderer/preview/viewers/XlsxViewer.test.tsx`

Expected: FAIL，仍渲染旧 SheetJS HTML 或找不到保存按钮。

- [ ] **Step 3: 实现 XlsxViewer 状态机**

状态使用：`loading | clean | dirty | saving | saved | error`。加载成功后 mount SDK，注册 `editor.content.addChangeListener(() => setState("dirty"))`。保存时：

```ts
const delta = await editor.content.getContent();
const modocContent = delta.stringify();
await officecli.saveXlsxEditor({ previewToken, sessionId, modocContent });
```

保存中禁用按钮；失败保持 dirty 并展示错误；成功显示“已保存”。组件 cleanup 顺序为 unsubscribe → ResizeObserver.disconnect → `editor.unmount()` → `editor.destroy()` → `closeXlsxEditor`。

- [ ] **Step 4: 实现聚焦范围内 Cmd+S**

编辑器容器 `pointerdown` 设置 focused ref，容器外 pointerdown 清除。document `keydown` 仅在 focused、`metaKey` 且 `key.toLowerCase()==="s"` 时 `preventDefault` 并调用保存；SDK 自身已禁用 `mod+s`，避免双重处理。

- [ ] **Step 5: 替换旧样式**

删除 `.preview-xlsx-content table/th/td` 的 HTML table 样式；新增占满剩余空间的 `.preview-xlsx-editor-shell`、`.preview-xlsx-editor` 和保存状态样式。不要修改其他 viewer 样式。

- [ ] **Step 6: 运行 focused 测试**

Run:

```bash
npx vitest run src/renderer/preview/viewers/XlsxViewer.test.tsx \
  src/renderer/preview/viewers/sheetSdk.test.ts
```

Expected: PASS。

- [ ] **Step 7: 提交 XLSX 编辑器 UI**

```bash
git add src/renderer/preview/viewers/XlsxViewer.tsx \
  src/renderer/preview/viewers/XlsxViewer.test.tsx \
  src/renderer/preview/PreviewApp.css
git commit -m "feat: replace xlsx preview with sdk sheet editor"
```

## Task 9: 阻止未保存关闭与 artifact 切换

**Files:**
- Modify: `src/renderer/preview/viewers/XlsxViewer.tsx`
- Modify: `src/renderer/components/PreviewPanel.tsx`
- Modify: `src/renderer/components/PreviewPanel.test.tsx`
- Modify: `src/renderer/App.tsx`
- Modify: `src/renderer/App.test.tsx`

- [ ] **Step 1: 写关闭和切换保护失败测试**

覆盖：dirty XLSX 点击 Back/Close 时取消确认不会关闭；确认后正常滑出；打开另一个 artifact 时取消确认保留当前 grant；window `beforeunload` 在 dirty 时设置 `returnValue`，clean 时不处理。

- [ ] **Step 2: 运行测试确认失败**

Run:

```bash
npx vitest run src/renderer/components/PreviewPanel.test.tsx \
  src/renderer/preview/viewers/XlsxViewer.test.tsx \
  src/renderer/App.test.tsx
```

Expected: FAIL，当前 close/open 流程没有 dirty guard。

- [ ] **Step 3: 提升 dirty 状态并保护面板关闭**

`XlsxViewer` 增加 `onDirtyChange?: (dirty: boolean) => void`；`PreviewPanel` 接收 viewer 回调并在 `requestClose` 开始动画前调用：

```ts
if (xlsxDirty && !window.confirm("此表格有未保存的修改，确定关闭吗？")) return;
```

clean/saved/unmount 时回报 false。

- [ ] **Step 4: 保护 artifact 切换和窗口关闭**

`App` 持有 `previewDirty`。`openInlinePreview` 在撤销旧 token 之前确认；取消时不得 revoke 或签发新 token。`XlsxViewer` dirty 时注册 `beforeunload`，cleanup 时移除。

- [ ] **Step 5: 运行 focused 测试并提交**

Run:

```bash
npx vitest run src/renderer/components/PreviewPanel.test.tsx \
  src/renderer/preview/viewers/XlsxViewer.test.tsx \
  src/renderer/App.test.tsx
```

Expected: PASS。

```bash
git add src/renderer/preview/viewers/XlsxViewer.tsx \
  src/renderer/components/PreviewPanel.tsx \
  src/renderer/components/PreviewPanel.test.tsx \
  src/renderer/App.tsx src/renderer/App.test.tsx
git commit -m "feat: guard unsaved xlsx edits"
```

## Task 10: 真实转换、Wails 开发模式和回归验证

**Files:**
- Create: `internal/office2modoc/integration_test.go`
- Modify only if required by generated bindings: no tracked generated files

- [ ] **Step 1: 写 opt-in 真实往返测试**

测试读取 `OFFICE2MODOC_TEST_XLSX`；变量或 dylib 不存在时 `t.Skip`。流程为导入 MODoc → 断言非空且小于 256 MiB → 导出 XLSX → 用 `archive/zip` 验证必要条目。

- [ ] **Step 2: 生成本地测试 XLSX 并运行真实转换**

```bash
node --input-type=module <<'NODE'
import * as XLSX from "xlsx";
const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet([["name", "value"], ["alpha", 1], ["formula", { f: "B2+1" }]]);
XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
XLSX.writeFile(wb, "/tmp/officedex-xlsx-editor-fixture.xlsx");
NODE

OFFICE2MODOC_FFI_PATH="$PWD/build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib" \
OFFICE2MODOC_TEST_XLSX=/tmp/officedex-xlsx-editor-fixture.xlsx \
  env -u GOROOT CGO_ENABLED=1 go test ./internal/office2modoc -run Integration -count=1 -v
```

Expected: PASS，不跳过。

- [ ] **Step 3: 生成本地 Wails bindings**

Run `HTTP_PROXY=http://127.0.0.1:7890 HTTPS_PROXY=http://127.0.0.1:7890 npm run dev`，等待 Wails 完成 bindings 生成和 dev server 启动后停止进程。

Expected: `src/renderer/generated/wailsjs/go/main/App.*` 包含三个 XLSX 方法；generated 目录保持 Git ignored。

- [ ] **Step 4: 运行完整自动化验证**

```bash
npm run lint
npx vitest run
env -u GOROOT go test ./... -count=1
env -u GOROOT go test -tags officedex_demo ./... -count=1
git diff --check
```

Expected: 全部 PASS。若出现任务开始前已确认的 generated bindings 缺失错误，先重复 Step 3，不得通过提交 generated 文件规避。

- [ ] **Step 5: Wails 手工验收**

使用本地 dylib 启动 `npm run dev`，打开一份多工作表 XLSX，逐项验证：

1. 显示石墨表格而非 HTML table。
2. 修改普通值、公式、样式、合并单元格、列宽并保存。
3. 关闭后重新打开，修改仍存在。
4. 用 Excel 或 Numbers 打开同一原文件。
5. dirty 状态关闭和切换 artifact 会确认。
6. 临时移走 dylib 后重试，显示明确错误且原 XLSX 哈希不变。
7. 编辑期间用外部程序修改原文件，再保存时拒绝覆盖。
8. 日志不包含 MODoc 或工作簿内容。

- [ ] **Step 6: 提交集成测试**

```bash
git add internal/office2modoc/integration_test.go
git commit -m "test: cover office2modoc xlsx round trip"
```

- [ ] **Step 7: 最终范围检查**

```bash
git status --short
git diff main...HEAD --name-only
git diff main...HEAD -- package.json package-lock.json app.go internal src vite.config.ts .npmrc
```

Expected: 没有 dylib、源码归档、generated Wails 文件、CI、release、签名、公证或安装包流程变更；其他文档 viewer 未被替换。
