# S1 — 窗口 chrome & 导航

日期：2026-09-19 ｜ 分支：`develop/1.0`

## 0. 运行环境与证据来源

- **环境：3100 fake（浏览器）**。按 PLAN 2.3，全程在 `createShellCanvas()` 返回 null 的环境下。**3210 dev-real 未验证**。
- 视口固定 1280×720（playwright `devices["Desktop Chrome"]` 默认）。
- spec：`e2e/ui-audit-s1.spec.ts`（19 个 test，全绿）
- 数值：`docs/ui-audit-2026-09-19/S1/measurements.json`（42 个顶层 key）；截图 `screenshots/`（34 张）

---

## 1. 发现

### [S1-001] 文件树的行内操作按钮整体挂在行外，下沿越界 6px，越界部分的点击被下一行抢走
- 壳组合：**C2、C6、C8**。C1/C5/C7 折叠轨下按钮被 `display:none`（nav.css:203）不复现；C3/C4/C9/C10 无树。
- 运行环境：3100 fake（3210 未验证）
- 表面：侧栏 > 文件夹行 "+"，文件行 "⋯"
- 复现：`?shellFixture=1&shell=C2` → 悬停 "MO product launch" 行
- 现象：24×24 的 "+" 顶边落在行的**垂直中线**上，下沿伸进下一行，看上去像属于下面那条文件行。
- 证据：`screenshots/C2-folderrow-hover.png`；`measurements.json → folderAddButton`
  - 行 rect `{top:222, bottom:258, height:36}`；"+" rect `{top:240, bottom:264, height:24}` → **overflowBottomPx = 6**
  - 锚点 `.shell-menu-anchor` rect `{left:177,top:240,right:177,bottom:240,width:0,height:0}`，`position:relative`
  - `getComputedStyle(add).top === "0px"`（CSS 未写 top，used value 落在锚点上沿 = 行中线）
  - `document.elementFromPoint(add.left+12, row.bottom+3)` → **`button.shell-tree-file-open`**，越界那 6px 的点击被下一行抢走（`.shell-tree-file-row` 是 `position:relative`，nav.css:128-129，DOM 在后）
  - 同形 `fileMoreButton`：行 `{top:260,bottom:294,height:34}`，"⋯" `{top:277,bottom:300,height:23}`，**overflowBottomPx = 6**，下一行 top=296
- 根因：`nav.css:89-90` 写 `position:absolute; right:4px` **未写 `top`**。意图包含块是 `.shell-tree-folder-row`（nav.css:22-23），实际包含块是 `Menu.tsx:132` 的 `<div className="shell-menu-anchor">`（`chrome.css:590-592` 的 `position:relative`）——其唯一子元素被绝对定位抽出正常流，它成为 **0×0 flex item**，在 `align-items:center` 下被居中到行中线。
- 类别：行内操作位 ｜ 严重度：**P1** ｜ 同根因其它实例：**2 处**（nav.css:87-88 两个选择器）。同一个 0 尺寸锚点亦是**全部 6 个 `<Menu>` 调用点**面板的包含块（`ModeMenu.tsx:43`、`Sidebar.tsx:99`、`FileTabs.tsx:209`、`FileTree.tsx:228`、`FileTree.tsx:316`、`Composer.tsx:650/667`、`ModelMenu.tsx:101`）→ 见 S1-002，归 S2。
- 双渲染对照：**另一套不复现**。`comfortableCrossCheck`：`.shell-list-pin` 是 `position:static`，`pinOverflowPx = -17.5`；ComfortableList 子树 `[class*='shell-tree-']` 计数 **0**，不经过 `Menu`。**修 nav.css:89-90 不影响首页。**

---

### [S1-002] 折叠轨下右键文件夹，220px 菜单有 177px 在视口外
- 壳组合：**C1（默认首屏）、C5、C7**。C2/C6/C8 展开态锚点在 x≈177 不复现。
- 运行环境：3100 fake
- 表面：折叠轨 > 文件夹图标 > 右键
- 复现：`?shellFixture=1&shell=C1` → 右键第一个文件夹图标
- 现象：220px 菜单只有最右 43px 露在屏幕上，是一条读不出字的白色竖条。
- 证据：`screenshots/C1-rail-folder-contextmenu.png`；`measurements.json → railContextMenu`
  - 菜单 rect `{left:-177, right:43, width:220}` → **可见 43px / 220px（19.5%）**
  - 侧栏 right=52，`clippedBy: "shell-sidebar-body"`（chrome.css:480 `overflow:hidden auto`），`z-index: 60`
