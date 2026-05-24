# Issue Reporting — 诊断日志收集与导出

本文档描述 OfficeDex 诊断日志系统的架构、隐私模型、Bundle Schema 以及开发流程。

---

## 1. 架构概览

OfficeDex 的诊断系统分三层：**日志持久化 → 诊断 Bundle 组装 → 用户导出/上传**。

### 日志持久化（Bridge Logfile）

Bridge 进程的 stdout/stderr 通过 async tee 机制持久化到磁盘。`internal/bridge/logfile.go` 实现了一个带 bounded channel（cap=256）的非阻塞写入层，独立 goroutine 负责落盘。Channel 满时丢弃新 chunk（drop newest），累计 `droppedBytes` 并在每 1MB 写入时插入 `[DROPPED N bytes since last marker]` 标记行。日志按天轮转为 `bridge-YYYYMMDD.log`，启动时清理 >7 天的旧文件。

写入路径：`<userDataDir>/logs/bridge-YYYYMMDD.log`（macOS 为 `~/Library/Application Support/OfficeDex/logs/`）。

### 诊断 Bundle 组装

`internal/diagnostics/bundle.go:26` 的 `BuildBundle()` 函数负责将各数据源装配为一个原子写入的 zip 文件。流程：

1. 创建临时目录 → 写入 `bundle.zip.partial`
2. 按 section 依次写入：meta → settings → events → logs
3. 每个 section 经过脱敏（scrub）处理
4. 全部写完后 `os.Rename` 到最终路径（原子性保证）
5. 任何步骤失败 → 清理临时目录，用户可见目录不留残文件

最终文件名格式：`officedex-logs-<YYYYMMDDHHMMSS.ns>-<bundleId-short>.zip`

### 用户导出

Settings → Diagnostics 面板提供"导出诊断日志"按钮，调用 `App.ExportLogs()` Wails binding。返回 `{path, manifest}` 给前端展示。Phase B 将新增一键上报到服务端。

### Stall Detector（停滞检测）

Renderer 层 `setInterval(30s)` 扫描活跃任务，超过 120s 无 `task.progress` 事件时标记 `stalledSince`。这是纯信息性提示——backgrounded/minimized 窗口可能因浏览器节流导致 interval 延迟执行，这是可接受的，因为 stall hint 仅为辅助诊断信息，不阻塞任何流程。相关测试见 W1 的 stall detector vitest spec。

---

## 2. 隐私模型

所有进入 Bundle 的文本数据均经过 `internal/diagnostics/scrub.go` 的行级脱敏处理。

### 脱敏规则

#### 正则集（`scrubPatterns`，scrub.go:14-21）

| 模式 | 替换为 |
|------|--------|
| `Authorization:\s*\S+(\s+\S+)?` | `Authorization: [REDACTED]` |
| `Bearer\s+\S+` | `Bearer [REDACTED]` |
| `apiKey=\S+` | `apiKey=[REDACTED]` |
| `token=\S+` | `token=[REDACTED]` |
| `sk-[A-Za-z0-9]{16,}` | `[REDACTED]` |
| `eyJ[A-Za-z0-9_\-\.]{10,}` | `[REDACTED]` |

#### 字面量替换（双源）

- **源 1**：`settings.LlmProvider.APIKey` / `BaseURL`（实时 settings）
- **源 2**：`CachedBridgeEnv` 中的 `OFFICECLI_LLM_API_KEY=` / `OFFICECLI_LLM_BASE_URL=` 值

任何文本中出现等于这两个源的 token 会被替换为 `[REDACTED_API_KEY]` / `[REDACTED_BASE_URL]`。

#### 路径脱敏

- `$HOME` → `~`
- `workspaceDir` → `<workspace>`
- Windows 路径先经 `filepath.ToSlash` 规范化后再匹配

### 已知限制

- **多行 token 不支持**：每行独立扫描。JWT 跨行的极端边缘场景不会被正则捕获。这是已知限制，因为实际日志中 token 跨行出现概率极低。
- 国产模型 API key 如果不以 `sk-` 开头且不匹配其他模式，仅通过字面量替换覆盖（依赖 settings 中存储的值）。

