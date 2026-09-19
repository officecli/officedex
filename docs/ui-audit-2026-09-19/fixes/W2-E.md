# W2-E 文件列表与树 —— 修复报告

日期：2026-09-19 ｜ 分支：`develop/1.0`（**未 commit，改动留在工作区**）
根因：**R5**（`.shell-list` 缺 `table-layout`）、**R6**（拖放命中区挂错层级 + 两套渲染各缺一半反馈）、
**R16**（行内操作位的包含块是 0×0 的 `.shell-menu-anchor`）、**R8 的一半**（`nav.css` 全文无焦点环）
验证环境：本 track 自起的 3131 dev server（`npx vite --port 3131 --strictPort`，已停），
Chromium，视口 1280×720（另测 1024×768），`?shellFixture=1`

---

## 1. 改了哪些文件

| 文件 | 动作 |
|---|---|
| `src/shell/nav/nav.css` | 表格布局、拖放高亮、行内按钮定位、`padding-right`、焦点环、拖拽源状态 |
| `src/shell/nav/FileTree.tsx` | `data-drop-folder` 提到 section、`ComfortableList` 接 `dropFolderId`、可拖=可放、拖拽源状态、空态文案、可访问名、Show more 焦点 |
| `src/shell/nav/useFolderDrop.ts` | 拖拽时的边缘自动滚动 |
| `src/shell/nav/FileTree.test.tsx` | 跟着改断言（2 处），**新增 4 条**用例 |
| `e2e/fix-w2e.spec.ts` | **新建**，14 个用例、**零 skip**（含零条件 skip） |

**没有改**：`SidebarTree.tsx`、`useFolderDialogs.tsx`、`useLibraryActions.ts`（我拥有但本轮无事可做）；
`home/FileList.tsx` 与 `home/EditorHome.tsx`（**props 一个字没动** —— 两者早就把 `dropFolderId`
传进来了，缺的一直是 `ComfortableList` 不读它，所以不需要动调用方）。

`nav.css` 里原有的裸色值（`#8b9eab` / `#e0e8ee` / `#374b5b` / `#f0f1f3` / `#e2e6e9` / `#ad5347` …）
一个没换，新加的两条规则也沿用同一组值 —— 归 **W3-I**。

---

## 2. 关掉了哪几条（逐条列 finding ID）

### 直接关掉（本 track 实测）

| Finding | 内容 | 判据（`e2e/fix-w2e.spec.ts`） |
|---|---|---|
| **S3-003** | 舒适密度列宽塌掉：Name 吃 81.6%、Folder/Last opened 换行、行高 201px、表比容器宽 21px | 四列比例 ≈ 46/25/21/8、四列 `textOverflow: ellipsis`、全部行高 = 40px、`scrollWidth ≤ wrapperClientWidth` |
| **S6-009** | 首页表无法缩到 1015px 以下，1024 下溢出 277px | 1024 下 `overflowPx ≤ 1`、`.shell-home` 不再横向滚动 |
| **S8-014** | 展开的文件夹只有 14%–19% 面积接受投放 | 采样命中率 **100%**（3915 个点）；`.shell-tree-files` 上 `dragover` → `defaultPrevented: true` |
| **S8-015** | comfortable 接受投放却零视觉反馈 | `tbody.is-drop-target` 计数 = 1，背景与描边都变了 |
| **S8-016** | EditorHome 时间分组无任何合法目标，行却仍 `draggable` | 时间分组下 `tr[draggable='true']` = 0；切到 folder 分组后 droppable 与 draggable 同时 > 0 |
| **S8-017** | 拖拽源无「正在拖」状态 | 拖起后 `tr.is-dragging` = 1（S8 自己的探针也从 `draggingMarkers: 0` 变成 `1`） |
| **S1-001** | 行内 "+" 挂在行外、下沿越界 6px，那 6px 的点击被下一行抢走 | `+` rect ⊂ 行 rect（上下各内缩 6px）；下沿处 `elementFromPoint` = `.shell-tree-folder-add` 自己 |
| **S5-007** | "+" 横向压住文件夹名 6px | `labelRight - addLeft = -16`（原 +6） |
| **S1-011** | 长文件夹名与 "+" 互压；focus-within 时计数徽标被按钮盖住 | 同上：右侧预留 30px 后，徽标与按钮不再相交 |
| **S1-005** | 树里 6 个控件 `outline-style: none` | 6 个控件全部 `outlineStyle: "solid"`、`focusVisible: true` |
| **S3-012** | `.shell-list-pin` 键盘聚焦时既无图标又无焦点环 | `outlineStyle: "solid"` 且聚焦时 `color` 从 `rgba(0,0,0,0)` 变为可见 |
| **S3-013** | 同一个「没有文件」两套文案 | 两处都取自同一个常量 `NO_FILES_YET`，实测侧栏全部 = `"No files yet"` |
| **S3-014** | 三种空态的正文只有两分支 | 三分支 + 第四种（pinned ∧ type 同时生效）单测覆盖 |
| **S1-010** | Show N more 展开后按钮被顶出视口、焦点跟着消失 | 展开到 49 行后 `inView: true`（`bottom 665` = 容器 `bottom 665`） |
| **S1-012** | 可访问名 "Archive 202645" | 五个文件夹全部 `aria-label` 形如 `"Archive 2026, 45 files"` |
| **S8-018** | 拖拽时侧栏不自动滚动，折线以下 3 个文件夹够不到 | `useFolderDrop` 在 `dragover` 上按边缘距离滚动最近的滚动祖先 |

