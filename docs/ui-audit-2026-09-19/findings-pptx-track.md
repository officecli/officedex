# 生成态下的界面缺陷（pptx track 顺带发现）

本轮 pptx 生成链路的工作中发现的界面问题，记在这里是因为它们都只在**一次运行正在进行时**才存在——普查的静态组合（C1–C10、fixture）到不了这些状态，而运行结束后它们就消失了。

发现方式：对一次真 bridge E2E 的 Playwright 录像抽帧（`ffmpeg -vf fps=1/12`），逐帧看真实运行下的界面。录像在 `test-results/real-e2e-*/playwright-output/*/video.webm`。

---

## 1. 状态栏在生成中说「No file open」 — 未修

**现象**：一份 deck 正在画布上被逐页画出来，同一时刻窗口底部的状态栏写着「No file open」。

**成因**：live 草稿按设计不进文件库——`CreateLivePptxDraft` 写到 `workspaceDir/live/`，只登记到预览注册表，从不碰 `documents`（见 `src/canvas/PresentationStage.tsx` 顶部注释）。所以整个生成期间 `activeFile` 都是 null，`StatusBar` 走空分支。这不是 bug，是那条设计的副作用：状态栏把「没有打开的文件」当成了「画布上什么都没有」。

**为什么不是文案问题**：S1-004 报的是这条文案的截断行为。这里是语义——它在一分钟以上的时间里陈述一件与屏幕上可见事实相反的事，而这个状态栏的既有注释恰好写着它的原则是「宁可少说也不说错」。

**修法（已验证方向，未实施）**：让 shell 通过自己的 UiPort 边界拿到「画布上有一次运行在写东西」这个事实。`src/shared/uiPort.ts` 是这个 shell 唯一的服务接缝。

**踩过的坑，别重复**：直接在 `StatusBar` 里 `useTaskStore()` 取 `state.tasks` 是错的——shell 入口没有挂 `TaskStoreProvider`（shell 和 legacy 是两个入口，provider 要各挂各的），加上去会让 shell **启动即崩**，真 bridge E2E 里表现为 `#shell[data-loaded="true"]` 永不出现。`useAgentTask()` 也不合适：AgentPresence 已经在用它，StatusBar 再调一次会重复订阅并重复发端口请求。

类型无关是对的方向——哪个舞台占着画布，状态栏要陈述的都是同一件事。

---

## 2. 生成中显示完整的编辑 ribbon — 已修（`a5a4fab`），后被整块移除（见 §4）

**现象**：正在画的 deck 上方是一整条 Insert / Draw / Design / Transitions / Animations / Slide Show / Review / View 工具栏，看起来完全可用。

**成因**：嵌入式编辑器自带 ribbon，且没有只读模式可以请求。原先的只读处理是一个透明的点击遮罩加一枚右上角的小药丸提示——点击确实被挡住了，但那条工具栏看起来是活的，唯一的线索是一行九号字。**一个看起来能用、实际不能用的工具栏，比一个明显不属于你的工具栏更糟。**

**修法**：把提示从「飘在 ribbon 旁边的药丸」改成「压在 ribbon 正上方的整条横幅」，直接点名它：`Being drawn — the toolbar below is inactive until this deck is finished`。横幅在 shell 自己的 DOM 里——ribbon 在 iframe 内部，高度不是外面能猜的，这条带子是这个界面上 shell 唯一够得到的地方。

---

## 3. 页表里失败和未开始同色、重试和生成同形 — 已修（`4a716ea`）

量出来的（改前）：

| 状态 | 颜色 | 标记 |
|---|---|---|
| queued | `rgb(139,142,144)` | 时钟 |
| failed | `rgb(139,142,144)` | 感叹号 |
| generating | `rgb(52,58,64)` | 转圈 |
| repairing | `rgb(52,58,64)` | 转圈 |

