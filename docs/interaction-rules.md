# 隐式交互规则清单

这份文档记录 `App.tsx` 与 `components/Shell.tsx` 中**以 effect 或条件分支形式存在、没有名字的交互决策**。

它不是设计文档，是**现状勘测**。每一条都对应今天代码里真实跑着的行为，包括那些看起来奇怪的。写下来的原因只有一个：这些规则是 IA 重构中最容易静默丢失的东西——它们没有名字、没有文档、大多也没有测试，只存在于某个 `useEffect` 的依赖数组和几行条件里。

配套的契约测试在 `src/renderer/test/interactionRules.test.tsx`，测试用例按本文的规则编号索引。**改动这些规则时，先改这份文档。**

行号对应 `63b7b52`。

---

## A. 连接与生命周期

### R-A-01 强制更新时不连接 bridge
`App.tsx:397`

`forceUpdate` 为真时，bridge 事件订阅与 `initialize()` 都不发生。更新闸门期间桌面端保持空闲，没有东西可连。

### R-A-02 设置未加载完不 initialize，但先订阅
`App.tsx:471`

`settingsLoading` 期间只注册事件监听器就返回，不调 `initialize()`。设置里带着 provider 配置，连接必须等它。

### R-A-03 `bridge.reconnecting` 一律忽略
`App.tsx:403`

重连过程本身不向用户报告。只有成功（`reconnected`）和放弃（`reconnect_exhausted`）才有可见后果。

### R-A-04 重连成功后清错误并重新拉取
`App.tsx:407`

`bridge.reconnected` → 清除错误横幅、刷新工作目录列表、刷新最近文件（带当前 `homeWorkspaceId`）。

### R-A-05 bridge 退出不算任务失败
`App.tsx:427`

`bridge.exited` 的处理是：放弃进行中的最近文件加载、`bridgeInterruptionKey++`（下游据此重置）、若没有恢复在途则 `connectAttempt++` 触发一次重建。

**明确不做的事**：不把任何任务标记为失败。OfficeCLI Runtime 的任务活在 stdio bridge 进程之外，重连后会重新附着。判定某个任务是否真的失败，只有后续的 task 事件说了算。

### R-A-06 重连去重
`App.tsx:435`

`bridgeRecoveryPendingRef` 保证同一个中断窗口内多次 `bridge.exited` 只触发一次重建，否则会起多个 bridge 子进程。

### R-A-07 任务终态发系统通知，标题带任务名
`App.tsx:458`

`task.completed` / `task.failed` 各发一条桌面通知，正文用 `taskNotificationBody(task, ...)` 带上任务名。

**为什么**：「一个生成完成了」会逼用户去任务页找是哪一个，而那趟旅程正是要消除的。

### R-A-08 任务终态触发额度刷新
`App.tsx:468`

completed / failed / cancelled 三者都调 `nudgeForTaskTransition()`。

### R-A-09 挂载时补水历史，失败静默
`App.tsx:487`

挂载拉 50 条任务历史灌进 state。失败不报错——实时事件仍然在流。

### R-A-10 有活跃任务时轮询对账，历史是权威
`App.tsx:510`

存在 starting/running/question/plan_review 的任务时，按 `TASK_HISTORY_RECONCILE_INTERVAL_MS` 轮询历史并重放。

**关键**：对账**不限制**在"刷新前的状态"。任务可能在渲染器还以为它停在 plan_review 时就已经走到 failed/completed 了。

### R-A-11 停滞检测独立轮询
`App.tsx:549`

`markStalledTasks` 按 `STALL_POLL_INTERVAL_MS` 跑，`immediate: false`（挂载时不立即跑一次）。

### R-A-12 账户信息随额度模式变化重取
`App.tsx:646`

`whoami()` 的依赖是 `creditStatus?.mode`——额度模式变了（匿名↔登录）就重新取账户。失败静默。

---

## B. 路由与导航

