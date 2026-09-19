# S3 — 两个首页 & composer

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ 负责表面：`home/AgentHome.tsx` `home/EditorHome.tsx` `home/*` `composer/Composer.tsx`
必过组合：**C1 / C2 / C3 / C4，四个全部覆盖**
运行环境：**3100 fake（浏览器，adapter 为 null）**，视口 1280×720（另在 900×900、760×720 做过两次窄视口取样）
spec：`e2e/ui-audit-s3.spec.ts`（24 条，全绿）｜ 截图：`docs/ui-audit-2026-09-19/S3/screenshots/`

```
PLAYWRIGHT_BASE_URL=http://localhost:3100 OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/s3 \
  npx playwright test e2e/ui-audit-s3.spec.ts
```

每条发现里的数值都是 spec 打出的 `S3 <name> {...}` 那行，可重跑对账。

---

### [S3-001] Home 的三条带子不在同一列上（宣称在同一列的注释是错的）

- 壳组合：**C1 复现**；C2 不复现（内容盒 994px < 1080px）；C3/C4 是另一套首页，见 S3-002
- 运行环境：3100 fake
- 表面：AgentHome > Feature highlights / Continue working / Your files
- 复现：`3100/?shellFixture=1&shell=C1`
- 现象：轮播比下面两条带子右移 26px；加上 800px 居中的 hero，一屏三个左边缘
- 证据：`screenshots/C1-agenthome-full.png`
  - `S3 C1-band-left-edges {"highlights":126,"tasks":100,"files":100,"highlightsMinusTasks":26}`
  - `S3 C1-band-margins`：`.shell-highlights` computed `marginLeft/Right = 26px`；`.shell-hero-resume`、`.shell-home-list` 均 `0px`；三者 `max-width` 同为 `1080px`
  - hero rect `left 266 / right 1066`，与另两者（100/1180）也不重合
- 根因：`src/shell/home/highlights.css:15-17` 有 `margin: 0 auto 34px`；`src/shell/home/home.css:157-160`（`.shell-hero-resume`）与 `home.css:78-80`（`.shell-home-list`）只有 `max-width:1080px`，**无水平 auto 外边距**。`highlights.css:13-14` 的注释「Same column the resume card and the file list sit in」与实测相反。
- 类别：布局/组合选择器漏写 ｜ 严重度：**P2**
- 同根因其它实例：**2 处**（`home.css:78`、`home.css:157`）。`src/shell` 全量 5 条非容器查询 `max-width`，另两条都带 auto 外边距。
- 双渲染对照：不适用

---

### [S3-002] EditorHome 的标题行与新建按钮行比文件表宽 52px

- 壳组合：**C3 复现**；C4 不复现；C1/C2 无此结构
- 运行环境：3100 fake
- 表面：EditorHome > `.shell-home-head` / `.shell-home-actions`
- 复现：`3100/?shellFixture=1&shell=C3`
- 现象：右上两个下拉比下方文件表右边缘外探 52px
- 证据：`screenshots/C3-editorhome-full.png`
  - `S3 C3-editorhome-rects`：`head {left:100,right:1232,width:1132}`、`actions {right:1232}`、`list {right:1180,width:1080}` → 差 **52px**；C4 对照两者都是 1232，差 0
- 根因：`src/shell/home/home.css:9`（`.shell-home-head`）与 `:40`（`.shell-home-actions`）**没有 `max-width`**，同页 `.shell-home-list`（`home.css:78`）有 1080px
- 类别：布局 ｜ 严重度：**P2**
- 同根因其它实例：**2 处**。与 S3-001 同属「1080 这个数没有单一来源」，汇总建议合并。
- 双渲染对照：不适用

---

### [S3-003] 舒适密度文件表列宽塌掉：Name 吃掉 81.6%，Folder/Last opened 换行，行高 40px → 201px

