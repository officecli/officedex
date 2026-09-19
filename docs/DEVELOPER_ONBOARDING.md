# OfficeDex 开发介入指南

本文档面向第一次接手 OfficeDex 的开发者，基于 develop/1.0 分支整理。文档中的路径均以 OfficeDex 仓库根目录为基准。

> 适用基线：develop/1.0 → 52df8af2dddf0118eac00c323d6cfd5393157c35（2026-09-04 检查）。
>
> OfficeDex 是多仓库协作项目。PPT 编辑器、OfficeCLI 和 office2modoc FFI 均有独立的源码或发布物边界。

## 1. 整体架构

OfficeDex 的运行结构：

~~~text
OfficeDex desktop process
├─ Wails shell (Go)
│  ├─ Wails bindings: App methods
│  ├─ local services: settings / SQLite / preview / editors
│  ├─ MOP HTTP asset handler
│  └─ child-process pool
│       └─ JSON-RPC 2.0 over stdio
│            └─ officecli agent-bridge
└─ embedded frontend: React + TypeScript + Vite
   ├─ home / task / settings / preview UI
   ├─ DOCX / XLSX editor and preview
   └─ embedded presentation component
~~~

主要边界：

- src/ 是前端源码；桌面版通过 Wails 绑定调用 Go 方法。
- app.go 和 internal/ 是桌面端 Go 运行时，负责本地文件、任务状态、预览、编辑器和外部进程。
- officecli agent-bridge 是独立 Go 子进程，负责 Agent 任务、模型调用和文档生成，不属于本仓库源码。
- PPT 编辑器默认从同级 ../presentation 构建，再同步到 public/presentation 或打包目录。
- office2modoc 是 DOCX/XLSX 相关转换能力使用的 FFI 发布物，版本由 office2modoc.version 固定。
- dist/、build/、test-results/ 等目录是构建、缓存或测试产物，不是业务源码入口。

## 2. 仓库和依赖边界

典型本地目录：

~~~text
vibe-officing/
├── officedex/             # 当前仓库：桌面应用、前端、Go 本地运行时
├── presentation/          # PPT 编辑器源仓库，OfficeDex 构建时默认引用
├── officecli/             # OfficeCLI 公共源码仓库
├── officecli-internal/    # 内部 OfficeCLI/FFI 源码或发布物来源
├── office2modoc-ffi/      # 独立 FFI 仓库（不一定存在于本地）
└── pptx/                  # 历史或其他 PPT 相关仓库，不是当前默认 PPT 来源
~~~

OfficeDex 直接依赖：

| 依赖 | 用途 | 介入注意 |
| --- | --- | --- |
| Wails v2 | Go 桌面壳、JS ↔ Go bindings、原生窗口和文件对话框 | 修改 Go 暴露方法后要检查 bindings，并同步 bridge.ts |
| React 19 + Vite | 前端渲染和开发服务器 | tsconfig.json 是严格类型检查；不要随意删除 Vite alias 和静态资源路由 |
| @shimo/sdk-sheet | 表格能力和资源 | Vite 开发与构建分别复制 sdk-sheet 资源 |
| docx / docx-preview / mammoth | DOCX 生成、预览和文本导入 | 生成与预览是不同链路 |
| xlsx | 前端 XLSX 读取和预览辅助 | 真正编辑保存链路在 internal/xlsxeditor 和 Sheet SDK |
| pdfjs-dist | PDF 预览 | 不负责 OfficeCLI 生成 |
| modernc.org/sqlite | 纯 Go SQLite 驱动 | schema 在 internal/localstore，迁移要保持重启兼容 |
| excelize | Go 侧 XLSX 处理 | 与前端 xlsx 是不同层次的能力 |

运行时依赖：

- OfficeCLI 由 scripts/fetch-officecli.mjs 默认从 officecli/officecli-dist Release 获取，也可用 OFFICECLI_DESKTOP_BINARY 指定本地二进制。
- OfficeCLI 解析顺序：OFFICECLI_DESKTOP_BINARY → PATH 中的 officecli → 自动下载 runtime。
- PPT runtime 和 mop-convert 来自 presentation 仓库，由 scripts/stage-presentation-runtime.mjs staging。
- office2modoc.version 对应 officecli-internal/third_party/office2modoc-ffi/<version>/ 下的 checksum 校验过的 FFI。