### 顺手连带（不是任务书点名的，但同一处代码必然覆盖）

| Finding | 说明 |
|---|---|
| **S1-005 的 `.shell-tab-close`** | **没做**。它在 `chrome.css`，是 **W2-F** 的文件。我只补了 `nav.css` 那 6 个 + `.shell-list-pin` + `.shell-list-file` |
| **S3-012 的「同模式侧栏实例」** | S3 把 `.shell-tree-file-more` / `.shell-tree-folder-add` 判给 S1；两边现在同一条规则一起修好 |

---

## 3. 修法

### 3.1 R5 —— `table-layout: fixed` + 四列都声明宽度

只加 `table-layout: fixed` 是不够的：原来四列里只有 `td:first-child` 有 `width: 46%`，
fixed 布局下其余三列会平分剩余空间，而「平分」不是任何人声明过的值。所以把宽度移到
`thead th:nth-child(n)` 上（fixed 布局只看第一行），四列写成 **46% / 25% / 21% / 8%**。

截断从「只有 Name 列的内层 `<span>` 有」扩到 `.shell-list td` 与 `.shell-list thead th`
与 `.shell-list-group th` 三处，三件套齐全（`overflow: hidden` + `white-space: nowrap` +
`text-overflow: ellipsis`）。表头 "Last opened" 原来自己就断两行，所以表头也要。

**为什么原来会塌到 81.6%**：auto 布局下单元格的最小宽度由内容的 min-content 决定，而
`text-overflow: ellipsis` 不参与 min-content 计算 —— 一个 771px 的不可断英文 token 把 Name
列的 min-content 顶到 829px，`width: 46%` 再把这个值按比例放大到整张表，于是表宽 1015px
而容器只有 738px（1024 视口）。这也是为什么「给 span 加 ellipsis」在原方案里治不好：
省略号是绘制阶段的事，撑宽是布局阶段的事。

### 3.2 R6 —— `data-drop-folder` 从行提到 section

`useFolderDrop.ts:22` 用 `closest()` 向上找，而 `.shell-tree-files`（展开出来的文件区）是
`.shell-tree-folder-row` 的**兄弟**。把属性挂到包住两者的 `<section className="shell-tree-folder">`
上，`closest()` 就能从文件区里找到它。高亮同步搬到 section（`.shell-tree-folder.is-drop-target`），
因为**命中区和高亮必须是同一个形状** —— 否则只是把「接受 14%、亮 14%」换成「接受 100%、亮 14%」。

comfortable 那半边：`ComfortableList` 从头到尾没读过 `props.dropFolderId`（compact 在 `:95`
读了）。加一个 `tbody.is-drop-target`，用**和 compact 完全相同的两个值**，这样同一个手势在
两种密度下长得一样。