- 壳组合：**C2 / C3 / C4 全部复现**（两个首页、两个 comfortable 调用点都中）
- 运行环境：3100 fake
- 表面：`nav/FileTree.tsx` 的 `ComfortableList`，由 `home/FileList.tsx:24` 与 `home/EditorHome.tsx:85` 渲染
- 复现：`3100/?shellFixture=1&shell=C4`，看 Today 分组
- 现象：Folder 列剩 83px，「MO product launch」竖断三行；Last opened 剩 58px，「Today, 9:05 PM」断成六个行盒；表头「Last opened」也断两行；含超长中文文件夹名那行高 **201px**（样式表声明 40px）；表比容器宽 21px
- 证据：`screenshots/C4-editorhome-full.png`、`C4-list-column-collapse.png`、`C2-agenthome-list-columns.png`、`C3-editorhome-list-columns.png`
  - `S3 C4-list-columns`：`tableLayout:"auto"`；Name `829px/81.6%/lineBoxes 2`，Folder `83px/8.1%/lineBoxes 3`，Last opened `58px/5.7%/lineBoxes 6`，Pin `46px/4.5%`；每个 td `whiteSpace:"normal"`、`textOverflow:"clip"`；`actualRowHeights: [41, 61, 201]`
  - `S3 C4-list-horizontal-overflow`：`wrapperClientWidth 994` vs `tableScrollWidth 1015` → 溢出 **21px**；`C4-editorhome-rects` 里 `table.right 1253.4` vs `head.right 1232`
  - `S3 C2-agenthome-list-columns`：同为 `829/83/58/46`，`rowHeights [41,61,201]`，`overflowsWrapper: true`
  - `S3 C3-editorhome-list-columns`：`829/142/63/46`，`rowHeights [40,61,101]`，`overflowsWrapper: false`
  - `S3 C4-list-long-names {"clippedRows":0}` —— **没有任何一格被省略号截断**，证明不是在截断而是在撑
- 根因：`src/shell/nav/nav.css:217-221` 的 `.shell-list` 只有 `width:100%; border-collapse: collapse`，**没有 `table-layout: fixed`**，所以 `nav.css:265` 的 `td:first-child { width: 46% }` 只是建议值，实测解析成 81.6%；`nav.css:258-263` 的 `.shell-list td` 只声明 `height: 40px`，无 `white-space/overflow/text-overflow`。截断只加在 `nav.css:283-287` 的 `.shell-list-file > span`，即四列里只有 Name 有截断。
- 类别：布局/长文案 ｜ 严重度：**P1**
- 同根因其它实例：**2 个调用点 × 2 列缺截断 = 4 个实例**（Folder `FileTree.tsx:406`、Last opened `FileTree.tsx:407-411`）
- 双渲染对照：**侧栏 CompactTree 不复现**——`.shell-tree-file-open`（`nav.css:150-171`）有 `min-width:0` + span 三件套，实测行高稳定 34px。两套选择器前缀不同（`.shell-tree-*` vs `.shell-list*`），**修 `.shell-list td` 不会碰到侧栏**，但同在 `nav.css` 一个文件里，改动要按 S1 清单回归。

---

### [S3-004] EditorHome 的 Group by / File type 下拉，选项是**完全没有样式的原生按钮**

- 壳组合：**C3 / C4**（AgentHome 无此控件）
- 运行环境：3100 fake
- 表面：EditorHome > 页头 `Select`（`EditorHome.tsx:47`、`:53`）展开后的面板
- 复现：`3100/?shell=C4` → 点「All types」
- 现象：四个选项是灰底、2px 立体斜角边框、Arial 居中的系统原生 button
- 证据：`screenshots/C4-editorhome-legacy-select-menu.png`（肉眼即见）
  - `S3 C4-legacy-select-menu.rowStyles`：`className:"(none)"`、`borderStyle:"outset"`、`borderWidth:"2px"`、`background:"rgb(239,239,239)"`、`fontFamily:"Arial"`、`fontSize:"13.3333px"`、`textAlign:"center"`、`appearance:"auto"`、`height:19px`
  - 规范值 `components.css:648`（`min-height:32px; padding:6px 10px; border:0; border-radius:8px; font-size:13px`）**一条都没生效**
  - 容器 `.od-menu` 的样式**有**生效（`width:180px`，来自 `components.css:630`）→ 不是 CSS 没加载，是元素没类名