一张有页死掉的 deck 读起来像还在排队往下走。失败色取原型自己的 `#ad5347`（`.cx-form-error`，按 `tokens.css` 顶部那条「后面的层覆盖前面的」取后出现的一支），`tokens.css` 补了 Status 一节。重试只改转圈的前缘。

**给后续的提醒**：原型只有这一个「出错了」的颜色，没有 warning / success——它只画了顺利路径。需要新语义色时先确认原型里是否真的存在，不要自己拍。

---

## 4. 「边画边看」在新 shell 里不工作 — **已修**（2026-09-20）

> ⚠️ **本节关于「frame 没有写权限」的归因已被实测推翻，功能随后修好。**
> frame 的 `?mode=embed` 编辑器**允许写入**（`slides.add()` 与 `shapes.addTextBox()`
> 都成功，形状计数 `0 → 1`）。真正的失败是另一回事：**本地编辑权限设得太晚** ——
> 第一帧绘制跑在会话设置 `privilege` 之前，`AccessPolicy.assertCanApply` 于是在
> `editPermission=undefined` 的 policy 上拒绝，抛出与 `assertCanEdit` 完全相同的
> `Editing is not permitted`。修法是在 `use-presentation-editor-session` 里把那次
> `updatePrivilege` 提前到文档 mount 之前。
>
> 现在 shell 里可以逐步画出来，入口 `?deckDemo=1`（legacy 的 Watch PPT generation
> 录制，8 页 123 shape）。完整证据链与踩坑见 `findings-pptx-write-probe.md`。

legacy 有这个能力，新 shell 没有。生成期间画布上是一个**空的** PowerPoint 编辑器，整个运行过程都空着。

**逐字节证据**：live 草稿 10111 bytes、1 页，与 `blank.pptx` 完全相同；同一次运行的成品 1.6MB。

### 链路与断点

```
officecli  边写边流式吐绘制 op（pptx_mop_skill.go，默认开）      ✅ 到位
bridge     转成任务事件 → task.vibeOps                          ✅ 到位
renderer   usePptxLiveDraft 建空白草稿、组装 VibeReplayFeed       ✅ 到位
执行       VibeReplaySequencer 把 op 编成脚本在编辑器里跑         ❌ 断在这
```

legacy 的执行端在 `PreviewPanel → PptxViewer → PresentationPptxWorkbench`，sequencer 在工作台内部构造。shell 的 `PresentationStage` 直接挂 `PresentationEditorFrame`，在那一层之下。

### 两次尝试都失败，原因不同

**尝试一：把 sequencer 接到 frame 的 controller 上。** sequencer 确实跑起来了，渲染器日志：

```
event=drawing   slide 1 / total 3
event=waiting
event=failed    error: "Editing is not permitted"
```

根因是**同一个编辑器有两套嵌入协议，权限不同**：

| | URL | 权限 |
|---|---|---|
| `PresentationEditorFrame` | `?mode=embed`，`presentation:*` 消息 | ~~无写权限~~ ← **这一栏是错的，见下** |
| workbench | `?officedexEmbed=1&channel=…&sessionMode=…`，nonce 通道 | `documentWrite` |

`officedex-embed-bridge.ts` 明确授予 `documentRead / documentWrite / documentExport / uiDialog`。那句拒绝来自 `access-policy.ts` 的 `assertCanEdit()`。

> ### ⚠️ 更正（2026-09-20）：「frame 没有写权限」已被证伪
>
> 上面那个推断是我从「workbench 那条明确授予 documentWrite」+「frame 这条我读不到声明」倒推出来的 —— **观察到的是拒绝，权限归因是猜的**，当时我也标注了这一点。
>
> 另一条 track 在 `presentation-component/src/officedex-editor-diagnose.ts` 建了行为探针，实测结论：**frame 的编辑器接受 slide 级写入**（`slides.add()` + `sync()` 成功）。所以「frame 没有写权限」是假的。
>
> 真正的问题被收窄了：sequencer 加的不是 slide 而是**形状**（`slide.shapes.addTextBox`，`vibeReplay.ts:562`），那是另一条、权限更敏感的路径。而且 `Editing is not permitted` 这句话**有两个生产者**，光看消息分不出是哪个：
>
> - `AccessPolicy.canEdit()` —— `mode === "edit" && !forceDisconnected && privilege.permissionWithReason.edit.hasPermission`
> - Office.js 的能力授予 —— `#grant.permissions.includes(permission)`
>
> 而 `?mode=embed` **不会**设置 `isEmbeddedPreview`（那个标志要 `mode=preview`），所以编辑器并没有被强制只读，privilege 工厂也确实给了 `edit`。
>
> **这意味着下面「要修的话」那一段也要打折看**：它建的前提是「给 frame 加写权限」，而写权限可能本来就有。探针跑出形状级的结果之前，不要按那个前提动手。