**`draggable` 改成条件式**：`draggable={group.folderId !== null}`。时间分组下每个 group 的
`folderId` 都是 `null`（设计如此，`fileTreeModel.ts:10-13` 的注释写得很清楚），所以整页没有
一个合法目标 —— 但每行都还在宣称自己可拖。不提供这个手势，是「时间桶不是位置」这条设计
决定的诚实版本；切到 folder 分组后两者同时恢复。

> 注意 React 把 `draggable={false}` 渲染成 `draggable="false"` 而不是省略属性（它是
> enumerated attribute，这是正确的 HTML）。所以 `querySelectorAll("[draggable]")` 仍会命中，
> 判据必须写 `[draggable='true']`。S8 探针用的是前者，它的 `dragstart` 因此仍报 `ok: true`
> —— 那是合成事件绕过了浏览器的门禁，真实鼠标拖不动。

**自动滚动**（S8-018）：`useFolderDrop` 在 `dragOver` 里先向上找最近的**真正在滚动**的祖先
（`overflowY: auto|scroll` 且 `scrollHeight > clientHeight`），指针进入上下 36px 就每次事件滚
14px。挂在 `dragover` 上是够的，因为指针停在边缘时该事件会持续重复触发。

### 3.3 R16 —— 把包含块还给行

`.shell-tree-folder-add` / `.shell-tree-file-more` 是 `position: absolute` 且**没写 `top`**，
所以它们解析到最近的定位祖先 —— `Menu.tsx:384` 的 `.shell-menu-anchor`（`position: relative`）。
那个 wrapper 唯一的子元素就是这个被绝对定位抽出正常流的按钮，于是 wrapper 自己变成 **0×0 flex
item**，被 `align-items: center` 停在行的垂直中线上，按钮跟着挂在行外。

修法是两条：

```css
.shell-tree-folder-row > .shell-menu-anchor,
.shell-tree-file-row > .shell-menu-anchor { position: static; }

.shell-tree-folder-add, .shell-tree-file-more { top: 50%; transform: translateY(-50%); }
```

**为什么选 `position: static` 而不是给 wrapper 一个真盒子**（这一条直接回应 W1-A 的提醒）：
`.shell-menu-anchor` 的 `position: relative` 在 portal 之后已经是空转的 —— 面板是
`position: fixed` 且挂在 `#shell` 上，不再用这个 wrapper 做定位基准，只用它的 **rect 做锚点
测量**。而一个 0×0 的 static flex item 与一个 0×0 的 relative flex item **占据完全相同的位置**，
所以 wrapper 的 rect 一个像素都没变，菜单落点不变。

实测佐证（`fix-w1a.spec.ts` 的 S2-007 用例）：修复前后 `scroll-follow-before` 都是
`left: 177, top: 246`，与 W1-A 报告里记录的数值**逐值相同**。`fix-w1a.spec.ts` 11 条全过。

横向那一半（S5-007 / S1-011）：`.shell-tree-folder-toggle` 的 `padding` 从 `8px` 改成
`8px 30px 8px 8px`，对照文件行早就有的 `8px 26px 8px 7px`。30 而不是 26，是因为 "+" 是
24px 宽 + 4px 内缩 = 28px，留 2px 余量。

### 3.4 R8 的一半 —— `nav.css` 的焦点环

七个选择器一条规则：`.shell-tree-folder-toggle` / `.shell-tree-file-open` / `.shell-tree-more` /
`.shell-tree-folder-add` / `.shell-tree-file-more` / `.shell-list-file` / `.shell-list-pin`。

两个实现细节：

- `outline-offset: -2px`（内缩）。这三类控件里有三个活在 `overflow: hidden` 的盒子里
  （`.shell-sidebar-body`，以及现在为了截断而开始裁切的 `<td>`），外扩的 outline 会正好在
  最该看见的地方被切掉。
- `.shell-list-pin` 另外补 `color: var(--shell-ink-faint)` —— 它静止态是 `color: transparent`，
  只画一个环等于框住一块空白。

判据全部取 `outline-style`：`outline-style: none` 时 `outline-width` 仍报 3px，用宽度判会
在一棵什么都不画的树上通过。

### 3.5 顺手的那几条

- **S3-013**：两处硬编码收进 `const NO_FILES_YET = "No files yet"`。选无句号那版，因为
  首页那处是 `<strong>` 标题，标题不带句号；侧栏那处是一句标签，同样不需要。
