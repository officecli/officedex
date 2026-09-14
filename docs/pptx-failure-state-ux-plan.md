# PPTX 生成失败态 UI 优化方案

> 对象：`ProgressivePptxStage` / `PptxProductionStage` 在 `task.status === "failed"` 时的界面。
> 截图复现：扩写阶段失败，第 8 页正文预览 + 一条原始错误 + 两个 Retry + 一个无用的修改输入框 + 一个 Floating 的 "Follow latest"。

---

## 1. 结论摘要

失败态当前是三个组件各画一半拼出来的：预览卡、错误条、操作条彼此不知道对方存在。要修的不是"配色"而是**结构**：

1. **一个失败面板**取代现在分散在 3 处的错误条 / Retry / Follow latest。
2. **全屏只有一个主行动**，且主行动按失败原因 + 已保留内容决定，而不是无脑"重试"。
3. **说清保留了什么**：`8 / 12 页已保留 · 第 9–12 页未完成`，失败页可点。
4. **让"续跑"真的可用**：截图这类失败（`refusing duplicate rendering`）后端根本没发 checkpoint，所以永远只能全量重跑 —— 需要后端补。
5. **终态收敛**：失败时不再显示"跟随最新内容"，也不再显示一个提交必然失败的修改输入框。

---

## 2. 当前失败态是怎么拼出来的

截图元素 → 代码位置：

| 截图元素 | 代码位置 | 它其实是什么 |
|---|---|---|
| 白卡 `Slide 8 / Approve the next proof point / ▼ View content / Content preview · open the editor for the final layout` | `ProgressivePptxStage.tsx:402` | `slide_preview` 事件的**纯文字正文预览**（`pptxRuntimeActivity.ts:23`），不是渲染后的版面缩略图 |
| 红色长句 | `PptxProductionStage.tsx:134` | `task.error` 原文直出，无标题、无操作 |
| `↺ Retry` 描边按钮 | `PptxProductionStage.tsx:140` | compact footer 自己画的 |
| 输入框 + `↑` + 文本 `Retry` | `PptxProductionStage.tsx:143-152` → `LiveSteeringBar.tsx:11` → `StageIntentBar.tsx:32-37` | 与上一个 Retry **绑定同一个 handler** |
| `↓ Follow latest` | `ProgressivePptxStage.tsx:418` + `progressivePptxStage.css:108` | `position: sticky` 浮层，终态仍渲染 |

挂载链：`App.tsx:1846` → `ProgressivePptxStage` → `:409` 渲染 `<PptxProductionStage compact>` → `:143` 渲染 `LiveSteeringBar`。

那串错误的来源（Go 侧三层 wrap）：

```
service.go:1051        content generation failed: %w
pptx_expansion_result.go:10   PPTX expansion is incomplete; retained completed pages
pptx_progressive_stream.go:346  streaming output already emitted; refusing duplicate rendering: %v
```

---

## 3. 问题清单

### 3.1 「乱」—— 视觉与层级

| # | 问题 | 证据 |
|---|---|---|
| P1 | 约 60px 内两个 "Retry"，一个描边带图标、一个是文本按钮，**都调同一个 handler**，用户无法区分，也不说明后果 | `PptxProductionStage.tsx:140` 与 `:148`；两者都落到 `App.tsx:1872` `onRetry: () => retryTaskGeneration(documentTask)` |
| P2 | 错误条和它的操作分属不同组件，中间没有任何分组容器 | 错误条在 `:134`，按钮在 `:140` 与 `StageIntentBar.tsx:36` |
| P3 | **失败没有任何状态色**。`data-phase="failed"` 已写在根节点，但 CSS 里一条 `[data-phase="failed"]` 规则都没有；`activeStep` 在 failed 时为 `undefined`，时间线节点退回灰色数字 3，标题也不变色 —— 整屏唯一的红就是那条原始错误 | `ProgressivePptxStage.tsx:369`、`:305`；`grep data-phase progressivePptxStage.css` 无结果 |
| P4 | 终态还挂着"进行中"的控件 | `LiveSteeringBar` 的渲染条件含 `failed`（`PptxProductionStage.tsx:143`）；`Follow latest` 的渲染条件是 `showGeneration`（`ProgressivePptxStage.tsx:418`），而 `showGeneration` 含 failed |
| P5 | 预览卡上那句 "Content preview · open the editor for the final layout" 在失败态是**空承诺**：Open editor 只在 completed 渲染 | `PptxProductionStage.tsx:141`；文案 `pptxFlowCopy.ts:42` |
| P6 | 每张预览卡都重复同一句 footer，正文细节又塞进 `<details>`，多页时噪声很大 | `ProgressivePptxStage.tsx:402` 与 `:405` |