- 根因：`FileTree.tsx:228` 用 `align="end"`，`chrome.css:611-613` 把 `.shell-menu[data-align="end"]` 定为 `right:0`，基准是 S1-001 那个 0 宽锚点（right=43）；`chrome.css:594-606` 无视口碰撞检测、无 portal。另一半：`FileTree.tsx:182-186` 的 `onContextMenu` 在折叠轨下仍生效，而触发器已被 `nav.css:203` 设为 `display:none`——看不见的触发器仍能开面板。
- 类别：浮层定位 ｜ 严重度：**P0** ｜ 同根因其它实例：`.shell-menu` 无碰撞检测影响全部 **6 个 Menu 调用点**；"折叠轨锚点过窄"另外命中 `ModeMenu`（`.shell-brand` 36px）与侧栏 footer 设置菜单（width=250 挂 28px 图标），均在 C1/C3/C5/C7/C9。→ **与 S2 重叠，此处只登记我量到的数值。**
- 双渲染对照：不适用。

---

### [S1-003] 标签栏溢出后没有任何可见提示，被挤出去的标签连关闭键都点不到
- 壳组合：**C1–C10 全部十个**。没有一个组合能放下 7 个标签。
- 运行环境：3100 fake
- 表面：顶部标签栏
- 现象：滚动条被两处规则关掉，没有左右箭头、溢出菜单、渐隐遮罩。用户看不出还有几个文件开着，也无法关闭它们。
- 证据：`screenshots/C1-chrome.png`、`C5..C10-tabstrip.png`；`measurements.json → C1..C10`、`tabstrip-C5..C10`

  | 组合 | `.shell-tabs` padding-left | clientWidth | scrollWidth | 溢出 | 7 个里完整可见 |
  |---|---|---|---|---|---|
  | C1/C3/C7/C9 | 132px | 907 | 998 | **91px** | 6 |
  | C2/C4/C8/C10 | 190px | 849 | 998 | **149px** | 5 |
  | C5 | 372px | 667 | 998 | **331px** | 4 |
  | C6 | **510px** | 529 | 998 | **469px** | **3** |

  - C6：第 4–7 个标签 `clipped: true`，其中 4 个 `closeVisible: false`（"Positioning brief"/长中文/长英文/"Scratch notes" 的 × 全部在可视区外）
  - `scrollbarWidth: "none"`，`overflowX: "auto"`，`scrollLeft: 0`；DOM 里 `.shell-tab-close` 计数 7（都在，只是够不着）
- 根因：`chrome.css:161` `scrollbar-width: none` + `chrome.css:164-166` `::-webkit-scrollbar{display:none}` 隐掉唯一溢出指示；`FileTabs.tsx:87-133` 无溢出菜单/滚动按钮/`scrollIntoView`。C5/C6 极端值来自 `chrome.css:149-151`：docked 时 padding-left = `calc(nav-w + task-w)` = 510px。
- 类别：溢出/可达性 ｜ 严重度：**P1** ｜ 同根因其它实例：**1 处**。同样"隐藏滚动条"的模式在 `chrome.css:481` `.shell-sidebar-body`（`scrollbar-width: thin`）上不复现。
- 双渲染对照：不适用。
- 附注：点半露标签时条会滚动，但那是浏览器对 `focus()` 的默认 `scrollIntoView`，非代码行为。`tabstrip-active-in-view`：`scrollLeft: 0`。

---