- **S3-014**：正文从两分支变四分支，把 `pinned ∧ typeFiltered` 同时生效这个原来无法表达的
  组合单独说清（"Nothing pinned matches the file type filter. Clear the filter, or pin a
  file of this type."）。标题仍是三分支 —— 标题说「什么没有」，正文说「哪个筛选在拦」。
- **S1-010**：`onToggleOverflow` 之后 `requestAnimationFrame(() => button.scrollIntoView({ block: "nearest" }))`。
  按钮不会被重新挂载（只换文案），所以拿到的引用在提交后仍然有效，焦点也不会丢。
- **S1-012**：文件夹 toggle 加 `aria-label={`${label}, ${count} files`}`；首页分组标题给
  `<small>` 挂 `aria-hidden` 并补一段 `.shell-visually-hidden` 的 ", N files"。

---

## 4. 修复前 / 修复后数值对照

### 4.1 表格列宽与行高（S3-003 / S6-009）

| 视口 | 容器宽 | 修复前表宽 | 修复后表宽 | 修复前四列 | 修复后四列 |
|---|---|---|---|---|---|
| 1280（C2） | 994 | **1015**（溢出 21） | **994**（溢出 0） | 829 / 83 / 58 / 46 | **457 / 249 / 209 / 80** |
| 1024（C2） | 738 | **1015**（溢出 277） | **738**（溢出 0） | 829 / 83 / 58 / 46 | **339 / 185 / 155 / 59** |
| 1280（C4） | 994 | 1015 | **994** | 829 / 142 / 63 / 46 | **457 / 249 / 209 / 80** |

比例：457/994 = **45.98%**（声明 46%）、249/994 = 25.05%、209/994 = 21.03%、80/994 = 8.05%。
`tableLayout` 从 `"auto"` 变成 `"fixed"`。

| | 修复前 | 修复后 |
|---|---|---|
| 行高集合（C2 全部数据行） | `[41, 61, 201]` | **`[40]`** —— 唯一值，与样式表声明一致 |
| 每列 `textOverflow` | `clip` / `clip` / `clip` / `clip`（只有 Name 的内层 span 是 ellipsis） | **`ellipsis` ×4** |
| 表头 `Last opened` 行盒数 | 2 | **1** |
| `.shell-home` 横向滚动（1024） | `scrollWidth 1063` vs `clientWidth 834` | **相等** |

### 4.2 拖放（S8-014 / S8-015 / S8-016 / S8-017）

| 探针 | 修复前（S8 findings） | 修复后 |
|---|---|---|
| `dragover` → `.shell-tree-files` | `defaultPrevented: **false**`，`.is-drop-target` = 0 | **`defaultPrevented: true`** |
| 展开文件夹的可放置面积 | MO 19.3% / Archive **14.0%** / yirentk 46.8% | **两个可见的展开文件夹各采样 1647 / 2268 个点，命中率均为 100%** |
| comfortable tbody 高亮 | `className: ""`、`background: rgba(0,0,0,0)`、`outline: none` | **`className: "is-drop-target"`、`background: rgb(224,232,238)`、`outline: solid 1px`** |
| 拖拽源标记 | `.is-dragging, [data-dragging]` = **0** | **1** |
| EditorHome 时间分组 | `droppableTbodies: 0 / 3`，`draggableRows` 全部可拖 | `droppable: 0`，**`draggable: 0`**；切 folder 分组后 `droppable: 5`、`draggable > 0` |

### 4.3 行内 "+"（S1-001 / S5-007 / S1-011）

| | 修复前 | 修复后 |
|---|---|---|
| 行 rect | `{top: 222, bottom: 258}` | 同（`{top: 222, bottom: 258, right: 177}`） |
| "+" rect | `{top: 240, bottom: 264}` | **`{top: 228, bottom: 252, left: 149, right: 173}`** |
| 上溢 / 下溢 | 0 / **+6px** | **-6 / -6**（两边各内缩 6px，完全在行内） |
| 按钮下沿的 `elementFromPoint` | `button.shell-tree-file-open`（**下一行抢走点击**） | **`shell-tree-folder-add`（它自己）** |
| 标签右沿 vs 按钮左沿 | `155` vs `149` → **重叠 6px** | `133` vs `149` → **留空 16px** |
| 按钮父元素 `position` | `relative`（0×0 的 `.shell-menu-anchor`） | **`static`** → 包含块回到行 |