- 根因：`src/renderer/ui/components/Select.tsx:37` 渲染 `<button type="button" role="menuitemradio">` **没有 `className="od-menu__item"`**，`components.css:648-651` 四条规则全部落空，UA 默认按钮样式透出。调用点 `src/shell/home/EditorHome.tsx:4`。
- 类别：两套设计系统混用 / legacy 组件缺类名 ｜ 严重度：**P1**
- 同根因其它实例：`src/shell` 里 `Select` 用了 **2 次**（都在 EditorHome）；但缺陷在 `Select.tsx` 自身，legacy 渲染器里每个 `Select` 都一样（需 S5/S7 交叉）。**与 S0-001 不同源**：S0-001 是 CSS 没进构建产物，这条是 CSS 在但选择器对不上。
- 双渲染对照：不适用

---

### [S3-005] 同一行里 legacy 控件比 shell 控件高 4px、圆角差 1px、字号大 1.33px

- 壳组合：C3 / C4 ｜ 环境：3100 fake
- 表面：EditorHome 页头两个 `od-select` vs 正下方四个 `.shell-home-new`
- 证据：`screenshots/C4-editorhome-full.png`；`S3 C4-editorhome-header`：`od-select → height 36 / borderRadius "5px" / fontSize "13.3333px"`；`.shell-home-new → height 32 / borderRadius "6px" / fontSize "12px"`。令牌值：`--shell-radius-item: 6px`（`tokens.css:40`）、`--shell-text: 12px`（`tokens.css:69`）
- 根因：`src/shell/home/EditorHome.tsx:4` 直接引 `renderer/ui` 的 `Select`，该组件按 `--od-*` 令牌排版，与 `src/shell/tokens.css` 两套刻度
- 类别：两套设计系统混用 ｜ 严重度：**P2**
- 同根因其它实例：`src/shell` 非测试 `renderer/ui` 引用共 **8 处**（`App.tsx:1`、`EditorHome.tsx:4`、`ModelMenu.tsx:4`、`Composer.tsx:14`、`useAgentTask.ts:9`、`FileTabs.tsx:11`、`useFolderDialogs.tsx:3`、`reportPortFailure.ts:1`），带可见外观的是 Select/Input/Modal/ToastHost 四类；Select 归 S3，其余归 S2/S7
- 双渲染对照：不适用

---

### [S3-006] 首页还没打字，主按钮就是「停止任务」

- 壳组合：**C1 / C2 都复现**（只要存在 running 任务）
- 运行环境：3100 fake
- 表面：AgentHome > hero composer > 右下角主按钮
- 复现：`3100/?shellFixture=1&shell=C1`，什么都不做
- 现象：输入框空着，右下角是深色实心圆 + 方块停止图标，`aria-label = "Stop task"`；点下去会停掉用户没在看的后台任务
- 证据：`screenshots/C1-hero-send-is-stop.png`、`C1-agenthome-full.png`
  - `S3 C1-send-button-with-running-task {"inputValue":"","ariaLabel":"Stop task","title":"Stop task","disabled":false,"glyph":"lucide lucide-square","background":"rgb(65, 70, 75)"}`
  - 空工作区对照 `S3 C1-send-button-no-task {"ariaLabel":"Send message","disabled":true,"background":"rgb(230, 232, 234)"}`
- 根因：`src/shell/composer/Composer.tsx:193` `const stopping = busy && !canSend;`，`busy` 由 `src/shell/home/Hero.tsx:72` 从 `useAgentTask()` 传入——那是**当前 scope 文件夹的任务**，不是这个 composer 发起的。Home 上「空输入 + 别处有任务在跑」恒等于停止按钮。
- 类别：状态表达 ｜ 严重度：**P1**（破坏性动作、零确认、出现在新用户第一眼的 C1）
- 同根因其它实例：**1 处表达式 / 3 个 placement**。docked 与 floating 下行为是对的，只有 `placement === "home"` 错——与 `Composer.tsx:201`/`:219` 已为 home 特判掉 `reference` 与 `activeFileId` 同型，`busy` 漏了特判。
- 双渲染对照：不适用

---

### [S3-007] 附件条藏起 62px，无任何提示，最后一排被横切