---

## 3. Bundle Schema（`bundleSchemaVersion=1`）

### manifest 结构

```json
{
  "schemaVersion": 1,
  "bundleId": "uuid-string",
  "items": [
    {
      "path": "meta.json",
      "sizeBytes": 256,
      "preview": "",
      "sectionId": "meta"
    }
  ],
  "truncated": false,
  "excludedReasons": []
}
```

类型定义见 `internal/diagnostics/manifest.go`。

### Bundle 内文件

| 路径 | sectionId | 说明 |
|------|-----------|------|
| `meta.json` | `meta` | appVersion, os, arch, time, bundleId, bundleSchemaVersion, taskId, runtimeDroppedBytes |
| `settings.scrubbed.json` | `settings` | 用户设置（apiKey/baseUrl 已脱敏） |
| `events/task-<id>.jsonl` | `events` | 指定 task 的全部 bridge events |
| `events/recent.jsonl` | `events` | 最近 200 条跨 task 事件 |
| `logs/bridge-*.log` | `logs` | 最近 3 天的 bridge 日志（行级脱敏后） |
| `user_input.json` | `user_input` | （Phase A1+）用户描述 + 联系邮箱，隔离 PII |

### meta.json 字段

```json
{
  "appVersion": "1.2.3",
  "os": "darwin",
  "arch": "arm64",
  "time": "2026-05-24T12:00:00Z",
  "bundleId": "abcd1234-...",
  "bundleSchemaVersion": 1,
  "taskId": "task-000032",
  "runtimeDroppedBytes": 0
}
```

### 体积裁剪规则

- 单文件 >10MB：头尾各保留 5MB + 中间标 `[TRUNCATED N bytes]`
- 总体 >25MB：自动排除 `events/recent.jsonl` 和较老 logfile，manifest 标 `excludedReasons`
- **永不拒绝构建**——即使超限也会产出一个裁剪后的有效 bundle

---

## 4. Schema 演进策略（bundleSchemaVersion forward-compat）

当 Phase B 服务端新增字段或要求变更时，遵循以下契约：

### 服务端行为

- Server **SHOULD** accept any `bundleSchemaVersion >= 1` and ignore unknown fields。
- Server **MAY** reject by emitting a `code: "unsupported_schema"` response；此为显式拒绝路径。

### 客户端降级路径

当收到 `unsupported_schema` 拒绝响应时，desktop client 的行为：

1. 显示提示信息："请更新 OfficeDex 到最新版本以提交此报告 / Please update OfficeDex to the latest version to submit this report"
2. **保留本地 zip 文件**不删除，用户可手动发送
3. 标记此次上传为 non-fatal failure（不影响后续使用）

### 契约要求

Phase B 服务端实现 **必须** 遵守以下规则：

1. `bundleSchemaVersion=1` 的 bundle 永远被接受（向后兼容）
2. 新增字段采用 additive-only 策略：新字段 `omitempty`，老 client 不发送也不报错
3. 若确需 breaking change，递增 `bundleSchemaVersion` 并在过渡期同时接受新旧版本
4. 拒绝响应体格式：`{"code": "unsupported_schema", "message": "...", "minVersion": N}`

此策略确保已发布的桌面客户端在用户未更新前仍能正常使用本地导出功能。

### Phase B 实现交叉引用

