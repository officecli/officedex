# OfficeDex E2E 测试指南

OfficeDex 的测试矩阵由三层组成。本地都可以独立或聚合运行；CI 集成留待后续接入。

## 一键聚合

```bash
npm run test:all
```

会按顺序跑：

1. `npm run lint` — `tsc --noEmit` 类型检查
2. `npx vitest run` — 组件级集成测试（jsdom + React Testing Library）
3. `go test ./... -count=1` — Go 后端单元/集成测试
4. `npm run test:e2e` — Playwright 浏览器端 E2E（默认 chromium，bridge IPC mock 化）

任意一层失败就退出，方便快速定位回归。

## 各层独立跑

### Vitest 组件层

```bash
npx vitest run                          # 全量
npx vitest run src/renderer/screens/    # 仅 screens
npx vitest run -t "Question state"      # 按名称过滤
```

覆盖范围：

- `App.test.tsx` — 主 App 状态机、任务流转、生成提交、附件、剪贴板粘贴
- `screens/OnboardingScreen.test.tsx` — 2 步引导
- `screens/SettingsScreens.test.tsx` — 设置面板（含 Modal.confirm 流程）
- `screens/LoginScreen.test.tsx` — 登录态机（anonymous→awaiting→success/failure）
- `screens/DialogueScreens.test.tsx` — Dialogue 五种状态（running/question/completed/failed/cancelled） + 错误横幅
- `components/PreviewPanel.test.tsx` — 预览面板的 viewer 路由
- 现有的 `designTokens.test.ts`、`defaults.test.ts`、`taskState.test.ts`

### Playwright 浏览器层

首次运行需要安装 chromium：

```bash
npm run test:e2e:install     # → npx playwright install chromium
```

然后：

```bash
npm run test:e2e                                            # 全部 e2e/*.spec.ts
npm run test:e2e -- e2e/smoke.spec.ts                       # 单文件
npm run test:e2e -- --headed                                # 带界面
PWDEBUG=1 npm run test:e2e -- -g "Generation flow"          # 调试
```

`playwright.config.ts` 配置：

- baseURL：`http://localhost:3100`（dev:browser 的 vite 端口）
- webServer：自动起 `npm run dev:browser`，复用已有进程
- bridge 注入：所有 spec 都用 `e2e/fixtures/bridge-mock.ts::installBridgeMock` 在 `addInitScript` 阶段塞入 `window.officecli` 假实现。`bridge.ts::selectAPI()` 在非 Wails 环境会优先采用此注入，避免触达真实 IPC

覆盖范围：

- `e2e/smoke.spec.ts` — Shell 渲染 + 5 个导航切换 + bridge.unconfigured 错误页
- `e2e/generation.spec.ts` — 五种 documentType + 附件 + Question/Cancelled/Failed/Completed 状态机
- `e2e/settings.spec.ts` — 设置面板核心交互（含 Reset everything 模态）
- `e2e/login.spec.ts` — 登录态全流程
- `e2e/artifacts.spec.ts` — 产物列表 + 文件夹定位

### Go 后端层

```bash
go test ./... -count=1                 # 全量
go test ./internal/bridge -v           # 单包
go test ./... -run TestParseWhoAmI     # 按名过滤
```

覆盖范围：

- `internal/bridge` — JSON-RPC 帧解析、请求超时、重连分类、session 缓存、attachment 参数、`task/invoke` 包装、env 构造
- `internal/settings` — Patch round-trip、`ClearLlmProvider`、provider 校验、原子写、缓存重载
- `internal/login` — `WhoAmI` 多种输出解析、`Cancel` SIGTERM、`StartReportsSpawnError`
- `internal/preview` — Token 颁发 / Revoke、路径校验、扩展白名单、符号链接解析
- `internal/binresolver` — 二进制解析优先级（user > bundled > env > fallback）
- `internal/runtime`、`internal/localstore` — runtime 资源 / 本地存储

## 真实 officecli + LLM 烟雾测试（US-007）

走真实二进制 + 真实 LLM 调用，默认 **不** 跑（成本与稳定性原因）。当需要验证端到端时：

```bash
# 仅 Initialize + GetCapabilities，验证 bridge 能连接真实进程
OFFICEDEX_E2E_REAL=1 \
OFFICECLI_DESKTOP_BINARY="$(pwd)/officecli-bin/officecli" \
  go test ./internal/bridge -run TestRealOfficeCliInitializeAndCapabilities \
  -tags real_e2e -count=1 -v

# 跑真实 generate（会调用 LLM、产出真实文件）
OFFICEDEX_E2E_REAL=1 \
OFFICEDEX_E2E_REAL_GENERATE=1 \
OFFICECLI_DESKTOP_BINARY="$(pwd)/officecli-bin/officecli" \
  go test ./internal/bridge -run TestRealOfficeCli \
  -tags real_e2e -count=1 -v -timeout 30m
```

约束与注意：

- 测试文件 `internal/bridge/real_integration_test.go` 使用 `//go:build real_e2e` 构建标签隔离，不会污染常规 `go test ./...`
- 真实 generate 失败（quota、网络、模型不稳定）会通过 `t.Skip()` 标记为 skipped 而不是 failed，避免误报
- 真实 LLM 调用可能持续数分钟。超过 30 分钟自动 skip
- 需要确保 OfficeCLI 已登录或环境变量已配置好 LLM provider（参考 OfficeCLI 文档）

## 桌面端（Wails）E2E 的现状

完整的 Wails 桌面端 E2E（驱动真正打包后的 `OfficeDex.app`）目前由：

- 渲染层：Playwright 浏览器测试（dev:browser + bridge mock）+ Vitest 组件测试
- 后端层：Go 单元 / 集成测试 + 上述 `real_e2e` 标签 smoke

三者共同覆盖。直接驱动 Wails 原生窗口需要 WebDriver 协议支持，本地暂未接入。

## 故障排查

| 现象 | 处理 |
|---|---|
| Playwright 抱怨找不到 chromium | `npm run test:e2e:install` |
| dev:browser 启动失败 / 端口冲突 | `lsof -ti:3100 \| xargs -r kill -9` 后重跑 |
| antd Radio.Group 测试点击失败 | 用 `label.ant-radio-button-wrapper` 替代 `getByRole("radio")`（hidden input 不可点） |
| Modal.confirm OK 按钮找不到 | 用 `.ant-modal-confirm-btns button.ant-btn-dangerous` 或最后一个按钮 |
| jsdom 报 `getComputedStyle not implemented` 影响 antd | 在 `beforeEach` 中 `vi.spyOn(window, "getComputedStyle").mockImplementation(...)` |
| Wails generated/ 目录缺失导致 vitest 报错 | `wails generate module` 重新生成；CI 中 `dist/` 也需要先存在 |