### [S1-004] 状态栏文件名被硬切，无省略号无 tooltip；负责省略的 CSS 选择器打空
- 壳组合：**C5–C10**（状态栏只在 `!home` 可见）。C1–C4 下 `.shell-workspace` 带 `hidden`，rect 为 0×0（app.css:38-40）。
- 运行环境：3100 fake（3210 未验证）
- 复现：`?shellFixture=1&shell=C6` → 点开长中文名标签
- 现象：`二〇二六年第三季度…现场执行三` 在第 497px **从字符中间切断**，无 `…`，无 tooltip，完整文件名不可恢复。
- 证据：`screenshots/C6-statusbar-longname.png`；`measurements.json → statusbarLongName`、`statusbar`
  - `.shell-statusbar-facts`：`scrollWidth 566` vs `clientWidth 497` → **溢出 69px**
  - 内层 `<span>`：`scrollWidth 566 === clientWidth 566`，`text-overflow: "clip"`，`overflow: "visible"`，`white-space: "nowrap"`，`title: null`
  - 十个组合 `factsSpanTextOverflow` 全部 `"clip"`；`.shell-statusbar` 的 `directSpanChildren: 0`，`directDivChildren: 2`
- 根因：`app.css:152-156` 写的是 `.shell-statusbar > span { … text-overflow:ellipsis }`，而 `StatusBar.tsx:28` 和 `:32` 渲染的是两个 `<div>`。**这条规则匹配不到任何元素**。实际裁切由 `chrome.css:552-559` 的 `.shell-statusbar-facts { overflow:hidden }` 完成，那里没有 `text-overflow`。`StatusBar.tsx:29` 的 `<span>` 也没有 `title`。
- 类别：死 CSS / 长文案 ｜ 严重度：**P2** ｜ 同根因其它实例：**1 处**。
- 双渲染对照：不适用。

---

### [S1-005] 整棵文件树没有任何可见的键盘焦点指示
- 壳组合：**C2、C6、C8**
- 运行环境：3100 fake
- 现象：焦点在移动（`activeElement` 正确、`:focus-visible` 为 true），但屏幕上什么都不画。
- 证据：`screenshots/C6-focus-tree-add.png`、`C2-folderrow-focus.png`；`measurements.json → focusIndicators`

  | 选择器 | `outline-style` | 画出东西 |
  |---|---|---|
  | `.shell-sidebar-item` / `.shell-icon-button` / `.shell-brand` / `.shell-tab-select` / `.shell-tab-bookmark` / `.shell-save-state` / `.shell-share` | solid 2px | ✅ |
  | `.shell-window-close` | solid 1px | ✅ |
  | **`.shell-tree-folder-toggle`** | **none** | ❌ |
  | **`.shell-tree-file-open`** | **none** | ❌ |
  | **`.shell-tree-more`** | **none** | ❌ |
  | **`.shell-tab-close`** | **none** | ❌ |

  判据必须取 `outline-style`：style 为 `none` 时 `outline-width` 仍报 3px。
  `focusAfterTabIntoTree`：从文件夹 toggle 按一次 Tab → 焦点落到 `.shell-tree-folder-add`，`outlineStyle:"none"`、rect `{top:240,bottom:264}` —— **既无焦点环又挂在行外 6px**（与 S1-001 复合）。
- 根因：`chrome.css:25-35` 的 `:focus-visible` 只列了 8 个选择器，`nav.css` 全文无任何 `:focus-visible` 规则。
- 类别：可访问性（WCAG 2.4.7） ｜ 严重度：**P1** ｜ 同根因其它实例：**6 处**（`.shell-tree-folder-toggle`、`.shell-tree-file-open`、`.shell-tree-more`、`.shell-tree-folder-add`、`.shell-tree-file-more`、`.shell-tab-close`）
- 双渲染对照：**另一套同样复现**。`.shell-list-file` 与 `.shell-list-pin` 也不在名单里，nav.css:269-322 无 `:focus-visible`。→ **这是 nav.css 的共用缺陷，S3 会在首页撞到；两套一起修。**

---