### R-B-01 路由存 sessionStorage，非法值回退 home
`App.tsx:77`

`readStoredAppRoute` 只接受 home / document / spreadsheet / settings / login 五个值，其余一律回退 `home`。解析异常同样回退。

### R-B-02 只有 document 路由才持久化 taskId
`App.tsx:575`

写回 sessionStorage 时，`taskId` 仅在 `nav === "document"` 且选中的是具体任务时才带上。

### R-B-03 自动选中第一个任务
`App.tsx:543`

`selectedTaskID.kind === "auto"` 且存在任务时，自动选中 `taskOrder[0]`。这是冷启动后的默认选择。

### R-B-03b 后端事件凭空创建的任务不抢导航
`App.tsx:452`、`App.tsx:713`

任务事件只做 `applyTaskEvent`，**不改 `activeNav`**。切到 document 路由的只有两条路：本地 `submit()`（`:714`）和显式的 `selectTask()`（`:1018`）。

**为什么**：后端是单通道广播，一个从别处冒出来的任务事件（或历史补水）不该把用户正在看的界面劫走。代价是「凭空出现的任务」只会出现在侧栏列表里，要用户自己点进去。

### R-B-04 完成态文档路由强制切回 home
`App.tsx:571`

`activeNav === "document"` 且该任务已 `completed` → `setActiveNav("home")`。

**为什么**：完成的产物在它自己的套件编辑器里打开，Home 是它下面那层界面。恢复一个旧的完成态 document 路由时也走这条。

### R-B-05 document 路由丢了任务就自己找一个
`App.tsx:582`

`activeNav === "document"` 但 `documentTask` 为空且存在任务时，回退到第一个活跃任务（starting/running/question/plan_review），没有活跃的就用 `taskOrder[0]`。

### R-B-06 选中任务会跨工作目录跳转
`App.tsx:1011`、`App.tsx:825`

`selectTask(taskId)` 时若该任务属于别的工作目录，先 `selectWorkspace` 切过去，再选中。

### R-B-07 切导航前先处理未保存，且会关掉 preview
`App.tsx:1779`

`changeNavigation(key)`：
1. `key === "home"` → 先清空 `stageFirstTask`（见 R-B-08）
2. 目标与当前相同**且**没有 preview 打开 → 直接返回，什么都不做
3. 其余情况走 `runSpreadsheetAction` 包裹（见 G 组），其中若有 preview 先关闭，再切 nav

### R-B-08 点 Home 一定回到真正的 Home
`App.tsx:982`、`App.tsx:1779`

`selectAllHomeFiles` 和 `changeNavigation("home")` 都会清掉 `stageFirstTaskRef` / `stageFirstTaskId`。

**为什么**：Home 是收件箱，不是"当前选中的生产舞台"。清掉这个临时选择，才能保证即使 Home 已经是当前 nav，点它也回得到真正的 Home 界面。

### R-B-09 登录是全页流程，不进 Shell
`App.tsx:1877`

`activeNav === "login"` 时直接返回 `LoginScreen`，不渲染 `Shell`。

**为什么**：在 Shell 里渲染会让工作目录侧栏和内容框架留在登录卡片背后，浏览器跳转交接看起来像卡住的中间态。

### R-B-10 登录后回到来处
`App.tsx:1155`

`openLogin()` 记住进入前的 nav；`returnFromLogin()` 回到它，若来处本身就是 login 则回 home。

### R-B-11 强制更新覆盖一切
`App.tsx:1856`

`forceUpdate && appUpdate.release` 时只渲染 `ForceUpdateOverlay` + 对话框/吐司宿主，Shell 和所有工作面都不渲染。

### R-B-12 Home 在完成态 document 路由下也渲染
`App.tsx:1921`

渲染条件是 `activeNav === "home" || completedDocumentRoute`。与 R-B-04 配合，让切换在一帧内完成、不闪空屏。

---

## C. 任务与生成

### R-C-01 乐观任务：先建本地任务再发 RPC
`App.tsx:675`

