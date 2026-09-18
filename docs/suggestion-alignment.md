# `AgentSuggestion` 需要对齐的问题清单

**这份清单不阻塞任何进度。** 按项目原则（见 `not-implemented.md`），
`applySuggestion` / `undoSuggestion` 已经抛 `NotImplementedError`，卡片和两个按钮
留在 UI 层放它的位置，点击时说明尚未实现。S4-2 可以随时开工，也可以一直等。

清单的用途是：等 runtime 侧有余力谈这件事时，把已经查清的事实和四个待决问题一次交出去，
不用重新考古。

写下来的理由：`AgentSuggestion` 是这一期唯一的全新产品概念，不是迁移。
服务层自行发明一套，等 runtime 侧给出真正的模型时就得推倒重来。

---

## 一、先把事实摆清楚

### UI 侧的完整预期

`AgentSuggestion` 只有五个字段（`src/shared/uiPort.ts:118`）：

```ts
interface AgentSuggestion {
  id: string;
  targetFileId: string;
  summary: string;
  applied: boolean;
  /** False once the target file changed after Apply — Undo is then refused. */
  undoable: boolean;
}
```

`SuggestionCard`（`src/shell/agent/TaskPanel.tsx:195`）据此渲染：一句 summary、
一个文件名、一个按钮。未应用时是 "Review and apply"，应用后换成 "Undo"，
`undoable: false` 时 Undo 禁用并给出理由 tooltip。

**没有 diff 视图，没有逐条勾选，没有部分接受。** 一次 run 最多一个 suggestion，
`AgentPresence` 把它当一条未读徽标。

参考实现（`src/shell/port/fake/fakeAgent.ts`）的语义是：apply 让目标文件变 dirty，
undo 让它变回 clean。**也就是说 fake 认为 apply 写的是打开着的编辑器，不是磁盘。**
这一条是否是产品意图，本身就是下面的 Q5。

### 桌面端三种类型的改动路径

| 类型 | agent 怎么改文档 | 改动落地前有检查点吗 | 改动可逆吗 |
|---|---|---|---|
| **docx** | run 跑完返回 `{ summary, edits: {query, replacement}[] }`，渲染层再调 `editor.apply()` + `editor.save()`（`word/DocxAgentPanel.tsx:65-73`） | **结构上已经有**：plan 在应用之前就存在，只是渲染层没有停在那里 | 部分可逆。`query`/`replacement` 互换不是可靠的逆操作，但 `editor.capture()` 手上有改前的全文 |
| **xlsx** | client tools `workbook.write_cells` / `format_cells` / `add_chart` 在 **run 进行中**逐个调用，每次立即改活表格（`spreadsheet/workbookClientTools.ts`） | 没有 | 不可逆。没有任何地方记录改前的值 |
| **pptx** | run 按渐进式管线把页面直接写进文件 / 会话快照 | 只有写之前的 `task.plan` 大纲闸门 | 不可逆 |

三处都查过，没有文档级的版本或快照回滚 RPC：`DesktopAPI` 里
`savePptxEditorSnapshot` 只写不读旧版本，没有 `restore` / `revert` 这一侧。

### 已经存在、可能可以直接用上的

- **`task.plan` / `plan_review` / `respond`**：runtime 已有的人工闸门，但它在**写之前**
  （批准大纲，然后才开始写）。shell 的 suggestion 在**算完之后、落地之前**。
  同一个人工检查点的两个不同位置。
- **`startAgentRun` / `approveAgentRun`（`AgentRunApproveInput` 带 `approved` / `data`）**
  以及 client tool 的 `risk` 字段——runtime 已经有"请求批准"的信封，
  问题是它今天批准的是**一次工具调用**，不是**一批待落地的改动**。
- **`workbookFingerprint.ts`**：xlsx 已经有工作簿指纹，可以用来判定"apply 之后文件又变了"。
  docx / pptx 没有对应物。

---

## 二、问题清单

### 必须由 runtime 侧决定的（这四条不定，服务层无从下手）

**Q1. 检查点放在 run 的哪一侧？**

docx 的 plan 是 run **完成后**才有的，所以"先看后应用"对它天然成立。
xlsx 和 pptx 是流式写入的：等 run 结束再给用户一个 suggestion，文件早就被改完了，
Apply 按钮无事可做，Undo 才是唯一有意义的动作。

- 建议：**按类型分层交付**。docx 先落地真正的 suggestion（改动最小，语义最纯），
  xlsx / pptx 暂时保持"直接写"，`suggestion` 继续为 null。
  UI 侧不受影响：`suggestion: null` 是合法状态，TaskPanel 只是不渲染那张卡。
- 需要 runtime 答复的是：xlsx / pptx 有没有可能把改动**先攒住不落地**？
  如果答案是否，那 Q4 的 undo 就是它们唯一的路。

**Q2. suggestion 的载荷是什么？**

三个候选，选哪个决定服务层存什么：

1. **一份可重放的改动集**——docx 的 `edits[]`、xlsx 的 write_cells 序列、pptx 的 op 流。
2. **一个改完的文件**（旁路文件 + 原文件，apply 就是换过去）。
3. **只是一个 id**，改动留在 runtime 侧，apply 是一次回调。

- 建议：**3**。`AgentSuggestion` 只有 `id` 和 `summary`，UI 不消费载荷，
  服务层没有任何理由把改动集搬到 TypeScript 这一侧来——搬过来就得为三种类型
  各写一套序列化，而且它们的 schema 归 runtime 管。
