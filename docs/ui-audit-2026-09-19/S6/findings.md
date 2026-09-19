# S6 — 组合 × 环境矩阵

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ 运行环境：**3100 fake（`?shellFixture=1`）**
spec：`e2e/ui-audit-s6.spec.ts`（12 个 test 全绿，76 张截图）
复跑：`PLAYWRIGHT_BASE_URL=http://localhost:3100 OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/s6 npx playwright test e2e/ui-audit-s6.spec.ts`

> 本轮全部在 3100（`createShellCanvas()` 返回 null）下采集。凡是涉及真编辑器的结论一律不下，交 S4（3210）。
> 反过来，`CanvasPlaceholder` 三套骨架只在 3100 存在，S4 永远看不到，见 S6-014/015。

**视口口径**：`main.go:44 MinWidth: 1040`，桌面窗口真实最小宽是 **1040**，PLAN 写的 1024 在打包应用里到不了。
两个宽度都跑了，结论一致。

---

## P0

### [S6-001] 暗色模式完全没有实现：亮暗两套截图逐字节相同
- 壳组合：**C1–C10 全部**（C1/C2/C4/C9 × 4 视口做了亮暗双跑，共 32 格）
- 运行环境：3100 fake
- 表面：整个 shell
- 复现：任意组合 + playwright `page.emulateMedia({ colorScheme: "dark" })`
- 现象：暗色下界面一个像素都不变，仍是纸白底 + 深灰字
- 证据：
  - `screenshots/C1-w1280-light.png` vs `C1-w1280-dark.png` → sha256 前 16 位同为 `cab6b0b126127f0c`
  - `C2-w1024-{light,dark}.png` 同为 `631a6f379ec5835d`；`C4-w1440-{light,dark}.png` 同为 `ba02f4b62ab2315f`
  - computed：`#shell` background 两态均 `rgb(250, 250, 250)`，color 均 `rgb(65, 70, 75)`；
    `getComputedStyle(#shell).colorScheme === "normal"`，`document.documentElement` 同为 `"normal"`
  - （C9 两张 hash 不同，差异来自 `PresenceFace` 的眨眼/视线动画，与配色无关）
- 根因：`src/shell/tokens.css:15-92` 只定义一套亮色令牌；`tokens.css:94` 只有 `prefers-reduced-motion` 一条媒体查询，
  **没有 `prefers-color-scheme`**；全仓 `grep -rn "prefers-color-scheme" src/` 命中数 = 0，
  `grep -rn "color-scheme" src/ index.html` 命中数 = 0（连 `color-scheme: light dark` 都没声明，
  所以原生滚动条、`<select>` 在暗色系统下也保持亮色，不会出现半黑半白）
- 类别：主题/令牌 ｜ 严重度：**P0**（是"未实现"不是"坏了"，但矩阵第三维整维为空）
- 同根因其它实例数：**3**（`src/shell/tokens.css`、`src/renderer/styles/tokens.css`、`src/renderer/ui/styles/tokens.css` 三套令牌全是单亮色）
- 双渲染对照：不适用

### [S6-006] Home 四个组合下整条标签栏键盘不可达，只剩 7 个没有焦点环的"关闭"按钮
- 壳组合：**C1 / C2 / C3 / C4**（`home=true` 的四格）；C5–C10 不复现
- 运行环境：3100 fake
- 表面：顶栏 > FileTabs
- 复现：`?shellFixture=1&shell=C2` → 点击空白 → 连按 Tab
- 现象：前 7 次 Tab 依次落在 `Close MO launch plan.docx` … `Close Scratch notes.docx`，第 8 次才到 `Switch mode`。
  **没有任何一次落在标签本身**——键盘用户能关掉每一个文件，却切不到任何一个文件
- 证据：`screenshots/C2-keyboard-focus-ring.png`、`C1-keyboard-focus-ring.png`
  - DOM 断言（`@@TOPROW`，C2）：7 个 `.shell-tab-select` 的 `tabindex` **全部是 `"-1"`**，
    7 个 `.shell-tab-close` 的 `tabindex` 为 `null`（默认可聚焦）
  - 对照 C7（`home=false`，`@@TOPROW-C7`）：第一个 `.shell-tab-select` 的 `tabindex` 是 `"0"`，其余 6 个 `-1`
    —— roving tabindex 正常，**差别只由 `home` 这一位造成**
- 根因：`src/shell/chrome/FileTabs.tsx:89` `const current = file.id === state.activeFileId && !state.home;`
  与 `:96` `tabIndex={current ? 0 : -1}` —— `home=true` 时没有任何 tab 是 current，
  roving tabindex 没有"无 current 时回退到第一个"的兜底，整个 `role="tablist"` 掉出 Tab 序
- 类别：键盘可达性 ｜ 严重度：**P0**
- 同根因其它实例数：**1**（只有这一处 roving tabindex；影响 4/10 个组合 × 每屏 7 个标签）
- 双渲染对照：不适用

---

## P1

