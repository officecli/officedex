# 「生成中实时画出来」——探测结果

日期：2026-09-20 ｜ 分支：`develop/1.0` ｜ 探针：`presentation-component/src/officedex-editor-diagnose.ts`

## 结论（三条，全部实测）

1. **`?mode=embed` 的 frame 允许写入。** `slides.add()` 与 `shapes.addTextBox()` 都成功，形状计数 `0 → 1`。
2. **所以「frame 没有写权限」是错的**——那个结论曾被我写进 `findings-pptx-track.md` §4，并作为选路依据。**不存在需要另一个团队为 frame 加权限这件事。**
3. **当前 shell 做不到「边画边看」的真正原因不是权限，是排版**：生成期画布挂的是 `PresentationStage`，而它现在只渲染 `CanvasPlaceholder` 骨架、**根本不挂编辑器**。

## 实测数据

真 bridge、真 `blank.pptx`、编辑器 boot 后在 iframe 内部测量：

```json
{
  "read":       { "ok": true, "slideCount": 1, "shapesOnFirstSlide": 0 },
  "slideWrite": { "attempted": true, "ok": true, "error": null, "code": null, "rolledBack": true },
  "shapeWrite": {
    "attempted": true, "ok": true, "error": null, "code": null,
    "shapesBefore": 0, "shapesAfterAdd": 1, "shapesAdded": 1, "shapesAfter": 1,
    "rolledBack": false
  },
  "officeJs": { "powerpointGlobal": true, "officeGlobal": true, "officeExtensionGlobal": true },
  "url": { "search": "?officedexEmbed=1", "hasChannel": false }
}
```

`shapesAdded: 1` 是关键：`shapeWrite` 用的正是 `VibeReplaySequencer` 画每个文本元素时的同一个调用（`slide.shapes.addTextBox(...)`，`vibeReplay.ts:562`），**它在这个编辑器里生效**。

### 一个差点让我再次归因错的读数

第一版探针把「加形状 → 删形状 → 数数量」放在**同一个 `PowerPoint.run`** 里，得到 `shapesBefore: 0, shapesAfter: 0`。那个读数看起来像「编辑器静默丢弃写入」——一个比「拒绝写入」更严重的结论。

实际上它只是**同一批次里删掉之后再读，读到的是删除后的状态**（API 的 `sync()` 语义）。改成三次独立 run 测量后才看清：`0 → 1 → 1`。

**教训**：这个 API 里「加了又删」和「根本没加」在单次 run 里读数完全一样。任何用计数证明写入生效的探针，必须分开 run 测量。

### 关于 `rolledBack: false`

回滚那一步失败，`shapesAfter: 1`。但 `blank.pptx` 磁盘文件**未被修改**（快照后仍为 10111 bytes、`slide1.xml` 里 `<p:sp>` 计数 0）：编辑器只在显式 save/export 时落盘。残留的形状只活在编辑器的内存会话里，随会话销毁。探针指向的这个 fixture（`blank.pptx`）本来就是一次性的，不影响任何用户文档。

## 这推翻/确认了什么

| 曾经的结论 | 状态 |
|---|---|
| frame 走的 `?mode=embed` 没有写权限，workbench 的 `?officedexEmbed=1&channel=…` 才有 | **推翻** |
| 「给 frame 的 embed 加写权限」需要动另一个团队 | **不需要**，那条 boot 本来就能写 |
| `Editing is not permitted` 的成因是权限声明 | **归因不成立**；见下 |
| live 草稿路由到 `PresentationStage`（不是 `PresentationCanvas`） | **确认**（`liveStageRouting.test.tsx`），而它现在只渲染骨架 |

## `Editing is not permitted` 现在怎么解释

它不再有一个可信的成因。可以确定的只有：**它不是这个编辑器对形状写入的当前行为**——同样的写入刚刚成功。

可能的历史解释（**未验证**，不要再当成结论用）：
- 那行日志来自**另一次代码状态**，当时的 editor 会话或权限确实不同；
- 或者当时 live 草稿没有被成功装载，报错来自装载路径而非绘制路径。

