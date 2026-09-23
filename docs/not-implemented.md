# 尚未实现的需求台账

新 IA 的 UI 层先于服务层落地，所以界面上有一批控件的背后是空的。本项目的处理
原则（2026-09-18 拍板）：

> - **UI 服从 UI 层的实现**——界面不因为功能缺失而改动，按钮留在设计放它的位置。
> - **功能服从服务层的实现**——服务层有多少能力就是多少，不假装。
> - **有 UI 但无功能 → 先做 UI，点击时提示「尚未实现」。**

理由是第三条隐含的那个反面：一个点了没反应的按钮，用户分不清是功能没做、
还是自己的文件坏了。**沉默是三种结局里最差的一种。**

两套机制实现它：

- 服务层抛 `NotImplementedError`（`src/shared/notImplemented.ts`），shell 侧
  `reportPortFailure` 把它显示成一条 notice（"Not built yet"），真失败显示成
  error（"That did not work"）。两种是不同的事，说法也不同。
- 完全没有 `UiPort` 方法可调的控件，直接调 `notBuiltYet(feature, message)`。

闸门：`src/shell/test/deadControls.test.ts` 静态扫描 `src/shell` 下所有
`<button>`，没有任何 handler 的一律报错。**这条闸门不许放行。**

---

## 一、服务层有方法、但实现仍不完整（部分能力已接入）

| feature key | 界面位置 | 缺什么 | 归属阶段 |
|---|---|---|---|
| `agent.applySuggestion` | 任务面板的 "Review and apply" | 已接入文件级 artifact apply：Review 修改先写独立副本，用户确认后才替换源文件；运行中的编辑器视图仍需重新打开源文件才能显示替换后的 bytes | 已接上（Office 三件套统一） |
| `agent.undoSuggestion` | 任务面板的 "Undo" | 已接入进程内源文件快照恢复；应用重启后快照失效，且源文件发生外部变化时不会强行恢复 | 已接上（Office 三件套统一） |
| `agent.pause` / `agent.resume` | 任务面板的暂停/继续 | 只有 pptx 有 `pausePptx` / `resumePptxLive`。其它类型的 run 没法在边界上按住 | 需 runtime 推广 |

## 二、`agent.send` 的部分字段仍受 runtime 协议限制（发出 `notice` 事件）

Composer 完整采集这些字段。mentions 和 reference 已转成明确的 prompt 上下文；
只有没有本地路径的 attachments，以及尚未接入 runtime 的权限模式，会发出 notice。

| 字段 | 缺什么 |
|---|---|
| `mentions` | 已将 `@文件/@文件夹` 名称拼入 prompt；runtime 仍没有结构化 mentions 字段 |
| `attachments` | 桌面原生选择的附件现在带绝对路径并写入 prompt 上下文；浏览器拖入或无法提供路径的附件仍会提示。runtime 尚无结构化附件输入，因此不会自动读取或嵌入附件内容 |
| `reference` | 已将选区文本拼入 prompt；`modify` 仍收整份文件，没有只改这一段的结构化入口 |
| `permission` | 只有 `full` 是可选的，它走当前的直接写入路径。`review` / `custom` 在菜单里点了出提示，不会再变成一个发出去的值 —— 详见下面第三节同名条目 |
| `modelId` | **没有任何消费者，是个死字段。** `GenerateInput` 没有 model 字段，runtime 也没有按消息选模型的入口；真正决定用哪个模型的是 `settings.llmProvider`，而桌面端只存一个 provider。模型选择器因此改成了「切换当前 provider」（`ModelPort.select`），选了确实会生效。这个字段留在 `SendInput` 里只是还没摘 |

## 三、完全没有 `UiPort` 方法的控件（调 `notBuiltYet`）

这些是 UI 层为一个还不存在的能力画的，连可调的接口都没有。

**2026-09-18 起新 shell 成为应用入口（`/`），旧 UI 退到 `/legacy.html`。**
所以下面这一节从「界面上有个按钮没反应」升级成了「这个能力用户现在够不着」——
旧 UI 是唯一还有账号、计费、垂直连接器、图片与预览界面的地方，而没有任何入口链接到它。
强制更新闸门已经随入口一起搬进 shell（`src/shell/chrome/UpdateGate.tsx`），
其余尚未搬。