`submit()` 立刻用 `local-<时间戳>-<随机>` 建一个本地任务、选中它、切到 document，然后才发 `generate`。RPC 返回后用真实 taskId 提升（`promoteLocalTask`）。

### R-C-02 在途提交用 Map 不用单槽
`App.tsx:279`

`pendingGenerateRef` 是 `Map<localTaskId, PendingGenerate>`。

**为什么**：两个提交可能同时在途，单槽会让第二个覆盖第一个的 prompt、parent 和 conversation。**只有创建它的那次 generate/modify RPC 能解析对应条目**——携带某个 id 的任务事件不能证明它属于哪次提交。

### R-C-03 任务事件不认领在途提交
`App.tsx:445`

事件归约只做 `applyTaskEvent`，不去猜"最新的乐观提交刚拿到这个 id"。

**为什么**：那个假设只在同时仅有一个提交在途时成立。有两个时，老任务的事件会认领新任务的 prompt、parent 和 conversation id，把两条血缘合并成一条。

### R-C-04 generate 失败后的去向取决于来处
`App.tsx:773`

失败时丢弃本地任务、记录错误，然后：`preserveWorkbookContext` → 回 spreadsheet；否则 → 回 home。

### R-C-05 工作簿转 PPT 失败时尝试从历史里捞回来
`App.tsx:734`

`preserveWorkbookContext && documentType === "pptx"` 且 generate 抛错时，最多 6 次、每次间隔 500ms 拉历史，用 `findRecoverableTaskHistoryEntry` 按 parent 血缘（首选）或 sourceFile + 类型（回退）找那个 runtime 其实已经接受的任务。找到就当成功，清错误。

### R-C-06 从 Home 起的 PPTX 生成捕获入场动画
`App.tsx:683`

`options.fromHome && documentType === "pptx"` 时记录 `captureHomeEntryTransition(prompt)`，供 `DocumentWorkspace` 播放入场过渡。其余情况清空。

### R-C-07 非 pptx 剥掉 pptx 专属字段
`App.tsx:184`

`normalizeGenerateInputForGeneration`：文档类型不是 pptx 时删掉 `pptxWorkflow` / `templateId` / `templateVersion` / `templateAssetDir`；不支持 office 生成模式的类型删掉 `generationMode`。

### R-C-08 Home 起的任务按推断路由分流
`App.tsx:879`

`startTaskFromHome` 的四条出口：
- `needs_source` → 抛错（catalog 清洗必须有源文件）
- `catalog_cleanup` → 打开工作簿、发 preview token、切 spreadsheet、预选 catalog 工具并自动扫描
- `xlsx` → 建新工作簿会话、切 spreadsheet、走 `spreadsheet.startGeneration`
- 其余 → 走 `submit`

### R-C-09 附件文本在前端读出来内联进 prompt
`App.tsx:888`

`referenceTextFiles` 通过 `readLocalTextDocuments` 读取后用 `buildReferenceTextPrompt` 拼进 prompt；`referenceDirectory` 以 `Reference directory: <path>` 追加。

**为什么**：runtime 在另一个进程里，打不开用户的文件。

### R-C-10 修改指令落在用户正在看的那份产物上
`App.tsx:215`

`findModifySourceTask` 优先用 `preferredTaskId` 指定的任务（若它确有产物），否则倒序找会话里最近一个有产物的任务。

**为什么**：回退到"会话里最新的产物"曾把本该发给已停止那份 deck 的指令，发给了碰巧先完成的另一份。

### R-C-11 产物取正式的，没有就取部分的
`App.tsx:211`

`sourceArtifactFor(task)` = `task.artifact ?? task.partialArtifact`。

**为什么**：集中在一处，是因为部分产物过去只活在 preview 状态里，导致任何向任务模型问"这次运行产出了什么"的消费者都得到空——失败的运行打不开，修改指令也会悄悄落到同会话里更老的 deck 上。