### [S1-006] 当前选中的侧栏项没有任何悬停反馈
- 壳组合：**C1–C10 全部**
- 证据：`measurements.json → controlStates["sidebar-home"]`：rest `background: rgb(228,233,236)`，hover 同值 → **`hoverDiffers: false`**。对照 `sidebar-settings`：`rgba(0,0,0,0)` → `rgb(233,237,240)`，`hoverDiffers: true`。
- 根因：`chrome.css:461-463` `.shell-sidebar-item:hover`（`#e9edf0`）与 `chrome.css:465-468` `.shell-sidebar-item.is-current`（`#e4e9ec`）特异度同为 (0,2,0)，`.is-current` 在后恒胜；没有写 `.shell-sidebar-item.is-current:hover`。
- 类别：状态反馈 ｜ 严重度：**P3** ｜ 同根因其它实例：**2 处**（`.shell-tree-folder-row.is-current` nav.css:34 排在 `:hover` nav.css:30 之后；`.shell-tree-file-row.is-current` nav.css:142 排在 nav.css:138 之后）
- 双渲染对照：**方向相反但同族**。`nav.css:250-256` 首页把 `tr:hover` 写在 `tr.is-current` **之前**，结果同样是当前行没有 hover 反馈 —— 家族第 3 个实例。

---

### [S1-007] 整个 chrome 没有一处按下（`:active`）反馈
- 壳组合：**C1–C10 全部**
- 证据：`measurements.json → activeRules`。遍历 `document.styleSheets` 全部规则，含 `:active` 的共 **90 条**，命中 `src/shell` 的只有 **2 条**：`.shell-task[data-placement="floating"] .shell-task-head:active`（agent.css，S4）、`.shell-tree-file-row[draggable="true"]:active`（nav.css:147-149，那是拖拽半透明不是按压）。命中我这八个 chrome 选择器的 **0 条**。另 88 条全部来自 legacy / `@vo-ui` / sheet 编辑器 —— **同一个窗口里 legacy 控件有按压反馈，新壳控件没有**。
- 根因：`chrome.css` 全文无 `:active` 规则。不是某行写错，是这层状态整体没实现。
- 类别：状态反馈 ｜ 严重度：**P3** ｜ 同根因其它实例：**8 处**（`.shell-icon-button` `.shell-sidebar-item` `.shell-tab-close` `.shell-tab-select` `.shell-share` `.shell-save-state` `.shell-tree-folder-toggle` `.shell-tree-file-open`）。全仓完整数待 S5 静态扫描。
- 双渲染对照：**另一套同样复现**。

---

### [S1-008] C1 默认首屏：新建文件夹与所有文件在侧栏完全不可达
- 壳组合：**C1（新用户第一眼）、C5、C7**
- 现象：折叠轨只剩 5 个文件夹图标。点它们切换展开状态但**什么都不出现**；"Folders" 段头连同唯一的 "New folder" 按钮被整条隐藏；折叠箭头也没有。新用户在默认状态下**既无法新建文件夹，也无法从侧栏打开任何文件**。
- 证据：`screenshots/C1-rail.png`、`C1-chrome.png`；`measurements.json → rail-C1`、`railContextMenu.railState`
  - `sectionHeadDisplay:"none"`，"New folder" rect `{width:0,height:0}`，**`newFolderFocusable: false`**
  - `filesHiddenInRail:"none"`、`treeChevronDisplay:"none"`、`folderAddDisplay:"none"`
  - C1 sweep `fileRows: 9` —— 9 个文件行在 DOM 里，全部不可见不可聚焦
  - `customTooltips: 0`，`titleAttributes: 33` —— 折叠轨全部提示靠原生 `title`，全壳无任何自绘 tooltip 组件
- 根因：`nav.css:199-206` 一条规则在 `data-nav-collapsed="true"` 下同时隐掉 `.shell-tree-files`(:199)、`.shell-tree-chevron`(:202)、`.shell-tree-folder-add`(:203)、`.shell-tree-section-head`(:204)。第 204 行连带隐掉了 `SidebarTree.tsx:26-34` 的 "New folder" —— 全壳唯一的新建文件夹入口（`grep -rn "createFolder" src/shell` 仅此一处）。
- 类别：可达性 / 组合选择器 ｜ 严重度：**P1**（落在默认首屏）｜ 同根因其它实例：**4 处**（nav.css:199/202/203/204）
- 双渲染对照：不适用。

---