要查清需要拿到那次运行的完整堆栈；目前仓库里没有。

## 现在该怎么把功能做出来

既然写入可用、且**不需要任何权限改动**，实现路径就是恢复被 `9b96338` 移除的东西：

1. `PresentationStage` 重新挂 `PresentationEditorFrame`（替掉 `CanvasPlaceholder`），平台按草稿的 preview token 装载草稿。
2. 恢复 `useLiveDeckReplay`（`7e7a6d2` 里那份完整实现被删了，可从该 commit 取回）——它当时已经跑到 `drawing slide 1 of 3`。
3. 顺带清掉 `PresentationStage.tsx` 里 `usePptxLiveDraft` 被调用两次的重复行（回退时留下的）。

**唯一还需要先量一遍的东西**：live 草稿文件本身有没有内容/形状。本探针证明了**编辑器能画**，没有证明**草稿里有东西可画**——`findings-pptx-track.md` §4 量到的「草稿 10111 bytes、与 blank.pptx 逐字节相同、1 页」仍然指向草稿可能是空的。若如此，接上编辑器后会看到「能画但没内容」，那要动的是内容管线，而不是权限。

## 探针怎么跑

```bash
npm run build:presentation        # public/presentation 是 staged 产物，改组件必须重编
OFFICEDEX_E2E_SKIP_PREFETCH=1 npm run test:e2e -- e2e/editor-write-permission-real.spec.ts
```

报告打在 stdout（`attach` 只在测试通过时落盘，而这里要的正是「先看答案」）。

**探针会写一次文档**（加一个幻灯片、加一个文本框），并尽力回滚；它跑在 `blank.pptx` 这个一次性 fixture 上，**不要**把 `fixturePath` 改成真文件。

---

# 追加：把 legacy 的演示 PPT 搬进 shell，以及「Editing is not permitted」的真因

日期：2026-09-20 ｜ 入口：`?deckDemo=1`

## 演示已经搬过来了

legacy 的 **Watch PPT generation** 那张卡对应 `demos/nexaedge/`（141 个 op、8 页、123 个 shape，
`ops.json` + 一张内嵌图，没有任务、不花 credits、不需要后端生成）。它现在从
`?deckDemo=1` 进入 shell：

- `src/shell/dev/deckDemo.ts` —— dev-gated 的入口判断（生产构建里恒为 false）
- `CanvasContent` 的 `demo` 分支 → `PresentationStage demo` → `usePptxLiveDraft.replayBundledDemo()`
- `App` / `EditorCanvasHost` 的 `fileless` —— 演示没有库里文件，但画布要显示

走的完全是真的那条路：真 `CreateLivePptxDraft` 草稿、真预览令牌、真 `PresentationEditorFrame`、
真 `VibeReplaySequencer`。

## 它复现了 §4 的失败，而且这次拿到了真因

`renderer-<date>.log` 里是原句复现：

```
waiting  | taskId=builtin-nexaedge
drawing  | slide=1 total=8
failed   | error="Editing is not permitted"
```

给 `presentation-component` 的脚本桥补上 stack 之后，抛出点确定了：

```
at AccessPolicy.assertCanApply     ← 不是 assertCanEdit
at applyOperations
at runAtomicMutation               ← MOP 批次路径，真实绘制 op 走的就是这条
at executeBatch                    ← local-mop-slide-package-bridge
```

这两条分支抛的是**同一句文案**，所以此前只看消息根本无法区分；是 stack 把它们分开的。

再让 `assertCanApply` 把自己的输入打出来，拿到拒绝时的真实状态：

```
mode=edit  forceDisconnected=false  editingSuspended=false
canComment=false  editPermission=undefined
operations=[remove_attrs,update_attrs]
```

`canEdit()` = `mode === "edit" && !forceDisconnected && privilege.permissionWithReason.edit.hasPermission`。
前两项都是对的，**第三项是 undefined —— privilege 没设上**。

## 真因与修法：权限设得太晚（已修）

不是「权限缺失」，是**顺序竞争**。