### 3.2 「缺」—— 功能

| # | 问题 | 证据 |
|---|---|---|
| F1 | **没有续跑入口**（截图场景）。真正的续跑 `onRetryFailed(checkpoint)` 只在事件流里出现 `resume_checkpoint` 时才渲染，且是裸 `Button`、零解释。而后端只在 recovery 分支发 checkpoint；`refusing duplicate rendering` 的三条分支**都不发** → 这类失败永远只能全量重跑 | 前端 `ProgressivePptxStage.tsx:219`、`:412`；后端 `pptx_expansion_recovery.go:353` 发，`pptx_progressive_stream.go:346/354/365` 不发 |
| F2 | **唯一可点的 Retry 是破坏性的**：`retryTaskGeneration(task)` 的 `resumeCheckpoint` 为 `undefined` → 已渲染的 8 页全部丢弃重来，而界面一个字都没提 | `App.tsx:761`、`:777` |
| F3 | **打不开已完成的部分**。`onOpenEditor` 由 App 在存在 artifact 时传入，却被 `status === "completed"` 挡住。而失败时**部分绘制结果确实已落盘**（绘制器在失败终态前先 `controller.save()`），用户却没有任何入口去看/导出这 8 页 | 传入 `App.tsx:1878`；挡住 `PptxProductionStage.tsx:141`；落盘 `vibeReplay.ts:1345-1357`；修复背景见 `docs/pptx-failed-live-replay.md` |
| F4 | **不显示"保留了什么"**。`pptxPageStates` 已算出每页 ready/failed/canceled，但只在大纲行里用了一次；失败头部只有一句"生成遇到问题"，没有页数事实、没有失败页码 | `pptxRuntimeActivity.ts:43`；唯一消费点 `ProgressivePptxStage.tsx:386` |
| F5 | **composer 在失败态是死控件**。`onSteer` 恒等于 `continueModify("pptx", …)`，而它要求 `findModifySourceTask` 找到带 artifact 的任务：失败任务没有 artifact → 抛未本地化的英文 `No source document to modify`；若同一会话里有更早成功的 deck，它会**静默改那一份**。placeholder 还是 "Tell OfficeDex what to change from the next slide"，可已经没有"下一页" | `App.tsx:1873`、`1075-1079`、`194-205`；`LiveSteeringBar.tsx:11` |
| F6 | **错误不可诊断**。`FailureKind` 每个失败都算出来了、App 也存了 `errorKind`，PPTX 失败态完全没用它来选行动；`stripFailureTag` / `errorCode` 在产品代码里没有消费点（只有自身测试）。没有折叠的技术详情，没有可复制的诊断块 | `failureKind.ts:34/45`；`App.tsx:224/267`；全仓 grep 消费点仅测试 |
| F7 | 同类实现其实已经存在却没用上：`ArtifactStageStatusBanner` 已经是「状态标签 + message + error + primary 行动」结构，带 `--failed` 边框色和错误行样式，但 `ArtifactStageShell` 与它**没有任何调用方** —— 两个 Stage 家族各写了一套 | `artifactStage/StageStatus.tsx:21-70`；`artifactStage.css:47-49`；grep 仅自身文件 |

---

## 4. 目标设计

### 4.1 失败面板

用一个面板取代现在的错误条 + 两个 Retry + 裸 checkpoint 按钮：

```
┌──────────────────────────────────────────────────────────────┐
│ ⚠  排版阶段未完成                              已保留 8 / 12 页 │
│                                                              │
│ 已完成的内容已经保存在文件里，第 9–12 页没有画完。             │
│ 可以先只补这 4 页，或者打开已经生成的部分看看。                │
│                                                              │
│ [ 继续生成未完成的 4 页 ]  [ 打开已生成的 8 页 ]   ▸ 技术详情  │
│ ──────────────────────────────────────────────────────────── │
│ 重新生成整份（将丢弃已生成的 8 页）                            │
└──────────────────────────────────────────────────────────────┘
```

- 失败页以 chips 形式列出（`第 9 页` `第 10 页` …），点击滚动到对应预览卡。
- 面板出现在 step 3（逐页绘制）内部，替换掉那里的 `work(...)`。
- 全屏只保留 **1 个 primary CTA**。

### 4.2 行动决策表

主行动由 `FailureKind × 是否有 checkpoint × 已保留页数` 决定，做成纯函数以便单测：

