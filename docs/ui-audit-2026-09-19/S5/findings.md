# S5 机械扫描 — findings

**运行环境：静态扫描**（全文一律如此，无 dev server、无截图）
基数：`src/shell` 9 个 CSS 共 3316 行 / TS·TSX 非测试 8499 行；`src/renderer/ui` 3 个 CSS 共 849 行。

## 0. 清单完成度

| 清单 | 状态 |
|---|---|
| 1 `position:absolute\|fixed` 全量 | ✅ 17 条，逐条给包含块 |
| 2 `overflow` 容器全量 | ✅ 14 个 |
| 3 `z-index` 全量 | ✅ 9 个取值 + 3 处打架 |
| 4 裸色值/px 与令牌偏差 | ⚠️ **半完成** — 93 处裸色值 + 9 处离表字号已出；**与 `DESIGN.md` 对账无法进行**，见 S5-009 |
| 5 `renderer/*` 调用点 | ✅ 25 处；S0-001 的"第二个"有结论 |
| 6 `ui-`/`od-` 冲突面 | ✅ |
| 7 固定尺寸撑爆点 | ✅ 13 个点 |
| 8 组合选择器覆盖率 | ✅ 13 规则块 × 10 组合 |
| 9 硬编码文案 | ✅ 227 条唯一串，重合度 11.5% |

---

## 表 1 — `position: absolute|fixed` 全量（17 条）

| # | 文件:行 | 选择器 | 包含块 | 出视口 | 外层 overflow 裁不裁 |
|---|---|---|---|---|---|
| 1 | `app.css:4` | `.shell` | 初始包含块 | 否 | — |
| 2 | `app.css:27` | `.shell-visually-hidden` | 最近 relative | — | 设计如此 |
| 3 | `app.css:128` | `.shell-attention` | `.shell-workspace`(`:116`) | 否 | 不裁 |
| 4 | `app.css:176` | `.shell-canvas-scroll` | `.shell-canvas`(`:170`) | 否 | `:171 hidden` 裁，设计如此 |
| 5-7 | `highlights.css:158/169/188` | watermark/play/duration | `.shell-highlight-poster`(`:118`) | 否 | poster `:123 hidden` 裁，设计如此 |
| 8 | `composer.css:372` | `.shell-cx-drop` | `.shell-cx`(`:4`) | 否 | 不裁 |
| 9 | `composer.css:388` | `.shell-mention` | `.shell-cx` | **会** | **会被裁** → S5-004 |
| 10 | `agent.css:193` | `.shell-face-badge` | `.shell-face`(`:6`) | 否 | `right/-bottom:-2px` 伸出盒外，离列边 ≥16px，低风险 |
| 11 | `agent.css:210` | `.shell-presence` | **视口**（祖先无 transform/filter/contain，逐个确认过） | 由 `anchorTucked()` 约束 | **逃逸成立**，不被任何祖先 overflow 裁 |
| 12 | `agent.css:329` | `.shell-presence-collapse` | `.shell-presence-panel`(`:318`) | 否 | `right:46px` 是魔数 |
| 13 | `chrome.css:92` | `.shell-window-glyph` | `button`(`:59`) | 否 | 不裁 |
| 14 | `chrome.css:119` | `.shell-windowbar` | `.shell-row--top` | 否 | 不裁 |
| 15 | `chrome.css:595` | `.shell-menu` | `.shell-menu-anchor`(`:591`) | **会**（只有 `left:0`/`right:0`+`top:calc(100%+6px)`，零碰撞检测） | **会被裁** → S5-002/003 |
| 16 | `nav.css:89` | `.shell-tree-folder-add` | `.shell-tree-folder-row`(`:23`) | 否 | **盖住文件夹名** → S5-007 |
| 17 | `nav.css:89` | `.shell-tree-file-more` | `.shell-tree-file-row`(`:128`) | 否 | 不裁（留了 26px） |

**17 条里只有 2 条有风险，而这 2 条覆盖了 shell 全部 9 个浮层入口。**

> 交叉更正：S1-001 实测 `.shell-tree-folder-add` 的实际包含块**不是** `.shell-tree-folder-row`，而是 `Menu.tsx:132` 的 0×0 `.shell-menu-anchor`（`chrome.css:590` `position:relative`）。本表第 16/17 行按 CSS 意图填写，实测以 S1 为准。

## 表 2 — `overflow` 容器全量（14 个）

| # | 文件:行 | 容器 | 值 | 内部什么会被裁 |
|---|---|---|---|---|
| 1 | `app.css:8` | `.shell` | hidden | `.shell-presence` 是 fixed 且祖先无 contain → 逃得掉；其余逃不掉 |
| 2 | `app.css:91` | `.shell-sidebar` | hidden | **footer 设置菜单(250) / ModeMenu(220) / 焦点环** → S5-002 |
| 3 | `chrome.css:480` | `.shell-sidebar-body` | hidden auto | **FileTree 两个菜单(220/230) 横竖双裁** |
| 4 | `app.css:110` | `.shell-agent` | hidden | 停靠 composer 的 4 个浮层 |
| 5 | `app.css:171` | `.shell-canvas` | hidden | 设计如此 |
| 6 | `app.css:149` | `.shell-statusbar` | hidden | 注释明写宁裁不换行 |
| 7 | `app.css:161`+`home.css:5` | `.shell-home` | auto | **同选择器跨文件双写**；首页 composer 向下开的菜单被裁 |
| 8 | `agent.css:322` | `.shell-presence-panel` | hidden | **悬浮 composer 全部 4 个浮层** → S5-004 |
| 9 | `agent.css:417` | `.shell-task-scroll` | auto | 卡片焦点环 1px |
| 10 | `chrome.css:160` | `.shell-tabstrip` | x auto | 标签焦点环；`.shell-tab` 是 relative，任何锚在标签上的浮层会被裁（FileTabs 的 Menu 挂在 `.shell-tabs-actions`，侥幸逃过） |
| 11 | `highlights.css:81` | `.shell-highlights-track` | x auto/y hidden | **全仓唯一一处主动补偿 overflow 裁切的地方**（`:67`/`:86` 注释 + `outline-offset:-2px` + `padding:2px 0 8px`） |
| 12 | `highlights.css:101` | `.shell-highlight-card` | hidden | 设计如此 |
| 13 | `composer.css:71` | `.shell-cx-chips` | auto, max-h 112 | chip 焦点环（`:180`） |
| 14 | `composer.css:394` | `.shell-mention` | hidden | 自身 |

