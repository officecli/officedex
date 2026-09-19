# S4 — 编辑态画布 & 悬浮 agent

**运行环境（全部条目）：`3210 dev-real`**（真 bridge + 真嵌入编辑器，`adapter !== null`）
**覆盖组合：C5 / C6 / C7 / C8 / C9 / C10**（必过范围全覆盖）
**文件类型：docx（Writer，iframe）/ pptx（presentation，iframe）/ xlsx（@shimo/sdk-sheet，同文档直挂）三种各跑通**

spec：`e2e/ui-audit-s4.spec.ts`（27 个用例，全绿）
截图：`docs/ui-audit-2026-09-19/S4/screenshots/`

按 PLAN 2.3，本环境 `adapter` 非 null，`editor/CanvasPlaceholder.tsx` 的 Doc/Sheet/Slides 三套骨架**在此永远不渲染**，不在本报告范围内（归 S6 / 3100）。

---

## 0. 环境与复现方式

```bash
node scripts/dev-real.mjs --port 3210 \
  /tmp/s4-docs/sample.pptx /tmp/s4-docs/sales-report.xlsx /tmp/s4-docs/sample.docx

S4_BRIDGE=<dev-real 打印的 bridge endpoint> \
PLAYWRIGHT_BASE_URL=http://127.0.0.1:3210 \
  npx playwright test e2e/ui-audit-s4.spec.ts
```

两个必须记下来的接线事实（下次谁跑都会撞）：

1. **dev-real 打印的 `?offlinePreview=1&previewToken=…` URL 对新壳无效。** 那是 legacy 渲染器的入口；`src/shell/main.tsx` 只认 `?shellFixture=`/`?forceUpdate=`。新壳的文件来自 UiPort，必须走 **`OpenLocalFile`**：向 bridge `POST /control/file-dialog {"paths":[…]}` 排队一个路径，再点 editor 模式侧栏的 **Open**（`Sidebar.tsx:61` → `files.openFromDisk()`）。
2. **真 bridge 下没有 `?shellFixture=1` 那样的壳组合直达参数。** 十个组合只能靠写 `localStorage["officedex.shell.v1"]`（`state/persist.ts:12`）再加载，而且必须用 `page.addInitScript` 在首个脚本前写入——`goto` 之后再写会输给 `ShellProvider` 挂载时的自持久化，reload 读回默认 C1，整批截图会被归错组合（本次第一轮就踩了）。

---

## 1. 发现

### [S4-001] editor 模式的悬浮面板可以停在窗口控件上，并吞掉红绿灯的点击
- 壳组合：C9、C10（editor 强制 floating）。C5/C6 不复现（docked 无浮层）；C7/C8 同样可复现（agent + floating 走同一份 `useDraggable`）
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel > 拖拽 grip > 顶边贴边
- 复现：拖面板 header 到窗口左上角，直到 `edge` 落在 `"top"` 且 `x` 到达最小值 12；等价持久化状态 `presence={x:12, y:-489, edge:"top"}`
- 现象：面板整体绘制在 `0 ≤ y ≤ 517`、`12 ≤ x ≤ 352`，**压在自绘窗口栏上**；三颗红绿灯从 82% 不透明度的面板 header 底下透出来，且点不动
- 证据：`screenshots/C10-top-tuck-over-traffic-lights.png`；
  `panel = {left:12, top:0, right:352, bottom:517}`，`opacity = 0.82`；
  `document.elementFromPoint()` 打在三颗按钮中心的结果全部是 **`header.shell-task-head is-grip`**：
  `[{label:"Close window",covered:true,topHit:"header.shell-task-head is-grip"},{label:"Minimize window",covered:true,…},{label:"Toggle full screen",covered:true,…}]`
- 根因：`agent/useDraggable.ts:65` —— `edge==="top"` 时 `place()` 把 y 定为 `peek - size.height`（28-517 = -489），`AgentPresence.tsx:27-28` 的 `anchorTucked` 再把元素钳回 `y=0`；x 只被钳到下限 **12**，正好落在 `chrome/WindowBar.tsx` 自绘的 close/minimize/fullscreen 区（实测 12–75px）之上。`agent.css:209-213` 的 `.shell-presence{position:fixed; z-index:200}` 让它盖过整个 chrome，而 WindowBar 没有任何保留区
- 类别：浮层定位 / 拖拽边界 ｜ 严重度：**P0** ｜ 同根因其它实例：**4**（`place()` 的四个 edge 分支 left/right/top/bottom 都把元素钳回视口内而不是真的推出去，top 这一支撞窗口控件，left 这一支撞侧栏——见 S4-008）
- 双渲染对照：不适用
- 备注：桌面构建里这三颗按钮是**唯一**的窗口控件（PLAN 2.5：全仓无平台分叉，没有原生标题栏兜底）。可恢复——grip 仍可拖回，键盘聚焦 grip 后按 `Home` 复位（`useDraggable.ts:177`）——但两条路都不可发现。

---