### 4.4 焦点环（S1-005 / S3-012）

| 选择器 | 修复前 `outline-style` | 修复后 |
|---|---|---|
| `.shell-tree-folder-toggle` | `none` | **`solid` 2px `rgb(120,149,174)`** |
| `.shell-tree-file-open` | `none` | **`solid` 2px** |
| `.shell-tree-more` | `none` | **`solid` 2px** |
| `.shell-tree-folder-add` | `none` | **`solid` 2px**（`focusVisible: true`） |
| `.shell-tree-file-more` | `none` | **`solid` 2px**（`focusVisible: true`） |
| `.shell-list-file` | `none` | **`solid` 2px** |
| `.shell-list-pin` | `none`，且 `color: rgba(0,0,0,0)` | **`solid` 2px，聚焦时 `color` 变为可见** |

后两个 hover-only 按钮是**按键盘用户真实路径**到达的（焦点落在行首控件 → 行 `:focus-within`
→ 按钮脱离 `display: none` → Tab 落到它身上），而不是直接 `focus()` 一个用户进不去的状态。

### 4.5 可访问名与文案

| | 修复前 | 修复后 |
|---|---|---|
| 文件夹可访问名 | `"Archive 202645"`（`ariaLabel: null`） | **`"Archive 2026, 45 files"`** |
| 首页分组标题 | `"Archive 202645"` | **`"Archive 202645, 45 files"`**（可见文本不变，加了一段 visually-hidden） |
| 空文件夹文案 | 侧栏 `"No files yet."` / 首页 `"No files yet"` | **两处同一个常量 `"No files yet"`** |
| Show N more 展开后 | `lessInView: false`，`scrollTop: 0` | **`inView: true`**（`bottom 665` = 容器 `bottom 665`），49 行 |

---

## 5. 没关掉的，以及原因

| Finding | 为什么没关 |
|---|---|
| **S1-005 的 `.shell-tab-close`** | 在 `chrome.css` 的共用 `:focus-visible` 清单里，那份清单是 **W2-F** 的账（W1-A 的报告里也是这么分的）。我只动 `nav.css` |
| **S8-019** 折叠轨下 5 个 35px 无名图标作为投放目标不可辨识 | 根因在 `chrome/Sidebar.tsx`（折叠态仍渲染 `SidebarTree`，靠 CSS 收窄把文字裁掉）——**F track 的文件**。要真正解决得给折叠轨一个 tooltip 或换一种折叠表示，这和 S2-014（全壳没有 tooltip 组件，167 个原生 `title`）是同一件事，**建议单独立项**，不该由一个 nav 布局修复顺手决定 |
| **S8 探针里 `droppableShare` 仍报 14%–19%** | 那是 `ui-audit-s8.spec.ts:629` 自己算的 `rowHeight / sectionHeight` —— 它度量的是**标题行占 section 的比例**，这个几何本来就没变，也不该变。真正的可放置比例由 `fix-w2e.spec.ts` 的逐点采样给出（100%）。同理它的 `.shell-tree-folder-row[data-drop-folder="folder-bulk"]` 选择器现在报 `no target`：属性按设计搬到了 section 上。**两处都是探针读数的口径问题，不是回归**；S8 是打印型探针（无断言），15 条仍全过 |
| **拖拽预览图（drag image）** | 全仓无 `setDragImage` 调用点，S8 也没看过。我全程用合成 `DataTransfer`，同样看不到，**不下结论** |
| **真实鼠标拖拽下的 auto-scroll 手感** | 自动滚动的步长（36px 触发区 / 每事件 14px）是按 `dragover` 的重复频率拍的，合成事件测不出手感。**逻辑有断言覆盖不到的部分：本 track 只验证了代码路径与不回归，没有做真实拖拽的体感验证** |
| **3210 dev-real 下的表现** | 与 W1-A 同样的理由：dev-real 归 S4，且它那 30 个用例全是条件 skip（SUMMARY 第 3 节的工程债）。真编辑器挂载后表格容器宽度会不会另有来源，本 track 没有答案 |
| `nav.css` 的 10 处裸色值 | 归 **W3-I**（93 处裸色值统一换令牌）。新加的两条规则也刻意沿用同一组旧值，免得 W3-I 要在两个地方对账 |
| **S6-010 / S8-009** 零数据首屏说不清下一步 | 产品决策，不在本 track 文件集 |