不要把 package.json 中的前端依赖误认为完整运行时依赖。桌面包还需要 Go、Wails、OfficeCLI、PPT MOP/BOS runtime 和平台相关 FFI。

## 3. 目录结构

### 3.1 应用入口和构建配置

| 路径 | 职责 |
| --- | --- |
| main.go | Wails 进程入口；嵌入 dist/；配置窗口、资源服务器、文件拖放和 Go bindings |
| app.go | App 主对象和 Wails 暴露方法；组装 bridge、存储、预览、编辑器、登录、更新等服务 |
| app_*.go | 按功能拆分的 App 方法和测试，例如 PPT 编辑器、timeline、真实 E2E |
| go.mod / go.sum | Go 模块和版本锁定 |
| package.json / package-lock.json | Node 依赖以及开发、构建、测试脚本 |
| wails.json | Wails 前端目录、开发服务器和绑定输出配置 |
| vite.config.ts | Vite alias、SDK Sheet 资源路由、测试环境和构建输出 |
| tsconfig.json | TypeScript 严格检查及 @vo-ui/backend alias |
| office2modoc.version | office2modoc FFI 版本单一来源 |

### 3.2 前端 src/

~~~text
src/
├── renderer/
│   ├── App.tsx                    # 前端应用组装和全局状态入口
│   ├── bridge.ts                  # renderer-facing DesktopAPI；Wails 调用集中在此
│   ├── screens/                   # Home、Settings、Onboarding、Data 等页面
│   ├── components/                # Shell、Sidebar、任务、设置、诊断等通用组件
│   ├── document/                  # 文档工作区和文档级操作
│   ├── artifactStage/             # 生成产物的阶段化交互壳
│   ├── flatArtifactStage/         # 扁平产物阶段兼容层
│   ├── presentation/              # PPT 生产阶段、计划确认、引导和编辑器 frame
│   ├── preview/                   # DOCX/PPTX/XLSX/PDF/HTML viewer
│   ├── word/                      # DOCX 编辑、导入、导出和 block addressing
│   ├── spreadsheet/               # XLSX/Sheet session、业务 workflow 和 canvas
│   ├── appBuilder/                # Workbook App 构建、预览和发布
│   ├── ui/                        # 项目内 UI facade、组件、backend 和样式
│   ├── i18n/                      # 中文/英文文案和 locale 逻辑
│   └── styles/                    # shell、home、settings、tasks 等页面样式
└── shared/
    ├── types.ts                   # 前后端共享类型和协议数据结构
    ├── documentProtocol.ts        # 文档相关协议
    ├── presentationProtocol.ts   # 嵌入 PPT 消息协议
    ├── presentationPptxProtocol.ts
    ├── embedRequests.ts           # iframe/embed 请求协议
    └── slidePreviewWire.ts        # PPT 流式预览 wire shape
~~~

前端改动推荐顺序：

1. 页面和交互：从 src/renderer/screens/ 或 components/ 找实际页面。
2. 桌面能力调用：先看 src/renderer/bridge.ts，不要在组件内直接拼 window.go 调用。
3. 数据结构：先看 src/shared/types.ts，再看 app.go 和 internal/types。
4. PPT 嵌入通信：同时阅读 shared/presentationProtocol.ts、PresentationEditorFrame.tsx 和 presentation-component/。
5. UI 组件：优先从项目内 src/renderer/ui facade 导入，避免新增业务代码绑定具体 UI 后端。

### 3.3 Go 运行时 internal/