### [S6-002] 切模式时标签栏瞬移，底下的列却用 200ms 过渡——中间 200ms 内容边界对不上
- 壳组合：任何 agent↔editor 切换；docked 侧最明显（**C5/C6 ↔ C3/C4/C9/C10**）
- 运行环境：3100 fake
- 表面：顶栏 FileTabs × body 行三列
- 复现：`?shellFixture=1&shell=C6` → 点 OfficeDex 品牌按钮 → 选 Editor（反向同理）
- 现象：标签条左边界一帧之内从 x=510 跳到 x=190，而它本该对齐的 agent 列还有 320px 宽，要花 200ms 才收完。
  反向切回时标签条一帧跳到 510，列却还是 0 宽，顶部凭空空出 320px
- 证据：`screenshots/C6-transition-agent-to-editor-000ms.png`、`-100ms`、`-300ms`、`-end`
  （反向四张 `C6-transition-editor-to-agent-*`）；分帧测量 `@@TRANSITION`：

  | 帧 | `.shell-agent` w | `.shell-tabs` padding-left | `.shell-tabstrip` x |
  |---|---|---|---|
  | 切换前 | 320 | 510px | 510 |
  | agent→editor 0ms | **320** | **190px** | **190** |
  | 100ms | 2 | 190px | 190 |
  | 300ms / end | 0 | 190px | 190 |
  | editor→agent 0ms | **0** | **510px** | **510** |
  | 100ms | 320 | 510px | 510 |

  0ms 那一帧的错位量 = **320px**
- 根因：`src/shell/chrome/chrome.css:137-147` `.shell-tabs` 没有任何 `transition`，
  而它的 `padding-left` 由 `chrome.css:149` 的组合选择器
  `#shell[data-mode="agent"][data-home="false"][data-presence="docked"] .shell-tabs` 整条规则换掉
  （属性选择器切换是离散的，即使加了 transition 也不会插值）；
  对面 `app.css:71 / :92 / :112` 的 `.shell-windowbar` / `.shell-sidebar` / `.shell-agent`
  都写了 `transition: width var(--shell-duration) var(--shell-ease)`
- 类别：过渡/组合选择器 ｜ 严重度：**P1**
- 同根因其它实例数：**2**（`chrome.css:146` 的 `max(var(--shell-nav-w), 132px)` 与 `:149-150` 的
  `calc(var(--shell-nav-w) + var(--shell-task-w))`，两条都靠属性选择器切换、都不过渡；折叠/展开侧栏时同样会跳）
- 双渲染对照：不适用

### [S6-003] 切模式瞬间停靠面板直接卸载，留下 320px 空列动画收缩，同时悬浮面板满不透明度弹出
- 壳组合：**C5/C6 → C3/C4/C9/C10**（离开 docked 的方向）
- 运行环境：3100 fake
- 表面：`.shell-agent` 停靠列 + `.shell-presence` 悬浮层
- 复现：同上
- 现象：`App.tsx:42` 注释声称"nothing unmounts"，实测相反：0ms 帧里停靠列还有 320px 宽但内容已经全空，
  同一帧右侧已经出现一个完整的悬浮面板。**同一时刻屏幕上有两份 agent 面板的位置，一份空壳一份实心**
- 证据：`screenshots/C6-transition-agent-to-editor-000ms.png`
  （x=190..510 为空白列；x=916..1256 悬浮面板已完整渲染）；`@@TRANSITION` 0ms 帧 `agent: {x:190, w:320}` 而列内无内容
- 根因：`src/shell/agent/AgentPresence.tsx:119` `{docked ? <TaskPanel agent={agent} placement="docked" /> : null}`
  —— 内容随 `docked` 立即卸载，而承载它的 `<section className="shell-agent">` 的宽度走 `app.css:112` 的 200ms 过渡
- 类别：过渡 ｜ 严重度：P1
- 同根因其它实例数：**1**（同一个三元，正反两个方向各表现一次）
- 双渲染对照：不适用

### [S6-004] 反向切回时停靠面板在动画中的窄列里挂载，按钮被截成半个词
- 壳组合：**C3/C4/C9/C10 → C5/C6**
- 运行环境：3100 fake
- 表面：`.shell-agent` > TaskPanel
- 复现：`?shellFixture=1&shell=C6` → 切到 Editor → 再切回 Agent，抓 0ms 帧
- 现象：面板以完整结构挂进一个还在动画的窄列里，0–200ms 内：
  标题 `Draft the launch checklist…` 被压成 `Dra…`、状态 `Agent…`、
  **"Finish task" 按钮被列边界切成 `Fini`**、"Current file · Saved on this computer" 折成 3 行、composer 占位文字折成 4 行
- 证据：`screenshots/C6-transition-editor-to-agent-000ms.png`（"Fini" 清晰可见被切断）
- 根因：`src/shell/app.css:104-113` `.shell-agent { width: var(--shell-task-w); min-width: 0; transition: width … }`
  —— `min-width: 0` 允许列在动画中经过任意窄的宽度，而 `AgentPresence.tsx:119` 在第一帧就挂了完整面板；
  `shellReducer.ts` 里的 `TASK_MIN_WIDTH` 只约束用户拖拽，没落到 DOM 上
- 类别：过渡 ｜ 严重度：P1
- 同根因其它实例数：**2**（`.shell-sidebar` app.css:82-93 同为 `min-width: 0` + width 过渡，折叠/展开时树行同样会被压；
  `.shell-agent` 用户拖拽 resize 时同理）