- 壳组合：C1 / C2（规则不分 placement）｜ 环境：3100 fake
- 表面：`.shell-cx-chips`
- 复现：C2 里往 composer 拖 10 个文件
- 证据：`screenshots/C2-composer-chip-overflow.png`（截图可见第 4 排 chip 被切成半个）
  - `S3 C2-chip-overflow {"chipCount":10,"clientHeight":112,"scrollHeight":174,"maxHeight":"112px","scrolls":true,"hiddenRows":62,"nameClipped":9,"nameMaxWidth":"200px","composerHeight":283}`
- 根因：`src/shell/composer/composer.css:66-74` `max-height: 112px; overflow: auto`，`scrollbar-width: thin` 在 macOS 覆盖式滚动条下静止不显形；容器高不是 chip 行高整数倍。上限 `Composer.tsx:71 MAX_ATTACHMENTS = 10` —— **允许的最大数量必定超出可视高度**。
- 类别：溢出/容器裁切 ｜ 严重度：**P2**
- 同根因其它实例：**1 条规则 / 3 个 placement**；docked（320px）下每行只放 1~2 个，溢出更早 —— 请 S4 在 C5/C6 复核
- 双渲染对照：不适用

---

### [S3-008] `.is-dragging` 是死类：拖拽中没有任何高亮

- 壳组合：C1 / C2 ｜ 环境：3100 fake
- 证据：`screenshots/C2-composer-dragging.png`
  - `S3 C2-drag-over`：`classList: "shell-cx shell-cx--home is-dragging"`，同时 `composerBorderColor:"rgb(217,223,228)"`、`composerBoxShadow:"rgba(0,0,0,0.02) 0px 2px 5px 0px"`、`composerBackground:"rgb(255,255,255)"` —— 与静止态逐值相同
  - `grep -rn "is-dragging" src/` → **只有 1 行命中，就是 `Composer.tsx:528` 那个模板字符串本身**
- 根因：`src/shell/composer/Composer.tsx:528` 拼了类名，`composer.css` 无对应规则
- 类别：死代码/缺样式 ｜ 严重度：**P3**（唯一反馈是 `.shell-cx-drop` 蒙层；两套反馈只做了一套）
- 同根因其它实例：**1 处**，grep 已穷举
- 双渲染对照：不适用

---

### [S3-009] 放置蒙层内缩 1px 却沿用 20px 圆角

- 壳组合：C1 / C2 ｜ 环境：3100 fake
- 证据：`screenshots/C2-composer-dragging.png`；`S3 C2-drag-over`：`composerBox {left:335,top:228,width:800,height:161,borderRadius:"20px"}` vs `overlayBox {left:336,top:229,width:798,height:159,borderRadius:"20px"}`；附带 `overlayPointerEvents:"auto"`、`z-index:10` 盖住 textarea
- 根因：`src/shell/composer/composer.css:371-383` 的 `inset: 0` + `border-radius: inherit`，`inherit` 拿到父元素 20px 但自身盒小 1px；应为 `calc(20px - 1px)` 或 `inset: -1px`
- 类别：像素对齐 ｜ 严重度：**P3** ｜ 同根因其它实例：`src/shell` 里 `border-radius: inherit` 仅此 **1 处**
- 双渲染对照：不适用

---

### [S3-010] composer 自适应高度只认文字不认宽度

- 壳组合：C1 / C2（以及任何改变 composer 宽度的操作）｜ 环境：3100 fake
- 复现：C2 输入无换行长段落，窗口从 1280 缩到 760
- 证据：`screenshots/C2-composer-height-stale-after-resize.png`
  - `S3 C2-composer-width-change`：宽 `{"inlineHeight":"94px","clientHeight":94,"scrollHeight":94,"overflowing":false,"width":766}`；窄 `{"inlineHeight":"94px","clientHeight":94,"scrollHeight":146,"overflowing":true,"width":440}` → **52px 内容被藏，而 maxHeight 是 220px**
  - 对照（纯文字变化正常）：`S3 C2-composer-empty` 88px → `S3 C2-composer-capped` 220px + 滚动
- 根因：`src/shell/composer/Composer.tsx:222-229` effect 依赖 `[text, placement]`，无 `ResizeObserver`/`resize` 监听。同页 `src/shell/home/Highlights.tsx:115-118` 为轮播接了 `ResizeObserver` + `resize`，两处标准不一致。
- 类别：响应式/失效重算 ｜ 严重度：**P2**
- 同根因其它实例：**1 个 effect / 3 个 placement**；docked↔floating 切换与拖 `--shell-task-w` 都会改宽度，请 S4 在 C5–C8 复核
- 双渲染对照：不适用