证据是同一个 access 对象在两次读取里给出不同答案：拒绝时
`editPermission=undefined`，而编辑器完全启动后 `canEdit() === true`。
也就是说权限是在**第一次批次之后**才就位的。

来源是 `use-presentation-editor-session` 里那个 `updatePrivilege(fileNode.privilege)`
的 effect —— effect 在 mount commit 之后才跑，而宿主一看到
`officedex:pptx-workbench-ready` 就开始画。**第一帧绘制赢了这场竞争。**

**修法**：把同一个赋值提前到 `applySlideInitialSnapshot` **之前**（工作台拿到之后、
文档挂上之前），effect 原样保留，它负责编辑器开着时权限变更的情况。
位置在 `presentation-ui-react/src/chrome/slide/editor/use-presentation-editor-session.ts`。

那段代码里的注释写了为什么是这里而不是别处：这一行跑在文档 mount 之前，
更跑在让宿主能执行脚本的 ready 事件之前，窗口就此关上。

### 修好的证据

```
[deck-demo] peakSlides=2 peakShapesOnSlide1=10
✓ draws the bundled recording into the live editor (4.3s)
2 passed
```

同一份录制、同一条真路径：从「第一帧就 failed」变成 4.3 秒内画到第 2 页、
首页 10 个 shape，并且是**逐步**长出来的（采样过程中计数在动）。

## 另一处保留的改动

`presentation-engine/src/model/state/access-policy.ts` 的拒绝消息现在带上了
mode / forceDisconnected / editingSuspended / canComment / editPermission / 操作类型。
这句文案此前什么线索都没有，是这个功能查了好几轮的根因；下次一眼就能看出是哪一项。

---

# 追加：画布里的舞台塌成一条（已修）

画得出来了，但用户一眼看出**只有菜单栏**——幻灯片在下面看不见。

## 量到的

```
[deck-demo-size] canvasHost 1228x648   liveDeck 1228x154   iframe 1228x154
```

648px 的画布里，舞台只有 **154px** —— 正好是编辑器自己那条 ribbon 的高度。
幻灯片被挤到折线以下，而且没有滚动条。

## 两个原因叠在一起

1. `canvas.css` 里 `.shell-live-deck { flex: 1 }` —— **但 flex-grow 需要 flex 父容器**，
   而 `[data-canvas-host]`（`.shell-canvas`）是 block 盒，`flex: 1` 完全不起作用。
2. `.shell-canvas > .pptx-embed-frame { width/height: 100% }` 是**直接子选择器**。
   文件编辑器的 iframe 是直接子元素，所以那条规则生效；live deck 的 iframe
   嵌在 `.shell-live-deck` / `.shell-live-deck-frame` 里面，**这条规则从来没匹配上**，
   iframe 于是退回 `height: auto`。

## 修法

- `.shell-live-deck` 补 `height: 100%`（对着有确定高度的宿主解析），`flex` 属性留着
- 新增 `.shell-live-deck .pptx-embed-frame`（后代选择器，不是直接子），把那条直接子规则
  的尺寸/边框/底色照搬一层

修后：`liveDeck 1228x648`、`iframe 1228x648`。

## 为什么值得记

**当时所有测试都是绿的，功能也确实在画**——形状在长、断言全过，只是画在一个
154px 高的窗口里。`toBeVisible()` 对「元素存在且非零尺寸」就满足了，抓不到这种。

所以 E2E 里补了一条尺寸断言：舞台高度必须 **> 画布的 90%**，失败信息直接印出
两个数字。这类「绿着但看不出来」的缺陷，只有把几何量出来才拦得住。

---

# 追加：第二次点「看演示」不会重演（已修）

## 现象与复现

先点了「Watch…」看完，回到 Home 再点一次 —— **什么也没发生**，屏幕上还是那份画完的 deck。

E2E 先复现了它（断言「第二次点击后应该回到 1 页」→ 失败）。

## 原因

两个都成立才构成这个 bug：

1. **回 Home 不会卸载画布。** `EditorCanvasHost` 是 `hide()` 而不是 unmount ——
   `hide()` 的注释写得很清楚：故意什么都不做，因为卸载等于每次回 Home 都重载文档。
   所以组件状态（包括那个「已经启动过」的 ref）全都活着。