### [S1-009] editor 模式的侧栏中段是一块 348px 的空白
- 壳组合：**C3、C4、C9、C10**
- 证据：`screenshots/C4-chrome.png`、`C4-sidebar-empty-middle.png`、`C10-sidebar-empty-middle.png`；`measurements.json → editorEmptyBody-C4 / -C10`
  - `bodyChildren: 0`，`bodyText: ""`，rect `{top:226, bottom:574, height:348}`（两组合完全一致）
  - 顶部导航底边到 Recent 顶边 `gapBetweenTopNavAndViews: 372px`；`flex:"1 1 0%"`，`margin-top:16px`
- 根因：`App.tsx:99` editor 模式传 `null`，`Sidebar.tsx:67` 的 `.shell-sidebar-body` 照样渲染，`chrome.css:477-483` 给它 `flex:1` + `margin-top:16px`，一个空 div 占满剩余高度。无 editor 分支的 `flex:0`，也无空态文案。
- 类别：模式分叉 / 空态 ｜ 严重度：**P2** ｜ 同根因其它实例：**1 处**
- 双渲染对照：不适用。
- 附注：`sidebarFork` 实测 C2（agent）侧栏 Tab 停靠点 **34 个**，C4（editor）**7 个**，差 5 倍，供 S6 键盘遍历对齐。

---

### [S1-010] "Show 40 more" 展开后，刚按的按钮被顶出视口，焦点跟着消失
- 壳组合：**C2、C6、C8**
- 证据：`screenshots/C2-showmore-before.png`、`C2-showmore-after.png`；`measurements.json → showMore`

  | | before | after |
  |---|---|---|
  | 文案 | `Show 40 more` | `Show less` |
  | `.shell-tree-file-row` 数 | 9 | **49** |
  | body scrollHeight | 636 | **2076** |
  | clientHeight | 477 | 477 |
  | scrollTop | — | **0**（没滚） |
  | 按钮在视野里 | — | **`lessInView: false`** |
  | 点击后 `activeElement` | — | `button.shell-tree-more`（那个看不见的按钮） |

- 根因：`FileTree.tsx:11` `SIDEBAR_PAGE = 5`，`:122-130` 的按钮把 `revealedFolderIds` 一次性切成全量（`:86-88`），没有第二页；展开后无 `scrollIntoView`/`scrollTop` 调整。`.shell-tree-more`（nav.css:179-197）又没有焦点环（S1-005）。
- 类别：分页 / 焦点管理 ｜ 严重度：**P2** ｜ 同根因其它实例：**1 处**
- 双渲染对照：**另一套不复现**。`FileTree.tsx:63-68` 只在 `density==="compact"` 时传 `limit`。

---

### [S1-011] 文件夹名与行内 "+" 互相压住；键盘聚焦时计数徽标被按钮盖住
- 壳组合：**C2、C6、C8**
- 证据：`screenshots/C2-folderrow-longname.png`、`C2-folderrow-focus.png`；`measurements.json → longFolderName`、`folderFocusWithin`、`folderAddButton.labelRect`
  - 长中文名行：label right = **155**，"+" left = **149** → **重叠 6px**；`labelScrollWidth 588` vs `labelClientWidth 90`（截掉 84.7%），`text-overflow: ellipsis` 生效
  - focus-within 时计数 `<small>` `opacity:"1"`，rect `{left:163,right:169}`；"+" rect `{left:149,right:173}` → **数字整个落在按钮覆盖范围内**
  - 对照：`.shell-tree-file-open` `padding: 8px 26px 8px 7px`（nav.css:157）右侧留 26px；`.shell-tree-folder-toggle` `padding: 8px`（nav.css:49）**无预留**
- 根因：(1) nav.css:49 文件夹 toggle 右内边距没像文件行 nav.css:157 那样留位；(2) nav.css:118-120 只写了 `:hover` 下隐藏计数，没有 `:focus-within` 变体 —— 而按钮显形规则 nav.css:111-116 **是**带 `:focus-within` 的，两条触发条件不一致。
- 类别：行内操作位 ｜ 严重度：**P2** ｜ 同根因其它实例：**1 处**
- 双渲染对照：**另一套不复现**（pin 在独立 `<td>`，nav.css:265-267）。

---