### [S4-002] 「从未摆放过」的默认位置就压住三种编辑器各自的底部控件条
- 壳组合：C9、C10（两者数值一致；面板是 fixed，不随侧栏宽度移动）。C7/C8 同位置同现象
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel（`presence.x/y === null`，即新用户第一次进 editor 模式）
- 复现：`presence={placement:"docked",expanded:true,x:null,y:null,edge:null}`，1440×900
- 现象：面板占据画布右下角 17%，压住每个嵌入编辑器**自己的**底部控件条
- 证据（1440×900，`presence = {left:1076, top:352, right:1416, bottom:869}`）：
  - `coverRatio = 0.1695`（面板覆盖 `.shell-canvas` 面积的 16.95%）
  - **xlsx**：`under` 角探针 = `bottom-left: div.sm-sheet-tab-container`、`bottom-right: div.sm-sheet-status-bar-wrapper`；工作表标签条 rect `{top:864,bottom:900,left:264,right:1241}` 与面板重叠 165×5px —— `screenshots/C9-default-position.png`
  - **pptx**：`underInFrame` = `bottom-left/bottom-right: div.…ppt-shell__statusbar`，`centre/top-left: rect.rect`（幻灯片本体）；标题页副标题「用策略、定位、爆款与复盘打通账号可持续增长闭环」被截在「闭环」处 —— `screenshots/C10-pptx-occlusion.png`
  - **docx**：`underInFrame` = `top-left/top-right: div.editor-ruler__page-region--horizontal`（横向标尺）、`bottom-*: rect.rect`（正文页面）—— `screenshots/C10-docx-occlusion.png`
  - 面板底 `869` > shell 状态栏顶 `868`（`overlapsShellStatusbar: true`）
- 根因：`agent/AgentPresence.tsx:69` —— 默认位置写死 `x = innerWidth - width - 24`、`y = innerHeight - height - 28`，**只对视口负责，完全不知道下面挂着一个编辑器**。`canvasContract.ts` 没有任何「安全区 / 内容矩形」通道，`editor/EditorCanvasHost.tsx:52-63` 也不上报 —— 悬浮层与画布之间没有协商接口
- 类别：浮层定位 ｜ 严重度：**P1** ｜ 同根因其它实例：**2**（默认位置 `AgentPresence.tsx:69` 与 `useDraggable.ts:92-97` 的 `reset()`/Home 键复位，两处用同一个「右下角 24/28」常量，都会落在同一块被占用的区域）
- 双渲染对照：不适用

---

### [S4-003] 打开工作簿时，shell 自己的状态栏 100% 被 sdk-sheet 的 `position:fixed` 页脚盖住
- 壳组合：C5–C10 全部（与 presence 无关，只要 activeFile 是 xlsx）
- 运行环境：3210 dev-real
- 表面：shell 状态栏 × 工作簿编辑器底栏（接缝）
- 复现：editor 模式打开 `sales-report.xlsx`
- 现象：shell 的 `.shell-statusbar`（文件名 / On this computer / All changes saved）在 xlsx 下完全不可见也不可点；docx / pptx 下正常
- 证据（`.shell-statusbar` rect `{top:868,bottom:900,left:190,right:1440}`，在其竖直中线上取 25%/50%/90% 三点）：

  | 文件类型 | 25% | 50% | 90% | `insideShellStatusbar` |
  |---|---|---|---|---|
  | slides | `div.shell-statusbar-facts` | `div.shell-statusbar-facts` | `span.shell-device` | true / true / true |
  | **sheet** | `div.sm-sheet-tab-container` | `div.sm-sheet-tab-container` | `div.sm-sheet-fullscreent-btn` | **false / false / false** |
  | doc | `div.shell-statusbar-facts` | `div.shell-statusbar-facts` | `span.shell-device` | true / true / true |

  祖先链（`screenshots/C10-xlsx-bottom-bar.png`）：
  ```
  div.sm-sheet-tab-container   position:relative  rect 864–900
  div.sm-sheet-footer-left     position:static    rect 864–900
  div.sm-sheet-footer          position:fixed     rect 864–900   ← 逃逸点
  div.sm-sheet-wrapper         position:static    rect  40–868
  section.spreadsheet-canvas   position:absolute  rect  40–868
  ```
  `overflowsCanvasBy = 32`（页脚比 `.shell-canvas` 底边多出整整 32px，正好是状态栏高度）
- 根因：`div.sm-sheet-footer` 是 `position: fixed`（SDK 自带样式，按**窗口**而非挂载宿主定尺）。shell 侧的可修复点是 `src/canvas/canvas.css:44-47` —— `.shell-canvas > .spreadsheet-canvas { position:absolute; inset:0 }`：`absolute` **不是 fixed 后代的包含块**，所以 `src/shell/app.css:171` 的 `.shell-canvas{overflow:hidden}` 也裁不住它（overflow 不裁 fixed 后代）。要么给 `.spreadsheet-canvas` 加 `transform/filter/contain:paint` 造包含块，要么为页脚预留 36px
- 类别：接缝 / 层叠 ｜ 严重度：**P1** ｜ 同根因其它实例：**1**（三个 adapter 里只有工作簿是同文档直挂，docx/pptx 走 iframe 天然被框裁死；但只要将来任一编辑器改成非 iframe，同一条路径就复发）
- 双渲染对照：不适用

---