**#2/#3/#4/#8 四个 hidden 裁的是同一样东西 —— `.shell-menu`。**

## 表 3 — `z-index` 全量（9 个值）

| 值 | 位置 | 所在层叠上下文 | 评价 |
|---|---|---|---|
| 3 | `chrome.css:121` `.shell-windowbar` | 根（`.shell` 是 absolute + z-auto，**不建立**上下文） | 够用 |
| 10 | `composer.css:382` `.shell-cx-drop` | **`.shell-cx`**（`composer.css:5 container-type:inline-size` ⇒ `contain:layout` ⇒ 建立上下文） | 局部魔数 |
| 60 | `chrome.css:597` `.shell-menu` | 侧栏/标签栏的在**根**，composer 里的在 `.shell-cx` | 60 < 200 → S5-006 |
| 180 | `composer.css:390` `.shell-mention` | **`.shell-cx`** | 对外等于 auto，空头支票 → S5-005 |
| 200 | `agent.css:211` `.shell-presence` | 根（fixed） | 与 60 打架 |
| 1000 | `components.css:399` `.od-dialog-mask` | 根（portal 到 body） | |
| 1050 | `components.css:584` `.od-popover` | 同上 | |
| 1100 | `components.css:451` `.od-toast-host` | 同上 | `top:max(16px,…)` → 盖住 0–40px 的标签栏 |
| 1200 | `components.css:612` `.od-tooltip` | 同上 | |

三处打架：(1) menu 60 vs presence 200；(2) mention 180 的作用域错觉；(3) shell 段(3–200) 与 ui 段(1000–1200) 之间 800 空档且无令牌表（全仓无 `--shell-z-*`）。

## 表 4 — 裸色值 / 离表 px

**裸色值 93 处**（不含 tokens.css 自身 26 处定义）：

| 文件 | 数 | 典型 |
|---|---|---|
| `composer.css` | 27 | `:14 #c7ced5`、`:242 #f0f1f2`、`:270 #fdecea`、`:530 #fbf5e6` |
| `chrome.css` | 25 | **`:602 #dfe2e6`**、**`:605 #34383c`**、`:633 #edf0f3`、`:638 #9aa8b3`、`:675 #5c6872` |
| `agent.css` | 22 | `:432 #e9edf1`、`:471 #697480`、`:503 #617f6f`、`:672 #cddac9` |
| `nav.css` | 10 | `:35 #374b5b`、`:125 #e2e6e9`、`:247 #f0f1f3`、`:362 #ad5347` |
| `app.css` | 9 | `:215 #eceef0`、`:228/:235 #e2e5e9`、`:259/:260 #edeff1` |
| `home.css` / `highlights.css` / `taskList.css` | **0** | **三个文件 100% 走令牌 —— 证明做得到** |

三类：可直接换令牌的 ≥40 处（`#dfe2e6`≈`--shell-line-strong #d9dfe4`、`#34383c`≈`--shell-ink-title #343a40`、`nav.css:125 #e2e6e9`≈`--shell-line #e4e6e9`）；**令牌表根本没有对应项的 9 处语义色**（见 S5-011）；平台约定色（macOS 红绿灯 `chrome.css:81/84/87`、companion 的 ink-on-ink，`agent.css:17` 注释明说）。

**离表字号 9 处**（令牌只有 10/11/12/14 四档）：`composer.css:517` **9px**、`home.css:106` 13px、`composer.css:422/496` 15px、`composer.css:55` 16px、`agent.css:687` 17px、`agent.css:340` 18px、`home.css:21` 26px、`home.css:97` 32px。另 `composer.css:482 font-weight:450`（令牌完全没有 weight 档）。

## 表 5 — `src/shell` → `renderer/*` 全部 25 个调用点

| 调用点 | 目标 | 视觉 | CSS 带了吗 |
|---|---|---|---|
| `App.tsx:1` ToastHost；`FileTabs.tsx:11` dialog/Input/Modal/toast；`ModelMenu.tsx:4` Input/Modal；`useFolderDialogs.tsx:3` Input/Modal；`EditorHome.tsx:4` Select；`Composer.tsx:14`/`useAgentTask.ts:9`/`useLibraryActions.ts:3`/`reportPortFailure.ts:1` toast | `renderer/ui` | ✅ | ✅ `ui/index.ts:1-2` 自带 CSS，**但 portal 出 `#shell`** → S5-001 |
| **`chrome/UpdateGate.tsx:6`** | `renderer/components/ForceUpdateOverlay` | ✅ | ❌ = S0-001 |
| **`main.tsx:31`** | 同上（`?forceUpdate=` 预览路径） | ✅ | ❌ **同根因第二个调用点，S0 只记了一个** |
| `UpdateGate.tsx:4/5/7`、`main.tsx:29/30`、`fixture.ts:32`、`createShellCanvas.ts:3`、`createShellPort.ts:3`、`shellLog.ts:2` | desktopApi / i18n / useAppUpdate / bridge | ❌ | — |

