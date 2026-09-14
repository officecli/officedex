# PPTX 生成失败态：根因与根治方案

> 本文取代 `pptx-failure-state-ux-plan.md`。那一版把失败态当成渲染层问题，给了"没有 checkpoint 时退化为打开残稿"这类权宜之计 —— 方向错了：**失败态之所以乱且缺功能，是因为模型层没有"部分产物"这个概念、恢复层没有渲染维度的 checkpoint、协议层拿英文散文当错误类型。** 不修这三条，任何 UI 重排都只是把症状摆整齐。

---

## 1. 根因

### R1 「残稿」被建模成预览态，而不是任务产物

失败时残稿**确实存在且已落盘**，证据链完整：

- 绘制器在发出失败终态**之前**先存盘：`vibeReplay.ts:1351` `await this.controller.save()` → `:1357` 才 `emit({ state: "failed" })`。
- 绘制期桌面已经创建了 live draft 并签发了预览令牌：`App.tsx:1436-1452`（`createLivePptxDraft` + `issuePreviewToken` + `setPreviewArtifact`）。
- 失败**不会**清掉它：只有 `closeInlinePreview`（`App.tsx:1333`）会 `setPreviewArtifact(null)`。

但模型层看不见它：

- `task.artifact` **只在 `task.completed` 赋值**：`taskState.ts:239-243`。
- `task.failed` 只写 `error`：`taskState.ts:249`。

于是残稿只活在 `previewArtifact` 这个**预览态**的 React state 里，而所有按"任务产物"取数的消费端全部失明：

```
无 task.artifact
  → onOpenEditor = undefined        (App.tsx:1908 三元判 documentTask.artifact)
  → findModifySourceTask 找不到本任务 (App.tsx:194，要求 task.artifact.filePath)
  → continueModify 抛 "No source document to modify" (App.tsx:1075/1077，且是未本地化英文)
```

**这一条同时解释了"打不开已生成的部分"和"composer 是死控件"** —— 不是按钮条件写错了，是模型缺概念。更糟的是 `findModifySourceTask` 取的是**会话里最新的带 artifact 的任务**：若同一会话有更早成功的 deck，失败态里输入修改指令会**静默改那一份**。

> 补充：并发 session 刚把 `onSteer` 改成 `steerPptxTask`（`App.tsx:1196`），区分了 live 走 `intervenePptx`、终态走 `continueModify`，并把 placeholder 按终态换了文案（`PptxProductionStage.tsx:107-109`）。但终态分支仍然落到 `continueModify` → 上面这条链一步没动，所以 composer 依旧不可用，只是提示词变诚实了。

### R2 渲染阶段的 checkpoint 被算出来了，却恰好在需要它的时刻没落盘

**设计上本来就打算支持部分重跑** —— `PPTXMOPManifest.LastOpSeq` 的字段注释原文：

```go
// LastOpSeq is the highest drawing-op sequence the run emitted; partial
// re-renders continue numbering from here.
LastOpSeq int `json:"lastOpSeq"`        // pptx_mop_manifest.go:42-44
```

这个值也确实被算出来了：`pptxMOPTrackLastOpSeq(options.MOPOpsSink)`（`pptx_progressive_stream.go:132`）。但它只写在**成功路径**：

- `pptx_progressive_stream.go:394` —— 在 `worker.Wait()` 成功之后才 `writePPTXMOPManifest(...)`
- `pptx_mop_skill.go:389` —— 一次性渲染路径同理

而三条失败分支**在写 manifest 之前就 return 了**：`:342`、`:353`、`:364`（都是 `if options.MOPOpsSink != nil && lastOpSeq() > 0` → 构造 `refusing duplicate rendering` 错误返回）。

恢复协议也只有内容一个维度：`loadPPTXResume` 硬校验文件名必须是 `expansion-state.json`、目录必须 `officecli-expansion-*`（`pptx_resume.go:37`），内容阶段的 checkpoint 由 `pptx_expansion_recovery.go:351-353` 发出。**渲染阶段没有对应物。**

结论：截图这类失败永远拿不到 checkpoint，只能全量重跑 —— 不是前端没渲染那个按钮，是后端这个状态下压根没有可续跑的 token。

### R3 失败被归错了阶段，且用英文散文当错误类型

截图那串错误的真实构成：

| 片段 | 出处 | 实际含义 |
|---|---|---|
| `content generation failed:` | `service.go:1051` | **内容**生成分支的 wrap |
| `PPTX expansion is incomplete; retained completed pages` | `pptx_expansion_result.go:10` | **内容**阶段的 sentinel |
| `streaming output already emitted; refusing duplicate rendering` | `pptx_progressive_stream.go:346` | **渲染**阶段的实际故障 |

