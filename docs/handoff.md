# OfficeDex 新 IA 重构 — 接手 prompt

把这份完整交给接手的 agent。它假设你没有任何前置对话记忆。

---

## 0. 你接手的是什么

**仓库**：`/Users/luyang/Workspace/shimo/vibe-officing/officedex`
**技术栈**：Wails v2 桌面应用 = Go 后端 + React/TypeScript 前端
**任务**：把这个应用的 UI/UX 完全重构成一套新的信息架构（IA），功能不变。

工作树里目前**有两套 UI 并存**：

| | 旧 UI | 新 UI |
|---|---|---|
| 入口 | `index.html` → `src/renderer/App.tsx` | `shell.html` → `src/shell/main.tsx` |
| 状态 | **已冻结，不要改** | 在建，43 个文件 / 约 7150 行 |
| 规模 | App.tsx + `screens/` + 10 个 controller | 完整界面已画完，功能在逐个接 |

两套共用同一个 Go 后端和同一个传输层（`src/renderer/bridge/`）。
`vite.config.ts` 是多入口，两个 html 都会进构建。

**重构最终会删掉旧 UI**（见 S5），但现在还不能删。

---

## 1. 架构（这是整件事的骨架，先看懂这张图）

```
src/shell/**              UI 层：只认 UiPort，不知道桌面端存在
        ↑ UiPort ← 唯一契约，在 src/shared/uiPort.ts
src/services/**           六个 service，直接实现 UiPort（没有适配层）
        ↑ DesktopAPI（123 个方法，在 `src/shared/types.ts`；另有 `DesktopVerticalAPI` 8 个在 `src/shared/verticals.ts`）
src/renderer/bridge/**    传输层：wails / realE2E / browserPreview 三个实现
        ↑ JSON-RPC
Go：app_*.go + internal/localstore（schemaV11 文档投影）
```

**关键设计决定（已拍板，不要推翻）**：

1. **`UiPort` 是唯一契约。** 33 个方法，分六个 Port：`folders`(4) / `files`(10) /
   `agent`(8) / `models`(4) / `settings`(2) / `window`(5)。它**故意不复用**
   `DesktopAPI`——那个 123 方法的接口是被旧 IA 塑形的。
2. **服务层直接实现 UiPort，不写适配器。** 上一期抽出的 10 个 controller 是按旧 IA
   领域划分的，继续用它们喂 shell 等于长期维护两套领域模型加一层翻译。
3. **一套契约，两个实现，都要绿。** `src/services/test/uiPortContract.ts` 是共享契约
   测试，由 in-memory fake（`src/shell/port/fake/createFakePort.ts`）和真 service
   （`src/services/createDesktopUiPort.ts`）各跑一遍。
   **两者分歧时 fake 赢**——UI 是照着 fake 写的，差异是 service 的缺陷。
4. **文件操作是真实文件系统操作。** `Folder.path` 是磁盘绝对路径，用户在 Finder 里
   看到的必须和应用里一致。rename 真的重命名文件，move 真的移动。
5. **document id 必须跨 rename/move 稳定。** 见 `documentIDForPathTx`
   （`internal/localstore/store.go`）。id 曾经是路径的纯函数，改名就产生一个不同的
   document，UI 手上所有引用全部指向不存在的东西。

---

## 2. 工作原则（用户 2026-09-18 明确拍板，优先级最高）

> 1. **UI 服从 UI 层的实现** —— 界面不因为功能缺失而改动，按钮留在设计放它的位置。
> 2. **功能服从服务层的实现** —— 服务层有多少能力就是多少，不假装。
> 3. **有 UI 但功能未实现 → 先做 UI，点击时提示「尚未实现」**，不阻塞整体进度。

第三条隐含的反面才是要点：**一个点了没反应的按钮，用户分不清是功能没做、还是自己的
文件坏了。沉默是三种结局里最差的。**

落地成两套机制 + 一条闸门：

- 服务层抛 `NotImplementedError`（`src/shared/notImplemented.ts`，带 `feature` key），
  shell 侧 `src/shell/port/reportPortFailure.ts` 分流：
  缺功能 → toast "Not built yet"（warning），真失败 → "That did not work"（error）。
- 完全没有 `UiPort` 方法可调的控件 → 直接调同文件的 `notBuiltYet(feature, message)`。
- 闸门 `src/shell/test/deadControls.test.ts`：静态扫描 `src/shell` 所有 `<button>`，
  没有 handler 的一律报错。**这条不许放行。**

台账：**`docs/not-implemented.md`**。每个 feature key 一条，写清缺什么、归属哪个阶段。
你实现了其中一条，就把它移到文件末尾的「已经接上」一节。