- 双渲染对照：不适用

### [S6-005] 标签"关闭"按钮没有焦点环——而它是 Tab 序的第 1 到第 7 站
- 壳组合：**C1–C10 全部**
- 运行环境：3100 fake
- 表面：顶栏 > FileTabs > `.shell-tab-close`
- 复现：任意组合，连按 Tab
- 现象：焦点停在关闭按钮上时屏幕无任何提示
- 证据：`screenshots/C2-keyboard-focus-ring.png`、`C4-keyboard-focus-ring.png`、`C1-keyboard-focus-ring.png`
  - computed（`@@TABORDER`，焦点在该元素时）：`outlineStyle: "none"`，`boxShadow: "none"`
  - 同一次走查里 `.shell-brand` / `.shell-sidebar-item` / `.shell-tab-select` 都是
    `outlineStyle: "solid"`, `outlineWidth: "2px"`, `outlineColor: "rgb(120, 149, 174)"`
- 根因：`src/shell/chrome/chrome.css:25-34` 的 `:focus-visible` 选择器列表
  （`.shell-icon-button` / `.shell-tab-select` / `.shell-sidebar-item` / `.shell-brand` /
  `.shell-profile` / `.shell-menu-item` / `.shell-save-state` / `.shell-share`）**漏了 `.shell-tab-close`**；
  `.shell-tab-bookmark` 另有 `chrome.css:258-261` 单独补了一条，说明这份清单是手工维护、已经漏过一次
- 类别：键盘可达性 ｜ 严重度：P1
- 同根因其它实例数：**3**（同一次走查里 `outlineStyle: none` 的还有 `.shell-tree-folder-toggle`、
  树里的文件行按钮、EditorHome 的 `Group by` / `File type` 两个按钮；前两者归 S1，后两者归 S3，根因同为这份手工清单）
- 双渲染对照：`.shell-tree-*` 那两处属 CompactTree（density=compact），ComfortableList 的
  `.shell-list-file` 同样没进清单，**两套 density 都复现**

### [S6-009] 首页文件表无法缩到 1015px 以下——一个不可断行的英文文件名把 Name 列钉死在 829px
- 壳组合：**C1/C2（AgentHome）+ C3/C4（EditorHome）**；C5–C10 无首页，不适用
- 运行环境：3100 fake
- 表面：首页 > 文件列表（`FileTree` density=comfortable → `ComfortableList`）
- 复现：`?shellFixture=1&shell=C4`，窗口 1040 或 1024，滚到文件列表
- 现象：表格比它的容器宽，右侧 Pin 列整列溢出到列表边界之外；`.shell-home` 出现水平滚动
- 证据：`screenshots/C4-table-w1024.png`、`C4-table-w1280.png`、`C4-table-w1440.png`；`C2-w1024-light.png`、`C4-w1040-light.png`

  | 视口 | `.shell-home-list` 宽 | `table.shell-list` 宽 | 溢出 | `.shell-home` scrollW/clientW |
  |---|---|---|---|---|
  | 1024 | 738 | **1015** | **+277** | 1063 / 834 |
  | 1040 | 754 | 1015 | +261 | — |
  | 1280 | 994 | 1015 | +21 | 1090 / 1090 |
  | 1440 | 1080 | 1080 | 0 | 1250 / 1250 |

  列宽实测（1024 / 1280 / 1440 三档）：`Name` 列恒为 **829px**，不随容器变；
  `Folder` 83→83→142，`Last opened` 58→58→63，`Pin` 46。`getComputedStyle(table).tableLayout === "auto"`。
  829px ≈ `Q3-2026-product-launch-programme-execution-plan-and-contingency-register-including-channel-media-and-onsite-workstreams.pptx`
  这一个 token 的渲染宽（同名字串在标签里实测 `scrollWidth = 771`）+ 图标 16 + gap 9 + 单元格 padding 20
- 根因：`src/shell/nav/nav.css:217-221` `.shell-list { width: 100%; border-collapse: collapse }`
  **没有 `table-layout: fixed`**。auto 布局下单元格的 min-content 由内容决定，
  `nav.css:284-289` 的 `.shell-list-file > span { overflow: hidden; text-overflow: ellipsis }`
  在 min-content 计算阶段来不及生效；`nav.css:265-267` 的 `td:first-child { width: 46% }` 又把这个 min-content 按比例放大到整表
- 类别：固定宽度/中英文案 ｜ 严重度：P1
- 同根因其它实例数：**1**（只有这一张表，但同时出现在 AgentHome 与 EditorHome，共 4 个组合）
- 双渲染对照：**另一套 density 不复现**。侧栏 CompactTree 在 `.shell-sidebar-body`（实测宽 165px）里用 flex 行 + ellipsis，
  C2/C6/C8 的 probe 中 `textOverflow` 与 `clipped` 均为空数组 —— 但两套共用 `nav.css`，
  修表格时若动到 `.shell-list-file > span` 要回来复测侧栏