- 那么需要的 RPC 大致是 `agentSuggestionApply(id)` / `agentSuggestionUndo(id)`，
  外加一个携带 suggestion 的事件（见 Q3）。

**Q3. `summary` 谁生成？**

docx 的 `office.docx.edit.v1` workflow **已经返回 summary**，xlsx / pptx 没有。

- 建议：runtime 生成。它是给人读的一句话，只有产生改动的那一侧知道改了什么；
  服务层从 op 流反推一句摘要，必然是"修改了 3 个单元格"这种没有信息量的话。
- 具体问题：这句 summary 走哪条通道到渲染层？新增一个 `task.suggestion` 事件，
  还是挂在现有的 `task.plan` 上？后者更省，但 `task.plan` 今天的语义是
  "写之前的大纲待批准"，复用会让 `plan_review` 这个状态同时表示两件事。
  倾向新增事件类型。

**Q4. Undo 的机制是什么？**

三个候选，目前**三个都不存在**：

1. **编辑器内的 undo 栈**——最便宜，但三个编辑器（writer / sdk-sheet /
   presentation）都没有暴露 undo 协议，查过了。而且它只在文件还开着时有效。
2. **逆操作**——要求 runtime 在生成改动时同时生成 inverse，成本落在 runtime 侧，
   但语义最干净，也是唯一能在文件被关掉后还成立的方案。
3. **改前快照 + 整体回滚**——实现最直接（apply 之前拷一份），
   代价是大文件的拷贝，以及"回滚会连带丢掉用户 apply 之后手动改的东西"。
- 建议：**3**，按 suggestion 一份改前快照，配 Q6 的失效判定。
  理由是它对三种类型同构，不需要 runtime 为每种 op 补 inverse，
  而 `undoable` 这个字段本来就承认了"undo 是有条件的、会过期的"。
- 需要 runtime 答复：inverse（方案 2）是不是本来就在计划里？如果是，那它更好。

### 影响语义但服务层可以先按建议实现的

**Q5. apply 是写内存还是写磁盘？**

fake 的语义是写内存：apply 之后文件 dirty，undo 之后 clean。
但 docx 现在的代码是 `editor.apply()` **紧接** `editor.save()`，直接落盘。

- 建议：**写磁盘**，apply 之后文件不是 dirty 的。
  理由是 dirty 语义已经归 canvas adapter 管（服务层的 `dirtyFiles` 是内存 Set，
  刻意不持久化），让 agent 的 apply 去制造一个 dirty 状态，会把两条独立的
  "未保存"来源混在一个标记里，用户按 Cmd+S 时谁也说不清保存的是什么。
- 这一条和 fake 有分歧。按 `createDesktopUiPort.ts` 头部写明的规则，
  分歧时 fake 赢——所以这条需要明确推翻，或者改 fake。

**Q6. "文件在 apply 之后变了"怎么判定？**

`undoable: false` 的触发条件。

- 建议：apply 时记下目标文件的 mtime + 大小，undo 前比对，不一致就拒绝。
  xlsx 可以用现成的 `workbookFingerprint.ts` 做得更准。
- 边界：文件被关掉再打开算不算"变了"？建议不算（只看内容）。
  文件被外部程序改了算（mtime 会变，自然覆盖到）。

**Q7. 一次 run 能不能产生多个 suggestion？**

UI 只有一个位置，后来的会覆盖前面的。

- 建议：合约层面约定**一次 run 至多一个**，由 runtime 保证。
  如果 runtime 天然会产生多个（比如一次改了三个文件），需要在这里说，
  因为那会变成 `UiPort` 的改动（`suggestion: AgentSuggestion[]`），要先跟 UI 侧走一遍。

**Q8. `permission: "review" | "full" | "custom"` 和 suggestion 是什么关系？**

`SendInput.permission`（`src/shared/uiPort.ts:167`）今天被服务层丢掉了
（`warnAboutUnsupported` 会警告）。但看语义，**suggestion 本身就是 "review" 模式的实现**：
review 表示改动落地前要人看一眼，full 表示直接应用。

- 建议：确认这个理解。如果成立，那 Q1 的分层交付就有了产品说法——
  xlsx / pptx 今天只支持 `full`，docx 先支持 `review`，
  而不是"suggestion 还没做完"。
- `custom` 是什么，需要 UI 侧给定义，这条不归 runtime。

---

## 三、不需要对齐的（服务层自己定）

记在这里是为了避免会上浪费时间：

- `AgentSuggestion.id` 的格式——服务层透传 runtime 给的。
- `targetFileId` 的解析——服务层从 run 的 `source_path` 映射到 document id，
  `documentIDForPathTx` 已经保证了这个映射稳定。
- Apply 失败怎么报——走现有的 `{ kind: "error" }` 事件，和别的失败一样。
- suggestion 在 task 历史里要不要持久化——不要。它是一个待办，
  run 结束且用户已决定之后就没有意义了；`current()` 从历史重放时不还原它。

---

## 四、最小可交付

如果上面只答 Q1–Q4，服务层就能做完这一条纵切：

> docx 的一次 agent 编辑：run 完成 → 事件带回 `{ suggestionId, summary }` →
> TaskPanel 显示卡片 → 用户点 Apply → `editor.apply` + `save` →
> 卡片变成 Undo → 用户点 Undo → 从改前快照恢复。

这条通了，xlsx / pptx 是同一套机制换一个改动来源，不是新设计。