**关于「S0-001 有没有第二个」的结论：** 按字面定义（绕过 `renderer/ui` 直接拿视觉组件），全仓只有 `ForceUpdateOverlay` 一个组件，**但它有两个调用点**，修的时候两处都要覆盖 —— 正确修法是把 `onboarding-update.css` 挪进 `ForceUpdateOverlay.tsx` 自己的 import。**但同一后果有第二个、更大的机制：portal（S5-001）。**

排除的三个假阳性：`ui/backends/beautiful/index.tsx` 的 33 个无 CSS 的 `od-*` class 只经 `@vo-ui/backend` 被 `PresentationPptxWorkbench.tsx:13` 引用，shell 够不到；`ui/design-tokens.css` 只被 `renderer/main.tsx:9` import，但 `components.css` 对 `var(--ui-` 引用数为 **0**，无影响；`ui/components/*.tsx` 实际渲染的 `od-*` 全部在 `components.css` 里有定义（Modal/Input/Select/Popover/toast/dialog 逐个核过）。

> 交叉更正（S3-004）：最后一句要撤销一半。`Select.tsx:37` 渲染的选项行 **没有 `className="od-menu__item"`**，所以 `components.css:648` 的四条规则全部落空，UA 默认按钮样式透出。「`od-*` 全部有定义」成立，但「渲染时都挂上了」不成立。

## 表 6 — `ui-`/`od-` 与 `@shimo/sdk-sheet` 冲突面

`src/shell` 的 `ui-` class = 0、`--ui-*` 引用 = 0、`od-*` class = 0（shell 自己一律 `shell-` 前缀）。
**唯一真实风险面：`src/shell/tokens.css:105-124` 的 `#shell { --od-*: … }` 共 19 个变量会级联进 `.shell-canvas` 里挂载的真 sdk-sheet 子树。** 若 sdk-sheet 消费同名 `--od-*`，shell 会静默改掉它的外观。**本轮未验证（需翻 node_modules 产物 CSS）→ 交 S4 在 3210 验：打开 xlsx，看表格控件圆角/行高是否等于 `--shell-radius-control 5px`/`--shell-row-h 36px`。**

## 表 7 — 固定尺寸撑爆/截断点

中文 12px 全宽 vs 英文均宽 ≈6.5px，占位约 1.85 倍。