### [S4-004] 贴边（tuck）对展开状态的面板完全失效：只把它调成 82% 不透明度，文字与文档内容叠印
- 壳组合：C7–C10（凡 floating + `expanded:true`）
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel > 四个 edge 的任一
- 复现：`presence={x:1412, y:240, edge:"right", expanded:true}`；或直接把面板拖到任意窗口边
- 现象：面板**没有缩起来**，仍是完整 340px 宽、全幅在屏，只是整体半透明；底下的单元格/正文从面板里透出来，两层文字叠在一起无法阅读
- 证据：`screenshots/C10-tucked-right-reload.png`、`screenshots/C10-drag-under-tabs.png`
  - `presenceRect = {left:1100, top:240, right:1440, bottom:757, width:340}`（视口宽 1440 → 一个像素都没出去）
  - `panelRect` 与 `presenceRect` 完全相同
  - `opacity = "0.82"`
  - `--shell-presence-peek-x = "312px"`（算出来了，但没人用它）
  - 四次拖拽落点持久化结果：`right → x:1412/edge:right`、`bottom → y:872/edge:bottom`、`left → x:-312/edge:left`、`top → y:-492/edge:top`，渲染 rect 分别是 `1100–1440`、`bottom 897`、`left 0`、`top 0` —— **每一次都仍然整块在屏**
- 根因：`agent/agent.css:236-253` —— 四条 overhang 规则的选择器是 `.shell-presence[data-edge="…"] .shell-face`，只作用于**折叠态的头像**。展开态的宿主是 `.shell-presence-panel`（`agent.css:317`），不匹配任何一条，于是 `anchorTucked`（`AgentPresence.tsx:20-30`）算出的 `offsetX/offsetY` 无处可用，"tuck" 退化成 `agent.css:222-227` 那条 `opacity: .82`
- 类别：拖拽 / 贴边 ｜ 严重度：**P1** ｜ 同根因其它实例：**4**（left/right/top/bottom 四条规则全都只覆盖折叠态）
- 双渲染对照：不适用

---

### [S4-005] 贴边时面板**内部**的每一个 companion 头像被平移出面板并旋转 90°，一半在视口外
- 壳组合：C7–C10（floating + `expanded:true` + 任一 edge）
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel > header 头像 / 空态头像 / 每条 agent 回复的小头像
- 复现：同 S4-004（`edge:"right"`）
- 现象：header 里的 40px companion 与空态的 44px companion 双双从面板里飞出去，转了 90°，卡在窗口右缘半个在外；header 只剩标题，看起来像丢了图标
- 证据：`screenshots/C10-tucked-right-reload.png`（右缘两坨半截的深色方块）；`screenshots/C10-expanded-tuck-right.png`
  ```
  faces: [
    {transform:"matrix(0,-1,1,0,312,0)", left:1428, right:1468, outsidePanel:true},
    {transform:"matrix(0,-1,1,0,312,0)", left:1432, right:1476, outsidePanel:true}
  ]
  panelRect.right = 1440   viewport.width = 1440
  ```
  两个头像的 `right` 都是 1468/1476 > 1440 —— 已越过视口右缘
- 根因：同 S4-004 的选择器，`agent/agent.css:241-244` 的 `.shell-presence[data-edge="right"] .shell-face` 是**后代选择器**，而 `.shell-face` 在展开的面板里出现在 `agent/TaskPanel.tsx:51`（header）、`:160`（空态）、`:91`（每条 assistant 回复各一个）。规则本意是「唯一那个折叠头像」，实际命中面板里全部头像
- 类别：拖拽 / 贴边 ｜ 严重度：**P1** ｜ 同根因其它实例：**3 个渲染点，运行时数量无上限**（`TaskPanel.tsx:91` 在 `task.messages.map` 里，一段 N 轮对话就是 N 个额外头像一起飞出去）
- 双渲染对照：不适用

---

### [S4-006] 悬浮面板里的 ModelMenu 被面板的 `overflow:hidden` 切掉一半，且本来就会出视口
- 壳组合：C7–C10（凡 floating 面板里的 composer）
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel > composer > 模型菜单（"OfficeDex ⌄"）
- 复现：默认位置（`x:null,y:null`）→ 点面板底部的模型按钮
- 现象：菜单从 composer 向下弹，只能看到上面约一半，第二个选项完全不可见；把面板拖高也只是改变被切掉的比例
- 证据：`screenshots/C10-floating-model-menu.png`
  ```
  menu  = {cls:"shell-menu", left:1076, top:813, right:1356, bottom:925, height:112, z:"60"}
  panel = {left:1076, top:352, right:1416, bottom:869}
  clippedBelow = true          → 面板在 869 处切断，菜单 112px 只剩 56px（50%）
  menu.bottom 925 > viewport.height 900   → 即使不被切也已出视口 25px
  .shell-presence-panel  computed overflow = "hidden"
  ```
- 根因：两条叠加——(1) `agent/agent.css:322` 的 `.shell-presence-panel{overflow:hidden}`；(2) `src/shell` 里 **`createPortal` 调用数 = 0**，`chrome/Menu.tsx:132-155` 把菜单绝对定位在锚点内，没有任何视口碰撞检测（同 S2 已知线索 `chrome.css:594`）。浮层被自己的祖先裁死
- 类别：浮层定位 ｜ 严重度：**P1** ｜ 同根因其它实例：**4**（`chrome/Menu.tsx`、`chrome/ModeMenu.tsx`、`composer/MentionMenu.tsx`、`composer/ModelMenu.tsx` 四个浮层全部非 portal；其中落在悬浮面板内部的是 MentionMenu + ModelMenu 两个）
- 双渲染对照：不适用
- 反向验证（**未复现**）：同一面板里的 MentionMenu 向上弹，`menu={top:385,bottom:725}` 对 `panel={top:352,bottom:869}`，`clippedAbove:false, clippedBelow:false, visibleHeight:340` —— 完整可见。所以问题不是「面板太小」，而是向下弹的那一个没有翻转策略。
- 交叉：这条同时是 S2 的料。