---

### [S3-011] 任务行副标题没有截断保护，行高 59px → 82px

- 壳组合：C1 / C2 ｜ 环境：3100 fake，1280×720 与 900×900 各一次
- 证据：`screenshots/C2-tasklist-five-states.png`、`C2-tasklist-narrow-900.png`
  - 1280：`S3 C2-task-row-heights [59, 66]`；CJK 行 `titleBoxHeight 17`（其余 14）、`smallBoxHeight 16`（其余 12）
  - 900：`S3 C2-task-row-heights-narrow [59, 82]`；CJK 行 `smallLineBoxes: 2`、`smallBoxHeight: 32`、`rowHeight: 82`
  - computed：`small` 是 `whiteSpace:"normal"` / `textOverflow:"clip"`；`strong` 是 `nowrap` / `ellipsis`
- 根因：`src/shell/home/home.css:202-207` 的 `.shell-resume-title small` 无 `white-space/overflow/text-overflow`，而 `home.css:193-200` 的 `strong` 三样俱全；两条都**没有 `line-height`**，中英字形高差（14/17、12/16）直接传导到行高
- 类别：长文案/中英混排 ｜ 严重度：**P2**
- 同根因其它实例：`home.css` 里「只写 font-size 不写 line-height」共 **7 条**（`:21 :30 :97 :106 :166 :198 :206`），承载可变长文案的 2 条；缺截断的 **1 条**（`:206`）。同型的 `composer.css:485-491` `.shell-mention-text small` 有 line-height 但也无截断 → 归 S2。
- 双渲染对照：不适用

---

### [S3-012] Pin 按钮静止态全透明，键盘聚焦后既无图标也无焦点环

- 壳组合：C2 / C3 / C4 ｜ 环境：3100 fake
- 证据：`screenshots/C4-pin-column-keyboard-focus.png`
  - `S3 C4-pin-at-rest`：未 pin → `color:"rgba(0, 0, 0, 0)"`，26×26；已 pin → `color:"rgb(89,111,134)"`
  - `S3 C4-pin-keyboard-focus`：`focusVisible: true` 时仍 `color:"rgba(0,0,0,0)"`、`outlineStyle:"none"`、`outlineColor:"rgba(0,0,0,0)"`
  - 枚举全部命中 `.shell-list-pin` 的选择器共 4 条，**无一带 `:focus-visible`**：`[".shell-list-pin", ".shell-list tbody tr:hover .shell-list-pin", ".shell-list-pin.is-pinned", ".shell-list-pin:hover"]`
- 根因：`src/shell/nav/nav.css:299-310` `color: transparent`，显形只挂 `nav.css:312` 的 `tr:hover`；无 `:focus-visible` 规则。对照 `home.css:151` 的 `.shell-hero-prompt:focus-visible` 是有的。
- 类别：可访问性/焦点可见性 ｜ 严重度：**P2**
- 同根因其它实例：**1 个控件**，但每行都有（C4 Recent 视图 53 个）。同模式的侧栏 `.shell-tree-file-more`/`.shell-tree-folder-add` **归 S1**
- 双渲染对照：**需 S1 确认**——CompactTree 的行内操作位（`FileTree.tsx:316-328`）是同一设计模式的另一实例，S1 报的「+ 按钮跑出行外」很可能同源

---

### [S3-013] 同一个「没有文件」，两套密度两句文案

- 壳组合：C2（两套同屏）｜ 环境：3100 fake
- 现象：侧栏「No files yet.」（带句号），首页「No files yet」（无句号）
- 证据：`screenshots/C2-agenthome-full.png`；`S3 C2-dual-render-inventory.compactEmptyClass = "No files yet."`；空工作区下 `S3 C4-empty-no-files-yet.heading = "No files yet"`
- 根因：`src/shell/nav/FileTree.tsx:107` 与 `src/shell/nav/FileTree.tsx:350` —— 同文件相隔 243 行的两处硬编码
- 类别：文案一致性 ｜ 严重度：**P3** ｜ 同根因其它实例：**2 处**，已穷举
- 双渲染对照：**这条本身就是对照结论**，改哪边都只修一半