### R-C-12 失败确认以"看见"为准
`App.tsx:635`

只有 `activityVisible`（活动列表真的在屏幕上）时才把当前失败任务写入 `seenFailures`。

**为什么**：红点不能比确认它的那次访问活得更久，但也不能没看见就消。

### R-C-13 侧栏信号取最高优先级
`App.tsx:628`

一个信号，优先级：needs-you > running > 未读失败。

### R-C-14 侧栏文档列表：文件覆盖任务，上限 40
`App.tsx:595`

最近文件按路径建索引；有产物的任务覆盖同路径条目；活跃或失败的无产物任务单独列出。按创建时间倒序、取前 40。本地文件没有任务创建时间，用持久化的打开时间，以免新打开的文件被 40 条上限挤掉。

---

## D. 产物打开与编辑器

### D 组的前提

`previewGrant` 同时是三样东西：预览令牌、"正在编辑文档"的模式开关、以及侧栏该不该收起的触发源。这是本组多数规则纠缠的根源。

### R-D-01 xlsx 走工作台，其余走 preview 覆盖层
`App.tsx:1169`

`openInlinePreview(artifact)`：是 xlsx → 撤销旧 token、发新 token、切 spreadsheet 工作台、`documentOpenRevision++`；否则 → 撤销旧 token、发新 token、设 previewGrant/previewArtifact。

**明确不做的事**：绝不把电子表格送进只读的 `sheet_to_html` 查看器。

### R-D-02 打开文档就收起任务栏，所有入口一视同仁
`App.tsx:1219`

`previewGrant` 变成**非空**时 `documentOpenRevision++`。变回 null 时不触发（effect 首行就 `if (!previewGrant) return`），所以关闭编辑器不会再次驱动侧栏。

**为什么**：进入文档工作台就隐藏任务栏——每个套件、每条入口都一样，因为那一步的主角是文档不是文件列表。入口很多：打开完成的产物、从侧栏打开文件、打开历史节点、以及 runtime 在 deck 还在绘制时自己打开的活草稿。最后这条过去是漏网的那个，会让任务栏在整个生成期间一直杵着。

**注意**：工作簿从不落进 `previewGrant`，所以 R-D-01 的 xlsx 分支自己单独报一次。

### R-D-03 新提交的任务完成后自动开编辑器，但活草稿除外
`App.tsx:1229`

`stageFirstTaskRef` 指向的任务变成 completed 时：清标记；若屏幕上这份 deck 不是该任务自己的活草稿（`previewLiveDraft?.taskId !== taskId`）且任务有产物，则自动 `openInlinePreview`。失败或取消时只清标记。

**为什么**：完成不能拿第二次产物导入去顶掉 op 绘制出来的编辑器——屏幕上那份 deck 就是这个任务自己的活草稿，时序器已经存过了。

### R-D-04 从 Home 打开任务：完成且有产物才进编辑器
`App.tsx:1252`

`openTaskFromHome`：completed 且有 `artifact.filePath` → 切 document 并开编辑器；否则 → 走 `selectTask`。

### R-D-05 侧栏条目按 id 前缀分派
`App.tsx:1383`

id 命中任务表 → 走 `openTaskFromHome`；id 以 `file:` 开头 → 在最近文件里按路径或 taskId 找，找到则 `openRecentFile`。

### R-D-06 打开最近文件的三种错误各有出路
`App.tsx:1336`

- 不支持的预览类型 → 提示后交给系统默认程序打开
- 文件不存在 → 错误吐司，附「从列表移除」动作
- 权限问题 → 专门的权限文案
- 其余 → 原始错误文本

### R-D-07 "打开本地文件"只认三件套
`App.tsx:1354`、`App.tsx:75`

对话框过滤 + 拿到路径后再查一次扩展名，只允许 docx/xlsx/pptx。

**为什么**：这条路径是就地编辑文档，所以只提供 OfficeDex 能编辑的格式。手打的路径能绕过对话框过滤，所以这一侧也留着规则。