---

## 3. 进度

原计划分 S0–S5（完整 plan 在 `/Users/luyang/.claude/plans/delegated-dancing-unicorn.md`）。

| 阶段 | 内容 | 状态 |
|---|---|---|
| S0 | 功能取舍评审 → `docs/uiport-scope.md` | ✅ |
| S1 | Go 后端补齐：文档投影 RPC、pinned 列、默认文件夹、真实文件操作 | ✅ |
| S2 | 六个 service 实现 UiPort | ✅（`files.create` 除外） |
| S3 | 垂直切片：shell.html 跑通真 service | ✅ |
| S4-1 | agent service 的非 suggestion 部分 | ✅ |
| S4-2 | `applySuggestion` / `undoSuggestion` | ❌ 见 §5 |
| S5 | 删除旧入口 | ❌ 未开始 |

**已提交的 commit**（基线 `9c547b5`）：
```
9c547b5 feat(agent): agent service 的非 suggestion 部分（S4-1）
e510aa4 feat(shell): 接上真 service，shell.html 进构建（S3）
6dc2215 feat(services): 服务层直接实现 UiPort（S2）
```

**工作树里有一批未提交的改动**，是最近两轮做的（详见 §4）。用户没有要求提交，
所以我没有提交。**提交时必须显式列文件，绝对不要 `git add -A`**（见 §7 陷阱）。

---

## 4. 最近两轮做了什么（未提交）

### 第一轮：让所有死控件开口说话

审计发现 shell 里 **14 个按钮完全没有 handler**，点了什么都不发生：
Share、设置齿轮、侧栏头像、状态栏两个缩放、麦克风、Ribbon **所有**工具按钮、
Home 的「Open from this computer」。另外 Home 上三个「Blank document/workbook/
presentation」会被服务层拒绝，但错误进了未捕获的 promise，用户同样看不到。

还发现 `useAgentTask` 把 `kind: "error"` 事件直接丢了——**run 失败用户根本不知道**。

做了：
- 新建 `src/shared/notImplemented.ts` + `src/shell/port/reportPortFailure.ts`
- 14 个按钮全部接上（其中「Full screen」其实 `port.window.toggleFullscreen()` 早有
  实现，只是没接——那个**接实现，不是提示**）
- `agent.send` 丢掉的 mentions/attachments/permission，改走新增的
  `AgentEvent` 的 `{ kind: "notice" }` 分支，用户看得见
- 新建闸门 `deadControls.test.ts`
- 新建台账 `docs/not-implemented.md`

### 第二轮：接上 open-local-file

**这里有个非显然的坑，接手前必须理解**：`OpenRecentFile` 只写 `recent_files` 表，
而新 IA 的文件列表读的是 **documents 投影**。两张表之间没有桥。所以「打开本地文件」
按原来的实现接上按钮，文件会「被记为最近打开、却在列表里根本不出现」。

做了：
- Go：`internal/localstore/store.go` 新增 `RegisterLocalDocument`（一个事务里同时写
  `artifacts` 和 `documents`，走 `documentIDForPathTx` 所以幂等）
- Go：新建 `app_local_files.go` = `OpenLocalFile()` + `ImportLocalFile(path)`，
  7 条测试在 `app_local_files_test.go`
- `DesktopAPI.openLocalFile()` + 三个 bridge 传输各实现一处 + 重新生成 Wails 绑定
- `UiPort.FilePort.openFromDisk()` + service 实现 + fake 实现 + 共享契约断言
  （契约套件新增了 `armFilePicker` 钩子，因为「选择器返回什么」是两边唯一无法共享的
  驱动方式，断言本身共享）
- 接上 Home 的按钮，以及**侧栏 Editor 模式的 "Open"**

三条产品决定（写在 `app_local_files.go` 的注释里）：
1. **文件不复制也不移动**，document 指向用户原本存放的位置
2. **落在默认文件夹**，不是当前作用域的文件夹（外部文件不在应用任何目录里，声称它在
   某个文件夹里，第一次 move 就穿帮）
3. **类型白名单收窄到 docx/xlsx/pptx**，不用 Go 现成的 `IsPreviewable`（那个含 PDF
   和图片，而文件列表会过滤掉它们——注册一个然后让它凭空消失，比直接拒绝更糟）

**顺带修掉的闸门漏洞**：`deadControls` 扫 `<button>` 标签，看不见渲染 button 的组件。
侧栏 "New"/"Open" 是 `<SidebarButton>` 且 `onClick` 是可选的，两处都没传 → 漏网。
修法不是把扫描器写聪明，而是**把 `SidebarButton.onClick` 改成必填**，让编译器管文本
扫描看不见的东西。已排查 shell 里所有可选 handler prop，只有这一处是真死的。