---

### [S3-014] 三种空态的正文不说明生效的筛选，两个筛选同时生效时只承认一个

- 壳组合：C4（三种全在此复现）；C3 同理 ｜ 环境：3100 fake，空工作区（`?shell=C4` 不带 `shellFixture`）

| 截图 | 标题 | 正文 | 问题 |
|---|---|---|---|
| `C4-empty-no-files-yet.png` | `No files yet` | `Create a file, or open one from this computer.` | 正确 |
| `C4-empty-no-files-of-this-type.png` | `No files of this type` | `Create a file, or open one from this computer.` | 不提「清掉筛选」这条最近的出路 |
| `C4-empty-no-pinned-files.png` | `No pinned files` | `Pin a file to keep it here.` | 此时 File type **仍是 Documents**，界面完全没说 |

- 证据：`S3 C4-empty-no-pinned-files {"heading":"No pinned files","body":"Pin a file to keep it here.","typeButtonLabel":"Documents"}`；`S3 C4-empty-no-files-yet {"padding":"56px 12px","height":158,"textAlign":"center","tableHeaders":0}`
- 根因：`src/shell/nav/FileTree.tsx:346-351` 标题是三分支三元，`:353-356` 正文只有两分支
- 类别：空态文案 ｜ 严重度：**P3** ｜ 同根因其它实例：**1 处三元 / 标题 3 分支 vs 正文 2 分支**
- 双渲染对照：CompactTree 只有一句 `No files yet.`，无筛选概念，不复现
- 补充（覆盖度事实）：**AgentHome 永远只能触发 3 种里的 1 种**——`home/FileList.tsx:24-41` 既不传 `filter` 也不传 `fileType`，agent 模式下另两种不可达

---

### [S3-015] scope 菜单底边掉出视口 1px

- 壳组合：C2（C1 未测）｜ 环境：3100 fake，1280×720
- 证据：`screenshots/C2-composer-scope-menu.png`；`S3 C2-scope-menu {"left":388,"right":648,"bottom":721,"width":260,"viewport":{"width":1280,"height":720},"offViewport":true}` → 超出 1px。对照同 composer 的 permission `bottom 591`、model `bottom 640`（项更少）
- 根因：**与 S2 同源**（`chrome/Menu.tsx` 无碰撞检测/翻转）。本表面触发条件：scope 项数 = 文件夹数 + 1（fixture 5 个 → 6 项 ≈ 260×200px），而 composer 工具栏在 Home 上位于视口 60% 高度处，随文件夹数线性恶化
- 类别：浮层定位 ｜ 严重度：**P3** ｜ 同根因其它实例：归 S2；本表面 3 个菜单中当前只有 scope 触发
- 双渲染对照：不适用

---

### [S3-016] 轮播左右箭头继承了为卡片写的 -2px 内缩焦点环

- 壳组合：C1 / C2 ｜ 环境：3100 fake
- 证据：`screenshots/C2-carousel-arrow-focus.png`、`C2-carousel-card-focus.png`
  - 箭头 `S3 C2-carousel-arrow-focus {"focusVisible":true,"outlineOffset":"-2px","outlineWidth":"2px","borderRadius":"50%","width":"26px","height":"26px"}`
  - 卡片 `S3 C2-carousel-card-focus {"outlineOffset":"-2px","insideTrack":true}` —— 卡片上是对的
- 根因：`src/shell/home/highlights.css:65-70` 选择器 `.shell-highlights button:focus-visible` 覆盖到了 `.shell-highlights-controls button`；注释（`:67-69`）自陈 `-2px` 是为 track overflow 裁切写的，箭头不在 track 里
- 类别：焦点样式 ｜ 严重度：**P3** ｜ 同根因其它实例：**1 条规则 / 2 个箭头**
- 附带（非缺陷，记数）：轮播两端边界态都正确。首屏 `previousDisabled:true / nextDisabled:false`；按一次 next 后 `scrollLeft 337 == max 337`、`nextDisabled:true / previousDisabled:false`。第 4 张卡左边缘在 `238 + 3×(320.7+16) = 1248.1`，track 右边缘 1232 → **首屏第 4 张卡一像素都不露**，「还有更多」全靠箭头传达。