| 包 | 职责 |
| --- | --- |
| internal/bridge | officecli agent-bridge 生命周期、JSON-RPC 2.0、stdio framing、事件、重连和超时 |
| internal/types | 文档类型、任务事件、artifact、设置和运行时模型 |
| internal/localstore | SQLite 持久化：任务、事件、artifact、workspace、conversation、document/run projection |
| internal/settings | 用户设置读写、默认值和敏感字段处理 |
| internal/config | 进程工作目录、环境变量和可执行文件解析 |
| internal/binresolver | OfficeCLI 二进制解析和优先级 |
| internal/runtime | OfficeCLI runtime 检查、下载、安装和更新 |
| internal/login | login、whoami、logout、credit、invite |
| internal/netproxy | HTTP client 和子进程代理环境 |
| internal/preview | artifact preview token、可信根目录和文件读取边界 |
| internal/pptxeditor | PPT 准备、snapshot、asset、export 和并发清理 |
| internal/xlsxeditor | XLSX 准备、保存、图片 staging、managed sheets 和清理 |
| internal/office2modoc | Go 侧加载和调用 office2modoc FFI |
| internal/mophttp | MOP 本地资源和转换 HTTP handler |
| internal/timeline | PPT 时间线/节点持久化与 replay |
| internal/diagnostics | 日志、诊断 bundle、脱敏和问题报告 |
| internal/appupdate | OfficeDex 应用更新检查和安装 |
| internal/subprocess | 跨平台子进程、取消、PGID 和终止策略 |
| internal/providerprobe | LLM provider 连通性检测 |
| internal/demoflow | demo build tag 演示流程，不等于真实生成链路 |

### 3.4 脚本、测试和静态资源

- scripts/：下载 OfficeCLI、构建前端、嵌入 presentation、staging FFI、打包 runtime、校验 license/font/bridge/release 的脚本及测试。
- e2e/：Playwright 真实浏览器 E2E；入口是 scripts/run-real-e2e.mjs。
- presentation-component/：OfficeDex 的嵌入 PPT 前端 Vite 配置和适配层，不是完整 presentation 源仓库。
- public/：Vite/Wails 静态资源；public/presentation 是生成或同步的 PPT 资源。
- internal/*/*_test.go、src/**/*.test.*：Go 单测和 Vitest 组件/协议测试。
- docs/：项目文档和截图。
- build/、dist/、test-results/：本地产物或测试输出，通常不应提交。

## 4. 前后端通信和关键数据流

### 4.1 Wails bindings

Go 侧将 App 绑定给 Wails；前端虽然使用 generated/wailsjs/go/main/App 的自动生成声明，但业务调用统一经过 src/renderer/bridge.ts。bridge.ts 负责：

- 恢复 Wails 的 []byte/base64 结果；
- 兼容可选的较新 App 方法；
- 规范化 settings、credit、runtime 和 report 返回值；
- 订阅 bridge:event、auth:event 等 Wails 事件；
- 在浏览器开发模式切换到 bridge host transport。

典型调用链：

~~~text
internal service/type
        ↓
app.go / app_*.go Wails method
        ↓
generated Wails declaration
        ↓
src/renderer/bridge.ts DesktopAPI
        ↓
screen/component + test
~~~

### 4.2 OfficeCLI bridge

internal/bridge 管理一个或多个按工作目录区分的 officecli agent-bridge 子进程。协议是 JSON-RPC 2.0，使用 LSP 风格的 Content-Length + CRLF framing，通过 stdin/stdout 传输。

重要约束：

- task 生命周期属于 bridge 子进程；进程被错误替换或提前终止会产生 stranded task。
- App 按 workspace cwd 维护 bridge client，不能简化成一个全局进程。
- bridge 有 request timeout、task invoke timeout、PPT JS plan timeout 和自动重连；修改时要考虑取消和 shutdown。
- 事件异步写入 SQLite，避免阻塞 stdout reader；不要在高频事件 goroutine 内加入慢 IO。
- 协议版本由 internal/bridge/protocol.go 校验；新增方法或字段要考虑旧版 OfficeCLI。

### 4.3 生成任务

~~~text
Home / task UI
  → bridge.generate(input)
  → Wails App.Generate
  → resolve workspace + attachments + settings
  → ensure bridge for workspace cwd
  → JSON-RPC task/invoke
  → bridge:event stream
  → localstore task/events/artifact
  → renderer task state + preview
~~~

回答交互问题使用 Respond，取消任务使用 Cancel。不要只修改 UI loading 状态而不处理 bridge 事件和本地持久化，否则重启恢复、历史记录和诊断会不一致。