---

### [S4-007] `overflow:hidden` 的面板被浏览器「滚动到焦点」，标题栏永久滚出视图且没有滚动条可以复原
- 壳组合：C7–C10
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel（整块）
- 复现：默认位置 → 点 composer 的模型按钮（任何使面板底部元素获得焦点的操作）
- 现象：整个面板内容上移 36px，`.shell-task-head`（头像 + 「Work with Agent」+ 停靠按钮）被推到面板可视框外；因为容器是 `overflow:hidden`，没有滚动条，用户无法把它滚回来
- 证据：`screenshots/C10-floating-model-menu.png`（面板顶部只剩半个头像，标题消失）
  ```
  panel.scrollTop    = 36
  panel.scrollHeight = 609      panel.clientHeight = 517
  headTop = 316   panelTop = 352   headAbovePanel = true
  ```
- 根因：`agent/agent.css:317-326` —— `.shell-presence-panel` 同时是 `max-height: min(76vh,620px)` + `overflow: hidden`。`overflow:hidden` 的盒子**仍然可被程序滚动**（`scrollIntoView` / 焦点滚动），只是不提供滚动条。内容高 609 > 可视 517，于是任何焦点滚动都变成不可逆位移。正确的分工是 `.shell-task-scroll`（`agent.css:414-420`，本来就是 `overflow:auto`）吃滚动，外层面板应当 `overflow: clip`
- 类别：浮层定位 / 滚动 ｜ 严重度：**P1** ｜ 同根因其它实例：**1**（`src/shell` 里只有 `.shell-presence-panel` 这一处把 `max-height` + `overflow:hidden` 套在含可聚焦控件的容器上；`.shell-menu` 用的是 `overflow:auto`）
- 双渲染对照：不适用

---

### [S4-008] 顶边/左边贴边把面板压在 FileTabs 与侧栏上，z-index 200 稳赢
- 壳组合：C7–C10
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel × `chrome/FileTabs.tsx` / `chrome/Sidebar.tsx`
- 复现：把面板拖到窗口上缘（→ `edge:"top"`）或左缘（→ `edge:"left"`）
- 现象：
  - top：面板 header 画在标签条上，遮住 `sample` 标签的文件名与关闭键，半透明下两层文字叠印
  - left：面板占 `left 0–340`，把 190px 宽的侧栏（模式菜单 / Home / New / Open / Recent / Pinned）整条盖住
- 证据：`screenshots/C10-drag-under-tabs.png`、`screenshots/C10-drag-far-top-left.png`
  ```
  edge=top   presence rect = {left:218, top:0,  right:558, bottom:517}   tabs rect = {0,0,1440,40}
  edge=left  presence rect = {left:0,   top:48, right:340, bottom:565}   sidebar rect = {0,40,190,900}
  z-index: .shell-presence = 200 ｜ .shell-tabs = auto ｜ .shell-menu = 60 ｜ .od-toast-host = 1100
  ```
- 根因：`agent/agent.css:209-213` 的 `z-index:200` 是一个没有和 chrome 协商过的魔数：比 `.shell-menu` 的 60（`chrome/chrome.css:597`）高，比 legacy toast 的 1100（`renderer/ui/styles/components.css:451`）低，而 `.shell-tabs`/`.shell-sidebar` 根本没有 z-index。叠加 S4-004（贴边不真的缩起），面板整块留在这些 chrome 上面
- 类别：z-index / 浮层定位 ｜ 严重度：**P2**（S4-001 是它撞窗口控件时的 P0 特例）｜ 同根因其它实例：**4 个 z-index 取值分布在 4 个文件**（`agent.css:211`=200、`chrome.css:597`=60、`chrome.css:121`=3、`composer.css:390`=180；外加 legacy 的 1000/1050/1100/1200），没有统一层级表
- 双渲染对照：不适用

---

### [S4-009] 一个窗口里三种语言：英文 shell + 中文 Writer + 两套措辞不同的英文编辑器
- 壳组合：C5–C10 全部（与 presence 无关）
- 运行环境：3210 dev-real
- 表面：shell chrome × 嵌入编辑器 ribbon / 状态栏
- 复现：editor 模式依次激活三个标签
- 现象：`<html lang="en">` 的壳里挂着一个 `lang="zh-CN"` 的 Writer；同时两个英文编辑器对同一个概念用不同词（"Home" vs "Start"），且出现 "Efficiency" 这种非 Office 惯用词
- 证据（`screenshots/C10-docx-occlusion.png` / `C10-pptx-occlusion.png` / `C10-xlsx-occlusion.png`）：

  | 文件 | `editorLang` | ribbon 标签 | shell 同屏文案 |
  |---|---|---|---|
  | sample.docx | **`zh-CN`** | 开始 / 插入 / 页面 / 引用 / 审阅 / 视图 / 帮助 | Home·New·Open·Recent·Pinned；`sample.docx On this computer All changes saved` |
  | sample.pptx | `en` | Home / Insert / Draw / Design / Transitions / Animations / Slide Show / Review / View / Help | 同上 |
  | sales-report.xlsx | `en` | **Start** / Insert / Page / Formula / Data / Review / View / **Efficiency** / Help | 同上 |

  Writer 的自带状态栏同屏显示「页数 1/1　节 1/1　字数 0　字符属性」，正下方 shell 状态栏显示 `All changes saved`。
  `document.documentElement.lang = "en"`（shell），`iframe.contentDocument.documentElement.lang = "zh-CN"`（Writer）。