### R-D-08 关闭编辑器会记住被关掉的 deck 面板
`App.tsx:1396`

`closeInlinePreview`：撤销 token、清 previewGrant/previewArtifact、清 `timelineNodeId`、把当前活跃 vibe 任务记进 `deckPanelDismissedId`。

### R-D-09 删除文档会连坐整条血缘
`App.tsx:1406`

删一个侧栏条目时：先取消该会话里所有活跃任务（`taskNotFound` 错误吞掉），再 `deleteDocument`，再从 state 里删掉整条血缘，再清掉对应的最近文件记录。若当前选中或当前预览属于这条血缘，回 home 并关闭预览。

### R-D-10 批量删除按会话去重
`App.tsx:1454`

折叠分组批量删除时，按 `conversationId || id` 去重——单条删除已经删掉整条血缘了，其余行不必再向 bridge 发重复请求。

### R-D-11 工作簿完成后自动打开
`App.tsx:665`

spreadsheet 会话对应的任务完成、产物是 xlsx、且与当前打开的不是同一个文件时，自动 `openArtifact`，随后刷新最近文件与项目列表。

---

## E. PPTX 活画布

### R-E-01 只有"绘制"才开活画布，大纲不算
`App.tsx:1497`

`liveCandidateTaskId` 的条件：任务有**绘制内容**（`hasPptxDrawingContent(vibeOps)`）**且**状态是 starting/running。

**为什么**：不能因为大纲到了就打开编辑器，用户还要审阅确认它。第一个真正的绘制 op 才是"规划"与"创作"的分界，也是活画布唯一的自动触发点。只认活跃状态，是因为页面加载时的历史重放会在同一批 state 里恢复已完成任务的 primitives，重画一份已完成的 deck 看起来像幽灵生成。

### R-E-02 活草稿一个任务只试一次，且不抢已打开的预览
`App.tsx:1513`

`liveDraftAttemptsRef` 记录已尝试的任务；`liveDraftOpenRef`（即有没有 previewGrant）为真时直接返回。创建 token 后**再查一次**任务是否仍活跃、是否已有预览被打开，任一不满足就放弃。创建失败会把尝试记录删掉以便重试。

### R-E-03 失败的运行把画到一半的 deck 认领为部分产物
`App.tsx:1549`

当前预览的产物所属任务变成 failed/cancelled 时，把该产物写进任务的 `partialArtifact`，并附上 `pptxPartialWork(task)`。

**为什么**：中途停下的运行留下的是一个真实文件——编辑器会话把失败前画好的每一页都存了。提交进任务模型，失败态才能提供「打开已生成的部分」和「继续改这份 deck」，而不是假装什么都没产出。

### R-E-04 指挥棒：还在画就打断，画完了就变成修改
`App.tsx:1263`

`steerPptxTask`：任务是 starting/running 且 runtime 支持 `intervenePptx` → 调 intervene，指令落在下一个页边界；否则 → 退化成对该任务产物的一次普通修改（含只画了一部分的 deck）。

### R-E-05 暂停状态靠调用的确认来推断
`App.tsx:1163`

runtime 是阻塞而不是上报暂停态，所以 `pausePptx` 调用的成功返回就是 UI 唯一的证据，据此把任务 id 记进 `livePausedTaskIds`。

**注意**：这是"活动齿轮"，与交互闸门是两回事——回答问题或审阅计划走的是 `resumePptxTask`。

### R-E-06 活动回放的源头是屏幕上那份文档，不是应用
`App.tsx:1663`

`liveReplayFeed` 只在 `previewLiveDraft` 存在时构造。打开任何别的东西（完成的产物、最近文件、另一个任务的输出）都解析不到草稿，因而没有 feed。

**为什么**：过去这个是按单一的应用级 task id 来的，导致一次生成之后打开的每一份 pptx 都继承那个任务的整条 op 流，并把它重放到一个已经包含这些对象的文档上。