| feature key | 界面位置 | 说明 |
|---|---|---|
| `share` | 文件标签栏 "Share" | 已接入系统分享（可用时）或复制本地路径；协作链接、权限和邀请成员仍未立项 |
| `file-more-actions` | 文件标签栏 "⋯" | 重命名、创建副本、置顶和移出库已经接入；版本历史、导出和打印仍未接入 |
| `settings-panel` | 侧栏齿轮 | UI 层没做设置面板。模型和权限控制现在在 composer 里 |
| `dictate` | Composer 麦克风 | 走浏览器的 Web Speech API，听写中麦克风有可视状态、再按一次停止。没有这个 API 的宿主（打包后的 webview 视版本而定）才提示；自建语音识别未立项 |
| `composer.permission.review` / `composer.permission.custom` | Composer 权限菜单第 2/3 档；侧栏齿轮菜单的 "Review changes" | runtime 没有「先给用户看、确认后再写」的闸门，所有 run 都直接写。两档保留在菜单里但点了只出提示，四处默认值都已改为 `full`，读取时还会丢掉旧版本存在盘上的 `review`。Custom 更早一层就是空的：没有任何界面能写 `settings.customInstructions` |
| `home-highlights` | Agent 首页 "Feature highlights" 的卡片 | 仓库里没有任何功能介绍视频素材，所以只出货架不接播放器。卡片、轮播、键盘导航都是真的，点击出提示。素材到位后放进 `public/assets/highlights/{id}.jpg`（DOM 上的 `data-asset` 就是契约），再把播放器接回来 |
| `composer.image.model` | 图片模式 composer 的模型菜单（Seedream 5.0 Pro / GPT Image 2 / Nano Banana 2） | 图片 runtime 自己选模型：hosted 路径 CLI 写死 `hosted/image`、external 路径只读配置里的 `image_model`，没有按请求覆盖的参数。四个选项照原型列出，只有 Auto 可选，其余点了出提示并标 "Soon"。要真做得先在 officecli `office.generate` 加 `image_model` 参数、平台侧按 profile 计价，再把 `ImageGenerationInput.modelId` 透传下去（字段已在契约里） |

### Writer 的界面语言（2026-09-19）

Writer 自己**不加载文案、不选 locale**——`writer-i18n.ts` 原话是「该模块不加载资源、
不选择 locale、不订阅状态，也不调用 setLocale」，这四件都是 host 的事。
`scripts/sync-writer-component.mjs` 现在把两个 namespace 的词典内联进
`public/writer/host-runtime.js` 并注册；在这之前 host 只装了 runtime 没装词典，
Word 编辑器整条工具栏渲染的是 `toolbar.start` / `statusbar.words 0` 这样的原始 key。

**剩下的缺口是 writer 仓库只有 `locales/zh-CN.json`，没有英文词典。**
所以英文系统上 Word 编辑器是中文界面（工具栏 chrome 的
`suite-components-toolbar-kit` 两种语言都有，会跟随系统）。
这不在本仓库能修的范围内；writer 侧补出 `locales/en-US.json` 当天，
`collectWriterLocaleResources` 会自动带上，这里不需要改任何代码。

## 四、已经删掉的（不是「未实现」，是不该存在）

2026-09-18：新 shell 成为入口后，界面上**编造事实**的部分被删除，而不是继续挂着
「尚未实现」的提示。区别在于：一个没反应的按钮只是没用，一个编造的数字是错的答案。

| 删掉的 | 它原来说什么 |
|---|---|
| 状态栏的文档事实 | 每个文档都是「Page 1 of 1 · 739 words · English (US)」，每个 deck 都是「Slide 3 of 6」，每个工作簿都是「Sheet 1 of 1 · B6」。固定字符串，与文件内容无关。页数、字数、光标位置都属于内嵌编辑器，`canvasContract.ts` 没有渠道问它们——等有了再作为真数字回来 |
| 状态栏的缩放 | 永远显示 100%，点了不动 |
| 侧栏账号 chip | 「Flora · Personal workspace」——一个谁都不叫的名字，旁边是一个不存在的工作区 |
| 整条 ribbon（871 行） | 一整套逐个 tab 画出来的 Office 工具栏，背后一个都没接。格式化属于挂载在画布里的编辑器，而那些编辑器自带工具栏——shell 这一份是一张图片，画的是用户在下面两行已经能用的控件 |

