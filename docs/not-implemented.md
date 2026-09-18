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

## 一、服务层有方法、但实现缺失（抛 `NotImplementedError`）

| feature key | 界面位置 | 缺什么 | 归属阶段 |
|---|---|---|---|
| `files.create` | Home 上三个 "Blank document / workbook / presentation" 按钮 | 需要空白 docx/xlsx 种子文件（现在只有 `blank.pptx`），以及一个产品决定：新文件什么时候真正落盘。Office 在首次保存前不写任何东西，`FileMeta.dirty` 正好能表达这个状态 | S2 遗留 |
| `agent.applySuggestion` | 任务面板的 "Review and apply" | 桌面端没有「先算完、攒住、等人点」这个模型。docx 结构上最接近（run 返回 `{summary, edits[]}` 之后代码立刻就 apply 了），xlsx/pptx 是边想边写的，没有可以停的位置 | S4-2，待与 runtime 对齐，见 `suggestion-alignment.md` |
| `agent.undoSuggestion` | 任务面板的 "Undo" | **没有任何回滚原语**。三个编辑器都没暴露 undo 协议，`DesktopAPI` 里也没有版本/快照恢复 | 同上 |
| `agent.pause` / `agent.resume` | 任务面板的暂停/继续 | 只有 pptx 有 `pausePptx` / `resumePptxLive`。其它类型的 run 没法在边界上按住 | 需 runtime 推广 |

## 二、`agent.send` 收得到、但传不下去（发出 `notice` 事件）

Composer 完整采集了这四样，`generate` / `modify` 一样都不接。run 照常发出去，
被丢掉的部分明确告诉用户（"Sent without mentions or attachments — not supported yet."）。

| 字段 | 缺什么 |
|---|---|
| `mentions` | 透传字段。runtime 的 input 没有位置放「这次对话涉及哪些文件/文件夹」 |
| `attachments` | 最麻烦的一个：`Attachment` 只有 name 和 size，**没有路径**，所以即便 runtime 接受附件，服务层也没东西可交 |
| `permission` | `review` / `full` / `custom`。见下面的待确认事项 |
| `modelId` | 只有内置模型和至多一个自定义模型，选了别的没有意义。目前静默按内置处理 |

## 三、完全没有 `UiPort` 方法的控件（调 `notBuiltYet`）

这些是 UI 层为一个还不存在的能力画的，连可调的接口都没有。

| feature key | 界面位置 | 说明 |
|---|---|---|
| `share` | 文件标签栏 "Share" | 分享需要一套协作/链接体系，本产品是本地文件应用，需要单独立项 |
| `file-more-actions` | 文件标签栏 "⋯" | 菜单里一条都还没有 |
| `settings-panel` | 侧栏齿轮 | UI 层没做设置面板。模型和权限控制现在在 composer 里 |
| `account` | 侧栏头像 "Flora · Personal workspace" | 账号/工作区体系未定。这个名字是占位美术 |
| `zoom` | 状态栏 +/− | 缩放属于挂载在画布里的那个编辑器，`canvasContract.ts` 只有 mount/show/hide/unmount/onSelection，没有缩放 |
| `dictate` | Composer 麦克风 | 语音输入未立项 |
| `comments` | Ribbon "Comments" | 批注未立项 |
| `editing-mode` | Ribbon "Editing" | 编辑/审阅/查看三态未立项 |
| `ribbon-tools` | Ribbon 里**所有**工具按钮 | 整条 ribbon 是完整画出来的工具栏，背后一个都没接。格式化属于内嵌编辑器，而 canvas 契约里没有「应用格式」这个动作。用一条共享提示覆盖全部 |

## 四、已经接上的

| feature key | 接上的日期 | 做了什么 |
|---|---|---|
| `open-local-file` | 2026-09-18 | 新增 `FilePort.openFromDisk()` ← `App.OpenLocalFile()`。补上的关键接缝是 `localstore.RegisterLocalDocument`：原来 `OpenRecentFile` 只写 `recent_files`，而文件列表读的是 documents 投影，所以本地打开的文件「被记为最近打开、却哪里都列不出来」。文件不复制不移动，落在默认文件夹，重复打开复用同一个 document id |

## 五、待确认的一件事

`PermissionMode` 的三个取值看语义就是 suggestion 的产品外壳：

- `review` = 改动落地前我要看一眼 → 也就是 suggestion 卡片
- `full` = 你直接改 → 也就是今天 xlsx/pptx 的行为
- `custom` = ？需要 UI 层给定义

如果这个理解成立，那第一节里 suggestion 的状态不是「功能没做完」，而是
**「xlsx 和 pptx 目前只支持 full 模式，docx 将先支持 review」**——同一件事，
后者是个能对外说的产品状态。