### 4.4 文档预览与编辑

- 预览由 Go 侧校验 artifact 和可信根目录后签发 preview token，前端 viewer 用 token 读取内容。
- DOCX：src/renderer/word 负责编辑和导入/导出，Go 侧 SaveDocx 负责保存边界。
- XLSX：src/renderer/spreadsheet 负责 canvas/session/workflow，internal/xlsxeditor 负责准备、保存、图片 staging 和 managed sheet。
- PPTX：src/renderer/presentation 负责阶段化 UI 和 embed 消息，internal/pptxeditor 负责 snapshot、asset 和导出；完整编辑器来自嵌入 presentation component。

### 4.5 PPT 构建和通信

默认 PPT 源是同级 ../presentation，不是 ../pptx。presentation-component/vite.config.ts 把 @presentation/* 和 @mop/runtime alias 到 presentation 源目录，再由构建脚本输出嵌入前端。

PPT 有两类协议：

- shared/presentationProtocol.ts：load、execute-script、swap、save snapshot、save asset、export 等编辑器消息。
- shared/presentationPptxProtocol.ts：PPTX embed URL、channel 和 session 参数。

修改 PPT 时至少验证：打开 → embed ready → 读写/执行 → dirty 状态 → 保存或导出 → 关闭清理。

## 5. 本地开发

### 5.1 前置条件

- Node.js、npm；
- Go 1.25.0；
- Wails v2 开发环境和平台 WebView 依赖；
- 可用 officecli：PATH、OFFICECLI_DESKTOP_BINARY，或可访问 Release 的网络；
- 修改/构建 PPT 需要同级 presentation checkout 及其 pnpm 依赖；
- 涉及 office2modoc 需要匹配 office2modoc.version 的 FFI。

网络较慢时，先检查超时、错误类型和是否可安全重放，再使用 127.0.0.1:7890 代理重试。

### 5.2 安装和启动

在 officedex/ 内：

~~~bash
npm install
npm run lint
~~~

单进程手动开发：

~~~bash
npm run dev
npm run dev:browser
~~~

在当前 vibe-officing 多 worktree/多 Agent 环境中，优先遵循父级 AGENTS.md，通过工作区提供的 ./scripts/devctl ensure --scope worktree（或明确的 shared scope）获取运行实例；如果当前 checkout 没有该脚本，应先定位工作区规定的 devctl 入口，不要退回到自行启动长期 dev 进程、抢端口或停止未知进程。E2E 前核对 runtime URL、实例、worktree、revision 和 dirty fingerprint。

### 5.3 OfficeCLI 选择

~~~bash
export OFFICECLI_DESKTOP_BINARY=/absolute/path/to/officecli
export OFFICECLI_DIST_REPO=officecli/officecli-dist
~~~

应用设置中的代理会通过 internal/netproxy 同时影响 HTTP client 和 bridge/login 子进程环境。遇到网络问题时，检查诊断面板、bridge 日志和实际 binary 路径。

## 6. 构建和 staging

常用命令：

~~~bash
npm run build:frontend:desktop
npm run build:local
npm run build:presentation
npm run dist:mac
npm run dist:win
~~~

脚本关系：

1. prefetch:officecli 准备 OfficeCLI。
2. build-embedded-presentation*.sh 调用 presentation 源码和 Vite，生成 public/presentation 或 staging 产物。
3. stage:presentation 准备 MOP/BOS/runtime。
4. stage:office2modoc 按 checksum staging FFI。
5. Wails 将 dist/ 嵌入 Go 二进制。
6. bundle-runtime、bundle-office2modoc、bundle-officecli 将运行时放进平台包。

桌面 PPT 构建设置 PRESENTATION_BUNDLE_WEB_FONTS=0，依赖宿主系统字体；构建脚本会拒绝同时存在 legacy dist/pptx 和新的 public/presentation，防止打包两个 PPT 编辑器。

指定其他 presentation checkout：

~~~bash
PRESENTATION_SOURCE_DIR=/absolute/path/to/presentation npm run build:presentation
~~~

该目录应包含 packages/presentation-app/src/main.ts、mop/runtime 和 bos/dist/mop-wasm/pkg。生成资源带有 source revision，不要手工改 manifest 掩盖版本不一致。

## 7. 测试和验收

建议按变更范围逐级执行：

~~~bash
npm run lint
npm test
npm run test:scripts
npm run test:go
npm run test:e2e
npm run test:all
~~~

针对性测试：

- bridge 或协议：npx vitest run src/renderer/bridge.test.ts；env -u GOROOT go test ./internal/bridge -count=1。
- PPT：npx vitest run src/renderer/presentation src/shared/presentation*；env -u GOROOT go test ./internal/pptxeditor -count=1。
- XLSX：env -u GOROOT go test ./internal/xlsxeditor -count=1，再运行对应 spreadsheet 测试。
- 脚本：优先运行对应的 node --test scripts/<name>.test.mjs。
- UI 回归：走实际点击、输入、保存/关闭路径并检查真实 viewport；静态测试不足以证明交互正确。

真实生成 E2E 会消耗 OfficeCLI/模型资源，相关测试有显式环境变量门控。确认账号、binary、输出目录和资源消耗后再启用。

交付前：

~~~bash
git status --short --branch
git diff --check
git diff --stat
~~~

报告测试结果时区分本次改动、基线已有失败、缺失资源、网络/环境问题和未接通的真实外部依赖。

## 8. 不同功能的入口

| 需求 | 首先阅读 | 继续追踪 |
| --- | --- | --- |
| 首页、任务、设置 UI | src/renderer/App.tsx、screens/、components/ | bridge.ts、对应 app.go 方法、测试 |
| 生成任务/流式事件 | src/renderer/taskState.ts、bridge.ts | app.go、internal/bridge、internal/localstore |
| LLM/provider/登录 | ProviderForm.tsx、useSettings.ts | internal/login、providerprobe、settings |
| DOCX 编辑或预览 | renderer/word/、DocxViewer.tsx | SaveDocx、internal/preview |
| XLSX 编辑/workflow | renderer/spreadsheet/ | internal/xlsxeditor、internal/office2modoc、Sheet SDK |
| PPT 计划/编辑/导出 | renderer/presentation/、PresentationEditorFrame.tsx | shared/presentation*.ts、internal/pptxeditor、presentation-component、../presentation |
| 本地数据/重启恢复 | internal/localstore/、internal/timeline/ | internal/types、恢复测试 |
| runtime 下载/更新 | internal/runtime/、fetch-officecli.mjs | internal/binresolver、app.go、diagnostics |
| 打包或签名 | package.json、scripts/build*.sh | scripts/bundle*.mjs、wails.json、平台脚本 |
| UI 组件迁移 | renderer/ui/ | tsconfig alias、上级 UI 迁移规则、组件测试 |

## 9. 常见陷阱

1. 父目录 vibe-officing 是多仓库容器，Git 操作必须在 officedex 或目标 sibling repo 内执行。
2. 介入前确认 branch、git rev-parse develop/1.0 和 dirty 状态；本地可能处于功能分支但与基线同一个 commit。
3. public/presentation、dist、build 可能被脚本覆盖，应改源仓库或 staging 脚本。
4. 当前默认 PPT 来源是 presentation，不要把 ../pptx 当成默认来源。
5. Wails 方法、generated bindings、bridge.ts、共享类型和调用方通常需要一起检查。
6. bridge、预览、PPT embed、文件保存和多视口 UI 不能只靠单测证明。
7. 不要替换忙碌的 bridge；进程承载 task 状态，必须遵循 internal/bridge 的 client pool 设计。
8. internal/demoflow 只服务 demo build tag，不能代表真实生成链路。
9. 不要默认 push、发布、生产部署、发送消息、消耗真实 credit 或删除用户数据。

## 10. 推荐接手流程

~~~text
确认 officedex 仓库和 develop/1.0 基线
        ↓
检查 dirty state、Node/Go/Wails、OfficeCLI 和 sibling repos
        ↓
阅读本指南 + AGENTS.md + src/shell/tokens.css + README.md
        ↓
从 bridge.ts / App method / internal service 找到完整链路
        ↓
先跑针对性测试，再做可回滚的实现
        ↓
按风险补充真实运行、文件保存、PPT/XLSX 或多视口验收
        ↓
检查 diff、测试分类、未验证项和依赖源码 revision
~~~

如果改动跨越 officedex、presentation、officecli-internal 或 officecli，在提交说明中明确列出每个仓库的 branch、commit、dirty 状态以及是否只修改了生成物，便于区分源码未同步、生成资源未更新和运行时版本不匹配。

## 11. 可直接交给同事 Codex 的接管 Prompt

下面的 Prompt 用于让另一位开发者的 Codex 在本地准备完整的 OfficeDex 开发环境。它会先检查目录和工作区，再拉取/更新必要仓库，最后给出 App 编译结果。Prompt 不会自动 reset、stash、覆盖未提交修改、push 或部署。

~~~text
你现在负责接管 OfficeDex 的本地开发环境。请严格按下面的仓库布局和分支要求执行，并在最后告诉我实际使用的 commit、工作区状态和 OfficeDex.app 编译命令/结果。

一、工作区布局

工作区根目录：/Users/luyang/Workspace/shimo/vibe-officing/

需要拉取或核对的关联仓库：

1. /Users/luyang/Workspace/shimo/vibe-officing/officedex
   remote: git@github.com:officecli/officedex.git
   branch: develop/1.0
   这是 Wails + React + Go 主仓库。

2. /Users/luyang/Workspace/shimo/vibe-officing/officecli-internal
   remote: git@github.com:officecli/officecli-internal.git
   branch: develop/1.0
   这是 OfficeCLI 源码和内嵌 MOP worker 的来源；本地 App 编译会从这里重编 officecli。

3. /Users/luyang/Workspace/shimo/vibe-officing/presentation
   remote: git@fegit.shimo.im:presentation/presentation.git
   branch: ci/officedex-dist-pipeline
   这是当前 OfficeDex 默认嵌入 PPT 编辑器的源码。该仓库当前使用 ci/officedex-dist-pipeline，不要自行切换到不存在或未经确认的 develop/1.0。

下面两个仓库不是本次 App 编译的直接输入，但如果目录布局要求完整，应一并拉取并切到指定分支；不要为了本次 App 编译擅自修改其源码：

4. /Users/luyang/Workspace/shimo/vibe-officing/officecli
   remote: https://github.com/officecli/officecli.git
   branch: main
   只有要修改公共 OfficeCLI 源码时才需要；本次 OfficeDex.app 编译不以它作为 officecli 构建输入。

5. /Users/luyang/Workspace/shimo/vibe-officing/office2modoc-ffi
   remote: git@git.shimo.im:office-ot/office2modoc-ffi.git
   branch: master
   只有要重新构建 office2modoc FFI 时才需要；本次默认从 officecli-internal 的 third_party/office2modoc-ffi 使用已固定版本。

二、操作安全规则

- 先检查工作区是否已经存在，以及每个仓库的 remote、当前 branch、HEAD 和 dirty 状态。
- 如果目录不存在，可以 clone；如果目录存在，只能 fetch 和安全切换。
- 切换分支前必须检查工作区是否干净。存在未提交修改时，不要 reset、checkout --、stash、clean 或覆盖文件；停下来报告仓库路径、当前分支和 dirty 文件。
- 不要删除 build、dist、node_modules、用户数据或测试结果来“解决”问题。
- 不要 push、merge、rebase、部署、提交表单或发送消息。
- 网络明显过慢时，先判断是否超时、认证失败、权限不足或不可安全重放；对 npm、brew、docker 和 Git 网络请求按工作区规则优先使用 127.0.0.1:7890 代理。
- Git 操作必须在对应仓库目录中执行，不能在父目录 /Users/luyang/Workspace/shimo/vibe-officing 执行 git status 来判断某个仓库状态。

三、准备仓库

对上面列出的每个仓库执行等价的安全流程：

- 确认 remote 与上面的值一致；不一致先报告，不要擅自改 remote。
- fetch 对应 remote 的目标分支。
- 如果目标分支已存在且工作区干净，切换到目标分支；如果本地没有目标分支，基于对应 origin 分支创建 tracking branch。
- 切换成功后，只在当前分支未分叉且工作区干净时使用 fast-forward 更新到 origin 的同名分支。
- 记录：仓库绝对路径、branch、HEAD 完整 SHA、是否 ahead/behind/diverged、是否 dirty。

等价命令示例（不要盲目执行，先完成上面的安全检查）：

  git -C /Users/luyang/Workspace/shimo/vibe-officing/officedex fetch origin develop/1.0
  git -C /Users/luyang/Workspace/shimo/vibe-officing/officedex switch develop/1.0
  git -C /Users/luyang/Workspace/shimo/vibe-officing/officedex merge --ff-only origin/develop/1.0

  git -C /Users/luyang/Workspace/shimo/vibe-officing/officecli-internal fetch origin develop/1.0
  git -C /Users/luyang/Workspace/shimo/vibe-officing/officecli-internal switch develop/1.0
  git -C /Users/luyang/Workspace/shimo/vibe-officing/officecli-internal merge --ff-only origin/develop/1.0

  git -C /Users/luyang/Workspace/shimo/vibe-officing/presentation fetch origin ci/officedex-dist-pipeline
  git -C /Users/luyang/Workspace/shimo/vibe-officing/presentation switch ci/officedex-dist-pipeline
  git -C /Users/luyang/Workspace/shimo/vibe-officing/presentation merge --ff-only origin/ci/officedex-dist-pipeline

如果任意仓库无法安全切换或 fast-forward，停止修改并报告原因，不要用 reset 或强制覆盖解决。

四、安装依赖

在 officedex 中执行 npm install。
在 presentation 中根据其锁文件使用 pnpm install；如果是 pnpm workspace，不要改用 npm install 破坏 workspace:* 依赖。
确认 Go 版本满足 officedex/go.mod 的要求（当前为 Go 1.25.0），并确认 wails CLI 可用。
如果已经有可用的 officecli，可设置 OFFICECLI_DESKTOP_BINARY；否则让 officedex 的 prefetch 流程按项目配置准备 runtime。

五、编译未签名的本地 OfficeDex.app

先确认没有正在运行的 OfficeDex.app，也确认没有其他构建占用同一 build 目录。然后执行：

  cd /Users/luyang/Workspace/shimo/vibe-officing/officedex
  npm run build:local:latest

该命令会从同级 officecli-internal 构建 officecli，使用同级 presentation 构建/嵌入 PPT 前端，staging office2modoc 和 license，并生成：

  /Users/luyang/Workspace/shimo/vibe-officing/officedex/build/bin/OfficeDex.app

如果只需要标准前端构建而不需要 local-latest 的 officecli 重编，可在确认运行时已就绪后使用：

  cd /Users/luyang/Workspace/shimo/vibe-officing/officedex
  npm run build:local

但不要把 build:local 的结果误报为已从 officecli-internal 最新 develop/1.0 重编的版本。

六、如果用户明确要求签名/公证包

只有在用户明确要求分发包、签名、公证或 DMG 时，才执行：

  cd /Users/luyang/Workspace/shimo/vibe-officing/officedex
  bash scripts/build-mac-dmg.sh

该命令需要 macOS、Developer ID 和公证凭据，产物是 dist-artifacts/OfficeDex-<version>-darwin-<arch>.dmg，不只是 .app。不要读取、打印、上传或提交 ~/.officedex-signing/ 中的密钥内容；不要为了绕过失败而关闭安全校验。

七、最后报告

报告以下内容：

- 五个关联仓库的实际路径、branch、HEAD SHA、dirty 状态和是否与 origin 对齐；
- npm/pnpm/Go/Wails/OfficeCLI 依赖是否就绪；
- 执行过的准确编译命令；
- OfficeDex.app 的实际路径、是否生成、文件大小；
- 通过/失败/未验证的检查项；
- 如果失败，区分代码错误、分支/工作区问题、缺失资源、网络问题和外部权限问题。

不要声称“已完成”或“可发布”，除非对应产物和验证证据都存在。
~~~