---

## 横切：i18n（PLAN 2.2）

四个表面用户可见文案 **100% 硬编码英文，`t(` 调用数为 0**（`S3 C2-copy` 实测）：

| 表面 | 文案 | 来源 |
|---|---|---|
| hero | `What would you like to get done?` / `Bring your files and a goal…` | `Hero.tsx:55,57` |
| composer 占位符 | `Ask anything, @ to add files or folders…` | `Composer.tsx:621` |
| 快捷提示 ×3 | `Write a document` / `Analyse a workbook` / `Build a presentation` | `QuickPrompts.tsx:5-7` |
| 轮播 | `Feature highlights` + 4 组卡片文案 | `Highlights.tsx:50-55,170` |
| 任务列表 | `Continue working` / `Recent tasks` / 七个状态名 | `TaskList.tsx:62,65` + `companion.ts:111-150` |
| 文件列表 | `Files in {folder}` / `Your files` / 表头 `Name Folder "Last opened" Pin` / 三种空态 | `FileList.tsx:22`、`FileTree.tsx:368-373,346-356` |
| EditorHome | `Recent` `Pinned` / `All types` `Documents` `Workbooks` `Presentations` / `Blank document` `Blank workbook` `Blank presentation` `Open from this computer` | `EditorHome.tsx:14-23,44,71,80` |
| composer 菜单 | `Full access` `Review changes` `Custom` `Enter sends · on` `New folder…` `Drop files to add context` | `Composer.tsx:57-68,696,518,750` |

**混排实证**（同一行）：`S3 C2-copy.taskTitles` 含 `二〇二六年第三季度产品发布会全流程执行方案与风险预案汇总（含渠道投放、媒体沟通、现场执行三个分册）`，右边状态标签是 `Agent finished`；文件列表 Folder 列同样中文数据配英文表头。**英文系统上也成立**（工作区数据不随 `navigator.language` 变）。与 S3-011 叠加：中文字形把行高从 59 撑到 82，混排不只是观感问题。

---

## 双渲染对照汇总（PLAN 2.4，交接 S1）

两套分支**没有共享任何 class 前缀**（`.shell-tree-*` vs `.shell-list*`），「改一边影响另一边」在选择器层面**不成立**；风险在 `nav.css` 是同一文件、`fileTreeModel.buildGroups` 是同一数据模型。

| 维度 | CompactTree（S1） | ComfortableList（S3） |
|---|---|---|
| 文件行 | `fontSize 11 / lineHeight 18 / padding 8px 26px 8px 7px / gap 7 / height 34` | `fontSize 12 / lineHeight 20 / padding 0 / gap 9 / height 20` |
| 文件名截断 | 有（`nav.css:166-171`） | 只有 Name 列（`nav.css:283-287`）→ **S3-003** |
| 空态文案 | `No files yet.` | 三种 → **S3-013 / S3-014** |
| 行内操作位 | hover 显形 | hover 显形（Pin 列）→ **S3-012，请 S1 确认另一半** |
| 分页 | `SIDEBAR_PAGE = 5` + Show N more | 无分页，53 行一次画完 |

需 S1 回复的只有一条：**S3-012（hover-only 控件缺 `:focus-visible`）在 CompactTree 那半边是否同样成立**。
（S1 已独立报告 S1-005：`.shell-tree-folder-toggle` / `.shell-tree-file-open` / `.shell-tree-more` / `.shell-tab-close` 的 `outline-style` 均为 `none` —— **成立，同一缺陷家族**。）

---

## 交给别人的三件事（不计入我的发现）

1. **S3-015 根因属 S2**（`chrome/Menu.tsx` 无碰撞检测），我给的是 composer 上的具体触发条件与数值。
2. **`shell-region` 是零规则的 class**：`grep -rn "shell-region" src/shell` 得 7 个使用点（含 `AgentHome.tsx:16`、`EditorHome.tsx:42`），CSS 命中 **0** 条。属 S5 第 5/8 条。
3. **S3-004 对 S0-001 的修正**：S0 写「shell 用到的其它 legacy UI 全部来自 `renderer/ui`，所以都带样式」。CSS 确实带进来了，但 `Select` 的选项行没类名，规则匹配不上，效果等同没样式。S0-001「同根因实例 = 1」不变，但「legacy 组件在 shell 里视觉正常」这个前提要撤销。