`src/shell/port/fake/` 的种子文档**保留**：打包后的 app 走真服务
（`hasDesktopBackend()`），永远不会显示它们；它们只服务于浏览器预览和 9 个测试文件，
也是共享契约测试「一套契约、两个实现」里的那一个实现。

## 六、画布接缝上等实现的三处（2026-09-18 新增）

这三处和上面几节不同：**UI 层已经写完并有测试守卫**，等的是 `CanvasAdapter` 的
实现方（`src/canvas/createDesktopCanvas.tsx` 与三个内嵌编辑器）。没有实现时行为是
安静降级，不是报错——所以不会有「点了没反应」的按钮，但也确实少了一层表达。

| 接缝 | UI 层已有 | 缺什么 |
|---|---|---|
| `showDraft` / `onDraftAction` | `useDocumentDraft` 决定草稿何时存在、属于哪个文件，文档内的 Apply 走 `agent.applySuggestion`（同一个 port 调用） | 没有任何适配器实现这两个可选方法。建议因此只出现在面板里，而不是出现在它要改的那段文字旁边 |
| 注意力光边的目标矩形 | `AttentionBorder` 接受一个 box，没有就框住整块画布（`AttentionBorder.test.tsx`） | 契约里没有「agent 正在动这一段」的坐标通道。shell 看不进已挂载的编辑器，段落级高亮只能由适配器给 |

`CanvasDraft` 的形状是**提案**：一个 text、一个目标、一个动作。定得这么小是因为
docx / xlsx / pptx 三边能达成一致的东西本来就不多，而每加一个字段，三个编辑器都要
各自实现一遍。

## 七、已经接上的

| feature key | 接上的日期 | 做了什么 |
|---|---|---|
| `files.create` | 2026-09-19 | `App.CreateBlankDocument()` 生成并注册真实 DOCX/XLSX/PPTX 包；shell 通过 `FilePort.create()` 创建后直接打开，不再依赖 prototype seed |
| `open-local-file` | 2026-09-18 | 新增 `FilePort.openFromDisk()` ← `App.OpenLocalFile()`。补上的关键接缝是 `localstore.RegisterLocalDocument`：原来 `OpenRecentFile` 只写 `recent_files`，而文件列表读的是 documents 投影，所以本地打开的文件「被记为最近打开、却哪里都列不出来」。文件不复制不移动，落在默认文件夹，重复打开复用同一个 document id |
| `canvas-selection` | 2026-09-18 | `CanvasAdapter.onSelection` 从「有订阅、无推送」接成整条链：Writer 的 `writer:selection-changed` → `DocxCanvas` 转成标签 → `SelectionProvider` → composer 引用块 → `SendInput.reference`。**文字不在推送里**：Writer 的选区摘要不含文本，取文本只能 `capture("selection")`，而 embed 只保留一个被 track 的 scope（`writer/apps/officedex-embed/src/agent-editing.ts`），光标一动就 capture 会作废 agent 正等着 apply 的那个 id。所以新增可选的 `resolveSelection()`，只在按下发送时取一次 |
| `canvas-selection`（xlsx / pptx） | 2026-09-18 | 三种文件类型都能产生引用了，各自用自己唯一可用的信号：**xlsx** 有真事件（`activeSheet.addRangeListener`），推地址（`Forecast!B2:D10`），发送时 `readSelection()` 取单元格并拼成 TSV；**pptx 没有选区事件**，轮询 `inspect()` 又是整个 deck 的快照（贵两个数量级），所以改用**窗口重新获得焦点**作为触发——用户从编辑器里抬头看向 agent 的那一刻，正是引用该出现的时刻，代价是每次抬头一条轻量脚本（`PRESENTATION_SELECTION_SOURCE`，只读选中项），工作时零开销 |

## 八、待确认的一件事

`PermissionMode` 的三个取值看语义就是 suggestion 的产品外壳：

- `review` = 改动落地前我要看一眼 → 也就是 suggestion 卡片
- `full` = 你直接改 → 也就是今天 xlsx/pptx 的行为
- `custom` = ？需要 UI 层给定义

如果这个理解成立，那第一节里 suggestion 的状态不是「功能没做完」，而是
**「xlsx 和 pptx 目前只支持 full 模式，docx 将先支持 review」**——同一件事，
后者是个能对外说的产品状态。