---

## 6. 四项验证的真实输出

### 6.1 `npx tsc --noEmit`

```
$ npx tsc --noEmit
TSC_EXIT=0
```

无输出，退出码 0。

> 中途一次 tsc 报过两条错（`TaskPanel.tsx(132) OutlineList`、`FileTabs.tsx(306) notBuiltYet`），
> 都在 `agent/` 与 `chrome/` —— **B/F track 当时写到一半的未完成文件**，与 `nav/` 无关。
> 等他们写完后自动归零。

### 6.2 `npx vitest run`

```
 Test Files  183 passed (183)
      Tests  1309 passed (1309)
```

**0 failed / 0 skipped。** 基线 1294 → **1309**，只增不减，其中我新加 4 条
（`FileTree.test.tsx` 从 8 条到 12 条），其余是并发 track 本轮新增的。**没有测试被删。**
改动过的两条既有断言是跟着实现改的，不是删的：

- `compactStructure` 的 `data-drop-folder` 从 `.shell-tree-folder-row` 改读 section
- `getAllByText("No files yet.")` → `getAllByText("No files yet")`

**并发干扰与隔离验证（必须记录）**：中途跑 vitest 出现过 `56 failed`，散落在
`chrome.test.tsx` / `canvasSeam.test.tsx` / `AgentPresence.test.tsx` / `Composer.test.tsx` /
`EditorCanvasHost.test.tsx` / `Hero.test.tsx` / `TaskList.test.tsx` / `notImplemented.test.tsx`
八个文件。为了不把别人的半成品算到自己头上、也不把自己的回归藏在别人的红里，做了 A/B 隔离
（把我的 4 个文件备份到 `/tmp/w2e-mine`，`git checkout --` 还原到 HEAD 跑一次，再拷回来跑一次）：

| | 失败条数 | 失败集合 |
|---|---|---|
| BASE（W2-E 还原到 HEAD） | 56 | 见上述八个文件 |
| MINE（W2-E 应用） | 2 | `notImplemented.test.tsx` 的两条（FileTabs 的 share 按钮） |

`diff` 结果：**MINE 的失败集合是 BASE 的真子集**（`diff` 只输出删除行，无新增行），
即 **W2-E 引入的新失败 = 0**。剩下那 2 条堆栈落在 `chrome/FileTabs.tsx`，是 F track 当时
写到一半的 `notBuiltYet`。等他们写完，工作区自己走到 183/1309 全绿（最终快照即如此）。

### 6.3 新 spec `e2e/fix-w2e.spec.ts`

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w2e.spec.ts
  ✓  1 › R5 gives every column the width it declares, and every column truncates (785ms)
  ✓  2 › R5 keeps the row with the long Chinese folder name at its declared 40px (437ms)
  ✓  3 › R5 does not overflow its container at 1024, where it used to be 277px wide of it (692ms)
  ✓  4 › R6 an open folder accepts a drop on all of itself, not on 14% of itself (477ms)
  ✓  5 › R6 the comfortable list shows where the file is going (469ms)
  ✓  6 › R6 time buckets do not offer a drag they cannot accept (460ms)
  ✓  7 › R16 the folder row's + button is inside its own row, top and bottom (478ms)
  ✓  8 › R16 the file row's ⋯ button is inside its own row too (484ms)
  ✓  9 › R8 all five tree controls draw a focus ring (467ms)
  ✓ 10 › R8 the Home list's pin button draws a ring and shows its icon (436ms)
  ✓ 11 › R8 the file list's own name button draws a ring (430ms)
  ✓ 12 › both densities call an empty folder the same thing (418ms)
  ✓ 13 › a folder's accessible name separates its name from its count (434ms)
  ✓ 14 › Show N more keeps the button it was pressed on in view (496ms)
  14 passed (7.4s)