### R-E-07 活草稿一律按"正在演出"处理
`App.tsx:1666`

`buildReplayFeed` 的 `performing` 恒为 `true`。

**为什么**：即使编辑器启动完成时后端已经把整条 op 流发完了，活草稿也是一场演出。把这种情况当成历史追赶会让整份 deck 一次性出现，那就毁掉了 op 模式的产品体验。

### R-E-08 标题栏的重放按钮只重放屏幕上这份
`App.tsx:1645`

`replayPreviewDemo`：任务 id 是内置 demo → 走内置 demo；没有任务 id 或该任务 op 数为 0 → 提示无 op；否则重放这一份。

**为什么**：按钮永远显示（找不到的调试功能比报告空会话更糟）；不用控制台命令那条"任何有 op 的任务"的回退，因为那会安静地画出另一份 deck。

### R-E-09 时间轴节点用当前 live draft 或预览的 taskId
`App.tsx:1473`

`timelineTaskId = previewLiveDraft?.taskId ?? previewArtifact?.taskId`。打开历史节点时用这个 id 构造 artifact；`returnToLatestDeck` 回到该任务的正式产物并清 `timelineNodeId`。

---

## F. 侧栏与外框（Shell.tsx）

### R-F-01 折叠状态分两套，只有一套持久化
`Shell.tsx:60`

`editorMode`（spreadsheet 或正在编辑文档）用内存里的 `spreadsheetCompact`；其余用 `defaultCompact` 并写 `localStorage["officedex.homeSidebarCompact"]`。

**注意**：`spreadsheetCompact` 初值是 `true`。Shell 若**一挂载就处于** editor 模式（例如恢复路由直接进了表格），侧栏开场即折叠——R-F-02 的「继承首页状态」只在运行期从非 editor 切进 editor 时生效，因为 `enteringEditor` 依赖 `previousEditorMode` 这个 ref，而它的初值就等于首帧的 `editorMode`。

### R-F-02 进编辑器继承首页的折叠状态
`Shell.tsx:71`、`Shell.tsx:107`

刚进入编辑器的那一帧用 `defaultCompact`，之后才切到 `spreadsheetCompact`。

**为什么**：把首页的导航状态带进编辑器，而不是让它以折叠的框架开场。

### R-F-03 从编辑器回到 Home 强制展开
`Shell.tsx:106`

`previousEditorMode && !editorMode && activeNav === "home"` → `defaultCompact = false` 并持久化，且本次不套用 `compact`。

### R-F-04 成功打开文件才收起侧栏
`Shell.tsx:179`

`documentOpenRevision` 变化（**只在文件真的打开成功后才变**）且处于编辑器模式且侧栏开着或正在 peek → 收起。

**为什么**：打开过程中要保持导航可见；成功的那一下才关它。

### R-F-05 rail 关闭要多活 160ms 才能卸载
`Shell.tsx:84`、`Shell.tsx:23`

`shut` 驱动几何（列宽、滑出），`closing` 让 rail 多挂 160ms 把这段几何演完再卸载。卸载了的元素没法做动画。

### R-F-06 展开要两帧
`Shell.tsx:126`

`openRail` 先 `setShut(true)` 挂上，再连续两个 `requestAnimationFrame` 后 `setShut(false)`，让 rail 有两个不同位置可以过渡。

### R-F-07 滑动期间单独标记，不能用 shut 代替
`Shell.tsx:95`

`railMoving` 有自己的标记位和 160ms 定时器。

**为什么**：滑动是一次布局动画，主列和里面的每个工作台在这期间都在改尺寸。`shut` 描述不了这个窗口——几何一交给 CSS 它就翻转了，而展开动画还在路上。角落的让位区要靠 `railMoving` 撑满整段时长。

### R-F-08 peek：悬停偷看，120ms 宽限
`Shell.tsx:161`