- 根因：三段独立来源。shell 侧：`src/shell` 里 `t("` 调用数 = 0，全部硬编码英文（PLAN 2.2）。Writer 侧：嵌入件只随 runtime 发了 zh-CN 词典，host 没有注入英文词典。sheet/pptx 侧：各自 runtime 自带英文，彼此未对齐术语。`src/shell/editor/canvasContract.ts` 没有 locale 通道，`port/createShellCanvas.ts:22-33` 挂载时也不传语言——**shell 没有任何手段告诉编辑器该说哪种语言**
- 类别：i18n / 接缝 ｜ 严重度：**P1**（三种文件类型 3/3 复现）｜ 同根因其它实例：**3**（三个 adapter 挂载点 `canvas/DocxCanvas.tsx`、`canvas/PresentationCanvas.tsx`、`canvas/SheetCanvas.tsx` 都不传 locale）
- 双渲染对照：不适用
- 备注：按 PLAN 第 9 节第 2 条，shell 全英文硬编码属「跳出 UI 范畴」的工程量；但**编辑器与壳语言不一致**是接缝缺陷，且只有在 3210 才看得见，所以记在这里。

---

### [S4-010] 底部 32px 有三种互相矛盾的行为：双状态栏 / 双状态栏 / 状态栏消失
- 壳组合：C5–C10
- 运行环境：3210 dev-real
- 表面：`chrome/StatusBar.tsx` × 编辑器自带状态栏
- 复现：同 S4-003
- 现象：docx 与 pptx 各自把自己的状态栏画在 shell 状态栏正上方 → 一屏两条状态栏；xlsx 则把 shell 那条整条吞掉 → 一条都不剩
- 证据：
  - docx：Writer 状态栏「页数 1/1 节 1/1 字数 0 字符属性」在 y≈853，shell 状态栏在 y 868–900（`screenshots/C10-docx-occlusion.png`）
  - pptx：「Slide 1 / 8」在 y≈853，shell 状态栏在 y 868–900（`screenshots/C10-pptx-occlusion.png`）
  - xlsx：shell 状态栏三点探针全部命中 sdk-sheet 元素，`insideShellStatusbar: false/false/false`（见 S4-003 表）
  - 三者 shell 状态栏文本恒为 `"<fileName>On this computerAll changes saved"`
- 根因：`src/shell/App.tsx:119` 无条件渲染 `<StatusBar />`，而 `editor/canvasContract.ts` 没有「编辑器是否自带状态栏 / 它的高度」这一项，所以 shell 无从决定让位还是保留。内容本身也高度重复（文件名已在标签页和 `.shell-task-artifact` 里各出现一次）
- 类别：接缝 / 信息重复 ｜ 严重度：**P2** ｜ 同根因其它实例：**3**（三个 adapter 一个也不上报自身 chrome 尺寸；与 S4-002「没有安全区通道」是同一个缺口的两个症状）
- 双渲染对照：不适用

---

### [S4-011] 折叠按钮为一个在 editor 模式下根本不存在的停靠按钮留了 46px 空槽
- 壳组合：C9、C10（`canDock()` 恒 false 的那两个）。C7/C8 不复现（agent 模式下停靠按钮真的在）
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel > header 右上角
- 复现：editor 模式，看面板 header 右侧
- 现象：「–」折叠键离面板右缘 46px，右边是一块空白；agent 模式下那块空白是停靠键
- 证据：`screenshots/C10-pptx-occlusion.png`（「–」在 x≈1357，面板右缘 1416）
  ```
  panelRight = 1256   collapseRight = 1210   gapToPanelEdge = 46
  computed right = "46px"        dockButtonPresent = false
  ```
  header 自身的 `padding-right` 是 16px（`agent.css:375`），所以有 30px 纯死区
- 根因：`agent/agent.css:328-336` 的 `.shell-presence-collapse{position:absolute; top:14px; right:46px}` 把 `16px padding + 26px 按钮 + 4px 间距` 硬编码成一个常量；而 `agent/TaskPanel.tsx:58` 的 `dockable = canDock(state)` 在 editor 模式下为 false（`state/shellReducer.ts:124`），按钮不渲染，槽位却还在
- 类别：行内操作位 / 组合选择器漏写 ｜ 严重度：**P2** ｜ 同根因其它实例：**1**（这是 `#shell[data-mode=editor]` 下唯一被遗漏的浮层内部布局常量，但属于 PLAN 3.8「只为某一个组合写了样式」的典型样本）
- 双渲染对照：不适用

---

### [S4-012] 1024×700 下面板盖住 32% 画布，含工作表标签条——切工作表的唯一入口
- 壳组合：C9、C10
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel × 工作簿
- 复现：视口 1024×700，editor 模式打开 xlsx
- 现象：面板占右侧近三分之一，盖住公式栏右端的展开键、纵向滚动条、工作表标签条与工作簿状态栏的缩放控件
- 证据：`screenshots/C10-1024x700.png`
  ```
  presence   = {left:676, top:172, right:1016, bottom:689}
  canvas     = {left:190, top:40,  right:1024, bottom:668}
  coverRatio = 0.3220
  under = ["top-right: span.fx-expand-icon",
           "bottom-left: div.sm-sheet-tab-container",
           "bottom-right: div.sm-sheet-status-bar-wrapper",
           "centre: canvas."]
  ```