### [S6-011] 悬浮面板按一个它没有的尺寸做边界钳制，拖到角落后底部 15px 出视口
- 壳组合：**C7 / C8 / C9 / C10**（`presence=floating` 的四格）
- 运行环境：3100 fake（S4 在 3210 上应复现同一数值，面板尺寸与 adapter 无关）
- 表面：`.shell-presence` 悬浮面板
- 复现：`?shellFixture=1&shell=C9` → 按住面板标题栏拖到 (2000, 2000) → 松手
- 现象：面板右侧正好贴边，但底部超出窗口；面板内 composer 那一行被窗口下沿切掉
- 证据：`screenshots/C9-presence-dragged-to-corner.png`
  - `@@PRESENCE`：declared `{width:340, height:520}`，实测 `{w:340, h:543}`，
    拖拽后 `{x:940, y:272, right:1280, bottom:815}`，viewport `1280×800` → **bottom 超出 15px**
  - 面板内 composer rect `{top:678, bottom:801}`，正好压在视口下沿
- 根因：`src/shell/agent/AgentPresence.tsx:12` `const PANEL_SIZE = { width: 340, height: 520 };`
  该常量同时喂给 `AgentPresence.tsx:27-28` 的 `anchorTucked` 钳制、`:68` 的默认落位和
  `useDraggable({ size })`（`useDraggable.ts:14-15, 54-58`）。宽度 340 与实测一致所以右边界正确，
  高度 520 比实测 543 少 **23px**，于是所有纵向钳制都少留 23px
- 类别：浮层定位 ｜ 严重度：P1
- 同根因其它实例数：**3**（同一常量被三处消费：默认落位、`anchorTucked`、`useDraggable` 的 clamp/贴边判定；
  收起态的 `FACE_SIZE = 56` 未在本轮验证）
- 双渲染对照：不适用
- 交叉：拖拽边界本属 S4；数值给 S4 复用

### [S6-012] 面板贴边时，展开态的头像被平移 312px 并旋转 -90°，甩到窗口外 28px
- 壳组合：**C7 / C8 / C9 / C10**
- 运行环境：3100 fake
- 表面：`.shell-presence[data-edge] .shell-face`
- 复现：同 S6-011（拖到右边界触发贴边）
- 现象：面板本体规规矩矩停在 940..1280，面板**头部的头像**却跑到窗口外，在右边缘留下半个被切掉的深色圆
- 证据：`screenshots/C9-presence-dragged-to-corner.png`（右边缘 y≈310 处的半圆）
  - `@@TUCK`：`data-edge="right"`、`data-expanded="true"`、`--shell-presence-peek-x: 312px`
  - `.shell-presence` / `.shell-presence-panel` rect 均为 `{left:940, right:1280}`（钳制正确）
  - `.shell-face` rect = `{left:1268, right:1308}` → **右边超出视口 28px**，与面板头部左沿（940）相距 328px
- 根因：`src/shell/agent/agent.css:241-244`
  `.shell-presence[data-edge="right"] .shell-face { transform: translate(var(--shell-presence-peek-x)…) rotate(-90deg) }`
  —— 选择器**没有限定 `[data-expanded="false"]`**。
  `AgentPresence.tsx:82-95` 的注释写明这个 peek 是给"收起态的马克"用的
  （"the element stays on screen, the artwork hangs over the edge"），
  但展开态的 TaskPanel 头部也渲染 `PresenceFace`（同一个 `.shell-face`），于是一起被平移旋转
- 类别：浮层定位 ｜ 严重度：P1
- 同根因其它实例数：**4**（`agent.css:236` left、`:241` right、`:246` top、`:251` bottom 四条规则同病）
- 双渲染对照：不适用

---

## P2

### [S6-007] 标签栏溢出没有任何提示，溢出量由壳组合决定，最坏时 47% 的标签不可见
- 壳组合：**C1–C10 全部**，但量级完全不同
- 运行环境：3100 fake
- 表面：顶栏 > `.shell-tabstrip`
- 复现：任意组合（fixture 固定 7 个标签），看右端
- 现象：多出来的标签被直接切掉，边界处只剩半个图标；没有滚动条、没有左右箭头、没有渐隐
- 证据：`screenshots/C2-w1024-light.png`（第 5 个标签在 x≈783 被切成半个图标）、
  `C5-default-light.png`、`C6-default-light.png`；实测 `scrollWidth` 恒为 998：

  | 组合 | 1024 | 1040 | 1280 | 1440 |
  |---|---|---|---|---|
  | C1/C3/C7/C9（折叠轨） | 347 | 331 | 91 | 0 |
  | C2/C4/C8/C10（展开） | 405 | 389 | 149 | 0 |
  | C5（折叠 + docked） | — | — | **331** | — |
  | C6（展开 + docked） | — | — | **469**（= 47% of 998） | — |

  `.shell-tabstrip` computed：`overflowX: auto`，`scrollbarWidth: none`
- 根因：`src/shell/chrome/chrome.css:152-166` `.shell-tabstrip { overflow-x: auto; scrollbar-width: none }` +
  `.shell-tabstrip::-webkit-scrollbar { display: none }` —— 能滚但一切可供性都被主动删掉；
  `chrome.css:171-175` `.shell-tab { flex: 0 1 260px; min-width: 140px }` 决定 7 × 140 + gap = 998 的下限