即：**渲染失败借用了内容阶段的 sentinel 上报，又被内容阶段的 wrap 包了一层。** wire 上没有 `stage`/`reason` 结构，UI 只能拿到一段英文散文。

这不是孤立现象，协议层已经在用字符串匹配当分类器：

```go
case strings.Contains(message, "content generation failed"),
     strings.Contains(message, "llm request failed"),
     strings.Contains(message, "internal llm request failed"):   // agent_bridge.go:1914
```

后果：前端只能靠正则猜错误类别（这正是我上一版方案里 `pptxFailureCopy.ts` 那种"桶"的设计来源），文案必然错，且每改一次英文措辞就会静默失配。**上一版的猜桶设计在这里被否决。**

### R4 同一阶段有两个所有者

`ProgressivePptxStage.tsx:409` 渲染 `<PptxProductionStage compact>`，而后者自己又持有错误条（`:148`）、重试按钮（`:155`）和指令条里的重试（`:158`）；`StageIntentBar.tsx:36` 还独立持有第三个重试入口；`App.tsx:1900` 把 `onRetry` 同时喂给它们。

**"两个 Retry"不是样式问题，是所有权问题：谁都能画按钮，于是画了两个，并且都与"续跑"无关。**

### R5 终态缺不变量

- `data-phase="failed"` 钩子已写在根节点（`ProgressivePptxStage.tsx:369`），但 `progressivePptxStage.css` 里**一条 `[data-phase="failed"]` 规则都没有**，时间线节点退回灰色数字。
- `showGeneration` 把 failed 也当"生成中"（`:302`），于是 `Follow latest`（`:418`）和 composer（`PptxProductionStage.tsx:158`）在终态照常出现。

---

## 2. 根治方案

四条主线，**没有一条是过渡措施**；顺序由依赖决定，不是"先做容易的"。

### 主线 A（模型层）—— 把"部分产物"变成一等公民

**A1. 区分完整产物与部分产物，语义上不混用。**

```ts
// src/shared/types.ts
interface DesktopTask {
  artifact?: Artifact;          // 完整产物，语义不变
  partialArtifact?: Artifact;   // 新增：已落盘的残稿
  partial?: {                   // 新增：残稿的结构化事实
    drawnPages: number;
    totalPages?: number;
    failedPages: number[];
  };
}
```

**A2. 在失败点填充，而不是在预览态里漂着。** `taskState.ts:249` 的 `task.failed` 分支持续复用同一个 `artifactFromPayload` 语义（`taskState.ts:584`）填 `partialArtifact`；桥接侧 `task.failed` 事件带上残稿的 `file_path` / `file_name` / `document_type` 与页数事实。绘制期桌面已持有 draft 路径（`App.tsx:1447-1452`），必要时由桌面在失败时补齐，**但必须落到任务模型，而不是留在 `previewArtifact`**。

**A3. 消费端统一改读 `artifact ?? partialArtifact`，并消除"改错 deck"的可能：**

- `App.tsx:1908`：`onOpenEditor` 在 failed + `partialArtifact` 存在时传残稿（打开的是已生成的页，不是空草稿）。
- `App.tsx:194` `findModifySourceTask`：接受 `partialArtifact`；**并且优先匹配当前任务**，只有在当前任务确实无产物时才回退到会话历史 —— 现状的"取最新 artifact"必须去掉。
- `App.tsx:1075` `continueModify`：以残稿为 `sourceFile`，不再抛 `No source document to modify`。

**A4. 残稿必须是显式的"未完成"状态**，下游（侧边栏、历史、导出）按 `partial` 渲染，避免把半成品当成品。

### 主线 B（恢复层）—— 渲染 checkpoint 与 ops 流同生共死

**B1. checkpoint 前置 + 增量。** `writePPTXMOPManifest` 从成功分支（`:394`）提到**派发第一个 op 之前**，并在每帧 op 发出后按节流更新 `LastOpSeq`，写入用已有的原子写法（`pptx_expansion_checkpoint.go:62-78`：`os.CreateTemp` + `os.Rename`）。失败路径因此天然带着最新 checkpoint。

**B2. 三条 `refusing duplicate rendering` 分支不再是死路。** `:342/:353/:364` 改为返回**带 checkpoint 的结构化失败**（`ResumeCheckpoint` + `ResumeImages` + `resume_stage: "render"`），"拒绝重复渲染"从终态变成可续跑状态。