- 根因：面板尺寸是常量 `PANEL_SIZE = {width:340, height:520}`（`agent/AgentPresence.tsx:12`），`useDraggable` 的 `place()` 只做钳位不做缩放（`useDraggable.ts:60-74`），所以窗口越窄，同一块面板吃掉的画布比例越大（1440 宽 17% → 1024 宽 32%）。没有任何「窄窗口自动折叠 / 自动让位」的分支
- 类别：响应式 / 浮层定位 ｜ 严重度：**P2** ｜ 同根因其它实例：**1**（`PANEL_SIZE` 是唯一的面板尺寸常量，但 S4-002 与本条是同一缺口在两个视口下的读数）
- 双渲染对照：不适用

---

### [S4-013] portal 出去的浮层落在 `<body>` 上，继承 legacy `ui-` 设计系统的字体栈
- 壳组合：C5–C10（与组合无关）
- 运行环境：3210 dev-real
- 表面：`renderer/ui/services/toast.tsx` 的 toast host（以及所有走 `createPortal` 的 legacy Modal / dialog）
- 复现：触发任意 toast（本次由 xlsx 的错误 toast 自动触发，见 S4-014）
- 现象：toast 与 shell 用的不是同一个字体栈；西文回退分别落到 Helvetica 与 system-ui
- 证据：
  ```
  toastHostInsideShell = false        toastHostParent = "body"
  toastHostFont = '"PingFang SC", Helvetica, Tahoma, Arial, "Microsoft YaHei", 微软雅黑, 黑体, …'
  shellFont     = '"PingFang SC", -apple-system, "system-ui", "Segoe UI", "Microsoft YaHei"…'
  body 上生效的规则： body { … font-family: var(--ui-typography-font-default); font-size: var(--ui-typography-size-s); … }
  ```
- 根因：`src/shell/app.css:3-13` 把字体设在 `.shell` 上，而 `renderer/ui/services/toast.tsx:147` 的 `createPortal` 目标是 `document.body`——**在 `.shell` 之外**，于是继承的是 `--ui-typography-*`（legacy `ui-` 设计系统）而不是 `--shell-font`（`tokens.css:66`）。`tokens.css:123` 只做了 `--od-font-ui: var(--shell-font)` 这一个方向的桥，没有覆盖 `--ui-typography-font-default`
- 类别：两套设计系统混用 ｜ 严重度：**P2** ｜ 同根因其它实例：**4**（`renderer/ui` 里 4 处 `createPortal`：`Popover.tsx:98`、`Modal.tsx:29`、`services/dialog.tsx:86`、`services/toast.tsx:147`，全部挂 body）
- 双渲染对照：不适用
- 交叉：字体令牌本身与 `DESIGN.md`（Plus Jakarta Sans / Inter）不符，但那是 `index.html` 注释里写明的有意决定（「No webfont link on purpose」），不按缺陷计——归 S5 对账。

---

### [S4-014] 每次打开工作簿都弹「The workbook editor could not start.」，而编辑器明明渲染正常
- 壳组合：C5–C10（只要 activeFile 是 xlsx）
- 运行环境：3210 dev-real
- 表面：`renderer/ui` toast × 工作簿 adapter
- 复现：editor 模式打开 `sales-report.xlsx`
- 现象：顶部弹出 `Not built yet / The workbook editor could not start.` 的错误 toast，同时表格正常加载、可选中单元格、显示真实数据
- 证据：本轮 6 张 xlsx 截图**张张都有**（`C10-xlsx-active.png`、`C10-tucked-right-reload.png`、`C10-1024x700.png`、`C10-floating-model-menu.png`、`C10-top-tuck-over-traffic-lights.png`、`C10-xlsx-occlusion.png`）；toast 矩形约 `{left:487, top:18, right:950, bottom:82}`，`z-index = 1100`，压在 `.shell-tabs`（`{0,0,1440,40}`，`z-index:auto`）上，遮住第二、三个标签的文件名与关闭键
- 根因：**部分待定。** shell 侧的发出点是 `src/canvas/SheetCanvas.tsx:197-203` —— `onError` 收到空串时兜底成这句话，经 `port/createShellCanvas.ts:31` 的 `onUnavailable` 包成 `NotImplementedError("editor-runtime")` 走 toast。为什么 `SpreadsheetCanvas` 在编辑器已经跑起来之后还调一次 `onError('')`，本次没有定位到（怀疑与 `StrictMode` 双挂载 + `key={session.grant.token}` 重建有关，`main.tsx:85` 确实包了 `StrictMode`，页面同时报 `Attempted to synchronously unmount a root while React was already rendering`）。**卡在**：需要在 `SpreadsheetCanvas` 内部加日志才能确认，而本 session 只读，未改源码
- 类别：假错误 / 浮层遮挡 ｜ 严重度：**P1**（每次打开工作簿都撒谎说它没启动）｜ 同根因其它实例：**3 个兜底文案**（`SheetCanvas.tsx:200`、`PresentationCanvas.tsx:176`、`DocxCanvas.tsx:141` 同构；本次只有 sheet 触发）
- 双渲染对照：不适用
- 交叉：toast z-index 1100 压住 FileTabs 这一条，是 S2 已知线索在真环境下的实测确认，把现象交给 S2。

---