### [S1-012] 文件树的可访问名把名称和计数粘在一起："Archive 202645"
- 壳组合：**C2、C6、C8**（C1/C5/C7 计数被 nav.css:201 隐藏，不复现）
- 证据：`measurements.json → treeAccessibleNames`：五行全部 `ariaLabel: null`、`separator: "none"`，可访问名为 `MO product launch4` / `Archive 202645` / `yirentk0` / `…三个分册）2` / `Documents2`
- 根因：`FileTree.tsx:224-225` `<span>{folder.label}</span><small>{folder.count}</small>` 之间无空白文本节点，`<small>` 无 `aria-hidden`，按钮无 `aria-label`（只有 `title`，`:192`，有文本内容时 title 不参与可访问名计算）。
- 类别：可访问性 ｜ 严重度：**P2** ｜ 同根因其它实例：**1 处**
- 双渲染对照：**另一套同样复现**。`FileTree.tsx:379-382` 首页分组标题是完全一样的写法。→ **S3 会撞到同一条。**

---

### [S1-013] `app.css:66` 的 `min-width: 132px` 已失效，红绿灯安全区实际靠另一条规则兜着
- 壳组合：**C1–C10 全部**
- 证据：`measurements.json → C1..C10` 的 `windowbar.minWidth`，十个组合**全部为 `"0px"`**。实际安全区来自 `chrome.css:146` `.shell-tabs { padding-left: max(var(--shell-nav-w), 132px) }`。实测 C1：窗口控件 `{left:12,right:75}`，侧栏 toggle `{left:99,right:127}`，标签条 left=**132** → 余量 5px。
- 根因：`app.css:63-72` 声明 `min-width:132px`；`chrome.css:118-126` 重新声明 `.shell-windowbar { position:absolute; inset:0; width:100%; min-width: 0; … }`。同为 (0,1,0) 特异度，`App.tsx:19-20` 先 import app.css 再 chrome.css，后者胜。该行连同注释一起是死代码。
- 类别：死 CSS / 平台假设 ｜ 严重度：**P2**（本身无可见缺陷，但它是 macOS 假设清单里最容易被误信的一条）｜ 同根因其它实例：**1 处**；`app.css` 里被 chrome.css 覆盖的 `.shell-windowbar` 属性共 **3 个**（`width`、`min-width`、`padding`）。
- 双渲染对照：不适用。

---

### [S1-014] Home 上 240.8px 的顶栏空间留给了 `visibility:hidden` 的控件
- 壳组合：**C1、C2、C3、C4**
- 证据：`measurements.json → homeReservedActions-C1..C4`（四组合一致）
  - `actionsVisibility:"hidden"`，`actionsWidth: 208.8`，右侧总预留 **`reservedPx: 240.8`**
  - C1 `stripClientWidth 907` / `scrollWidth 998` / 溢出 91px；C2 `849` / 溢出 149px
  - **`wouldFit: true`** 四个组合全成立 —— 释放这 240.8px，7 个标签刚好全部放得下
- 根因：`chrome.css:334-337` `#shell[data-home="true"] .shell-tabs-actions { visibility:hidden; pointer-events:none }`。注释说是刻意保留 DOM "for keyboard/tests"，但 `visibility` 保留布局盒，`.shell-tabs-actions`（chrome.css:268-274 `flex:none`）继续占位。
- 类别：组合选择器 / 布局 ｜ 严重度：**P2** ｜ 同根因其它实例：**1 处**（`grep -n "visibility: hidden" src/shell` 在 chrome.css 只此一条）
- 附注：`visibility:hidden` 元素本来就不可聚焦，注释里"保留给键盘"的理由不成立 —— 实测 C1 下这些按钮 `focus()` 后不会成为 `activeElement`。改 `display:none` 不损失任何现有能力。
- 双渲染对照：不适用。

---

## 2. PLAN 2.5：`WindowBar` 的 macOS 外观假设清单（**本轮不下结论，需在 Windows 构建单独验证**）

`grep -rniE "platform|darwin|win32|isMac|process.platform" src/shell` 只命中**两处注释**（`WindowBar.tsx:72`、`chrome.css:90`），**无任何平台分叉代码**。