- 类别：溢出/可供性 ｜ 严重度：P2（内容可达，但不可发现）
- 同根因其它实例数：**1**（只有这一条 strip；但在 10 个组合 × 4 个视口里 24/40 格非零）
- 双渲染对照：不适用
- 交叉：标签栏本体归 S1，此条只提供"溢出量随组合变化"的矩阵数据

### [S6-008] Home 上那组不可见的顶栏操作仍然占着 209px，恰好把溢出最严重的四个组合又挤窄 209px
- 壳组合：**C1 / C2 / C3 / C4**（`data-home="true"` 的四格）
- 运行环境：3100 fake
- 表面：顶栏 > `.shell-tabs-actions`
- 复现：`?shellFixture=1&shell=C2`，看顶栏右侧
- 现象：Saved / Share / 全屏 / 更多 四个控件在首页按设计隐藏，但它们的盒子没让出位置
- 证据：`@@ACTIONS`，四个视口下 `.shell-tabs-actions` 恒为
  `{w: 209, display: "flex", visibility: "hidden", opacity: "1"}`：

  | 视口 | strip 可视宽 | actions 占位 | strip 本可达到 | 溢出可减少 |
  |---|---|---|---|---|
  | 1024 | 593 | 209 | 802 | 405 → 196 |
  | 1040 | 609 | 209 | 818 | 389 → 180 |
  | 1280 | 849 | 209 | 1058 | 149 → 0 |

- 根因：`src/shell/chrome/chrome.css:334-337`
  `#shell[data-home="true"] .shell-tabs-actions { visibility: hidden; pointer-events: none }`
  —— 用 `visibility` 而不是 `display: none`。
  （用 `visibility` 本身是对的：它同时把四个按钮移出 Tab 序，实测 C2 的 Tab 走查里它们确实不出现。
  问题只在于它保留了布局盒。）
- 类别：组合选择器 ｜ 严重度：P2
- 同根因其它实例数：**1**
- 双渲染对照：不适用

### [S6-010] 零数据首屏：唯一一句告诉新用户该干什么的话在折线以下，上面是 4 张营销视频卡
- 壳组合：**C1**（新用户第一眼），C2 同理
- 运行环境：3100 fake，**不加 `?shellFixture=1`**（预览 port = 真正的空工作区）
- 表面：AgentHome
- 复现：`http://localhost:3100/?shell=C1`
- 现象：首屏自上而下是 hero 输入框 → 三个空白文档按钮 → "Feature highlights" 视频轮播；
  `No files yet / Create a file, or open one from this computer.` 完全在折线以下
- 证据：`screenshots/C1-state-zero-data.png`、`C1-zero-data-w1024.png`、`-w1280`、`-w1440`
  - `@@FIRSTRUN`（viewport 高 800）：`.shell-list-empty` 的 `top` = **801 / 839 / 839**（1024 / 1280 / 1440），三档全部 ≥ 视口高
  - `.shell-hero` `{top: 132, bottom: 439}`；`.shell-highlight-card` 数量 = **4**（工作区里 0 个文件，却有 4 张产品宣传视频卡）
- 根因：`src/shell/home/AgentHome.tsx` 的区块顺序把 `Highlights` 排在文件列表之前，且空态没有任何"提到首屏"的分支
  —— **根因待定**到具体行：这是布局顺序的产品决策，不是某一行写错；
  卡在"该不该在零数据时抬空态"需要产品拍板（PLAN 第 9 节第 3 条）
- 类别：空态/首次启动 ｜ 严重度：P2
- 同根因其它实例数：**1**
- 双渲染对照：空态文案由 `FileTree.tsx:347-350` 的 comfortable 分支产出；
  compact 分支的 `No files yet.`（带句点，文案不一致）在侧栏内，不受折线影响，**不复现**
- 交叉：零数据态归 S8，此条只补"三个视口下都在折线以下"的数值

### [S6-013] shell 没有加载态：`loaded` 从不参与渲染，加载中与零数据是同一张界面
- 壳组合：**C1–C10 全部**
- 运行环境：3100 fake（fake port 一帧内解析完，所以在 3100 上这条不可见；真 bridge 下的时长归 S4/打包版）
- 表面：整个 shell
- 复现：`?shellFixture=1&shell=C4` 用 `waitUntil: "commit"` 立刻截图
- 现象：截到的已经是 `data-loaded="true"`（`@@LOADING {"dataLoaded":"true"}`）；代码层面确认根本没有 loading 分支
- 证据：`screenshots/C4-state-loading.png`（与 `C4-default-light.png` 同构）；
  DOM 断言 `#shell[data-loaded]` 在 commit 时刻已为 `"true"`。
  静态证据：`grep -rn "loaded" src/shell --include='*.tsx' --include='*.ts'` 的全部非测试命中为
  `App.tsx:47`（解构）、`App.tsx:82`（写 `data-loaded` 属性）、`ShellContext.tsx:68`（state）、
  `:168`（`if (persist && loaded)` 只用于持久化闸门）、`:186-187`（memo）—— **没有任何组件对它分支**
- 根因：`src/shell/App.tsx:82` 只把 `loaded` 写成属性；`src/shell/state/ShellContext.tsx:168` 只用它守持久化。
  没有骨架屏、没有 spinner、没有禁用态