**B3. 恢复协议加渲染维度。** `loadPPTXResume`（`pptx_resume.go:37`）从"只认 `expansion-state.json`"改为按 `resume_stage` 分派：`expansion` 走现有校验，`render` 恢复 `LastOpSeq` 与已完成页集合。`service.go:486-488` 按 stage 加载。

**B4. 用不变量锁死，而不是靠分支覆盖：**

> **只要 sink 收到过 ≥1 个 op，失败就必然携带 render checkpoint。**

写成一条 Go 测试（构造 worker 中途死亡、finish 失败、send 失败三种注入），这是根治的验收标准 —— 而不是"在三个分支上都记得加一行"。

### 主线 C（协议层）—— 失败是结构化数据，不是散文

**C1. wire 上给出 `failure` 结构：**

```jsonc
// task.failed payload
{
  "message": "…",                        // 保留，仅用于技术详情
  "failure": {
    "stage": "plan" | "content" | "render" | "export" | "transport",
    "reason": "expansion_incomplete" | "worker_died" | "llm_rejected" | …,
    "retryable": true,
    "resume_stage": "expansion" | "render",
    "retained": { "drawn_pages": 8, "total_pages": 12, "failed_pages": [9,10,11,12] }
  }
}
```

`stage` 与 `reason` **在 Go 的失败点就地标注**，不由 UI 反推。

**C2. 渲染失败不再借用内容 sentinel。** 新增 `errPPTXRenderIncomplete`；`service.go:1051` 的 `content generation failed` wrap 只包内容阶段。截图那种"渲染失败被报成内容生成失败"的归因错误从此不可能出现。

**C3. 删掉字符串分类器。** `agent_bridge.go:1914` 的 `strings.Contains(message, …)` 改为读结构化 `failure.reason`。前端 `failureKind.ts` 的 tag 解析退化为兼容旧事件，**不新增任何按英文文本猜类别的代码**；文案按 `stage × reason` 查表。

### 主线 D（表现层）—— 一个阶段只能有一个所有者

**D1. 删除 `PptxProductionStage` 的 compact 双所有权。** `ProgressivePptxStage` 是唯一所有者；生命周期动作（`onRetry`/`onResume`/`onOpenEditor`）从 `PptxProductionStage` 的 props 中移除，改由单一的 `StageActions` 模型派生。

**D2. `StageIntentBar` 不再持有 `onRetry`**（`StageIntentBar.tsx:36`）。重试是终态动作，属于失败面板，不属于随行指令条。

**D3. 失败面板由结构化数据驱动**（数据来自 C1 + A1，**不需要猜文本**）：

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠  排版阶段未完成                              已保留 8 / 12 页 │
│ 第 9–12 页没有画完，已完成的页面已保存。                       │
│ [ 继续生成未完成的 4 页 ]  [ 打开已生成的 8 页 ]   ▸ 技术详情  │
│ ──────────────────────────────────────────────────────────── │
│ 重新生成整份（将丢弃已生成的 8 页）                            │
└──────────────────────────────────────────────────────────────┘
```

行动由 `failure.retryable` × `resume_stage` × `partial.drawnPages` 决定，且**"打开残稿"和"续跑"都是真实可用的功能**，不是降级替代品：

| 条件 | 主行动 | 次行动 |
|---|---|---|
| `stage == auth/setup` | 去登录 / 去修复环境 | 技术详情 |
| `resume_stage` 存在 | 继续生成未完成的 N 页 | 打开已生成的 M 页 |
| `resume_stage` 缺失但 `drawnPages > 0` | 打开已生成的 M 页 | 重新生成整份（标注丢弃 M 页） |
| `retryable == false` | 无重试类动作 | 技术详情 |
| 其余 | 重新生成整份 | 技术详情 |

**D4. 终态不变量集中表达并测试锁死：**
失败/取消下 —— 至多一个 primary、无 `Follow latest`、无动画、无提交必然失败的输入框；`[data-phase="failed"]` 用 danger token 上色（节点/标题/进度线）。

---

## 3. 落地顺序（依赖强制，非优先级偏好）

```
步骤 1  协议层 (C1 + A2 的 wire 部分)
        ├─ task.failed payload 增 failure{} / result{}
        ├─ Go 失败点就地标注 stage/reason
        └─ 桥接映射到 internal/types + src/shared/types
             ↓
步骤 2  模型层 (A1 + A3 + A4 + C3)
        ├─ partialArtifact / partial 字段 + taskState 填充
        ├─ onOpenEditor / findModifySourceTask / continueModify 改读残稿
        └─ 删除字符串分类器
             ↓
步骤 3  恢复层 (B1-B4)
        ├─ manifest 前置写 + 节流增量更新
        ├─ render sentinel + resume_stage 分派
        └─ 不变量测试（≥1 op ⇒ 必有 render checkpoint）
             ↓