2. **第二次点击没有产生任何状态变化。** `enter-workspace` 把 `demo` 设成 `true`，
   而它**本来就是 `true`** —— 没有新状态、没有重渲染，那个 ref 于是继续挡住重播。

`demo: boolean` 表达不了「再要一次」这件事。

## 修法

加一个**只增不减的计数** `ShellState.demoEpoch`，每次 `enter-workspace` 带 `demo` 就 +1，
画布把它作为 `PresentationStage` 的 React `key`。计数一变 → 组件重挂载 → ref 归零 →
`replayBundledDemo()` 重新建一份空白草稿，从头演。

两个刻意的边界：

- **只有演示会 +1**（`enter-workspace` 不带 `demo` 时不动）。真实运行的 stage 有它自己的
  生命周期，在 sequencer 画到一半时把它重挂载等于把画的东西扔掉。
- `demoEpoch` **不持久化**：刷新后画布本来就是新挂载的，计数没有意义要跨会话保留。

## 顺带修的测试隔离

这些 E2E 之前会互相污染：shell 状态（含 `demo`）写在 `localStorage`，一个测试留下
「正在演示」，下一个测试就带着这个状态启动。加了个 `gotoShellClean()` 在导航前清掉
`officedex.shell.v1`。**这类失败只在整份 spec 一起跑时才出现**，单跑一条是绿的 ——
值得单独记一笔。

修后 4/4 通过，其中重演那条 5.2s（说明它真的观察到了「回到 1 页再重新长」）。

---

# 追加：看完演示再生成，画布还留着演示（已修）

## 现象

用户截图：看完 Watch 演示后回首页、发起一次真的 ppt 生成 —— **左边任务面板列的是新 run 的页面，
右边画布里还是那份演示**。一个窗口里两份不同的 deck。

## 原因

`CanvasContent` 的路由是 `if (demo) return <演示>;` **排在 `if (liveDeck)` 前面**。
而 `demo` 这个 flag **只有 `open-file` 会清**，一次 run 根本没有文件 ——
于是新 run 开始时 `demo` 仍然是 `true`，演示继续霸占画布。

先写了个单测把它钉住（`liveStageRouting.test.tsx`）：演示 + 新 run → 断言画布上应该是
新 run 的 stage。当时收到的是 `builtin-nexaedge`，复现成功。

## 修法：谁后要的谁赢

把「什么时候要的演示」记下来（`ShellState.demoStartedAt`），和新 run 自己的 `createdAt` 比：

```ts
const demoIsNewerThanRun =
  demo && (demoStartedAt === null ||
    Date.parse(demoStartedAt) >= Date.parse(liveDeck?.createdAt ?? "") || ...);
```

这也**顺手把上一个 bug 修得更正确**：原来我用的是一个自增计数，其实「时间戳」才是这件事的
本体 —— 它同时回答了「要不要重演」（值变了）和「谁占画布」（谁更新）。计数只能回答第一个。

三个细节：

1. **时间戳必须严格递增，不能只是不同。** 两次点击落在同一毫秒会得到**相同**的 ISO 串 →
   React key 不变 → 第二下又变成空操作 —— 正是这个机制要防的那个 bug。
   所以 reducer 里用 `Math.max(now, last + 1)`，并且有一条测试专门断言严格大于。
2. **失去画布要告诉 shell。** 画布是独立的 React root，它做优先级判断，但 flag 归 shell 所有。
   所以在演示被压过时回调一次 `leave-demo` 把 flag 清掉 —— 否则 `demo` 会活得比它的演示久，
   **下次刷新又冒出来压在已经跑完的 run 上面**。
3. **只有演示会盖时间戳。** 真实 run 的 `enter-workspace` 不动它，既是「不要在 sequencer
   画到一半时重挂载」，也是让 run 有机会压过它。

## 验证