| 位置 | 值 | 判定 |
|---|---|---|
| `composer.css:256` scope/model/permission name | `max-width:160px` | 截断（≈13 中文字） |
| `composer.css:339/342/361` 容器查询档 | 78/88/**62px** | 停靠列 320px 时 `.shell-cx` 内容 ≈268px → 触发 252 档，scope 名压到 **62px ≈5 字** |
| `composer.css:103` chip name | 200px | 截断 |
| `chrome.css:173` `.shell-tab` | min 140px | ✅ tabstrip 是 `overflow-x:auto`，滚动不撑爆 |
| **`highlights.css:205/209`** `.shell-highlight-caption strong` | min-h 45px，**无 ellipsis** | **唯一不截断的标题**（另 9 处 `chrome.css:206/394/457/540`、`nav.css:66/169/286`、`agent.css:396/407/634`、`home.css:195` 全部 nowrap+ellipsis）→ 中文长标题换行把卡片撑高，同行另两张不会 |
| **`agent.css:544`** `.shell-task-button` | h 29px + nowrap，父 `:534` 无 `flex-wrap` | 中文按钮文字横向溢出，三按钮时出列 |
| `app.css:66` | min-width 132px | **死规则** → S5-008 |

**只需改两条**：`highlights.css:209` 补 ellipsis；`agent.css:534` 加 `flex-wrap:wrap`。

## 表 8 — 组合选择器覆盖率（最重要）

`App.tsx:78-83` 挂 **5** 个属性；shell 全部 CSS 里 `#shell[data-` / `.shell[data-` 开头共 **18 条选择器行 / 13 个规则块**。

**每个轴被引用的规则块数：** `data-nav-collapsed` **11** ｜ `data-home` 2 ｜ `data-mode` **1**（且只匹配 `="agent"`）｜ `data-presence` **1**（且只匹配 `="docked"`）｜ `data-loaded` **0**。

| 规则 | C1 | C2 | C3 | C4 | C5 | C6 | C7 | C8 | C9 | C10 |
|---|---|---|---|---|---|---|---|---|---|---|
| `app.css:95` nav | ✓|·|✓|·|✓|·|✓|·|✓|· |
| **`chrome.css:149` mode+home+presence** | ·|·|·|·|**✓**|**✓**|·|·|·|· |
| `chrome.css:334` home=true | ✓|✓|✓|✓|·|·|·|·|·|· |
| `chrome.css:349/355/407/412/470/495/520` nav ×7 | ✓|·|✓|·|✓|·|✓|·|✓|· |
| `nav.css:199/208` nav ×2 | ✓|·|✓|·|✓|·|✓|·|✓|· |
| **组合专属规则总数** | 11|1|11|1|**12**|2|11|1|11|1 |

**四条结论：**

1. **`chrome.css:149` 只覆盖 C5/C6 —— PLAN 的怀疑成立，但方向要修正。** 它把 `.shell-tabs` 的 `padding-left` 从基线 `max(var(--shell-nav-w),132px)`(`:146`) 改成 `calc(var(--shell-nav-w)+var(--shell-task-w))`(`:150`)，**丢掉了 132px 下限**。当前不出事只因 `--shell-task-w` 恒 ≥ `TASK_MIN_WIDTH=320`(`shellReducer.ts:30`)，52+320=372>132 —— 这是运行时常量兜底而非 CSS 保证，任何把 task 最小宽调到 80px 以下的改动会让 **C5 一格**红绿灯被标签压住。
2. **editor 模式（C3/C4/C9/C10）零 `data-mode` 专属样式。** `App.tsx:99` 在 editor 下给 Sidebar 传 `null`，于是 `.shell-sidebar-body`(`chrome.css:477` `flex:1;margin-top:16px;overflow:hidden auto`) 成了占满侧栏剩余高度的空滚动区，没有任何 CSS 承认这件事。（= S1-009 实测的 348px 空白）
3. **floating（C7–C10）零 `data-presence` 专属样式。** 根节点对「一个面板正浮在画布上」一无所知，底下的 `.shell-workspace`/`.shell-statusbar` 不可能让位 —— **C9/C10 的遮挡在 CSS 层结构性无解**，只能靠 JS 拖拽边界（S4 实测）。
4. **`#shell[…]`(id, 1-1-1) 与 `.shell[…]`(class, 0-3-0) 混用且有一对重复。** `chrome.css:355` 与 `:412` 都改 `.shell-brand` 的 `width/justify-content/padding`，值相同但一个写死 `36px`、一个写 `var(--shell-row-h)` —— **改令牌只动后者，两条会静默分叉**。

## 表 9 — 硬编码文案

**`src/shell` 真实 `t("…")` 调用 = 0**（grep 的 21 个命中全是 `split(`/`setText(`/`logShellEvent(`/`params.get(`/`closest(` 假阳性，逐个核过）。唯一走 i18n 的 `LocaleProvider`(`main.tsx:30`、`UpdateGate.tsx:5`) 是为 legacy `ForceUpdateOverlay` 包的壳。

**295 处出现 / 227 条唯一串 / 28 个文件。** Top：`Composer.tsx` 35、`FileTree.tsx` 34、`FileTabs.tsx` 31、`Sidebar.tsx` 22、`ModelMenu.tsx` 22、`TaskPanel.tsx` 19、`MentionMenu.tsx` 16、`Highlights.tsx` 16、`EditorHome.tsx` 13、`WindowBar.tsx` 10、`fileTreeModel.ts` 10（时间分组 Previous 7/30 days、On this computer）、`companion.ts` 7（七个 `Agent xxx` 状态 aria-label）、`QuickPrompts.tsx` 6（三条会被塞进输入框发给模型的英文长句）。

**重合度：`en.ts`/`zh.ts` 各 1540 条；227 条里 26 条（11.5%）可逐字复用**（Collapse→`waiting2048.collapse`、Unsaved changes→`workbench.state.dirty`、Home→`projectSidebar.home`、Cancel/Close→`ui.text.*`、Full screen→`image.fullscreen`、OfficeDex→`settings.about.productName`、Settings→`projectSidebar.settings`、Expand/Collapse sidebar→`shell.sidebar.*`、Show less→`home.lessTasks` 等）。**剩 201 条（88.5%）需新增。**

**一个关键事实：`en.ts:584-603` 已有整段 20 条 `shell.*` 词条（中英双份齐全）** —— `shell.sidebar.collapse/expand`、`shell.nav.home/settings/profile`、`shell.projects.*`、`shell.workspace`、`shell.creditMeter.*`、`shell.brandPill.*`。**新壳一条都没用**，其中两条的英文值与 `WindowBar.tsx:33` 的硬编码逐字相同。移植成本比 227 条从零翻译低。

**混排点：** 中文系统下 UpdateGate 整块中文而 shell 全英文；每个文件行都是中文文件名 + 英文表头；`nav/fileTreeModel.ts:85-115` 的时间分组；**`dialog.tsx:92-95` 用 `t("ui.text.Cancel")`/`t("ui.text.OK")` → 中文系统下同一个弹窗里按钮中文、标题是 shell 传的英文（如 `FileTabs.tsx:55 "Save before closing?"`）—— 唯一一个控件内部就混排的地方。**

---

# 发现条目

### [S5-001] `renderer/ui` 四个浮层全部 portal 到 `document.body`，`#shell` 的 `--od-*` 令牌桥完全失效 — **P0**
- 壳组合：**全部 C1–C10** ｜ 运行环境：静态扫描
- 根因：`src/shell/tokens.css:105` 把桥写成 `#shell { --od-*: … }`（作用域 = `#shell` 子树），而四个浮层都 portal 出去：`Modal.tsx:29`、`dialog.tsx:86`(`:99` `document.body`)、`Popover.tsx:98`(`:107` `document.body`)、`toast.tsx:151`(`viewport ?? document.body`，而 shell 从不渲染 `ToastViewport` —— `App.tsx:1` 只 import `ToastHost`)。
- 量化差值（**请 S2 用 computed style 各验一条**）：

| 令牌 | `#shell` 桥（应生效） | portal 实际取到 |
|---|---|---|
| `--od-radius-dialog` | `--shell-radius-card` **10px** | **8px** |
| `--od-radius-control` | **5px** | **4px** |
| `--od-control-md` | `--shell-row-h` **36px** | **32px** |
| `--od-guidance` | `--shell-accent` `#596f86`/`#5c7565`/`#926b67` | **`#5da4e3`**（shell 里不存在的亮蓝） |
| `--od-button-primary-bg` | `#41464b` | **`#000000`** |
| `--od-border-subtle` | `#e4e6e9` | **`#41464b1a`** |
| `--od-surface-muted` | `#f5f6f8` | **`#f7f7f7`** |
| `--od-shadow-floating` | 两段阴影 | **`0 20px 32px #0000000f`** |

- `tokens.css:101-104` 的注释宣称让 `@vo-ui` 原语「adopt the shell's language」—— **这个承诺从落地第一天起就没兑现过。**
- 类别：两套设计系统混用 ｜ **同根因其它实例数：4 个 portal 点 × 11 个 shell 调用点**
- 修法二选一：桥改 `:root`（影响 legacy），或给四个 portal 一个 shell 内挂载点（`ToastViewport` 已有现成机制，另三个需加 `getContainer` prop）。
- **已被 S7 实测证实**：同一时刻同名令牌两侧不同值（`--od-radius-dialog` 10 vs 8、`--od-control-md` 36 vs 32），可见后果是主按钮纯黑 `rgb(0,0,0)` vs shell 的 `rgb(65,70,75)`。

### [S5-002] 侧栏 footer 设置菜单在全部 10 个组合下被纵向裁到几乎不可见 — **P0**
- 壳组合：**全部 C1–C10**（Sidebar 恒渲染，footer 恒在）｜ 表面：侧栏 footer > Settings
- 纵向：`.shell-sidebar-footer`(`chrome.css:485` `margin-top:auto`) 恒贴侧栏底，`.shell-sidebar` 底 padding 14px(`app.css:88`)，菜单 `top:calc(100%+6px)`(`chrome.css:596`) → 菜单顶边距侧栏底边仅 **8px**；菜单高 = 3×`min-height:38px`(`:620`)+12 ≈ **126px** → **约 118px（94%）被 `app.css:91` 的 `overflow:hidden` 裁掉**。
- 横向 C1/C3/C5/C7/C9（折叠轨）：`width={250}`(`Sidebar.tsx:102`) + `align="end"`(`right:0`, `chrome.css:611`)，侧栏 `NAV_RAIL_WIDTH=52`(`shellReducer.ts:27`) 减 8×2 padding → 可视 36px → **再裁 198px（79%）**。
- 横向 C2/C4/C6/C8/C10：`navWidth` 默认 190(`shellReducer.ts:106`) 减 12×2 → 166px → **裁 84px**（`navWidth` 取下限 160 时裁 102px）。
- 根因：`chrome/Menu.tsx` 零碰撞检测（`:150-158` 只有 class+`data-align`+内联 width，全文件 grep `getBoundingClientRect|innerWidth|innerHeight|flip` 为空）× `chrome.css:594-613`（**无向上翻转变体**）× `app.css:91`。
- **这是 shell 唯一的设置入口（PLAN 2.1）。**
- **同根因其它实例数：8 个 `Menu` 调用点**
- **已被 S2-002 与 S7-001 双双实测证实**：`left = -210.5`（折叠轨）/ `-210`（展开），可见 15.8%。横向预测值 198/84px 与实测 210.5/210 有偏差（我按 padding 推算，实测含锚点自身宽度），**纵向 94% 的预测未被单独验证**。

### [S5-003] `Menu` 的 8 个调用点里 6 个的 `width` 常量大于所在裁切容器 — **P1**

| # | 调用点 | width | align | 裁切容器 | 可视宽 | 溢出 | 组合 |
|---|---|---|---|---|---|---|---|
| 1 | `Sidebar.tsx:99` 设置 | 250 | end | `.shell-sidebar` 52/190 | 36/166 | **+214/+84** + 纵裁 94% | C1–C10 |
| 2 | `ModeMenu.tsx:43` 模式 | 220 | start | 同上 | 36/166 | **+184/+54** | C1–C10 |
| 3 | `FileTree.tsx:228` 文件夹动作 | 220 | end | `.shell-sidebar-body` | 166 | **+54** | C2/C6/C8 |
| 4 | `FileTree.tsx:316` 文件动作 | 230 | end | 同上 | 166 | **+64** | 同上 |
| 5 | `ModelMenu.tsx:101` 模型 | 280 | end | `.shell-agent` 320 / panel 340 | 268/292 | **+12/−12**，纵向都被裁 | C5–C10 |
| 6 | `Composer.tsx:667` 权限 | 280 | end | 同上 | 268/292 | **+12/−12** | C5–C10 |
| 7 | `Composer.tsx:650` 范围 | 260 | start | 同上 | 268/292 | 横向 OK | C1–C10 |
| 8 | `FileTabs.tsx:209` 文件动作 | 190 | start | `.shell-tabs-actions`（无 overflow） | — | **唯一安全** | C5–C10 |

- 根因：`Menu.tsx:62` 默认 `width=200` + 8 处各拍常量，与容器宽度（`shellReducer.ts:27-31` 的 52/160/190/300/320/660、`AgentPresence.tsx:12` 的 340）**无任何约束关系**；`chrome.css:594` 也不设 `max-width`。
- **同根因其它实例数：6 个；加 S5-002 的纵裁则 8 个全中**
- **双渲染对照：3/4 号在 `ComfortableList` 不复现 —— 首页列表根本不挂 `Menu`（`FileTree.tsx:275` 的 `FileRow` 只在 compact 分支）。请 S3 确认首页是否因此少了「文件动作」这个能力。**
- **8 号「唯一安全」的判断被 S2-004 推翻**：它确实不被祖先 overflow 裁，但它 `align` 缺省成 `start`，从一个距右边框 44px 的按钮向右展开，**146px 直接出窗口**。我只查了 overflow 容器，没查视口边界。

### [S5-004] `.shell-presence-panel` 的 `overflow:hidden` 裁掉悬浮 composer 的全部四个浮层 — **P0**
- 壳组合：**C7/C8/C9/C10**（及 C5/C6 被拖成 floating 时）
- `AgentPresence.tsx:138` 渲染面板，宽 `PANEL_SIZE.width=340`(`:12`)，`agent.css:319-322` 给 `max-height:min(76vh,620px)` + **`overflow:hidden`**（为 `border-radius:20px` 服务）。composer 在 `.shell-task-composer`(`agent.css:702`)，是 flex 列**最后一个**子元素，恒贴面板底。
- `.shell-menu` 三个（模型/权限/范围）`top:calc(100%+6px)` → 整体落在面板底边之外 → **100% 不可见**。
- `.shell-mention` 虽有 `[data-side="above"]`(`composer.css:402`)，但面板高 `PANEL_SIZE.height=520`，菜单 `min-height:40px`(`:428`)+heading+footer **会顶穿面板顶边被裁**。
- 类别：浮层定位 ｜ **同根因其它实例数：4 浮层 × 4 组合 = 16 格；同一 overflow 根因波及停靠态(`app.css:110`) 再 +3 浮层 × C5/C6**
- **S2-005 已实测**：三个菜单在 C7–C10 被裁 73%–84%（非 100%，因为面板不总是贴视口底）；`.shell-mention` 反而**没被裁**（`clippedBy = null`），因为它是 shell 里唯一会测量并翻转的浮层。我对 mention 的预测是错的。

### [S5-005] `.shell-cx` 的 `container-type:inline-size` 建立层叠上下文，`z-index:180`/`10` 成为对外无效的魔数 — **P2**
- 壳组合：全部。`composer.css:5` 为四档容器查询(`:328/335/353/365`)写了 `container-type:inline-size`；按 css-contain-3 它施加 layout+style+inline-size containment，**layout containment 建立层叠上下文**。于是 `.shell-mention` 的 180(`:390`) 与 `.shell-cx-drop` 的 10(`:382`) 只在 `.shell-cx` 内部排序，`.shell-cx` 自身 z-auto。
- 180 这个数在全仓没有任何注释或常量解释它要压过谁。
- **同根因其它实例数：2 条 z-index；同类「建立层叠上下文却没人声明」另有 `agent.css:304` 的 `filter:drop-shadow`，共 3 处**
- **已被 S2-011 实测证实**：四处 `stackingAncestors` 第一项都是 `div.shell-cx {z-index:auto; container-type:inline-size}`。

### [S5-006] `.shell-menu`(60) 与 `.shell-presence`(200) 同在根层叠上下文，侧栏/标签栏菜单必被悬浮面板盖住 — **P1**
- 壳组合：**C5–C10**（`showsPresenceFace` 要求 `!state.home`，C1–C4 不复现）
- `.shell`(`app.css:4`) 是 `position:absolute; z-index:auto`，**不建立**上下文（逐条排除 transform/filter/contain/opacity）→ `chrome.css:597` 的 60 与 `agent.css:211` 的 200 直接比较。
- **同根因其它实例数：8 个 Menu 调用点中 6 个在根上下文（侧栏 2 + 文件树 2 + 标签栏 1 + ModeMenu 1）全中；composer 里的 2 个因在 `.shell-presence` 内部反而无事**
- **已被 S2-010 实测证实**（C9，拖面板到标签条下方开 "…" 菜单，重叠 44×164px，`elementFromPoint` 命中面板）。

### [S5-007] 文件夹行的 "+" 压在文件夹名上，而文件行为同位置按钮留了 26px — **P2**
- 壳组合：**C2/C6/C8**（折叠轨下 `nav.css:203` 把它 `display:none`）
- `.shell-tree-folder-add`(`nav.css:87-104`) `position:absolute; right:4px; width:24px`，兄弟 `.shell-tree-folder-toggle`(`nav.css:43-57`) `width:100%; padding:8px` —— **右侧未预留**。
- 对照 `.shell-tree-file-open`(`nav.css:157`) `padding: 8px 26px 8px 7px` —— **文件行留了 26px**，正好容下 23px 的 `.shell-tree-file-more`(`:106`)。
- 旁证：`nav.css:118` 只把计数徽标 `opacity:0`，**作者知道右侧会撞但只处理了徽标没处理名字**。
- 修法：`nav.css:43-57` 补 `padding-right:28px`。
- **同根因其它实例数：1 处**（文件行是对的，两处对照证明是漏改非设计）
- **双渲染对照：`ComfortableList` 不复现** —— 首页用 `.shell-list-pin`(`nav.css:299`) 占独立 `<td>`。
- **S1-001 补了更深一层**：除了横向压名字，这个按钮还**纵向挂在行外 6px**，因为它的包含块是 0×0 的 `.shell-menu-anchor` 而非文件夹行。两条要一起修。

### [S5-008] `app.css:63-72` 的 `.shell-windowbar` 整块被 `chrome.css:118-126` 覆盖，含 PLAN 2.5 引用的 132px 注释 — **P3**
- 两条规则选择器相同、特异度相等，胜负靠文件顺序：`App.tsx:19` app.css → `:20` chrome.css，**chrome 全胜**。

| 属性 | app.css:63-72 | chrome.css:118-126 | 生效 |
|---|---|---|---|
| `position` | 静态 | `absolute` | chrome |
| `width` | `var(--shell-nav-w)` | `100%` | chrome |
| `min-width` | **`132px`** | **`0`** | **chrome** |
| `flex:none` / `transition:width` | 有 | — | app（但已 absolute / width 恒 100%，均无意义） |

- 真正生效的 132px 在 `chrome.css:146` 的 `padding-left: max(var(--shell-nav-w), 132px)`。`chrome.css:114-117` 的注释说明这是一次重构，**只改了 chrome.css 没回去删 app.css 作废的半块**。
- **S1 的 macOS 假设清单会引错行，需要改引 `chrome.css:146`。**（S1-013 已独立实测同一结论：十个组合 `windowbar.minWidth` 全为 `"0px"`。）
- **同根因其它实例数：强的 1 处（本条）；同类「同选择器跨文件双写」另 1 处 —— `.shell-home` 在 `app.css:158` 与 `home.css:3` 各定义一次，胜负同样靠 import 图顺序。共 2 处**

### [S5-009] `DESIGN.md` 与 `CLAUDE.md` 完全不符、与 `tokens.css` 零交集 —— 令牌对账无基准 — **P1**
- `CLAUDE.md` 要求「任何 UI 工作前必须先读 `DESIGN.md`」并列了 5 条关键约束。**这 5 条在 `DESIGN.md`(821 行) 里一条都不存在**（`grep -c` 全为 0）：`05101a` 0 ｜ `006876` 0 ｜ `fcfaf2` 0 ｜ `e6e4d8` 0 ｜ `Paper & Ink` 0 ｜ `Jakarta` 0。
- `DESIGN.md:1-4` 实际是 `name: Notion-design-analysis` —— Notion 官网品牌提取：主色 `#5645d4`、`brand-navy #0a1530`、Notion-Sans/Inter、圆角 8/12px。
- `src/shell/tokens.css` 是**第三套**：`--shell-ink #41464b`、`--shell-chrome #f5f6f8`、`--shell-accent #596f86`、`"PingFang SC"`、圆角 5/6/10/14/20px。其 `:2-8` 注释明说值来自「approved interaction prototype's computed styles」，**根本没提 DESIGN.md**。
- 后果：**PLAN 第 3 节第 4 条要求的「与 DESIGN.md 令牌对账」无法进行**，表 4 只能给「与 tokens.css 的偏差」。需要产品/设计先拍板哪份是真的。

### [S5-010] `data-loaded` 写给根节点但零 CSS 消费；另 5 个局部 data 属性同样 — **P2**
- `App.tsx:82` 写 `data-loaded`，CSS 引用 **0**，唯一读者是 `test/renderShell.tsx:79` 的测试探针。其余 0 消费的：`data-expanded`(`AgentPresence.tsx:125`)、`data-symbol`、`data-asset`、`data-highlight`、`data-drop-folder`、`data-canvas-host`。有 CSS 消费的 9 个：`data-edge`/`dragging`/`placement`/`side`/`align`/`applied`/`state`/`tone`/`file-type`。
- **`data-loaded` 最有意义**：`loaded=false` 期间 shell 完整渲染但数据为空，与「真的空工作区」**视觉上完全无法区分** —— 正是 S8 要评估的首启零数据态。
- **同根因其它实例数：6 个属性**

### [S5-011] `tokens.css` 没有 danger/warning/success 令牌，9 处语义色被迫裸写且互不一致 — **P2**

| 语义 | 裸值 | 位置 |
|---|---|---|
| 错误红 | `#ad5347` | `nav.css:362` |
| 录音红 | `#b3392c`/`#fdecea`/`#8f2d22`/`#fadfdb` | `composer.css:271/270/277/276` |
| 警告黄 | `#7a6533`/`#fbf5e6`/`#e6dcc4` | `composer.css:531/530/528` |
| 成功绿 | `#617f6f` ｜ `#cddac9`/`#f5f8f4` | `agent.css:503` ｜ `:672/673` |

- **两个"红"不同**（`#ad5347` vs `#b3392c`），**两个"绿"也不同**；`renderer/ui/styles/tokens.css` 还有第三个红 `--od-danger #e86666`。
- `src/shell/tokens.css` 的令牌集（Surfaces/Lines/Ink/Interaction/Radii/Elevation/Metrics/Type/Motion/Document identity）**没有 Status 一节**。
- **同根因其它实例数：9 处 / 4 个语义族** —— 表 4 里唯一「必须先扩令牌才能修」的一类。

### [S5-012] 227 条用户可见英文串零 i18n，其中 20 条现成 `shell.*` 词条已在字典里躺着没人用 — **P1**
- 详见表 9。移植最省的第一刀：`WindowBar.tsx`（10 条，2 条已有 key）+ `Sidebar.tsx`（22 条，`shell.nav.*` 已有 4 条）。
- **同根因其它实例数：295 处出现 / 227 条唯一串 / 28 个文件**

---

# 建议闸门草案（伪代码，**未写进 src**，仿 `src/shell/test/deadControls.test.ts`）

```ts
// —— 表 3 ——
it("z-index values come from the declared ladder", () => {
  const ALLOWED = new Set([3, 10, 60, 180, 200]);
  for (const css of shellStylesheets())
    for (const { value, line } of zIndexDecls(css))
      expect(ALLOWED.has(value), `${css.path}:${line} z-index:${value}`).toBe(true);
});
it("no z-index lives inside an undeclared stacking context", () => {
  // contain/container-type/filter/transform/opacity<1/will-change 的选择器集合
  // ∩ 其后代里带 z-index 的选择器集合 必须为空，
  // 除非规则块上一行有 /* stacking-context: intentional */
});