```

**14 passed / 0 skipped。** 文件里没有任何 `test.skip` 语句、没有任何条件跳过
（唯一出现 "test.skip" 字样的地方是文件头注释，写明为什么这里不允许有它）。
任务书点名的六项判据逐条覆盖：

| 任务书要求 | 用例 |
|---|---|
| 四列宽度比例 ≈ 声明值，每列都有 ellipsis；长中文名那行 ≈ 40px | 1、2 |
| 1024 宽下表格不溢出容器 | 3 |
| 展开文件夹的文件区也能接受投放（命中面积 > 90%） | 4（实测 100%，两个文件夹 3915 个采样点） |
| comfortable 拖拽悬停有可见反馈 | 5（背景与 outline 都实测变化，不只是类名） |
| "+" rect 完全落在行 rect 内，下沿 `elementFromPoint` 返回它自己 | 7（另有 8 覆盖文件行的 "⋯"） |
| 6 个控件 + `.shell-list-pin` 键盘聚焦时 `outline-style !== "none"` | 9、10、11 |

一个实测逼出来的修正记在这里：第一版我用 `page.selectOption('select[aria-label="Group by"]')`
切分组 —— 超时。EditorHome 的 Group by 是 `renderer/ui` 的 `Select`，渲染出来是
一个 `<button>` 加一个 `role="menuitemradio"` 的 popover，**不是原生 `<select>`**
（这正是 S3-004 报的那条）。改成点按钮再点菜单项。
第二个：`.shell-list-pin` 的第一个实例是已 pin 的，静止态本来就有颜色，用它测不出
「聚焦是否让图标显形」，换成 `.shell-list-pin:not(.is-pinned)`。

### 6.4 重跑 `e2e/fix-w1a.spec.ts`

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/fix-w1a.spec.ts
  11 passed (12.3s)
```

**W1-A 的提醒已核销**：菜单以 `.shell-menu-anchor` 的 rect 为锚点，而我对该 wrapper 只改了
`position: relative → static`（仅在树的两种行里），0×0 的盒子位置不变。实测
`scroll-follow-before` = `{left: 177, top: 246}`、`scroll-follow-after` = `{left: 177, top: 226}`，
与 W1-A 报告第 4.3 节记录的 `left` 不变 / 位移 = 滚动距离 20px **逐值相同**。
`clippedBy` 全为 `null`。

### 6.5 重跑 `e2e/ui-audit-s8.spec.ts`

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3131 npx playwright test e2e/ui-audit-s8.spec.ts
  15 passed (11.7s)
```

该 spec 是打印型探针（只 `console.log` 不断言），所以「15 passed」本身不证明什么 —— 有价值
的是它打印的 `S8-4` JSON，已在第 4.2 节逐条与修复前对照。三处口径变化已在第 5 节说明。

> 它会把 21 张截图写回 `docs/ui-audit-2026-09-19/S8/screenshots/`，覆盖掉审计的「修复前」
> 证据。跑完我用 `git checkout -- docs/ui-audit-2026-09-19/S8/screenshots` 还原了，
> **findings.md 引用的那 43 张截图未被破坏**。后面谁再跑这个 spec 要注意同一件事。

---

## 7. 给 Wave 3 / Wave 4 的三条交接

1. **W3-I**：`nav.css` 现在有 12 处裸色值（原 10 处 + 我新加的 `.shell-tree-folder.is-drop-target`
   与 `.shell-list tbody.is-drop-target` 各复用了 `#8b9eab` / `#e0e8ee`）。两条新规则与原
   `.shell-tree-folder-row.is-drop-target` 是同一对值，换令牌时一起换即可。
2. **W3-J**：本 track 新增 3 条用户可见英文文案（两条空态正文分支 + 一条 `", N files"`
   的可访问名后缀模板），并删掉 1 条重复（`"No files yet."`）。净 +2，写入基线 227 的账时
   请按 229 记。
3. **Wave 4 闸门**：`fix-w2e.spec.ts` 的第 1、3 条可以直接当「表格列宽 / 无横向溢出」的闸门
   实现；第 4 条的逐点采样法（`elementFromPoint(x,y).closest("[data-drop-folder]")` 覆盖率）
   适合推广成「命中区与高亮必须同形」的通用判据 —— 它抓得到「接受但不高亮」和
   「高亮但不接受」两种，而单点 `dragover` 断言两种都抓不到。