### [S4-015] 面板位置按绝对像素持久化，窗口放大后不回到右下角
- 壳组合：C7–C10
- 运行环境：3210 dev-real
- 表面：悬浮 TaskPanel 的持久化
- 复现：在 1280×720 下加载一次（面板落在默认右下角），再把窗口放大到 1440×900
- 现象：面板停在原来的绝对坐标（画布正中偏右），不再是设计意图的右下角
- 证据：1280×720 首次加载后 `localStorage["officedex.shell.v1"].presence = {x:916, y:172, edge:null}`（= `1280-340-24`, `720-520-28`）；改到 1440×900 后 `presence rect = {left:916, top:172, right:1256, bottom:689}`，而同视口下「从未摆放」的默认位置是 `{left:1076, top:352}` —— 相差 160×180px
- 根因：`agent/useDraggable.ts:100-104` 的 resize 监听只调 `place()` 做钳位，不区分「用户摆过」与「窗口把默认位置具体化了」；`AgentPresence.tsx:64-70` 一旦算出默认坐标就通过 `set-presence-position` 写进持久化状态（`state/shellReducer.ts:220`），`x/y === null` 这个「从未摆放」的语义在第一次 resize 后就永久丢失
- 类别：持久化 / 响应式 ｜ 严重度：**P3** ｜ 同根因其它实例：**1**

---

## 2. 查了但**没有**复现的（同样要记，免得下一轮重查）

| 检查项 | 结论 | 数值证据 |
|---|---|---|
| 画布滚动时悬浮层是否跟错位置 | **无缺陷**。`position: fixed` 正确，滚轮 1200px 后面板纹丝不动 | before `{left:1076,top:352,right:1416,bottom:869}` ≡ after，逐字段相等 |
| AttentionBorder 与真实画布对齐 | **无缺陷**。宿主与画布逐像素一致，且正确避开状态栏 | `attention = {190,40,1440,868}` ≡ `canvas = {190,40,1440,868}`；`workspace.bottom=900`，差值 32 = `--shell-statusbar-h`；`attentionChildren = 1` |
| 面板内 MentionMenu 是否被裁 | **未复现**（向上弹，完整可见） | `menu={top:385,bottom:725}` ⊂ `panel={top:352,bottom:869}`，`visibleHeight=340`（= 菜单全高） |
| editor 模式是否真的进不了 docked | **符合设计**。`placement:"docked"` 的偏好被完整保留并在回到 agent 模式时生效 | C6：`data-presence="docked"`, `--shell-task-w:320px`, `.shell-agent` 宽 320, `inert:false`, 无 `.shell-presence`；C10 同一份持久化状态下：`data-presence="floating"`, `--shell-task-w:0px`, `.shell-agent` 宽 0 且 `inert:true`, `.shell-presence` 存在 |
| C5/C6（agent + docked）下浮层是否残留 | **无缺陷** | 两组合 `presence: null`（DOM 中无 `.shell-presence`），`coverRatio = 0` |
| 与嵌入编辑器自带工具栏的 z-index 谁赢 | docx/pptx **不构成 z-index 冲突**：编辑器在 iframe 里，其内部层级无法越过 iframe 边界，shell 面板必然在上。真正的同文档冲突只在 xlsx，且 sdk-sheet 的 `position:fixed` 页脚赢了 shell 状态栏（S4-003） | `under` 探针：docx/pptx = `iframe.writer-embed-frame` / `iframe.pptx-embed-frame`；xlsx = `canvas.` / `div.sm-sheet-*` |

---

## 3. 自报：覆盖了什么、没覆盖什么

### 起环境
**成功。** go1.26.4 在位，`build/officecli` 已 staged，Writer / presentation / sheet 三套运行时都真实挂载。dev-real 在 3210 稳定跑完 27 个用例、4 轮共约 90 次页面加载。未碰 3100，未在 3210 做任何删除操作。

### 壳组合覆盖
| 组合 | 状态 | 说明 |
|---|---|---|
| C5 agent/!home/折叠/docked | ✅ 截图 + 几何 | `C5-xlsx-active.png` |
| C6 agent/!home/展开/docked | ✅ 截图 + 几何 + 停靠列对照 | `C6-xlsx-active.png`, `C6-docked-column.png` |
| C7 agent/!home/折叠/floating | ✅ 截图 + 几何 | `C7-xlsx-active.png` |
| C8 agent/!home/展开/floating | ✅ 截图 + 几何 | `C8-xlsx-active.png` |
| C9 editor/!home/折叠（强制 floating） | ✅ 截图 + 几何 + 默认位置 | `C9-xlsx-active.png`, `C9-default-position.png` |
| C10 editor/!home/展开（强制 floating） | ✅ **深度覆盖**：三种文件类型、拖拽四向、贴边展开/折叠、1024×700、浮层裁切、接缝、语言 | 其余 20 张 |

### 文件类型覆盖
- docx（Writer，iframe）✅
- pptx（presentation，iframe）✅
- xlsx（@shimo/sdk-sheet，同文档直挂）✅

三种都在 C10 下测了遮挡与底部接缝；C5–C9 的几何只在 **xlsx** 下取（面板是 `position: fixed`，其矩形与文件类型无关，已由 C10 三类型同值 `{1076,352,1416,869}` 验证，故未重复）。