步骤 4  表现层 (D1-D4)
        ├─ 删 compact 双所有权 + StageIntentBar.onRetry
        ├─ 失败面板（数据驱动，无文本猜测）
        └─ 终态不变量 + data-phase CSS
```

步骤 3 依赖步骤 1 的 `resume_stage` 字段；步骤 4 依赖步骤 2 的 `partialArtifact`（否则"打开已生成的 8 页"没有数据来源）。**这些依赖是硬约束，不是排期建议。**

---

## 4. 验收：每条对应一个可证伪的不变量

| # | 不变量 | 验证方式 |
|---|---|---|
| A | 任意 failed 任务的残稿：打开入口可用，且修改指令落到**本任务**的残稿 | 前端测试：failed + partialArtifact → Open 可点；`findModifySourceTask` 优先返回当前任务；无 artifact 时不再产生 "No source document to modify" |
| B | sink 收到 ≥1 op 后失败 ⇒ 必带 render checkpoint | Go 测试：注入 send 失败 / finish 失败 / worker 中途死亡三种，断言 `ResumeCheckpoint != ""` 且 `resume_stage == "render"` |
| C | wire 上不存在"靠字符串匹配决定 UI 行为"的路径 | `agent_bridge.go:1914` 子串分类被删除；前端无新增错误文本正则；文案查 `stage × reason` 表 |
| D | 终态：primary ≤ 1，无 `Follow latest`，无动画，无死输入框 | 组件测试 + 截图场景回归 |

**截图场景的期望终态**：一个失败面板，`已保留 8 / 12 页`，主行动 `继续生成未完成的 4 页`（有 render checkpoint 时）或 `打开已生成的 8 页`，次行动 `重新生成整份（将丢弃已生成的 8 页）`，技术详情里保留原始错误原文。

---

## 5. 明确否决的权宜之计

| 被否决的做法 | 为什么不行 |
|---|---|
| 前端按错误文本猜原因桶（上一版 `pptxFailureCopy.ts` 的桶设计） | 把英文散文当协议，改一次措辞就静默失配；正解是 C1 的结构化 `failure` |
| "没有 checkpoint 时降级为主行动=打开残稿" | 掩盖 R2：该场景下 checkpoint **本该存在**，应当修到它必然存在（B4） |
| 保留 `PptxProductionStage compact` 的第二套错误条/按钮，只调样式 | 双所有权是"两个 Retry"的成因（R4）；只调样式会再次长出第三个入口 |
| 在 failed 态隐藏/禁用 composer 了事 | 掩盖 R1：正解是让 `continueModify` 能改残稿（A3）；隐藏只是把"缺功能"变成"看起来不需要" |
| 只改 placeholder 文案（并发 session 刚做的 `steeringPlaceholder`） | 提示词变诚实了，但动作仍然失败 —— 典型过渡方案 |
| 把 `ArtifactStageShell` 死代码接上来"统一外观" | 外观不是问题；先修模型与协议，表现层统一是步骤 4 的结果而非手段 |

---

## 6. 实施前必须先解决的一件事

`src/renderer/presentation/PptxProductionStage.tsx` 在本次分析期间（2026-09-14 13:16:02）被**另一个 session 写入**，改动已包含 `onResumeLive` / `livePaused` / `steeringPlaceholder`，且 `App.tsx` 的 `onSteer` 已改为 `steerPptxTask`、行号整体后移（`onRetry:1900`、`onSteer:1903`、`onOpenEditor:1908`）。

`ProgressivePptxStage` / `StageIntentBar` / `LiveSteeringBar` / `progressivePptxStage.css` / `StageStatus.tsx` / `ArtifactStageShell.tsx` / `DocumentWorkspace.tsx` 也都在该 session 的修改集内（`git status` 全部为 ` M`）。

**本方案步骤 4 与这批改动是同一批文件。** 动手前必须先确认该 session 的归属与边界，否则会直接冲突。

---

## 7. 交付记录（2026-09-14）

### 7.1 已完成

| 步骤 | 改动 | 文件 |
|---|---|---|
| 1 协议层 | `GenerationFailure{stage,reason,retryable,resume_stage,resume_checkpoint,retained}` + `RetainedWork`，`errors.As` 可穿透包装 | 新增 `officecli-internal/internal/runtime/failure.go` |
| 1 协议层 | 渲染阶段自有 sentinel `errPPTXRenderIncomplete`，不再借用内容阶段 sentinel | `internal/runtime/pptx_expansion_result.go` |
| 1 协议层 | `task.failed` payload 增 `stage` / `resume_stage` / `resume_checkpoint` / `retained`；类型化失败优先，未类型化错误仍走旧匹配（迁移边界有测试锁） | `internal/cli/agent_bridge.go` |
| 1 协议层 | 前端 `TaskFailure` / `TaskRetainedWork` / `TaskPartialWork` 类型；`task.failed` 分支解析结构化 `failure`（非法 stage 丢弃，不猜） | `src/shared/types.ts`、`src/renderer/taskState.ts` |
| 2 模型层 | `partialArtifact` / `partial` 一等公民；`attachPartialWork` reducer；绘制任务终态时把已落盘残稿写回任务模型 | `src/renderer/taskState.ts`、`src/renderer/App.tsx` |
| 2 模型层 | `sourceArtifactFor` = `artifact ?? partialArtifact`；`findModifySourceTask` 增"当前任务优先"并去掉了"静默改会话里最新 deck"的路径；`continueModify` 以残稿为 `sourceFile`，英文报错本地化 | `src/renderer/App.tsx`、i18n |
| 3 恢复层 | 扩展阶段把本轮 checkpoint 留在 Service 上；三条 `refusing duplicate rendering` 分支改为返回带 checkpoint 的结构化失败，并额外发一条带 `resume_checkpoint` 的 progress 事件 | `internal/runtime/pptx_progressive_stream.go`、`pptx_expansion_recovery.go`、`service.go` |
| 4 表现层 | 新增数据驱动失败面板（stage 标题 / 已保留页数 / 未完成页码 / 主次行动 / 技术详情可复制） | 新增 `src/renderer/presentation/PptxFailurePanel.tsx`、`pptxFailurePanel.css` |
| 4 表现层 | compact 不再重复渲染错误条与 Retry；`StageIntentBar` 移除 `onRetry`；终态隐藏 Follow latest；`[data-phase="failed"/"cancelled"]` 上色并停动画 | `ProgressivePptxStage.tsx`、`PptxProductionStage.tsx`、`StageIntentBar.tsx` |

### 7.2 与原文的偏差（一处，且是收紧）

原文主线 B 的不变量写作"sink 收到 ≥1 op 后失败 ⇒ 必带 **render** checkpoint"。落地时收紧为：

> **sink 收到 ≥1 op 后失败 ⇒ 必带结构化 retained 事实；当内容阶段的 checkpoint 仍可加载时，必须携带它。**

原因：真正的中途续画（只重画未完成页、复用已画好的页）需要 worker 协议接受起始 op seq 与编辑器页 ID 对齐，`docs/pptx-failed-live-replay.md:19` 已明确记录该能力**尚未实现**。原写法会承诺一个引擎做不到的 resume，正是本文档第 5 节否决的那种"UI 给出按不动的按钮"。因此：

- 内容结果完整但渲染失败时（截图场景）：`resume_stage` 为空，UI 给"打开已生成的 N 页" + "重新生成整份（丢弃 N 页）"——都是真实可用的动作；
- 内容阶段本身可续跑时：`resume_stage="expansion"`，UI 给"继续生成未完成的 N 页"。

`withResume()` 用 `loadPPTXResume` 实际校验后才写入，测试 `TestWithResumeOnlyPromisesAResumableCheckpoint` 断言"不可加载的路径不得产生 resume 承诺"。

### 7.3 验证

- Go：`go test ./internal/runtime/`、`go test ./internal/cli/` 全绿；新增 `failure_test.go`（4 例）与 `agent_bridge_failure_test.go`（3 例）。
- 前端：`npx tsc --noEmit` 通过；`npx vitest run src/renderer src/shared` = **915/916**，唯一失败是 `SpreadsheetWorkspace.test.tsx:89`（断言 `complementary / "AI Assistant"`），该标签只存在于测试文件中，是并发 session 对 `SpreadsheetWorkspace.tsx` / `Shell.tsx` 的在途改动所致，与本方案无关。
- 引擎已重新编译进 `officedex/build/officecli/officecli`，二进制内含 `PPTX rendering is incomplete; drawn pages retained` 与 `resume_stage`。

### 7.4 并发 session

分析期间 `ProgressivePptxStage.tsx`（13:25）、`PptxProductionStage.tsx`（13:19）、`pptxDeckState.ts`、i18n、`vibeReplay.ts` 等被另一 session 连续写入。本方案的步骤 4 落在这些文件之上，已按它们的最新版本改（`livePaused` / `onResumeLive` / `steeringPlaceholder` 均保留）。`SpreadsheetWorkspace` 那一条失败属于该 session 的未完成工作面。