- 类别：终点态 ｜ 严重度：P2（在 3100 无感；在真 bridge 上磁盘扫描期间用户会看到一个"空工作区"）
- 同根因其它实例数：**1**
- 双渲染对照：不适用

### [S6-014] Sheet 骨架在第 18 行断掉，画布下方 234px（32%）纯白
- 壳组合：**C5–C10**（`home=false` 且当前文件是 sheet）
- 运行环境：**3100 fake 独有**（`createShellCanvas()` 返回 null；3210 上 adapter 非 null，S4 永远看不到这三套骨架 —— PLAN 2.3）
- 表面：`editor/CanvasPlaceholder.tsx` > `SheetSkeleton`
- 复现：`?shellFixture=1&shell=C9` → 点 `MO sales forecast` 标签
- 现象：表格从第 1 行画到第 18 行就停了，下面是纯白；读起来像"这个表只有 18 行"而不是"还没加载"
- 证据：`screenshots/C9-skeleton-sheet.png`、`C7-skeleton-sheet.png`、`C9-skeleton-sheet-w1040.png`
  - `@@SKELETON C9/sheet`：`.shell-canvas {h: 728}`，`.shell-skeleton-grid {h: 494}` → 空白 **234px = 32.1%**；
    `.shell-skeleton-cell` 计数 **152**（= 8 列 × 19 行）
  - `.shell-canvas-scroll` 的 `scrollHeight === clientHeight === 728`，所以不是"滚下去还有"
- 根因：`src/shell/editor/CanvasPlaceholder.tsx:47` `Array.from({ length: 18 }, …)` 行数写死，
  配合 `src/shell/app.css:251-256` `.shell-skeleton-grid { grid-auto-rows: 26px }` → 19 × 26 = 494px 固定高，与画布高度无关
- 类别：占位/骨架 ｜ 严重度：P2
- 同根因其它实例数：**2**（Doc 骨架 `.shell-skeleton-paper` 高 660 / 画布 728，下缘正好落在
  `.shell-canvas-scroll` 的 40px padding 上，无留白问题；Slides 骨架缩略图写死 6 张
  —— `CanvasPlaceholder.tsx:66 Array.from({ length: 6 })`，同类硬编码，视觉上不显）
- 双渲染对照：不适用（另一半是真编辑器，归 S4）

### [S6-015] C9/C10 的悬浮面板默认落位就盖住画布右下 20.7%，sheet 骨架的最后两列整列不可见
- 壳组合：**C7 / C8 / C9 / C10**（C9/C10 是 PLAN 点名的高危格）
- 运行环境：**3100 fake**（盖住的是骨架；真编辑器的遮挡结论归 S4，本条不外推）
- 表面：`.shell-presence` × `.shell-canvas`
- 复现：`?shellFixture=1&shell=C9` → 切到 `MO sales forecast`
- 现象：面板默认停在右下，把 F、G 两列和第 8–18 行整块压住；面板不会让位，画布也不会缩
- 证据：`screenshots/C9-skeleton-sheet.png`、`C9-default-light.png`、`C9-state-float-min-width.png`
  - 1280×800：`.shell-presence {x:916, y:252, w:340, h:543}`，`.shell-canvas {x:52, y:40, w:1228, h:728}`
    → 遮挡面积 184 620 / 893 984 = **20.7%**
  - 1040×720（桌面最小窗口）：`.shell-presence {x:676, y:172, w:340, h:543}`，
    `.shell-canvas {x:52, y:40, w:988, h:648}` → 遮挡 **28.8%**
- 根因：`src/shell/agent/AgentPresence.tsx:62-70` 默认落位
  `x = max(8, innerWidth - 340 - 24)`, `y = max(48, innerHeight - 520 - 28)`，只考虑视口不考虑画布内容；
  `shellReducer.ts:124` 的 `canDock()` 在 editor 模式恒 false，所以 C9/C10 没有"改成停靠"这个出口
- 类别：浮层遮挡 ｜ 严重度：P2（3100 口径；真编辑器下可能升级，交 S4）
- 同根因其它实例数：**1**
- 双渲染对照：不适用

---

## P3 / 记录在案

### [S6-016] 折叠轨下顶栏内容边界与侧栏边界差 80px
- 壳组合：**C1 / C3 / C7 / C9**（`navCollapsed=true` 且非 docked）
- 运行环境：3100 fake
- 证据：`.shell-sidebar {w: 52}` 而 `.shell-tabstrip {x: 132}`（`@@PROBE C1/1280/light` 等四格一致）
  → 标签条左沿比它注释里说的 "content boundary" 右移 **80px**。
  展开态 C2/C4/C8/C10 则严丝合缝：sidebar w=190、tabstrip x=190。
  docked 的 C5（52+320=372 = tabstrip x）与 C6（190+320=510）也对齐
- 根因：`src/shell/chrome/chrome.css:146` `padding-left: max(var(--shell-nav-w), 132px)`
  —— 132px 是给红绿灯留的净空（`app.css:66` 同注释），在折叠轨（52px）下这个 `max` 把
  "对齐内容边界"的承诺让位给了"避开红绿灯"。两个目标在折叠态冲突，代码选了后者且没有视觉补偿