---

## 5. 最大的未决问题：`AgentSuggestion`

新 IA 的任务面板有一张卡片（"Review and apply" / "Undo"），假设的流程是
「AI 算完 → 先不动文件 → 用户点了才改 → 可撤销」。**桌面端三种类型都不是这么工作的**：

| 类型 | agent 怎么改文档 | 有可以停下的位置吗 | 可逆吗 |
|---|---|---|---|
| docx | run 完成后返回 `{summary, edits[]}`，渲染层紧接着 `editor.apply()` + `editor.save()`（`src/renderer/word/DocxAgentPanel.tsx:65-73`） | **结构上已经有**，代码只是没停 | 部分：`editor.capture()` 手上有改前全文 |
| xlsx | client tools `workbook.write_cells`/`format_cells`/`add_chart` 在 run **进行中**逐个调用，每次立即改活表格 | 没有 | 不可逆，没记录改前的值 |
| pptx | 渐进式管线一页页直接写进文件 | 只有写之前的 `task.plan` 大纲闸门 | 不可逆 |

**关键事实：整个桌面端没有任何回滚原语。** 三个编辑器（writer / sdk-sheet /
presentation）都没暴露 undo 协议，`DesktopAPI` 里也没有版本或快照恢复。

**按 §2 的原则，这件事已经不阻塞进度**：两个方法抛 `NotImplementedError`，按钮留着并
提示。要与 runtime 侧对齐的四个问题整理在 **`docs/suggestion-alignment.md`**。
另有一个待确认：`PermissionMode` 的 `review`/`full` 大概就是 suggestion 的产品外壳，
若成立则 xlsx/pptx 的状态是「只支持 full 模式」而非「功能没做完」。

---

## 6. 接下来可以做什么（按性价比排序，用户没有指定顺序）

1. **`files.create`** —— Home 上三个最显眼的按钮。缺两样：空白 docx/xlsx 种子文件
   （现在只有 `blank.pptx`），以及一个产品决定：新文件什么时候真正落盘。
   Office 在首次保存前不写任何东西，`FileMeta.dirty` 正好能表达这个状态。
   **这个需要先问用户拿决定。**
2. **S5 退役旧 UI** —— 删 `src/renderer/App.tsx`、`screens/`、10 个 controller、
   旧 `index.html`；并把 `docs/interaction-rules.md` 的 78 条规则逐条标注归宿
   （仍成立 / 已废弃 / 已迁移到某 service）。判据：`grep -rn "renderer/App" src/` 为空。
   注意：`taskState.ts`/`taskTitle.ts`/`homeIntake.ts`/`bridge/` 都在 `src/renderer/`
   下但**不是渲染层代码**，service 在用，退役时要搬走不要删。
3. **台账里剩下的 9 项**（`docs/not-implemented.md` 第三节）—— 大多需要产品决定，
   不是纯工程问题。
4. **S4-2 suggestion** —— 需要 runtime 侧先回答 `docs/suggestion-alignment.md` 的四问。
5. **`--od-*` token 碰撞** —— 已 ratchet 住，留给视觉改版一起做。

---

## 7. 陷阱清单（每一条都是真摔过的）

**验证纪律**
- **`npm run lint` 就是 `tsc --noEmit`，这个仓库没有 ESLint。** tsc 基线是干净的，
  可以当闸门（注意：隔壁 pptx 仓库相反，那边基线有上万个错，不能当闸门）。
- **跑测试不要 `| head`**。`head` 会截断 FAIL 行，而 `$?` 拿到的是 head 的退出码——
  我因此两次错误宣称「全绿」。用 `set -o pipefail` 并看完整输出。
- **Go 有 4 个历史遗留失败**：`TestRespondRecoverStalePlanQuestionTask`、
  `TestRespondRecoveryUsesLivePendingQuestionID`、`TestRespondRecoveryReplaysFullAnswerHistory`、
  `TestRespondRecoverySkipsStalePerNodeFeedback`。**用户明确说过不要修**
  （「历史遗留问题，重构期间的阵痛」）。其余 33 个包应为 ok。
- **每阶段结束实际点一遍，不只依赖测试。**

**浏览器预览**
- 预览用 `preview_start`（配置名 `officedex-develop-1.0`，端口 3104），进去后要手动
  导航到 `/shell.html`。
- **dev server 的模块可能是陈旧的**：改完代码第一次点，handler 可能还是旧的，
  **硬刷一次再判断**。我差点把这个误判成 bug。
- toast 是 portal 到 `document.body` 的，断言要读 body 不是 render container；
  默认 3 秒淡出，截图往往赶不上，需要视觉确认时用 `duration: null` 定住。