- `liveStageRouting.test.tsx`「lets a new run take the canvas away from the recording」：通过
- `shellReducer.test.ts` 三条：每次请求都严格变新、真实 run 不动时间戳、`leave-demo` 清干净
- E2E 4/4；全量单测 **1406/1406**

---

# 追加：右侧高亮框盖住编辑器 UI（已修）

## 现象

用户截图：agent 工作时的注意力光边框有点小，压住了编辑器自己的界面。

## 原因

`.shell-attention`（`app.css`）是铺在工作区上的：`left/right: 0`，底部到
`--shell-statusbar-h` 为止；边框在里面按 `INSET` 收进来。**工作区的边缘就是画布宿主的边缘**，
而嵌入式编辑器在这个边缘上还画了自己的东西：

- 右侧一条**滚动条**
- 底部一条 **32px 的状态栏**（`SLIDES_CHROME.insets.bottom = 32`，`editorChrome.ts` 里量过）

`INSET = 10` 时，框就落在滚动条上、贴着底部控件。（量过：工作区 1228×680，
代码区 y 从 40 起 → 画布区 1228×648，框底在画布底上方 10px，而编辑器状态栏占 32px。）

## 修法：用已有的那条通道，而不是再猜一个数

shell 里**已经有**「编辑器各边占了多少」的通道 —— 悬浮面板就是靠它躲开编辑器控件的
（`editorChrome.ts` 的 `insets`，`canvasKeepOut`）。注意力边框现在也读同一个值：

```ts
const { chrome } = useCanvasSurface();
const bottom = inset + (insets?.bottom ?? 0);   // 16 + 32
```

`INSET` 同时从 10 提到 **16**（自己那圈辉光的宽度）。两条一起，框既避开滚动条，
也避开底部状态栏。效果是**框住的是文档本身**，而不是「画布盒子」——
后者会把编辑器为文档画的控件圈进去。

## 顺带修正一条已经过时的断言

`editorChrome.ts` 里写着「生成舞台不上报，因为它们不挂编辑器」。
`PresentationStage` 现在**挂了**（`PresentationEditorFrame`，底部同样有那条 32px 状态栏），
所以那句话只对 `DocxStage`/`SheetStage` 成立。已改成：规则从来不是「舞台要沉默」，
而是「**你画了什么 chrome 就上报什么**」，并让 `PresentationStage` 在编辑器起来时上报
`SLIDES_CHROME`。

不然生成期/演示期（`activeFile` 为 null 时不画框，但有文件打开时画）框还是会压在状态栏上。

## 验证

- `AttentionBorder.test.tsx` 新增一条：发布 `SLIDES_CHROME` 后，框的 `height` 必须是
  `600 - 16 - (16+32) = 536` —— 直接断言状态栏被让出来
- 全量单测 **1407/1407**，E2E 4/4

**一个诚实的说明**：边框只在「agent 正在工作 + 有打开的文件」时绘制，
我没有为它单独造一个 E2E 场景（要驱动一次真生成）。这次的依据是几何量测
+ 单元断言；等下次真跑生成时可以顺手确认一眼。

---

# 追加：「修改 ppt」被当成「重新生成 ppt」（已修）

## 现象

打开一份 ppt，在左侧输入「把第三页的标题改为 Hello World」：
画布变成一份**整个 deck 正在被画**的骨架，最后标题**并没有被改**。

## 真因：路由，不是编辑器

`useAgentTask.send` 里只有一条原地编辑分支：

```ts
if (target?.type === "doc" && canvas?.canEditDocument?.()) { ... }
```

**只认 `doc`。** ppt 于是掉到下面那句 `port.agent.send(...)` ——
走的是**生成运行时**：「改第三页标题」被理解成「按这句话重新做一份 ppt」，
所以整个 deck 被重画，而原来那份没有被改，标题当然没变。

## 关键发现：原地编辑 deck 的能力一直都有，只是没人调

三块拼图全都在仓库里躺着：

| 能力 | 位置 | shell 是否调用 |
|---|---|---|
| 规划器 `office.pptx.plan_js`（返回可执行的 Office.js） | officecli + `api.planPptxJS` | ❌ |
| 检查/执行/保存 | `PresentationEditorController.inspect / executeScript / save` | ❌ |
| 找出改动落在哪一页 + 跳过去 | `pptxEditFocus.ts`（`changedSlideIds` / `focusSlideAfterEdit` / `buildSelectSlideScript`） | ❌ |