| # | 位置 | 假设 | Windows 上的事实 | 实测值（macOS/3100） |
|---|---|---|---|---|
| A1 | `WindowBar.tsx:7-11` `CONTROLS` | close → minimize → fullscreen | Windows 是 minimize → maximize → close，顺序相反 | rect left 依次 12 / 33 / 54 |
| A2 | `chrome.css:118-126` + `app.css:63-72` | 控件簇**左置** | Windows 在**右上角** | 控件簇 `{left:12,right:75}`，十组合一致 |
| A3 | `chrome.css:71-78` 圆形 `::before` | 红绿灯是 12px 圆点 | Windows 是无边框方形按钮 46×32 | 12×12 圆 |
| A4 | `chrome.css:80-88` | `#ff5f57`/`#febc2e`/`#28c840` | Windows 用主题色，close 悬停红底白叉 | `rgb(255,95,87)`/`rgb(254,188,46)`/`rgb(40,200,64)`，**三个都是裸色值，不在 tokens.css** |
| A5 | `chrome.css:90-106` | 字形 hover 才显形且**整簇联动** | Windows 符号常显 | glyph opacity 0 → 1；单按钮 focus-visible 也显形（chrome.css:104） |
| A6 | `chrome.css:87` | 绿键 = 全屏/分屏字形 | Windows 是"最大化"方框，`port.window.toggleFullscreen()` 语义要重定义 | `aria-pressed` 随 `isFullscreen()` 切换，label 改 "Exit full screen"（WindowBar.tsx:43） |
| A7 | `app.css:66` 注释 | 132px 装得下红绿灯 + toggle | Windows 左侧无控件，132px 纯浪费；右侧反需 ~138px | **该声明已失效（S1-013），实际由 chrome.css:146 承担** |
| A8 | `chrome.css:124` `padding-right: 22px` | 疑似为 macOS 可拖拽区留白 | Windows 右侧要留三个系统按钮的宽度 | 窗口栏 `{left:0,right:1280}` |
| A9 | `chrome.css:63-69` | 21×24 命中区 | Windows 系统按钮 46×32，21px 明显偏小 | 每个按钮 width 21，簇宽 63 |
| A10 | `tokens.css:66-67` | 字体栈首位 `"PingFang SC"` | Windows 回落 `"Microsoft YaHei"`，度量不同，固定高度的行都要复验 | `--shell-font` 已确认 |

**结论：本轮不下结论。** A1/A2/A3/A4/A6/A9 六条在 Windows 上**必然**需要分叉；A5/A7/A8/A10 需真机看度量。建议 Windows 构建后单开一轮，复用本 spec 的 `windowControls` 与 `C1..C10` 两个测量点做对照。

---

## 3. PLAN 2.2：i18n —— 四个表面的文案全部硬编码英文

`grep -rn 't("' src/shell` 命中 21 条，**逐条核对后全部是误报**（`params.get("`、`setText("`、`closest("`、`openAt("`、`logShellEvent("`），真正的 i18n 调用数 = **0**，与 PLAN 2.2 一致。
`visibleStrings` 实测：C2 **100 条**、C4 **61 条**、C6 **102 条**、C10 **63 条**用户可见字串。

| 表面 | 硬编码 / i18n | 中英混排点 |
|---|---|---|
| `WindowBar.tsx` | **全硬编码英文** | 无 |
| `FileTabs.tsx` | **全硬编码英文**（Saved/Unsaved/Share/Close/Bookmark/Rename file…/Duplicate file/Remove from library/Save before closing? …） | **有**：`Close 二〇二六年第三季度…docx` |
| `Sidebar.tsx` | **全硬编码英文**（Home/New task/New/Open/Recent/Pinned/Settings/Review changes/Enter sends/Reduced motion …） | 无 |
| `StatusBar.tsx` | **全硬编码英文**（No file open/On this computer/Unsaved changes/All changes saved） | **有**，最重的一处：左侧被硬切的中文文件名 + 右侧英文，见 `screenshots/C6-statusbar-longname.png` |
| `FileTree.tsx`(compact) | **全硬编码英文**（No files yet./Show N more/Show less/New document/New workbook/New presentation/Rename folder…/Remove folder/Pin/Unpin/Move to X …） | **有**：`Actions for 二〇二六年…`、`Move to 二〇二六年…` |
| `SidebarTree.tsx` | **全硬编码英文**（Folders / New folder） | 无 |

---

## 4. 覆盖自报（逐条对到组合号）