---

## 覆盖度自报

| 组合 | 首页 | 覆盖内容 |
|---|---|---|
| **C1** | AgentHome + 折叠轨 | 四条带子 rect 与外边距、hero 位置、composer 800px 下容器查询未触发（permission 名与 mic 都在）、空任务态、send/stop 对照 |
| **C2** | AgentHome + 展开侧栏 | 以上全部 + 轮播两端边界态 + 箭头/卡片焦点环、五种任务态 + 长标题行 + 900px 重测、快捷提示填充、composer 自适应高度（底/顶/宽变）、scope chip + 三个菜单、拖放全流程（拖入 / 放置 / 10 个溢出 / 第 11 个被拒）、与侧栏 compact 对照取样 |
| **C3** | EditorHome + 折叠轨 | 整页、两个 legacy Select 的 computed、页头与列表 52px 错位、折叠轨下 Recent/Pinned 两个 36×36 图标按钮可达且点击生效、1080 宽下的表格列宽 |
| **C4** | EditorHome + 展开侧栏 | 整页、Recent↔Pinned 双向切换（53 → 2 → 53 行）、三种空态各一张截图 + 文案实测、legacy Select 展开后的原生按钮、列宽塌陷与 21px 溢出、长中英文名、Pin 列静止态与键盘态 |

任务列表五种状态**全部拿到**并逐行量了 dot 的 `data-state`/`background`/`animationName`：working→live（`rgb(65,70,75)` + `shell-task-row-pulse`）、awaiting-review→waiting（透明 + 2px inset ring）、paused→waiting、done→still、idle→still（`rgb(139,142,144)`）。**确认契约里没有 failed，没有伪造它**。空列表态用空工作区拿到（band 整体不渲染，`taskList: 0`）。三种空态各一张截图。

**没覆盖到的，以及为什么：**

1. 暗色 / 1024 与 1440 视口 / 加载中与错误态 —— 归 S6，我只在 1280×720 加两次窄视口取样。
2. **EditorHome 的文件拖到文件夹**（`EditorHome.tsx:84`、`FileList.tsx:20` 都挂了 `useFolderDrop`）—— 归 S8。**风险提示给 S8**：ComfortableList 的 `data-drop-folder` 挂在 `<tbody>`（`FileTree.tsx:377`），按时间分组时 `group.folderId` 是 undefined → 属性不渲染 → **整个 Recent 视图没有一个合法放置目标**。
3. `MentionMenu`（@ 提及）—— 归 S2；属于我的三个菜单（scope/permission/model）都测了并给了 rect。
4. `CustomModelDialog`（ModelMenu → Add model…）—— 归 S7，我只截到 ModelMenu 列表本身。
5. docked / floating 下的同一个 composer —— 归 S4（C5–C10）。S3-007 与 S3-010 的规则不分 placement，窄栏下只会更糟，条目里已点名请 S4 复核。
6. 键盘 Tab 全序与焦点环整体 —— 归 S6；我只在轮播箭头/卡片、Pin 列做了 `:focus-visible` 实测。
7. 真编辑器环境（3210）—— 按 PLAN 2.3 首页在两环境应一致（首页不挂 canvas），但**我没在 3210 验证过**，本报告结论仅对 3100 fake 成立。
8. C1 下的 scope 菜单（S3-015）—— 只在 C2 量过，C1 composer 更宽（800 vs 766）、锚点 x 不同，未单独取样。

**不夸大的总结**：AgentHome 与 EditorHome **两套都跑完了 C1–C4 四个组合**，不是只测 AgentHome。16 条发现中 3 条 P1（S3-003 列宽塌陷、S3-004 原生按钮、S3-006 首页主按钮是停止键）、8 条 P2、5 条 P3；每条都有截图 + 至少一个 computed/rect/DOM 数值，根因全部定位到 `文件:行`，**没有一条需要标「根因待定」**。