- 类别：对齐/平台假设 ｜ 严重度：P3（有理由的取舍，但注释与行为不符）
- 同根因其它实例数：**1**；另与 PLAN 2.5 的 macOS 红绿灯假设同源，Windows 构建上 132px 的方向是反的（S1 负责）
- 双渲染对照：不适用

### [S6-017] 全部 10 个组合的文案硬编码英文，与中文文件名同屏混排
- 壳组合：**C1–C10 全部**
- 运行环境：3100 fake
- 证据：`screenshots/C2-state-long-names.png`、`C2-default-light.png` 等；
  同一屏里 `Feature highlights` / `Continue working` / `Recent tasks` / `No files yet` 是英文，
  文件名 `二〇二六年第三季度产品发布会全流程执行方案与风险预案汇总（含渠道投放、媒体沟通、现场执行三个分册）.docx`
  与文件夹名是中文。实测标签里该名 `scrollWidth = 588`、`clientWidth = 92` → 只能显示约 6 个汉字
- 根因：`src/shell` 内 `t("` 调用数 = 0（PLAN 2.2），全部硬编码
- 类别：i18n ｜ 严重度：见 PLAN 第 9 节第 2 条（工程量，不计入 UI 缺陷清单）
- 同根因其它实例数：全量清单由 S5 出
- 双渲染对照：两套 density 均为硬编码英文，且文案不一致：
  compact 是 `No files yet.`（带句点），comfortable 是 `No files yet`（无句点）——
  `FileTree.tsx:347-350` 与 compact 分支各写一份

### [S6-018] 长中文名与长英文名在标签与树行里都正确省略，未发现破版（阴性结论）
- 壳组合：C1–C10
- 证据：`@@LONGNAMES` —— 6 个 `.shell-tab-name` 全部
  `textOverflow: "ellipsis"`, `whiteSpace: "nowrap"`, `overflowX: "hidden"`；
  长中文 `scrollW 588 / clientW 92`，长英文 `scrollW 771 / clientW 93`，均正常截断。
  C2/C6/C8 的 probe 里 `textOverflow` 数组为空、`clipped` 数组为空
- 结论：**长文案维度在标签栏与侧栏树上没有缺陷**；唯一被长名打穿的是 S6-009 的首页表格
- 严重度：无（阴性结论留档，避免汇总时重复排查）

---

## 完成判据自查

| 判据 | 状态 |
|---|---|
| 每条有截图路径 + 可验证数值 | 18/18 都有。S6-017 的数值是 scrollWidth/clientWidth；S6-018 是阴性结论 |
| 每条给到 `文件:行` 根因 | 17/18 给到。**S6-010 标为「根因待定」**，卡在它是布局顺序的产品决策而非代码缺陷 |
| 每条填「同根因其它实例数」 | 18/18 |
| 每条填「壳组合」「运行环境」 | 18/18 |
| 涉及 FileTree 的填双渲染对照 | S6-005 / S6-009 / S6-010 / S6-017 四条已填 |

## 覆盖自报（逐个组合对账）

### 主维：10 个壳组合，默认视口 1280×800 亮色

| 组合 | 截图 | 全量几何扫描 | 结论 |
|---|---|---|---|
| C1 | `C1-default-light.png` | 是 | 折叠轨对齐差 80px（S6-016）；轮播第 3 张出视口 291px（设计如此，`highlights.css:72-82` 每屏 3 张）；tab 隐藏 91px |
| C2 | `C2-default-light.png` | 是 | 表格溢出 21.4px；tab 隐藏 149px；树最后一行低于视口 24px（`.shell-sidebar-body` overflow-y auto，可滚，非缺陷） |
| C3 | `C3-default-light.png` | 是 | 同 C1 的 80px；EditorHome 表格此宽度下不溢出（容器 1080 = 表 1080） |
| C4 | `C4-default-light.png` | 是 | 表格溢出 21.4px（S6-009） |
| C5 | `C5-default-light.png` | 是 | tab 隐藏 331px；tabstrip x=372 = 52+320 对齐正确 |
| C6 | `C6-default-light.png` | 是 | tab 隐藏 **469px（47%）**，全矩阵最差；tabstrip x=510 对齐正确 |
| C7 | `C7-default-light.png` | 是 | `offViewport` 与 `clipped` 均为**空数组**——静态上最干净的一格；问题全在交互态（S6-011/012/015） |
| C8 | `C8-default-light.png` | 是 | 同 C2 的树行；面板 916..1256 |
| C9 | `C9-default-light.png` | 是 | 静态空数组；交互态见 S6-011/012/015；骨架见 S6-014 |
| C10 | `C10-default-light.png` | 是 | 静态空数组 |

### 四个代表组合的全覆盖

| 维度 | C1 | C2 | C4 | C9 |
|---|---|---|---|---|
| 1024 亮/暗 | 是/是 | 是/是 | 是/是 | 是/是 |
| 1040 亮/暗（真实最小宽） | 是/是 | 是/是 | 是/是 | 是/是 |
| 1280 亮/暗 | 是/是 | 是/是 | 是/是 | 是/是 |
| 1440 亮/暗 | 是/是 | 是/是 | 是/是 | 是/是 |
| 空态 | 零数据（三视口） | 空文件夹 yirentk | Pinned 视图 | n/a（非首页） |
| 加载中 | — | — | 是（S6-013：不存在） | — |
| 错误 | 见下 | 见下 | 见下 | 见下 |
| 超长中文名 | 是 | 是 | 是 | 是（标签） |
| 超长英文名 | 是 | 是 | 是 | 是（标签） |