legacy 的 `PresentationPptxWorkbench` 一直在走这条路（`planTurn` → `applyPlan`），
shell 只是从来没接。所以这次不是缺能力，是**接线**（和 §4 那次正好相反）。

## 修法

1. **新增 `src/canvas/pptxEditRun.ts`** —— 与 Word 的 `docxEditRun` 对称：
   `inspect()`（规划器的上下文 + 编辑前的快照）
   → `planPptxJS({prompt, context})`
   → `executeScript(plan.source)`
   → **再次 `inspect()`，比较前后找出变化的页，`setSelectedSlides` 跳过去**
   → `save()`
2. **`PresentationCanvas` 用 `onEditRunner` 注册这个 runner** —— 走的是和 Word 完全
   同一条适配器通道（`editCurrent`），所以 `canEditDocument()` / `editDocument()` 不用改名。
3. **路由改成按类型分派**，抽成纯函数 `inPlaceEditorFor(file, canvas)`：
   `doc → docx`、`slides → pptx`、其余 → null（继续走生成）。
4. `documentEditRun` 加 `documentType` 参数（同一个三步流程，不复制第二份），
   面板文案也分类型：deck 说「the slide(s) that needed it」，不再是「the document」。

## 关于「动态边框 + 焦点转到那一页」

就是 `focusSlideAfterEdit` + `buildSelectSlideScript`：**不是 shell 画的边框，是编辑器
自己的选中态** —— `setSelectedSlides` 同时驱动画布和左侧缩略图轨道，转场也由编辑器做。
这正是 legacy 的效果，代码是同一份。

## 两个刻意的取舍

- **低置信 / 需要确认的计划一律拒绝，不执行。** workbench 会把它们放进自己的确认步骤；
  这条路径没有计划评审 UI，而「执行一个规划器自己都不确定的改动」比不执行更糟。
  拒绝时把规划器自己的话（`confirmation.message` / `summary`）原样说出来。
- **undo 为 null。** deck 没有 Word 那种可逆替换记录（脚本是任意 Office.js，shell 也没有
  文件快照），卡片不提供 Undo，而不是给一个只能猜的按钮。

## 验证

- `pptxEditRun.test.ts` **12 条**：应用脚本并报告改了 1 页、**跳到 s3**、已经在 s3 时不跳、
  无改动则不保存、低置信拒绝并带出规划器原话、需确认拒绝、空脚本拒绝、保存失败作为数据
  返回、中止不执行、空指令拒绝、规划器收到的 context 正确、规划器失败不静默
- `inPlaceEditorFor.test.ts` **6 条**：doc→docx、**slides→pptx**、sheet→null、
  没挂编辑器→null、无文件/无 canvas→null、适配器没有该方法也不抛
- 全量单测 **1425/1425**，E2E 4/4，`tsc` 干净

---

# 追加：第一次改成功、第二次又变成重新生成（已修）

## 现象

用户实测：改标题**成功**了（还自动跳到了那一页）；紧接着输入「把第二页改为日语」，
又变成整个 deck 重新生成（画布出现生成骨架、标签栏多出 `Product_Launch.modified`）。

## 真因：runner 被同一棵树里的另一个 effect 撤销了

这是我上一轮**只修了一半**的地方。

`PresentationCanvas` 在 controller 回调里用 `onEditRunner(runner)` 注册原地编辑器 ——
**这一步做了，而且是对的**。但同一棵树里 `CanvasContent` 还有一个 effect：

```ts
// 旧
if (open && open.type !== "doc") onEditRunner(null);
```

「原地编辑只属于 Word，其他分支一律撤销」。**deck 的 type 是 `slides`**，
所以 deck 一注册就被撤销。