### 一个必须承认的过程错误
第一轮的「per-file-type」用例用 `.shell-tab-name` 的文本 `"sample"` 选标签，而 `sample.pptx` 与 `sample.docx` 的标签文字**都是 `sample`**，于是「slides」与「doc」两次跑的都是 Word 编辑器，pptx 从未被打开。已改为按标签序号 `nth(1)` 选取并加断言 `data-file-type === "slides"` 重跑（用例「C10: floating panel over the real presentation editor」），两张误标的截图已删除、其余按真实内容重命名（`C5..C10-docx-default.png` → `C5..C10-xlsx-active.png`）。本报告中所有 pptx 数据来自重跑。

### 明确**没有**覆盖的
1. **C1–C4**：不在本 session 范围（home=true，presence 不渲染）。
2. **`CanvasPlaceholder` 的三套骨架**：按 PLAN 2.3，本环境 `adapter` 非 null，永不出现。归 S6 / 3100。
3. **暗色模式 / 超长文件名 / 键盘 Tab 序**：属 S6 的矩阵维度，未做。
4. **agent↔editor 过渡中间态分帧**：属 S6，未做。
5. **agent 真的在跑任务时的表现**：本次 `task === null`（空态面板）。因此**未覆盖**：`AttentionBorder` 在 `working/reading/writing` 下真的点亮时与画布的对齐（只验证了 `active=false` 时宿主矩形对齐）、`shell-task-steps`/`SuggestionCard`/`QuestionCard` 在悬浮面板窄宽下的排版、以及有多条 assistant 回复时 S4-005 的头像数量。起一个真 agent run 需要平台凭据与 hosted 上游，本 session 未具备。
6. **Windows 构建下的窗口控件位置**：按 PLAN 2.5 本轮不下结论。S4-001 的结论限定在 macOS 约定的自绘控件上。
7. **S4-014 的深层根因**：需要改 `SpreadsheetCanvas` 加日志，只读约束下未做，已标「根因待定」。

### 一条要交给汇总的方法论
本 session 三个 P0/P1（S4-001、S4-002、S4-003）**根因是同一个缺口**：
`src/shell/editor/canvasContract.ts` 的 `CanvasAdapter` 只有 `mount/unmount/show/hide`，**没有任何关于「编辑器占了哪块、它自带多高的 chrome、它说哪种语言」的回传通道**。
于是悬浮层按视口摆、状态栏无条件画、语言无法下发，三件事各自出错。
只补 CSS 修不掉这一类；闸门应当写成「悬浮层的落点必须来自画布上报的安全区」，而不是「面板不许压住某个 class」。

---

## 附录：复现性缺口与一条补充观察（由汇总方于 S4 交付后核验补入）

### 复现性缺口：这份 spec 的 30 个用例 100% 依赖环境变量

`e2e/ui-audit-s4.spec.ts` 里 **30 个 `test()` 全部**以
`test.skip(!BRIDGE, "S4_BRIDGE must point at the dev-real bridge endpoint")` 开头（`BRIDGE = process.env.S4_BRIDGE ?? ""`，`:27`）。

实测：不带 `S4_BRIDGE` 跑，输出是

```
30 skipped
```

**不是 30 passed。** 而 playwright 的退出码为 0，CI 摘要行读起来与成功无异。
S4 交付说明里的「30 cases, all green」在**设了 `S4_BRIDGE` 的前提下**成立；脱离那个前提，这份 spec 是一个恒绿的空壳。

**结论：本 session 的发现不是伪造的**（见下条证据），但**这份 spec 不能进任何自动闸门**，除非：
1. 把 `S4_BRIDGE` 缺失从 `skip` 改成 `fail`（缺环境是配置错误，不是"这条不适用"）；或
2. 由 CI 负责拉起 dev-real 并注入端点。

**证据：环境确实跑过。** `screenshots/C10-default-position.png` 显示的是**真 sdk-sheet**——完整功能区（Start / Insert / Page / Formula / Data / Review）、真单元格数据（Month/Revenue/Cost；January 120 80 / February 150 95 / March 180 110）、底部 Sales 工作表标签栏、右下悬浮 agent 面板。3100 的 `CanvasPlaceholder` 骨架画不出这些。40 张截图时间戳集中在 21:21–21:23。

### [S4-016] 工作簿编辑器已经起来了，却同时弹出「编辑器无法启动」

- 壳组合：C10 ｜ 运行环境：**3210 dev-real**
- 证据：`screenshots/C10-default-position.png`
- 现象：窗口顶部一个 toast 写着 **"Not built yet — The workbook editor could not start."**，而它正下方的 sdk-sheet 工作簿**功能区、单元格数据、工作表标签全部正常渲染**。两件事同屏互相打脸。
- 待定：该 toast 可能由**另一个标签页**的文件加载失败触发（截图里有多个标签），而非当前这个工作簿。**根因待定** —— 要分清需要把 toast 与触发它的 fileId 关联起来，`port/reportPortFailure.ts` 目前不带这个上下文。
- 无论归属如何，有一条是确定的：**用户看到的是「起不来」四个字压在一个正常工作的编辑器上方**。
- 类别：错误归属 / 状态表达 ｜ 严重度：**P2（根因待定）**
- 同根因其它实例数：待定 —— `reportPortFailure` 的全部调用点都缺同一个上下文。

### 同一张截图独立复现了 S2-008

该 toast 横跨并盖住标签栏，与 S2 在 3100 fake 上测得的重叠区一致。
**这是 S2-008 在真 bridge 环境下的独立确认**，说明它不是 fixture 特有的现象。