折叠状态下悬停角落控件 → `peeking` 并滑出，但不提交。移开后等 120ms 再收，让指针能从控件跨到 rail 上而不被抽走。`expandRail` 把 peek 中的 rail 钉住：它已经在屏幕上了，只需要从浮在内容上方改成占一条网格轨道。

### R-F-09 rail 的收起按钮只有一个，且不在 rail 上
`Shell.tsx:195`

唯一的控件在窗口左上角的条带里，无论 rail 朝哪边。

**为什么**：rail 自己不带收起按钮，按钮就永远不会从藏起它的那个指针底下移走。

### R-F-10 rail 收起后角落还给窗口
`Shell.tsx:241`

`railDocked` 为假时渲染 `home-shell__drag`——除了 toggle，角落其余部分用来拖动窗口。

### R-F-11 只有 home 和 settings 有点阵背景
`Shell.tsx:66`

`texturedStage = activeNav === "home" || activeNav === "settings"`，决定是否挂 `usePointerDotField` 的 canvas。

### R-F-12 spreadsheet 不套 stage 外壳
`Shell.tsx:246`

`spreadsheetMode` 时 `children` 直出，不包 `home-shell__content` / `home-shell__stage`，也没有 inspector 位置。

---

## G. 表格未保存拦截

### R-G-01 脏工作簿拦截一切导航
`App.tsx:307`

`runSpreadsheetAction(action)`：不在 spreadsheet 或工作簿不脏 → 直接执行；否则挂起 action、弹未保存对话框，并把上一个挂起的 action 以 `false` 结掉。

### R-G-02 保存失败时对话框不关
`App.tsx:318`

选「保存」但保存失败 → **保持挂起的导航存活**，对话框继续开着。

**为什么**：清掉它会让对话框留在原地，而按钮已经完不成原来的动作了。用户还要能重试保存、明确丢弃、或取消。

### R-G-03 丢弃修改要一并丢掉编辑器授权
`App.tsx:331`

选「丢弃」时重建 `spreadsheetEntry`（不带 grant）。

**为什么**：保留同一个已授权条目挂载，可能让 Sheet SDK 绑在一个 Bridge/API 重启期间已失效的编辑器会话上。不带 grant 重新进入产物会卸载那张画布，恢复的运行随后能用新令牌重开工作簿，哪怕路径没变。

---

## H. 尚未分类的耦合点

以下不是"规则"，但属于同一类隐式约定，重构时同样会丢：

### R-H-01 生产编辑器只认自己的任务
`App.tsx:1928`、`App.tsx:1986`

`productionEditor` / `ProgressivePptxStage.editor` 只在 `previewArtifact?.taskId === 目标任务 id` 时才传下去。

### R-H-02 pptx 与非 pptx 走两套问答通路
`App.tsx:2012`

`DocumentWorkspace` 的 `onAnswer` / `onApprovePlan` 在 pptx 时**传 undefined**——pptx 的问答由 `ProgressivePptxStage` 自己接管。

### R-H-03 图片/GIF 的"继续编辑"是再生成不是修改
`App.tsx:2022`

`onContinueEditing` 对 img/gif 调 `continueGeneration`（把当前产物当参考图传回去），其余类型调 `continueModify`。

### R-H-04 文件拖拽只在 Home 生效，落点由悬停时记录
`App.tsx:1046`

原生拖放不带坐标，所以 dragover 期间记录的 `homeDropZone` 决定路径去哪：`workspaces` → 逐个加为工作目录；`intake` → 交给 Home 的输入区。**故意只在 Home 激活。**

---

## 统计

| 组 | 条数 |
|---|---|
| A 连接与生命周期 | 12 |
| B 路由与导航 | 12 |
| C 任务与生成 | 14 |
| D 产物打开与编辑器 | 11 |
| E PPTX 活画布 | 9 |
| F 侧栏与外框 | 12 |
| G 表格未保存拦截 | 3 |
| H 未分类耦合点 | 4 |
| **合计** | **77** |