共 32 格视口×亮暗，全部有截图 + 几何扫描。

**"错误态"这一维没有界面可截**，原因是契约层面不存在：
`AgentStatus` 只有 idle/reading/writing/working/paused/awaiting-review/done（PLAN 2.2.1），
失败走 `AgentEvent kind:"error"` → toast；`grep -rn '"Failed\|Something went' src/shell` 命中 0。
shell 里唯一的错误表面是 toast，归 S2/S8。这不是漏做，是这一维在 shell 内为空集。

### 三件专属任务

1. **模式切换过渡中间态** — 做完。C6 ↔ Editor 双向，各 4 帧（0/100/300ms/结束），8 张截图 + `@@TRANSITION` 数值表。
   产出 3 条发现：S6-002（标签条瞬移 320px）、S6-003（停靠面板先卸载留空列、同时悬浮面板弹出）、
   S6-004（反向挂载被压到 "Fini"）。
   附带测得缓动实际形状：`cubic-bezier(0.22,1,0.36,1)` 极度前倾，100ms 时列宽已从 320 走到 2，
   所以可见错位窗口约 **100ms** 而非标称 200ms。
   **没做**：只在 C6（展开 + docked）一组上分帧；C5（折叠 + docked）未分帧 ——
   差异只有 nav 宽，错位量应为同一个 320px（`--shell-task-w`），但未实测。

2. **键盘 Tab 序与焦点环，两个模式各一遍** — 做完，实际做了 4 遍（C2 agent / C4 editor / C1 折叠轨 / C7 工作区）。
   - Tab 序确认因模式而异：agent 是 `Home → New task → New folder → 树`；
     editor 是 `Home → New → Open → Recent → Pinned → Settings → Group by → File type`。
   - 侧栏按钮（`.shell-sidebar-item`）在折叠轨 C1 下焦点环照常可见（`outline: solid 2px rgb(120,149,174)`），
     且 `aria-label` 在折叠时才挂（`Sidebar.tsx:189`），标签不可见时无障碍名仍在 —— **这一块是对的**。
   - **焦点陷阱：没有发现。** 菜单 Esc 后焦点回到触发器：
     `@@FOCUSRETURN` = `{inMenu:"shell-menu-item", afterEscape:"shell-brand"}`。
   - 两条缺陷：S6-005（关闭按钮无焦点环）、S6-006（Home 四格标签栏整体不可达）。
   - **没做**：没有走满整个 Tab 环回到起点（每次只走 16 步），所以"最后一个可聚焦元素之后是否回到浏览器 chrome"未验证；
     Shift+Tab 反向序未测。

3. **CanvasPlaceholder 三套骨架** — 做完。Doc / Sheet / Slides 各在 **C9 与 C7 两个组合**下开了一次，
   外加 C9 在 1040 下再开三次，共 9 张截图 + 逐元素 rect。
   - Doc：`.shell-skeleton-paper {x:276, w:780, h:660}`，`width: min(780px,100%)` 生效，居中正确，无溢出。
   - Sheet：152 个 cell，grid 高 494 / 画布 728 → S6-014。
   - Slides：filmstrip 168px 固定宽 + 6 张缩略图，stage `{x:220,w:1060}`，slide `{w:880,h:495}`（16:9 精确）。
     1040 宽下 `clipped` 仍为空数组，未破版。
   - 三套都在 `aria-hidden="true"` 容器里，屏幕阅读器不会读到假内容 —— 正确。
   - **没做**：没在 C5/C6（docked）下开骨架 —— 那里画布更窄（770px），
     `.shell-skeleton-paper` 的 `min(780px, 100%)` 会切到 100% 分支，`.shell-skeleton-slide` 的
     `min(880px,100%)` 同理，值得补一次但本轮未做。

### 明确没做的，以及原因

| 没做 | 原因 |
|---|---|
| 3210 dev-real 下的任何采集 | PLAN 3 节把 3210 判给 S4 独占，且明令其它 session 不要碰该端口 |
| C5/C6 下的三套骨架 | 时间分配给了主维 10 格与四代表组合的 32 格；docked 画布 770px 会走 `min()` 的另一分支，建议补 |
| C5 的过渡分帧 | 同上；预期与 C6 同为 320px 错位，未实测 |
| Shift+Tab 反向序、完整 Tab 环 | 每次只走 16/10/8 步 |
| 收起态悬浮马克（`FACE_SIZE=56`）的贴边行为 | 只测了展开态；S6-011/012 的根因常量 `PANEL_SIZE` 只管展开态 |
| 竖直方向的视口维（高度） | PLAN 第二维只列了宽度；只在 C9 用 720 高跑了一次（`main.go:45 MinHeight: 720`）。S6-011 的 15px 溢出在 800 高下就已出现，更矮只会更糟 |
| 轮播左右箭头的边界态 | 归 S3（PLAN 3 节 S3 行明列） |
| toast 的定位与叠压 | 归 S2 |