// —— 表 4 ——
it("shell stylesheets declare no bare colours", () => {
  const ALLOW = /* chrome.css 红绿灯 3 行 + agent.css companion 6 行，逐行白名单 */;
  for (const css of shellStylesheets().filter(f => !f.endsWith("tokens.css")))
    for (const { hex, line } of hexLiterals(css))
      expect(ALLOW.has(`${css.path}:${line}`), `${css.path}:${line} ${hex}`).toBe(true);
});
// 注意：先补 danger/warning/success 令牌，否则这条永远带 9 个豁免
it("font-size comes from the type scale", () => { /* 白名单当前 9 行 */ });

// —— 表 5（S0-001 + S5-001 的闸门）——
it("a shell-reachable component's styles ship with the component", () => {
  // 从 src/shell 的 import 图做可达闭包（跳过 .test.）
  // 每个可达 .tsx 的字面量 class 必须在「该模块 import 图可达的 .css」并集里有定义
  // 当前会红：ForceUpdateOverlay 的 13 个 force-update-* class
});
it("shell only imports visuals through renderer/ui", () => {
  const offenders = shellSources().flatMap(imports)
    .filter(s => /^\.\.?\/.*renderer\//.test(s) && !/renderer\/ui$/.test(s))
    .filter(s => rendersJsx(resolve(s)));
  expect(offenders).toEqual([]);   // 当前 2 个：UpdateGate.tsx:6、main.tsx:31
});
it("every portalled overlay mounts inside #shell", () => {
  // createPortal 的第二参数不得是 document.body —— 或 --od-* 桥必须挪到 :root
});

// —— 表 6 ——
it("shell never emits ui- or od- prefixed classes", () => { /* className 必须 /^shell-/ 或来自 renderer/ui */ });
it("the #shell --od-* bridge is a closed set", () => {
  // src/shell/tokens.css 的 --od-* ⊆ renderer/ui/styles/tokens.css 的集合
  // 当前 19 ⊆ 29 ✅
});

// —— 表 8（PLAN 第 5 节点名要的那条）——
it("every #shell[data-*] rule declares which combinations it covers", () => {
  const EXPECTED = { "chrome.css:149": ["C5","C6"], "chrome.css:334": ["C1","C2","C3","C4"], /* … */ };
  for (const rule of parseCombinationSelectors(shellStylesheets())) {
    const hit = COMBINATIONS.filter(c => matches(rule.selector, attrsOf(c)));
    expect(hit.length, `${rule.at} matches nothing`).toBeGreaterThan(0);
    expect(hit.map(c => c.id)).toEqual(EXPECTED[rule.at]);   // 新规则必须来登记
  }
});
it("every root data-* attribute is consumed by CSS or declared test-only", () => {
  const written = rootDataAttributes("src/shell/App.tsx");   // 5
  const consumed = new Set(cssReferencedDataAttributes());   // 4
  expect(written.filter(a => !consumed.has(a) && !new Set(["data-loaded"]).has(a))).toEqual([]);
});
it("no rule pair targets the same element through both #shell and .shell", () => { /* chrome.css:355 vs :412 */ });

// —— 表 9 ——
it("shell renders no untranslated user-visible copy", () => {
  expect(visibleStringLiterals("src/shell").length).toBeLessThanOrEqual(BASELINE /* 227 */);  // 棘轮
});
```

---

# 收尾自报

**完成：9 张表全部交付。** 1/2/3/5/6/7/8/9 条完整；条目 S5-001…S5-012 共 12 条，每条都有 `文件:行` 级根因和「同根因其它实例数」。

**没完成 / 打折扣的：**

1. **第 4 条只做了一半。**「与 `DESIGN.md` 令牌的偏差」**无法产出** —— 仓库里的 `DESIGN.md` 是 Notion 品牌分析，与 `CLAUDE.md` 的描述和 `tokens.css` 的实际值三者互不相交（S5-009）。我给的是「与 `tokens.css` 的偏差」。补这半张表要先有人拍板基准。
2. **全部条目无实测数值与截图。** S5 按定义是静态分片。可预算的几何量已写成算式（S5-002 的 118/198/84px、S5-003 的溢出表、S5-001 的 8 个令牌差值），并点名了验证归属：**S5-001/003/005/006 → S2；S5-002 → S7；S5-004 → S2 + S4 双环境；表 6 的 sdk-sheet 级联 → S4(3210)；S5-003 的双渲染对照 → S3**。这些数字在被实测前都只是预测。
   - **事后对账**：S2/S3/S7 的实测已证实 S5-001/005/006 与 S5-002 的方向，**推翻了两处**：S5-003 第 8 号「唯一安全」（漏查视口边界）、S5-004 对 `.shell-mention` 的预测（它其实会翻转、没被裁）。
3. **`@shimo/sdk-sheet` 是否消费 `--od-*` 未验证** —— 需翻 `node_modules` 产物 CSS，超出「读 src」范围，转 S4。
4. **CSS 加载顺序的两处推断（S5-008）按 ES module 深度优先求值顺序推得，未跑构建验证。**`.shell-home` 那处结论尤其依赖 `App.tsx` 的 import 行序，任何 import 排序工具都可能翻转它。
5. **没做 `:hover`/`:focus-visible`/`:active` 三态穷举** —— 不在这八条清单里，归 S1。

**最该先修的三个（按实例数排）：** S5-001（4 portal × 11 调用点，P0）→ S5-002/003/004（同一个 `Menu` 无碰撞检测根因，8 调用点全中，P0）→ 表 8 第 2/3 条结论（editor 与 floating 各 4 个组合零专属样式）。