`unsupported_schema` 响应的具体处理逻辑位于 `internal/report/submit.go` 的 `handleSubmitResponse()` 中。当服务端返回该错误码时，submit 函数返回 `ReportResult{Uploaded: false, SchemaRejected: true, BundlePath: localZipPath}`，由 UI 层触发更新检查提示。详见 [Section 8: Failure Modes](#8-failure-modes失败模式)。

---

## 5. 如何添加 stderr Fixtures

### 目录结构

```
internal/diagnostics/testdata/stderr-samples/
├── seed.log            # public-safe synthetic seed（必须始终存在）
├── oauth-refresh.log   # OAuth token refresh 场景
├── provider-error.log  # Provider API error 含 apiKey/sk- 模式
├── windows-paths.log   # Windows 路径格式
└── mixed-tokens.log    # 同行多 token + 多行混合
```

### 要求

- **Public CI 要求 ≥1 个 seed fixture**（`scrub_fixture_test.go` 在 0 fixture 时 `t.Fatal`）
- **Internal/staging CI 建议维护 ≥5 fixtures**，来源于真实客户 stderr 样本
- 所有 public 仓 fixture 必须使用 **OBVIOUSLY-FAKE 值**：
  - API keys: `sk-FAKEKEY-DO-NOT-USE-...`
  - JWT: `eyJ...FAKEJWT-DO-NOT-USE...`
  - 路径: `/Users/testuser/...` 或 `C:\Users\testuser\...`

### 添加新 fixture 的审核清单

1. **确认无真实凭据**：fixture 中不得包含任何来自真实环境的 key、token、密码
2. **覆盖目标 pattern**：新 fixture 应覆盖 `scrubPatterns` 中至少一个未被现有 fixture 充分覆盖的模式
3. **运行 fixture 测试**：`go test -race ./internal/diagnostics/ -run TestScrubFixtures`
4. **验证脱敏后输出**：确认 scrub 后无敏感模式残留
5. **检查路径替换**：如含路径，确认 `$HOME` / Windows home 被正确替换
6. **提交 PR 时注明**：fixture 覆盖的场景和对应 scrub rule

### 内部仓真实样本流程

内部/staging 仓维护来自客户 stderr 的真实 fixture（已手动脱敏）：
- 放置在同一目录 `internal/diagnostics/testdata/stderr-samples/`
- 本地跑 `go test ./internal/diagnostics/` 验证 scrub 覆盖度
- 不 push 到 public 仓（或通过 `.gitignore` 规则隔离）

---

## 6. Reviewer Pre-Merge Checklist

```bash
# 编译 + race 检测
go test -race ./internal/bridge/... ./internal/diagnostics/...
go test ./internal/localstore/...

# Frontend
npx vitest run
npm run lint

# 跨平台 smoke
GOOS=windows go build ./...

# Fixture 完整性（期望 ≥5 个 .log 文件）
ls internal/diagnostics/testdata/stderr-samples/*.log | wc -l

# 隐私 grep set（手动验证一次）
TMPDIR=$(mktemp -d)
# 触发 ExportLogs → 把生成的 zip 解压到 $TMPDIR/bundle
unzip <path-to-zip> -d $TMPDIR/bundle
grep -REn 'Bearer |sk-|apiKey=|Authorization:|eyJ' $TMPDIR/bundle ; echo "exit=$?"  # 期望 1
grep -REn "$HOME" $TMPDIR/bundle ; echo "exit=$?"  # 期望 1

# 并发点击 smoke
for i in {1..10}; do
  (curl -s http://localhost:... 触发 ExportLogs &)
done
wait
ls ~/Downloads/officedex-logs-*.zip | wc -l  # 期望 10，无 .partial 残留

# Race 条件
go test -race -count=5 ./internal/diagnostics/...
```

PR 作者跑一遍完整 checklist，reviewer 复跑关键项（race + privacy grep），output 贴 PR comment。

---

## 7. Phase B Issue Reporting Flow（一键上报）

### 端到端流程

1. **用户点击 Report Issue** — 在 Dialogue 区域或 Settings 面板中点击上报按钮
2. **填写表单** — 输入问题描述（≥10 字必填）、联系邮箱（可选）；勾选需包含的 bundle sections（meta 必含）
3. **Bundle 构建** — 复用 Phase A 的 `diagnostics.BuildBundle()`，根据用户选择组装 zip
4. **Capability 探测** — 三重探测判断上传通道可用性（见下文）
5. **路径选择** — CLI 通道优先 → HTTP 通道备选 → 本地 fallback
6. **结果反馈** — 成功时显示 ticket ID + 查看链接；失败时保留本地 zip 并 toast 文件路径

### Capability 三重探测

上传通道可用性通过以下三个探测源综合判断，**任意两个为 true 即认为 enabled**：

| 探测源 | 实现 | 说明 |
|--------|------|------|
| **Settings 配置** | `supportReportEndpoint` 非空 | 用户或管理员在 Settings → Diagnostics 中配置的上传端点 URL |
| **CLI 子命令** | `officecli report submit --help` 退出码 == 0 | 当前安装的 officecli 是否包含 report 子命令 |
| **GetCapabilities 协议** | `GetCapabilities` 返回 `report.submit = true` | Bridge 初始化时服务端协议声明 |

探测结果在 session 内缓存，不重复探测。变更探测结果需要重启应用。

实现位于 `internal/report/capability.go`，入口函数：

```go
func ProbeCapability(ctx context.Context, opts ProbeOptions) CapabilityResult
```

### 后端契约（Server Endpoint API）

**请求：**

```
POST <supportReportEndpoint>
Content-Type: multipart/form-data
Authorization: Bearer <token>

Parts:
  - bundle: bundle.zip (application/zip)
  - description: string
  - email: string (optional)
  - bundleId: string (UUID)
  - bundleSchemaVersion: "1"
```

**成功响应（2xx）：**

```json
{
  "ticketId": "TKT-20260524-abcd",
  "viewUrl": "https://support.example.com/tickets/TKT-20260524-abcd"
}
```

**Schema 拒绝响应（4xx）：**

```json
{
  "code": "unsupported_schema",
  "message": "Bundle schema version 1 is no longer supported",
  "minVersion": 2
}
```

Schema 拒绝时的客户端行为详见 [Section 4: Schema 演进策略](#4-schema-演进策略bundleschemaversion-forward-compat)。

### Settings 配置项

| 字段 | 类型 | 说明 |
|------|------|------|
| `supportReportEndpoint` | `string` | 上报端点 URL。为空则 HTTP 通道不可用 |
| `supportReportToken` | `string?` | 可选的独立 auth token。未设置时 HTTP 通道使用 officecli 自带 token |

配置方式：Settings → Diagnostics 面板，或直接编辑 `settings.json`。

### CLI 通道路径

当 CLI 子命令可用时（探测通过），调用：

```bash
officecli report submit \
  --bundle <zip-path> \
  --json \
  --source desktop \
  --task-id <task-id> \
  --description "<user-description>"
```

成功时 stdout 输出 JSON `{"ticketId": "...", "viewUrl": "..."}`。

实现位于 `internal/report/submit.go`，使用 fakeExec 模式可测试。

---

## 8. Failure Modes（失败模式）

| 场景 | 触发条件 | 客户端行为 |
|------|----------|-----------|
| **Endpoint 不可达 / 5xx** | 网络超时或服务端错误 | Fallback 到本地 zip，toast 指向文件路径 |
| **Schema 拒绝 (4xx `unsupported_schema`)** | 服务端不支持当前 bundle schema 版本 | 触发 app 更新检查 + 保留本地 zip + 提示用户更新 |
| **CLI 子命令不存在** | `officecli report submit --help` 退出码 != 0 | 回退到 HTTP 通道（如 endpoint 已配置），否则回退到本地 zip |
| **描述过短** | 用户输入 <10 字 | Renderer 侧校验拦截，不发起上传请求 |
| **Auth token 缺失（HTTP 通道）** | `supportReportToken` 未配置且 officecli 未登录 | Toast："未配置 supportReportToken，请在 Settings 中设置或使用 hosted 模式（officecli 自带 token）" |
| **Bundle 构建失败** | 磁盘空间不足、权限问题等 | Toast 显示错误原因，不尝试上传 |
| **上传超时** | 大文件上传超过 60s | 中断上传，保留本地 zip，toast 提示手动发送 |

### 降级优先级

```
CLI 通道 (officecli report submit)
  ↓ 不可用
HTTP 通道 (supportReportEndpoint + token)
  ↓ 不可用
本地 fallback (保留 zip + toast 路径)
```

每一级失败都不阻塞用户——最差情况下用户总是能拿到本地 zip 文件。