| 条件 | 主行动（primary） | 次行动 |
|---|---|---|
| `kind == "auth"` | 去登录 | 技术详情 |
| `kind == "setup"` | 去修复运行环境 | 技术详情 |
| `kind == "connection"` | 重新连接并重试 | 技术详情 |
| 有 checkpoint 且 ready > 0 | 继续生成未完成的 N 页 | 打开已生成的 M 页 |
| 无 checkpoint 且 ready > 0 | **打开已生成的 M 页** | 重新生成整份（丢弃 N 页） |
| ready == 0 | 重新生成整份 | 技术详情 |

原则：**有残稿时，"接着用"优先于"从头再来"**；破坏性动作永远不占 primary 位，且必须写明丢弃多少页。

### 4.3 失败原因分桶

新增 `presentation/pptxFailureCopy.ts`，先按 `classifyError` 的 tag 判定 auth/setup/connection，其余按错误文本归三桶（纯前端映射，将来后端补 `kind` 可直接替换）：

| 桶 | 匹配（示例） | 标题（zh） |
|---|---|---|
| `render` | `expansion is incomplete` / `retained completed pages` / `refusing duplicate rendering` | 排版阶段未完成 |
| `write` | `content generation failed` / `llm request failed` / `invalid json` | 正文生成失败 |
| `transport` | `unexpected EOF` / `context deadline` / `connection refused` | 网络中断 |
| 兜底 | 其它 | 生成未完成 |

签名：

```ts
export interface PptxFailureInput {
  kind: FailureKind;
  error?: string;
  resumeCheckpoint?: string;
  readyPages: number;
  totalPages?: number;
  failedPages: number[];
  canOpenPartial: boolean;
}
export interface PptxFailurePlan {
  tone: "danger" | "warning" | "info";
  titleKey: string;
  bodyKey: string;
  primary: { action: "resume" | "open" | "retry" | "login" | "setup"; labelKey: string };
  secondary?: { action: "open" | "restart" | "details"; labelKey: string; destructive?: boolean };
  rawDetail?: string;   // stripFailureTag 之后的原文，放进折叠区
}
export function planPptxFailure(input: PptxFailureInput): PptxFailurePlan;
```

### 4.4 新增文案（`i18n/zh.ts` + `en.ts` 同改）

| key | zh |
|---|---|
| `pptx.failure.title.render` | 排版阶段未完成 |
| `pptx.failure.title.write` | 正文生成失败 |
| `pptx.failure.title.transport` | 网络中断 |
| `pptx.failure.title.auth` | 需要重新登录 |
| `pptx.failure.title.setup` | 运行环境未就绪 |
| `pptx.failure.retained` | 已保留 {ready} / {total} 页 |
| `pptx.failure.pagesFailed` | 第 {pages} 页未完成 |
| `pptx.failure.resume` | 继续生成未完成的 {count} 页 |
| `pptx.failure.openPartial` | 打开已生成的 {count} 页 |
| `pptx.failure.openPartialHint` | 这份还不是完整演示，可以打开已有的页面继续编辑 |
| `pptx.failure.restart` | 重新生成整份 |
| `pptx.failure.restartWarning` | 将丢弃已生成的 {count} 页 |
| `pptx.failure.details` | 技术详情 |
| `pptx.failure.copyDiagnostics` | 复制诊断信息 |
| `pptx.failure.steerDisabled` | 生成已中断，重试后才能继续修改 |
| `pptx.failure.partialSaved` | 已完成的页面已保存到文件 |

### 4.5 视觉规范

- 复用 `artifact-stage-status` 的结构与 token（`--od-danger`、`--od-danger-border`、`--od-border-subtle`、`--od-radius-dialog`），不再自造 `pptx-production-stage__error` 那种裸色块。
- 面板圆角 12px、按钮 8px、卡片 12px —— 与 `DESIGN.md` 一致；不引入药丸按钮。
- 失败页 chips 用现有 tag 语义，不新增色彩。
- `[data-phase="failed"]` 下：时间线节点与标题置为 danger 色；停止全部动画（复用 `progressivePptxStage.css:161` 的 `data-delayed` 停动画写法）。
- 技术详情用等宽字体（`DESIGN.md`：JetBrains Mono），内容为 `stripFailureTag(error)` 原文 + `errorCode`。

### 4.6 终态收敛规则

1. `failed` / `cancelled` 时**不渲染** `Follow latest`（`ProgressivePptxStage.tsx:418` 条件收紧）。
2. `failed` 时**不渲染** composer：不再给一个提交必然失败的输入框。修改入口推迟到用户点"打开已生成的 M 页"进入编辑态之后。
3. `PptxProductionStage` compact 在 failed 时不再自己画错误条和 Retry（`:134`、`:140`、`:148`），统一交给上层的失败面板，保证全屏只有一个 primary。

---

## 5. 实施计划

### Phase 1 —— 收敛失败态 UI（纯渲染层，可独立验收）