**工具**
- **macOS 的 `sed` 不支持 `\b`**，用了会静默不替换。
- **`sed` 批量替换会伤到无辜字符串**：`s/officecli\./api./g` 把 `https://officecli.io`
  改成了 `https://api.io`。批量替换后必须逐条审 diff。
- **`wails generate module` 会以 exit code 2 结束但其实成功了**（尾部是赞助信息）。
  看产物 `src/renderer/generated/wailsjs/go/main/App.d.ts` 判断，别看退出码。
- **改了 `DesktopAPI` 一定要重新生成 Wails 绑定**，否则 `WailsApp.Xxx` 不存在。
  改完跑 `node scripts/verify-bridge-types.mjs`。
- 用正则扫 JSX 的 `<button ...>` 会被 `=>` 里的 `>` 截断；而且要先剥注释，否则注释里
  写的 `<button>` 会被当成真标签。两个坑我都踩过，修法在 `deadControls.test.ts`。

**git**
- **工作树里有另一个 session 的改动，不要碰、不要提交**：
  `demo/pptx-template-lab/`、`internal/pptxtemplate/slots.go`、
  `scripts/build-embedded-presentation.sh`。
- **绝对不要 `git add -A`。** 曾经因此把另一个 session 的未跟踪文件卷进三个 commit，
  后来不得不 revert。提交时显式列文件。
- 未经用户要求不要提交、不要 push。

**测试约定**
- vitest 配的是 `globals: false`，需要显式 `cleanup()`。
- `src/renderer/ui` 是可安全复用的组件库（shell 已经在用它的 `ToastHost` / `Select` /
  `Modal`）。
- `src/services/test/fakeDesktopApi.ts` 用 Proxy 让**未实现的方法抛错**而不是返回
  假数据——这是刻意设计，它会在你给 service 加新依赖时立刻叫出来。

**其它**
- **做任何 UI 工作前必须先读根目录的 `DESIGN.md`**（`CLAUDE.md` 的硬性要求）。
- **用中文回复用户**，代码/标识符/日志保持英文。

---

## 8. 验证命令

```bash
npm run lint                      # tsc --noEmit，基线干净
npx vitest run                    # 应为 160 files / 1103 tests 全绿
go test ./... -count=1            # 33 个包 ok + 4 个已知失败（不要修）
npx vite build                    # 双入口构建
node scripts/verify-bridge-types.mjs   # 改过 DesktopAPI 才需要
```

关键闸门测试（改动后重点看这几个）：
- `src/renderer/test/rpcReachability.test.ts` —— 每个 RPC 都要有调用点。
  `UNWIRED` 是 ratchet，**只许变小**（当前 14）；`PENDING_CONSUMER` 不 ratchet
  （当前 3，是在建状态）。
- `src/renderer/test/architecture.test.ts` —— 5 条分层闸门。
- `src/shell/test/deadControls.test.ts` —— 没有死按钮。
- `src/services/test/uiPortContract.ts` —— 共享契约，两个实现都跑。

---

## 9. 关键文件索引

| 文件 | 是什么 |
|---|---|
| `src/shared/uiPort.ts` | **唯一契约**。改它之前先想清楚，改完两边都要跟 |
| `src/shared/types.ts` | `DesktopAPI`，123 个方法 |
| `src/shared/notImplemented.ts` | `NotImplementedError` |
| `src/services/createDesktopUiPort.ts` | 六个 service 的组装点，头部写了「分歧时 fake 赢」 |
| `src/shell/port/createShellPort.ts` | 桌面 → 真 service，其它 → fake |
| `src/shell/port/reportPortFailure.ts` | 所有「说不出话」的统一出口 |
| `docs/interaction-rules.md` | 从旧 UI 抠出来的 78 条隐式交互规则，S5 要逐条标注归宿 |
| `docs/uiport-scope.md` | S0 的功能取舍决定表 |
| `docs/not-implemented.md` | **未实现台账**，做完一条就搬到「已经接上」 |
| `docs/suggestion-alignment.md` | 与 runtime 侧对齐 suggestion 的四个问题 |
| `/Users/luyang/.claude/plans/delegated-dancing-unicorn.md` | S0–S5 完整 plan |

---

## 10. 开工前先做的三件事

1. `git status` 确认工作树状态，认清哪些改动**不是你的**（§7 git 一节）。
2. 跑一遍 §8 的四条命令，确认基线：1103 TS 测试绿、Go 4 个已知失败。
3. 读 `docs/not-implemented.md` 和 `DESIGN.md`。

然后问用户要做哪一项——§6 列了五个方向，其中 `files.create` 需要产品决定才能动。