时序上还特别隐蔽：`PresentationCanvas` 的 controller 回调来自 effect，而这个是
**父组件**的 effect —— 子 effect 先跑、父 effect 后跑。于是「注册」永远被「撤销」盖掉，
`canEditDocument()` 对打开的 deck **恒为 false**，指令于是走到生成运行时。

**为什么第一次看起来成功了**：那次是巧合 —— 控制器/会话建立的时机决定了两个 effect
谁后跑。我的单元测试当时全绿，因为它们只测了「注册」这一半（`pptxEditRun.test.ts`）
和「路由分派」（`inPlaceEditorFor.test.ts`），**没有测注册之后它还在不在**。

## 修法

```ts
if (open && open.type !== "doc" && open.type !== "slides") onEditRunner(null);
```

判据从「是不是 Word」改成「**是不是可原地编辑的类型**」。注释也改了：
Word 和 deck 都能原地编辑，只有 workbook 不能。

## 新测试，而且**验证过它会红**

`createDesktopCanvas.test.tsx` 两条：

- 「keeps the deck's in-place editor available after the open」—— stub 的
  `PresentationCanvas` **从 effect 里**上报 runner（模拟真实时序），然后断言
  `canEditDocument()` 仍为 true
- 「withdraws in-place editing for a workbook」—— 切到 sheet 后必须为 false

我把修复回退了一次，确认第一条**确实失败**，再改回来 ——
不然这就是又一个「绿着但测不到东西」的断言。

## 另一处：把路由决策写进日志

顺手把那次失败变成一个可诊断的事实。`useAgentTask.send` 现在每次都记
`agent.routing`：`targetFileId` / `targetType` / `inPlace` / `canvasCanEditInPlace`。
打包版没有控制台，这张截图区分不了「走错了路」和「规划器给了错的脚本」，
而这条日志可以直接区分 —— 下次再报，读 `renderer-<date>.log` 就知道。

## 验证

- 全量单测 **1427/1427**（新增 2 条，且确认过其中一条能变红）
- E2E 4/4，`tsc` 干净

---

# 追加：E2E 实测结果（这次是端到端跑的，不是推断）

用户说「还是出现框架，你 E2E 测一下」。测了，**而且发现我上一轮的解释只对了一半**。

## 新增 `e2e/deck-edit-routing-real.spec.ts`

打开真 deck → 输入指令 → **只 stub 规划器**（它需要 provider 和 key），
其余全是真的：返回的 Office.js 在真编辑器里执行、再 inspect 找出变化的页、写回文件。

结果：

```
[deckEdit] inspected slides=1 selected=["slide-1"]
[deckEdit] planned source=667 confidence=high
[deckEdit] script executed
[deck-edit] deck texts: ["Hello World"]
✓ edits the deck in place instead of regenerating it (1.0m)
```

**指令确实是原地改的，没有生成框架，文件被写回。** 与标题修改那条路径一致。

## 过程中查出的四件事（都写进了代码注释或日志）

1. **`agent.routing` 日志证明路由判定是对的**：
   `{"canvasCanEditInPlace": true, "inPlace": "pptx", ...}` —— 上一轮那个
   `open.type !== "doc"` 撤销 runner 的修复**确实生效**。

2. **我的 RPC 断言写错了。** 我用「有没有调 `PlanPptxJS`」当路由证据，但
   **stub 会 fulfill 请求**，recorder 不一定看得到 —— 于是测试在「编辑其实成功」的情况下失败。
   改成断言**没有调 `Generate`**（没被拦截的那条路），以及最终 deck 里的文本。

3. **stub 写错会伪装成产品坏掉。** 第一版 stub 直接 `shapes.items[0].textFrame` ——
   空白 deck 上那个 shape 不是文本框，报 `reading 'textFrame'`，看起来像产品坏了。
   这正是这类测试要能分辨的东西：**改 stub 前先确认失败点是谁**。

4. **demo 那条 E2E 是 flaky，与本次改动无关。** 它会在 embed 还没装好探针时就读，
   于是在长跑里失败、单跑却通过。已改成「等读取器出现」而不是固定 sleep。
   （同一类问题上一轮也踩过：断言 `probe missing` 其实是启动时序。）