**尝试二：改挂 workbench。** 编辑器报 `Failed to import the PowerPoint file`，画布上出现「AI editor unavailable」、编辑器自己的中文空状态占位，以及**一整个 OfficeDex Agent 面板**（Simplify text / Improve layout / Unify the style）—— 正是这块画布刚被清掉的那套 chrome。比修之前更糟，已回退。

### 结局：接线本来就是对的，我删错了

**实测（`e2e/editor-write-permission-real.spec.ts` + `officedex-editor-diagnose.ts`，在编辑器自己的 realm 里跑）：**

```json
"slideWrite": { "attempted": true, "ok": true }
"shapeWrite": { "attempted": true, "ok": true, "shapesAdded": 1 }
"url":        { "search": "?officedexEmbed=1", "hasChannel": false }
```

**两级写入都成功。** 写权限从来不是问题。而且 frame 实际启动的 URL 是 `?officedexEmbed=1` —— 连「两条协议」这个前提本身也是错的。上面那套「frame 没有写权限 / 要跨团队加权限」的推断，前提和结论全错。

所以 `7e7a6d2` 那个 `useLiveDeckReplay` 接线**本来就是对的**，而我因为一个错误的推断把它删掉了（`9b96338`），连带删掉了只读罩和横幅，把画布退成骨架。另一条 track 把它们恢复了回来，加上「watch a deck being drawn」入口和 CSS 尺寸修复（frame 嵌套深一层，直接子选择器选不中，deck 塌成编辑器 ribbon 的 154px 高），现在 e2e 能把内置录像画进 live 编辑器。

**我上一版写在这里的「当前处置：显示骨架，不挂编辑器」和「要修的话：给 frame 加写权限」都已作废，不要照做。**

### 教训

我观察到的是一句拒绝（`Editing is not permitted`），归因是推的：「workbench 那条明确授予 documentWrite，frame 这条我在压缩 bundle 里读不到声明」→ 把**读不到**当成了**没有**。然后据此得出「跨团队、不是能顺手修的东西」，还动手删掉了正确的代码。

那句 `Editing is not permitted` 有两个生产者（`AccessPolicy.canEdit` 和 Office.js 的能力授予），消息本身分不出是哪个 —— 这正是探针存在的理由。**行为探针花了几分钟，推断花了我两次错误结论和一次误删。**

⚠️ **写 e2e 断言时注意**：我两次都在「画面明显坏掉」的情况下拿到绿灯。第一次断言的是 `.pptx-embed-frame` 可见（iframe 无论如何都会挂载），第二次断言的是文案「Unable to open this presentation」而实际报的是「Failed to import the PowerPoint file」。**断言「容器在」几乎总是太弱，断言具体错误文案则会被换一种说法绕过。**

## 观察这些状态的工具


`?shellFixture=1&deckRun=1` （`src/shell/dev/fixture.ts`）渲染一个生成中的 pptx 任务，五种页状态同屏，不需要后端、不花 credits。

做成 opt-in 而不是第六个种子任务，是为了不让 C1–C10 的基线截图漂移。注意 fake port 的 tasks 是按 folderId 的 Map，一个文件夹只留一个，直接追加会被覆盖——要先 filter 掉同文件夹的再放自己的。