### 覆盖到的壳组合
**C1–C10 全部十个**，每个至少跑过一次并截图。证据：`measurements.json` 里 `C1`…`C10` 十个顶层 key 各含五组 rect，`screenshots/C{n}-chrome.png` 十张。

| 表面 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 |
|---|---|---|---|---|---|---|---|---|---|---|
| WindowBar 几何 + 红绿灯安全区 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| WindowBar hover/focus 三态 | ✅ | — | — | — | — | — | — | — | — | — |
| 标签栏溢出量 + 每个标签是否被裁 | ✅ | ✅ | ✅ | ✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ | ✅✅ |
| 标签关闭键可达性 | — | — | — | — | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| 侧栏折叠轨（图标/tooltip/命中区） | ✅ | — | ✅ | — | — | — | — | — | — | — |
| 侧栏模式分叉（按钮集合/Tab 序） | — | ✅ | — | ✅ | — | — | — | — | — | — |
| 文件树行内 hover 操作位 | — | ✅ | — | — | — | — | — | — | — | — |
| 文件树焦点指示 | — | ✅ | — | — | — | ✅ | — | — | — | — |
| Show 40 more 展开前后 | — | ✅ | — | — | — | — | — | — | — | — |
| 状态栏（含长文案） | ✅ | ✅ | ✅ | ✅ | ✅ | ✅✅ | ✅ | ✅ | ✅ | ✅ |
| 控件 hover/focus/active 三态 | — | ✅ | — | — | — | ✅ | — | — | — | — |
| 硬编码文案清单 | — | ✅ | — | ✅ | — | ✅ | — | — | — | ✅ |

（✅✅ = 做了该组合专属的深度测量）

### 明确**没有**覆盖的，以及为什么
1. **C5–C10 下文件树的行内 "+"/"⋯" 未逐个重测。** 只在 C2 做了完整量化。理由：nav.css:89-90 的包含块问题只与 `data-nav-collapsed` 有关，与 mode/home/presence 无关；C6/C8 侧栏几何与 C2 完全相同（sweep 里 `sidebar.width` 均 190px、`folderRows:5`/`fileRows:9` 一致）。**这是推论不是实测，若要当闸门需补测 C6/C8。**
2. **C7–C10 下浮动 TaskPanel 与侧栏/标签栏的叠压。** 属 S4；真正的遮挡只在 3210 上成立（PLAN 2.3），我在 3100 上看到的是压在 `CanvasPlaceholder` 骨架上。
3. **模式切换过渡中间态。** 归 S6，需分帧。我只测了 transition 结束后的稳定态（每次 `open()` 后固定 250–350ms）。
4. **窄视口 / 暗色 / 1024·1440。** 归 S6。S1-003 的溢出量与 S1-014 的 `wouldFit:true` 都是 **1280 专属结论**，窄视口下会恶化，需 S6 复算。
5. **3210 dev-real。** 一次没跑，按 PLAN 由 S4 独占。涉及 canvas 的结论只有一条（状态栏只在 `!home` 可见），已标未验证。
6. **侧栏 footer 设置菜单的内容与溢出。** 归 S7。我只量了触发器的 hover/focus/active 三态，没有展开面板。
7. **Windows 构建。** 按 PLAN 2.5 只出清单，本轮不下结论。

### 遗留的不确定
- **S1-002 的严重度可能被低估**：我在 C1 量到 left=−177，但未测 C5/C7 下 `.shell-agent` 列是否改变锚点 x。两者 sidebar width 同为 52px，预期一致，**未实测**。
- **14 条发现全部给出了 `文件:行` 级根因，无「根因待定」。** 唯一还差一步的是 S1-007 的"同根因其它实例数"——我只数了自己表面上的 8 个选择器，全仓 shell 范围内缺 `:active` 的可点击元素总数需 S5 静态扫描补齐。

### 交付
- `e2e/ui-audit-s1.spec.ts` —— 19 个 test，`19 passed`
- `docs/ui-audit-2026-09-19/S1/measurements.json` —— 42 个顶层 key
- `docs/ui-audit-2026-09-19/S1/screenshots/` —— 34 张，文件名带组合号

**未改任何源文件，未 commit。**