1. 新增 `src/renderer/presentation/FailurePanel.tsx` + `failurePanel.css`。
2. 新增 `src/renderer/presentation/pptxFailureCopy.ts` + `pptxFailureCopy.test.ts`（kind × checkpoint × ready 矩阵）。
3. 改 `PptxProductionStage.tsx`：compact 且 failed 时不再渲染 `__error`、footer Retry，也不传 `onRetry` 给 `LiveSteeringBar`。
4. 改 `ProgressivePptxStage.tsx:398-413`：failed 时在 step 3 内渲染 `<FailurePanel>`，传入 ready/total/failedPages/kind/checkpoint 与 `onRetryFailed` / `onOpenEditor` / `onRetry`。
5. 改 `ProgressivePptxStage.tsx:412`：checkpoint 按钮并入失败面板主行动，删掉裸 `Button`。
6. 改 `ProgressivePptxStage.tsx:418`：终态不渲染 `Follow latest`。
7. i18n 增 key（zh/en）。
8. CSS 增 `[data-phase="failed"]` 规则。
9. 测试更新：`PptxProductionStage.test.tsx`（"keeps failed output actionable" 的 `role=alert` 与按钮名）、`ProgressivePptxStage.test.tsx`（"preserves failed slides…"、"passes the saved checkpoint only on explicit retry"）。**注意这两处现在用 `getByRole("button", {name: "Retry"})`，断言"恰好一个"，改单主行动后正好符合语义。**

### Phase 2 —— 失败事实与页级定位

10. `pptxRuntimeActivity.ts` 增 `pptxFailureSummary(task)` → `{ ready, failed: number[], canceled: number[], total }`（复用 `pptxPageStates` + `vibeSlides` + `vibeOutline.slides.length`）。
11. 面板渲染 `已保留 8 / 12 页` + 失败页 chips，点击滚动到对应预览卡。
12. `pptxRuntimeActivity.test.ts` 增失败摘要用例。

### Phase 3 —— 让"续跑"真的可用（跨前后端）

13. Go：`pptx_progressive_stream.go:346/354/365` 三条 `refusing duplicate rendering` 分支在返回错误时带上 `ResumeCheckpoint`（沿用 `pptx_expansion_recovery.go:353` 的 `expansion-state.json` 语义），或在 service 层把 `errPPTXExpansionIncomplete` 统一转成带 checkpoint 的 progress 事件。
14. 桌面侧 `retryTaskGeneration` 已有 `resumeCheckpoint` 分支，无需改；确认 checkpoint 存在时 `resume` 成为 primary。
15. 端到端回归：`npm run test:e2e`，对齐 `docs/pptx-stage-e2e.md` 的失败场景。

### Phase 4 —— 家族统一（可选，单独排期）

16. 把失败面板抽成 `artifactStage` 通用件，让目前无调用方的 `ArtifactStageShell` 与 `ProgressivePptxStage` 共用，删除重复的 `pptx-production-stage__error` 样式。

---

## 6. 验收标准

- 截图场景（`expansion incomplete`、8/12 页、无 checkpoint）渲染为：**一个**失败面板，含 `已保留 8 / 12 页`、主行动 `打开已生成的 8 页`、次行动 `重新生成整份（将丢弃已生成的 8 页）`、可展开技术详情。
- 全屏名为 `Retry` 的 primary 按钮**只有一个**。
- 终态不出现 `Follow latest`，不出现提交必然失败的 composer。
- 原始错误原文仍可在技术详情中读到 —— 不牺牲可诊断性。
- 现有失败态测试更新后全绿；新增 `planPptxFailure` 矩阵单测。

---

## 7. 风险与取舍

| 风险 | 说明 | 缓解 |
|---|---|---|
| 主行动从"重试"变成"打开残稿"会改变用户预期 | 若多数失败其实无法从残稿继续，用户会停在半成品 | 仅当 `ready > 0` **且**存在 artifact/预览时才把"打开"提为 primary，并在面板上一句 `这份还不是完整演示` |
| Phase 3 依赖后端 | 若 `refusing duplicate rendering` 分支无法安全生成 checkpoint，续跑仍不可用 | Phase 1+2 独立可用：主行动退化为"打开已生成的部分"，续跑按钮只在 checkpoint 存在时出现 |
| 复用 `ArtifactStageStatusBanner` 会牵动其它 Stage | Phase 4 有回归面 | 排在最后，单独排期；Phase 1-3 不依赖它 |
| UI 组件库迁移约定 | 面板新增组件 | 一律从 `../ui` facade 引入 `Button` 等基础件，不直接依赖 AntD，不使用 `Form`/`Result` 等未纳入兼容层的组件 |