## 顺带把诊断变成永久的

`pptxEditRun` 现在每一步都写应用日志：`pptx-edit.inspect` / `pptx-edit.plan` /
`pptx-edit.execute`，各带 `ok` 与失败原因。加上 `agent.routing`，
**「又出现框架了」这类报告现在可以从 `renderer-<date>.log` 直接定位**，
不用再靠截图猜。我就是靠这组日志把「规划器没被调用」和「脚本执行失败」分开的。

## 最终状态

- E2E **5/5**（新 spec 1 条 + 原有 4 条）
- 全量单测 **1427/1427**，`tsc` 干净

---

# 追加：低置信计划被「拒绝」，而面板没有可以按的东西（已修）

## 现象

用户：「把第二页改为日语」→ 面板里出现模型的说明
「涉及该页多处文案需要替换，请确认后执行」→ **然后没有后续了**。

## 真因：我把「要确认」实现成了「拒绝」

`pptxEditRun` 第一版对 `requires_confirmation` 或 `confidence: "low"` 直接抛错：

```ts
if (plan.requires_confirmation === true || plan.confidence === "low") {
  throw new Error(detail || "...");
}
```

这是我自己写的「计划不确定就别执行」的取舍 —— **方向对，但落地方式错了**：
抛错只会让面板显示一段 agent 消息，**没有任何可以按的东西**。用户明确说了要什么，
应用回了一句他无法回应的话。`AgentQuestion` 的注释早就写着这件事：

> Not a message. A message is something the agent said; this is **a door** it is
> standing behind. …… 打字…… 会启动**第二个** run，而第一个永远卡住。

**legacy 的 workbench 本来就有这一步**：`plan.requires_confirmation` → 界面切到
`awaiting-confirmation` → 用户点确认才执行。我照搬了判定，漏了那扇门。

## 修法：把确认接成已有的 question 机制

shell **已经有**问题卡（`.shell-task-question`：`QuestionCard` + `task.question`），
缺的只是「本地的 run 收不到回答」：

- `agent.answer` 原本**只**发给 port；本地编辑 run 永远等不到答案
- `DocumentEditHandle` 没有 `answer`

所以：

1. `DocumentEditRequest` 增加 `onConfirm(question) => Promise<boolean>`
2. `pptxEditRun` 遇到要确认的计划**先问**：同意才执行；不同意返回
   「Cancelled. The deck was not changed.」（`applied: 0`，不是失败）；
   **没有地方可以问时仍然拒绝** —— 唯一不能发生的事是未经确认就应用
3. `documentEditRun` 实现 `onConfirm`：把问题挂到 `task.question`、状态转
   `awaiting-review`，并返回一个 promise；**`answer()` 释放它**
4. `useAgentTask.answer` 优先回答本地 run，没有本地 run 才转发给 port

## 顺便修掉的测试隔离问题

两条 E2E 都在编辑**同一份** `blank.pptx`：导入后应用里是同一个库条目，
所以第二条打开时拿到的是第一条已经改过的 deck —— 表现为「尚未应用」断言失败，
**而代码其实是对的**。现在每条测试先 `mkdtemp` 复制一份自己的 deck。

这类「测试之间通过被测系统互相污染」的坑，和之前那个「回 Home 不卸载画布」一样，
都只在整份 spec 跑的时候才现身。

## 验证

- 单测新增 5 条：确认后应用 / 拒绝则 `applied: 0` / 无处可问仍拒绝 /
  问题挂上 task 且回答后才继续 / 回答 cancel 不改动（**1430/1430**）
- **E2E 新增 1 条**：「asks before applying a plan the planner flagged, and applies on a yes」
  —— 断言卡片出现、文案是规划器原话、**点确认前 deck 没变**、点确认后改成
- E2E 6/6，`tsc` 干净

## 还没做的

面板对本地编辑 run 的 **Pause 仍走 port**（`finish` 已经会 abort 本地 run）。
确认卡出现时它是多余的按钮，点了没有效果 —— 是个小瑕疵，不是死路，
我没有顺手改，因为「暂停一次编辑」本身没有明确定义。
