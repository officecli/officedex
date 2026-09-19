# W4 — 闸门

日期：2026-09-20 ｜ 分支：`develop/1.0` ｜ 验证 commit：`249e317`（Wave 1 + Wave 2 合入）
与 `a5a4fab`（本轮进行中并发落地的三笔之后）—— **两个 commit 上全部数值一致**

前 74 条修复的回归防线。**四条落地、一条按 SUMMARY 计划推迟、一条工程债清掉。**
所有验证都在干净 worktree（`git worktree add /tmp/w4-gates HEAD` + 拷入
`src/renderer/generated`）里跑，避免把并发 session 的未提交改动算成自己的结果。

## 0. 交付清单

| | 闸门 | 文件 | 跑法 | 耗时 |
|---|---|---|---|---|
| ① | 浮层无裁切 | `e2e/gates.spec.ts` | `npx playwright test e2e/gates.spec.ts` | **6.2s**（11 用例） |
| ② | 组件的样式随组件发货 | `scripts/verify-shell-styles.mjs` + `.test.mjs` | `node --test scripts/verify-shell-styles.test.mjs` | **6.8s**（其中 6.3s 是 `vite build`，检查本身 0.07s） |
| ③ | portal 必须落在 `#shell` 内 | `src/shell/test/portalHost.test.ts` | `npx vitest run` | **36ms** |
| ④ | 组合选择器登记表 | `src/shell/test/combinationSelectors.test.ts` | `npx vitest run` | **15ms** |
| ⑤ | 文案棘轮 | `src/shell/test/copyRatchet.test.ts` | `npx vitest run` | **11ms** |
| ⑥ | z-index / 裸色值 | —— | —— | **未落地，等 W3-I**（§6 有草案） |

另：`e2e/ui-audit-s4.spec.ts` 的 23 处 `test.skip(!BRIDGE)` 改成硬失败（§5）。

**三条进 `npx vitest run` 的闸门合计 62ms**，不会让任何人不愿意跑；
**② 要跑构建，刻意不进 vitest**，单独调用。

### 一处需要 merge 的人补的接线

我不拥有 `package.json`，所以闸门 ② 没有 npm script。合并时加这一行，它才会被人跑到：

```json
"verify:shell:styles": "node --test scripts/verify-shell-styles.test.mjs",
```

并把它挂到 CI（**不要**挂进 `test:scripts`，那条现在是秒级的，加一次 vite build 会毁掉它）。

## 1. 验证（断言式）

全部在干净 worktree（HEAD + 本轮新文件）。**做了两遍**：第一遍在 `249e317`，
写报告期间并发 session 又落了三笔（`4d1ffed`/`4a716ea`/`a5a4fab`），于是在
`a5a4fab` 上原样重跑了一遍 —— **每一个数字都一样**，说明这四条闸门对那三笔改动
不敏感（也说明它们没有意外地绑在某个瞬时状态上）。

```
$ npx tsc --noEmit ; echo "TSC_EXIT=$?"
TSC_EXIT=0                      # 直接读退出码，没有经过管道

$ npx vitest run
 Test Files  186 passed (186)
      Tests  1322 passed (1322)      # 基线 1311 + 新增 11（3 + 5 + 3）
   Duration  9.97s

$ PLAYWRIGHT_BASE_URL=http://localhost:3153 npx playwright test e2e/gates.spec.ts
  11 passed (8.3s)

$ node --test scripts/verify-shell-styles.test.mjs
  ℹ pass 6 / fail 0 / skipped 0        7.3s

$ 文案棘轮量具（同一套规则的独立复算）
  occurrences 284 | unique 249 | files scanned 58 | files with copy 26
```

新增的三个 vitest 文件在**脏工作树**（并发 session 正在写 `canvas/**`、`composer/**`、
`home/**`、`src/shell/**/*.css`、以及一条 in-flight 的 i18n 改动）里也是绿的：

```
$ npx vitest run src/shell/test/{portalHost,combinationSelectors,copyRatchet}.test.ts
      Tests  11 passed (11)
```

闸门 ① 在脏工作树里 **10 绿 1 红**，红的正是它该红的那条，见 §7。

dev server 全程用 3153，自起自停；跑完端口已释放，两个临时 worktree 已 `git worktree remove`。
**没有 commit。**

## 2. 闸门 ① 浮层无裁切 — `e2e/gates.spec.ts`

### 守什么

R1（14 条）。`Menu` 曾经用 `left:0`/`right:0`/`top:calc(100%+6px)` 在自己所在的 overflow
容器里定位、从不测量，八个调用点全被裁（设置菜单只剩 15.8% 可见，FileTabs 菜单出窗口
146px）。W1-A 修了引擎，这条防它回来。

### 怎么实现

八个 `<Menu>` 调用点 × 十个壳组合 = 80 格，每格要么**开出来量**，要么在
`REACHABILITY` 里**被声明为不可达**。判定直接复用 `e2e/ui-audit-helpers.ts` 的
`expectNoClip`（`clippedBy === null && offViewport === false`）。实测 59 格可开。

`REACHABILITY` 是实测出来的，不是猜的：

| | mode | settings | tabs-more | folder-row | file-row | scope/permission/model |
|---|---|---|---|---|---|---|
| C1 | ✓|✓|·|✓|·|✓ |
| C2 | ✓|✓|·|✓|✓|✓ |
| C3 | ✓|✓|·|·|·|· |
| C4 | ✓|✓|·|·|·|· |
| C5 | ✓|✓|✓|✓|·|✓ |
| C6 | ✓|✓|✓|✓|✓|✓ |
| C7 | ✓|✓|✓|✓|·|✓ |
| C8 | ✓|✓|✓|✓|✓|✓ |
| C9 | ✓|✓|✓|·|·|✓ |
| C10 | ✓|✓|✓|·|·|✓ |

**「不可达」也是断言。** 一个触发器如果哪天在某个组合里冒出来，这条会红 —— 否则它会
变成「这里没东西要量」，闸门只会更绿不会更红，而那正是 `ui-audit-s4.spec.ts` 的病。

**与 `e2e/fix-w1a.spec.ts` 的区别**：那份证明修复在**审计量过的那些组合**上成立
（ModeMenu 只跑 4/10，设置菜单 4/10，文件行菜单 1/10），S2 自己写明其余是
「推断不是实测」。这份跑满叉乘。两份都留着：W1-A 那份还断言了滚动跟随、焦点归还、
`max-height` 不再是 340 这些行为，本闸门只管几何。

**漂移守卫**：`every <Menu> in src/shell is registered in CALL_SITES` 直接数源码里的
`<Menu` 个数，和 `CALL_SITES` 对齐。否则新加的第九个菜单谁都不覆盖而全绿 ——
这条**已经抓到一个**，见 §7。

### 盲区

1. **只跑 1280×720、只跑亮色。** 1280 下不裁不等于 900 下不裁；视口扫描归 S6。这条
   闸门证明的是「在 1280×720 不被裁」，不是「不被裁」。
2. **`expectNoClip` 比的是盒子，看不见「被盖住」。** S2-010（`.shell-presence` z 200
   压 `.shell-menu` z 60）能通过本闸门。遮挡是层叠问题，要换量具
   （对面板中心做 `elementFromPoint`）；没写是因为 W3-I 还在重建 z-index 表，
   按今天的数字写的闸门会在它落地那天过期。
3. **量的是面板，不是里面的项。** 面板在屏内但自己内部滚动，这里是绿的。
4. **只管 `Menu`。** legacy 的 `Modal`/`dialog`/`Popover`/toast 归 W1-C，由闸门 ③
   从结构上守，不从几何上守。
5. composer 三个 chip 用键盘打开而不是点击 —— 因为 340px 面板里 chip 互相重叠
   （MERGE-001），鼠标点击会被邻居拦截。那是别的 track 的缺陷；用键盘量得到菜单，
   又不会把别人的 bug 变成这里的一个 skip。

### 红 → 绿证明

把 R1 原样装回去（`Menu.tsx` 的 `computePlacement(...)` 换成 anchor 相对、零碰撞检测）：

```
✘ C1 … ✘ C10   （10/10 红）
✓ every <Menu> in src/shell is registered in CALL_SITES
Error: .shell-menu is clipped: {"rect":{...,"top":712,...,"bottom":873},
        "viewport":{"width":1280,"height":720},"offViewport":true,"clippedBy":"shell"}
```

`git checkout -- src/shell/chrome/Menu.tsx` 后：

```
11 passed (6.2s)
```

## 3. 闸门 ② 组件的样式随组件发货 — `scripts/verify-shell-styles.mjs`

### 守什么

R4 / S0-001，**这轮最重要的一条**，因为它是一类**源码扫描原理上看不见**的缺陷。
`ForceUpdateOverlay` 的样式表在仓库里、被 import、被提交、全套测试通过 ——
而打包后的 shell 里那一页渲染成黑底 Times 没有布局，因为那行 import 挂在
**legacy 入口**上，shell 入口产出的 CSS bundle 里一条 `force-update-*` 都没有。
所有 grep 都说样式在。构建说不在，而用户跑的是构建。

### 怎么实现

**这条不许读 `src/` 找答案。** 它读 `dist/index.html`，取这份文档真正 `<link>` 的
样式表，问 shell 自己的 module graph 往 DOM 里写的那些类名在不在里面。

- 可达闭包从 `src/shell/main.tsx` 起，静态 import 和 `import()` 都跟（画布/viewer 都是
  懒加载的，「它是懒的」从来不是一个组件最终出现时可以没有样式的理由）。实测 139 个模块。
- 类名并集来自 `dist/index.html` 的 `<link rel=stylesheet>`：实测
  `useAppUpdate-*.css` + `main-*.css`，4194 个类。
  **`legacy-*.css` 只被 `legacy.html` 链** —— 这正是 S0-001 赖以成立的那条分界，
  也正是这条闸门的判别力所在。
- 例外表 `UNSTYLED_BY_DESIGN` 目前 **8 条**，全部是结构/测试钩子，每条写了理由；
  并且**双向断言**：某条哪天有了规则，必须删掉它，否则红。

### 为什么不是 vitest

它要 `vite build`（约 6.3s）。给每次 `npx vitest run` 加六秒的闸门，是会被人开始跳过的
闸门。单独调用：

```
node scripts/verify-shell-styles.mjs              # 构建后检查
node scripts/verify-shell-styles.mjs --no-build   # 检查现成的 dist/
node --test scripts/verify-shell-styles.test.mjs  # 纯函数 fixture + 真构建，6 个用例
```

### 盲区

1. **只看字面量类名。** `className={styles[kind]}` 或任何运行时拼装的名字看不见；
   模板字面量只贡献完整的词 —— `` `shell-home--${mode}` `` 一个字都不贡献，
   因为 `shell-home--` 不是类名（第一版把它算成类名，凭空报了四个「缺失」）。
2. **「在链接的 CSS 里有规则」不等于「样式正确」。** 只写在一条永不匹配的 media query
   里的类也算通过。
3. **只查 shell 入口。** `legacy.html` 没人管；旧渲染器要是也长出这个 bug，这里不会说。
4. **假设 shell 需要的每个 CSS chunk 都能从 `dist/index.html` 的 `<link>` 够到。**
   当前构建成立（Vite 把共享 CSS 提到入口的 link 里，三个 css 文件没有一个是孤儿）。
   如果将来出现一个运行时注入的 CSS chunk，这条会报假缺失 —— 那时的修法是走 chunk 图，
   **不是**往 `UNSTYLED_BY_DESIGN` 里加人。
5. 真正的修法在扫描器上游：组件自己 import 自己的样式表就不可能和它分叉。这条闸门
   只是抓那些没这么做的。

### 红 → 绿证明

把 W1-D 的那行 import 拿掉（即原样复现 S0-001）：

```
$ sed -i '' 's|^import "../styles/onboarding-update.css";|// RED PROOF|' \
      src/renderer/components/ForceUpdateOverlay.tsx
$ node scripts/verify-shell-styles.mjs
21 class(es) the shell writes have no rule in the shell bundle:
  src/renderer/components/ForceUpdateOverlay.tsx  .force-update-overlay
  …（force-update-card / -glyph / -title / -version / -version-current /
     -notes-block / -notes-heading / -notes / -reason / -progress /
     -progress-label / -status / -action / -error / -error-label /
     -error-detail / -fallback / -fallback-heading / -download / -secondary）
exit 1，总耗时 7.0s（含构建）
```

还原后：

```
shell stylesheets: ./assets/useAppUpdate-DHeb366x.css, ./assets/main-C5lKN2gO.css
modules reachable from the shell entry: 139
classes defined in the shell bundle: 4194
OK: every class the shell writes has a rule in the CSS the shell ships.
```

`node --test`：`ℹ pass 6 / fail 0 / skipped 0`，6.8s。

### 顺带查出来的（只报不修）

`UNSTYLED_BY_DESIGN` 里有一条不是「设计如此」，是**真发现**：

- **`.shell-home--editor` 全仓库没有任何规则，而 `.shell-home--agent` 有**
  （`home.css:84`）。和 S5 表 8 结论 2 是同一件事的另一个切面：editor 模式没有自己的
  样式。归 W3-I 或后续 editor track；我只登记，没动。
- `.shell-region`（六个顶层区域的地标标记）、`.shell-sidebar-tree`、`.shell-task-list`、
  `.shell-cx-model`、以及 legacy 表格画布的三个 `spreadsheet-*` 标记 —— 这些确实是
  无样式的结构钩子，属于 R15 那一族的边角，删不删都行。

## 4. 闸门 ③ portal 必须落在 `#shell` 内 — `src/shell/test/portalHost.test.ts`

### 守什么

R3（13 条）。四个浮层各写了一遍 `createPortal(…, document.body)`，于是它们落在
`#shell` 之外 —— 而 `--od-*` 令牌桥只声明在 `#shell` 上（`tokens.css:105`）。
桥从落地那天起一次都没生效过，而且没人发现，因为**颜色不对不是异常**。

### 怎么实现

静态扫描 `src/**` 全部 `.ts(x)`，取每个 `createPortal(` 的容器参数，不得是 `document.body`。
外加一张 `KNOWN_BODY_PORTALS`，**双向断言**（条目哪天修好了必须删）。

解析器的两个坑，都写进注释了：
- **不能把 `<`/`>` 当括号。** 每个 `=>` 贡献一个孤立的 `>`，深度变负，
  最后在一个有六个 portal 的仓库里只找到两个。
- **不能取第一个顶层逗号**（JSX 文本里的逗号会被当成参数分隔），也**不能无条件取最后一个**
  （本仓库多行调用都带尾随逗号，取最后一个会得到空串 —— 例外表要守的那个组件因此看起来是干净的）。
  正解是**最后一个非空参数**。

### 盲区

1. **只看字面量。** `createPortal(node, host)` 里 `host` 是算出来的就看不见 ——
   而 `overlayHost()` 正是这种，它自己那个 `document.body` 兜底（给 shell 之外挂载的
   `Menu`、以及根本没有 `#shell` 的 legacy 渲染器用）是**刻意且正确的**。所以这条
   证明的是「没人在 portal 处写了 `document.body`」，不是「没有东西落到 body」。
   互补的那半在运行时断言：`e2e/fix-w1a.spec.ts` 的
   `the panel is portalled inside #shell` 和 `e2e/fix-w1c.spec.ts`。
2. 不认 `ReactDOM.createPortal(...)` 这种命名空间写法（本仓库没有）。
3. 真正的修法不是更聪明的扫描：是 `renderer/ui` 之外根本没人调 `createPortal`。

### 红 → 绿证明

```
$ sed -i '' 's/^    overlayHost(),$/    document.body,/' src/renderer/ui/components/Modal.tsx
× portalled overlays > mount inside the shell's token scope, not on document.body
  + "src/renderer/ui/components/Modal.tsx:42 -> document.body"
$ git checkout -- src/renderer/ui/components/Modal.tsx
Tests  3 passed (3)      36ms
```

### 顺带查出来的（只报不修）

- **`src/renderer/spreadsheet/UnsavedChangesDialog.tsx:28` 仍然 portal 到
  `document.body`。** 它从 shell 可达（表格画布关闭时会弹它），而且它自己画对话框、
  没走 `Modal`，所以 W1-C 的修复到不了它：在 shell 里它用的是组件库默认值，
  就是 R3 的症状出现在 R3 的修复没覆盖到的组件上。归 `renderer/spreadsheet` 的 owner。
  已登记在 `KNOWN_BODY_PORTALS`，数量不会再悄悄长。
- `Composer.tsx` 里 `{folderDialogs.element}` 上方的注释写着「Portals to the body」——
  **注释已过期**，它走的是 `Modal` → `overlayHost()`。

## 5. 闸门 ④ 组合选择器登记表 — `src/shell/test/combinationSelectors.test.ts`

### 守什么

S5 表 8 那一族。shell 往根节点写五个属性、CSS 对其中四个有反应，十格状态空间被
十几条选择器覆盖着，而**没人手上有这张图**：`chrome.css` 的两组合规则丢掉了
`max(…,132px)` 下限、editor 四格零专属样式、`data-presence` 只有一条规则、
`data-loaded` 零消费 —— 这些从读任何**单条**规则都看不出来。

### 怎么实现

闸门问的不是「这条规则对不对」（CSS 没法被这么问），是「**作者知不知道它打到谁**」：
任何 `#shell[data-*]` / `.shell[data-*]` 规则必须出现在 `REGISTRY` 里，并声明它命中
哪几个组合；命中集合每次运行都从 `SHELL_COMBINATIONS` **重新算**。

**期望值不抄第二份**：`SHELL_COMBINATIONS` 从 `../dev/fixture` import（就是 fixture
服务器和全部审计 spec 用的那张表），presence 轴走 `effectivePlacement`
（docking 是 agent 模式独占的，所以 C3/C4 的 `data-presence` 实际是 `floating`——
这是 DOM 里真正的值，不是 fixture 字段）。

四条断言 + 一条解析器守卫：
1. 新规则没登记 → 红
2. 登记的组合集合 ≠ 实际命中集合 → 红
3. 一个组合都不命中的选择器（死 CSS）→ 红
4. 登记表里有已经不存在的规则（陈旧登记）→ 红
5. 解析器找不到规则了（≥15 条、≥3 个文件）→ 红

当前 18 条选择器全部登记：15 条是折叠轨（`C1/C3/C5/C7/C9`）、
1 条 `#shell[data-home="true"] .shell-tabs-actions`（`C1–C4`）、
1 条 `#shell[data-mode="agent"][data-home="false"][data-presence="docked"] .shell-tabs`
（**只有 C5/C6**，就是丢了 132px 下限那条，注释里写明了它靠
`TASK_MIN_WIDTH=320` 这个 reducer 常量兜底）。

### 盲区

1. **读选择器文本，不读层叠。** 两条都登记了的规则仍然可以打架 —— `chrome.css` 里
   有一对都设 `.shell-brand` 的宽度，一个写死 `36px` 一个写 `var(--shell-row-h)`
   （S5 表 8 结论 4），两条命中同一批组合，本闸门很满意。抓它需要层叠模型；
   现实中拦住它的是**这两条现在是登记表里相邻的两行**。
2. **只看根节点上的 scope。** 用别的方式表达的组合差异（内层元素的 data 属性、
   TSX 里切的 class、container query）都在它之外。
3. 它分不清「命中了但没用」和「什么都没命中」，只红后者。
4. **登记表按选择器文本做 key，不按 `file:line`。** 这是刻意的：行号会因为上面任何
   一次编辑而移动，一个因为无关编辑而变红的闸门会被删掉。代价是一条规则原样搬到
   另一个文件，这里看不见。

### 红 → 绿证明（三种）

```
(a) 新加未登记的规则：  #shell[data-home="false"] .shell-probe { … }
    × every combination-scoped rule is registered
      + "src/shell/app.css:313  #shell[data-home=\"false\"] .shell-probe"

(b) 让期望值与真相分叉：把 fixture 里 C1 的 navCollapsed 翻成 false
    × each registration names the combinations the selector actually matches
      + declared C1/C3/C5/C7/C9
      + matches  C3/C5/C7/C9          （15 条一起红）

(c) 死选择器：        #shell[data-mode="reader"] .shell-probe { … }
    × every combination-scoped rule is registered
    × no registered selector matches nothing
      + "src/shell/app.css:313  #shell[data-mode=\"reader\"] .shell-probe"

还原后：Tests  5 passed (5)      15ms
```

## 6. 闸门 ⑤ 文案棘轮 — `src/shell/test/copyRatchet.test.ts`

### 守什么

R18。`src/shell` 里 `t(` 调用数为 0；每一条标签、空态、`aria-label`，以及
`QuickPrompts` 那三句会被塞进输入框发给模型的英文长句，都是编进组件的字面量。

W3-J 负责修。**这条不是修，是棘轮**：要求归零的闸门会红好几周然后被删掉，
什么都不要求的闸门会让每个新功能再加十条。

### 基线：我自己重新数的

**S5 的 227/295 不是这里的基线。** 它早于 Wave 1/2（那两波加了文案 —— 错误态、
手动下载兜底、标签溢出提示），而且它的数法从来没写成任何东西能重跑的形式。
所以重数一遍，数法完整写进了文件头注释（哪些目录、哪三条规则、排除什么），
数出来的是：

> **2026-09-20，干净 worktree 的 `249e317`：284 处出现 / 249 条唯一串 / 26 个文件（扫描 58 个文件）**

S5 踩过的坑（`grep 't("'` 的 `params.get(` / `setText(` / `closest(` /
`logShellEvent(` 假阳性）在这里不成立，因为这条根本不 grep `t(`，它数的是**文案本身**。
真正咬到我的是另外三个，都修掉并写进注释了：

- TS 泛型 `() => Promise<void>` 会被「JSX 文本」规则读成 `>` 和 `<` 之间的 ` Promise`
  （加 `(?<!=)`）;
- SVG path data（`M3 3h3.5L3 6.5Z`）符合「大写开头 + 有空格」的散文形状（单独排除）;
- `port/fake/**` 的 seed 数据（约 65 条假文件名和台词）既不是产品文案也不该交给译者
  （和 `test/`、`dev/` 一起排除）。

### 盲区

1. **它数字符串，不数翻译。** W3-J 落地那天这些串变成 `t("shell.…")`，数字骤降；
   在那之前闸门分不清一条「即将被翻译」和一条「永远不会」。它是棘轮，不是完成的定义。
2. **散文规则要求「大写开头 + 含空格」。** `"Pin"`、`"Home"`、`"More"` 只有出现在
   JSX 文本或登记的属性里才被看见。**这个数是下界。**
3. **错误信息和厂商名也被算进去了**（`"Model ID cannot contain spaces."`、
   `"DeepSeek 4.1"`）。有些永远不该翻译 —— 这让地板非零，对棘轮没问题，对「目标」就错了。
4. **完全不数中文和其它非 ASCII 文案。** shell 现在没有；将来有了它不会知道。
5. 真正的修法还是在上游：`t()` 是让字符串上屏的唯一途径 —— 那是个 i18n-aware 组件 API
   上的 lint 规则，不是正则。

### 下界怎么守 —— 一个被推翻的设计

第一版写的是 `expect(count).toBeGreaterThan(BASELINE - 40)`，用来防「扫描器悄悄不工作了」。
**这个设计活不过它自己的成功**：只看总数下降，一次翻译浪潮和一个坏掉的正则长得一模一样。
而且它当场就被证伪了 —— 脏工作树里已经有一版未提交的 i18n 改动，同样的量具在那里读到
**122 / 111 / 10**，下界会立刻误报。

改成**对 fixture 断言**：给一段内联的假源码，断言三条规则各自仍然命中、并且
注释/泛型/SVG path 仍然被排除。它问的是下界想问的那个问题（「三条规则还开火吗」），
而不对「shell 翻译了多少」持有意见。

### 红 → 绿证明（两个方向）

```
(a) 加一条新的未翻译文案：
    × has no more untranslated occurrences than the baseline
      → untranslated copy grew to 285 (baseline 284).
    × has no more untranslated unique strings than the baseline
      → expected 250 to be less than or equal to 249

(b) 把散文规则注释掉（模拟扫描器坏掉）：
    ✓ has no more untranslated occurrences than the baseline     ← 上界被骗过了
    × still recognises copy at all
      → expected [ 'Close window', 'Show less' ]
           to deeply equal [ 'Close window', 'Open from this computer',
                             'Rename folder', 'Show less' ]

还原后：Tests  3 passed (3)      11ms
```

(b) 这一格正是整条设计的理由：**只有上界的棘轮，会被一个瞎掉的扫描器完美满足。**

### 给 W3-J 的一句话

脏树里的那版 i18n 已经把同样的量具读到 **122 / 111**。那条改动提交时，
把 `BASELINE_OCCURRENCES` / `BASELINE_STRINGS` 一起调下来 —— 同一个 commit 里。

## 7. 闸门当场抓到的东西（只报不修）

| | 发现 | 抓到它的闸门 | 归属 |
|---|---|---|---|
| 1 | **composer 多了第九个 `<Menu>`（`What this message makes`，`Composer.tsx:794`）没有任何裁切覆盖** | ① 的漂移守卫 | 正在写 `composer/**` 的那个 session |
| 2 | `UnsavedChangesDialog.tsx:28` 仍 portal 到 `document.body`，在 shell 里拿不到 `--od-*` 桥 | ③ | `renderer/spreadsheet` |
| 3 | `.shell-home--editor` 零规则，而 `.shell-home--agent` 有 | ② | W3-I / editor track |
| 4 | `Composer.tsx` 里「Portals to the body」注释已过期 | ③（人工核对时） | composer owner |

发现 1 我顺手量了一下（临时 probe，跑完即删）：**这个新菜单在 C1/C2/C5–C10 八个组合下
都没有被裁**，所以那个 track 只需要把它登记进 `CALL_SITES` + `REACHABILITY`，不用改实现。

```
PROBE C1 ok {"left":482,"top":381,"right":762,"bottom":591}
PROBE C2 ok … C5 ok … C6 ok … C7/C8/C9/C10 ok {"left":951,…,"right":1231,"bottom":592}
```

还有一件顺带确认的好消息：闸门 ① 的十条几何用例在**脏工作树**（含 W3-I 的 CSS 改动
和 in-flight 的 i18n）里**全绿** —— 在飞的改动没有把裁切带回来。

## 8. 工程债：`e2e/ui-audit-s4.spec.ts` 的 30 个静默 skip

### 之前

23 处 `test.skip(!BRIDGE, "S4_BRIDGE must point at the dev-real bridge endpoint")`
覆盖 30 个用例。不带 `S4_BRIDGE` 跑：

```
30 skipped        exit 0
```

CI 摘要行里这和「30 个通过」无法区分。**这就是这份文件进不了任何闸门的原因**：
它对一个自己什么都没检查的配置报告成功。

### 之后

全部换成 `requireBridge()`，缺变量直接抛：

```
$ npx playwright test e2e/ui-audit-s4.spec.ts     # 不带 S4_BRIDGE
  1 failed
    imports three real documents and captures the base shell state
  29 did not run
EXIT=1
    Error: S4_BRIDGE is not set, so this suite has no real bridge to measure.
      node scripts/dev-real.mjs --port 3210 <pptx> <xlsx> <docx>
      S4_BRIDGE=<endpoint it prints> PLAYWRIGHT_BASE_URL=http://127.0.0.1:3210 \
        npx playwright test e2e/ui-audit-s4.spec.ts
```

（`29 did not run` 是 serial 模式的正常行为 —— 第一条就失败，后面不跑。
关键是 `skipped` 归零、退出码是 1、且错误信息直接给出要执行的两条命令。）

判据写进了文件注释：**`skip` 的正确用法是「这条用例不适用于这个环境」**
（在 macOS 上跳过 Windows 专有断言）；**「这套 suite 存在的理由所依赖的环境不在」
是配置错误**，而配置错误必须响。

### 其余 `e2e/*.spec.ts` 的同类检查

| 文件 | 条件 skip | 分类 |
|---|---|---|
| `ui-audit-s4.spec.ts` | 23 处 `!BRIDGE` | **缺环境 → 已改成 fail** |
| `compatibility-real.spec.ts:39` | `OFFICEDEX_E2E_COMPAT !== "1"` | **主动 opt-in**（跑付费的 managed real bridge），默认关是设计 |
| `pptx-stage-real.spec.ts:13` | `OFFICEDEX_E2E_PPTX_STAGE !== "1"` | 同上 |
| `generation-real.spec.ts:57,61` | `OFFICEDEX_E2E_RUN_HOSTED_PPTX` / `..._GIF !== "1"` | 同上（hosted PPTX 渲染要几分钟、GIF 依赖图像 provider） |
| `fix-w1a/b/c/d`、`fix-w2e/f/g`、`gates` | **零** | 七份修复 spec 的文件头都显式写了「本文件故意没有 skip」 |

后四条与 s4 的区别是：**默认关是刻意的成本决定，不是配置错误**，而且官方跑法
`scripts/run-real-e2e.mjs` 会注入这些变量。我不拥有那三个文件，所以只分类、没动。
但**同一个 CI 摘要陷阱仍然存在**：如果哪天要把它们接进闸门，得先让 CI 打印
「本次有 N 条 opt-in 用例未运行」，而不是让它们混在 `skipped` 里。

## 9. 没落地的草案，以及原因

| 草案（来自 SUMMARY §2 Wave 4 / S5 建议闸门） | 结论 |
|---|---|
| **⑥ z-index 来自声明的层级表** | **等 W3-I。** 白名单要以它重建的令牌表为准，提前写会立刻过期。草案见下。 |
| **⑥ 裸色值禁令 + 字号白名单** | **等 W3-I。** S5 自己写了「先补 danger/warning/success 令牌，否则这条永远带 9 个豁免」—— 一条自带九个豁免的禁令不是禁令。 |
| `shell only imports visuals through renderer/ui` | **不落地。** S5 说它「当前 2 个违例：`UpdateGate.tsx:6`、`main.tsx:31`」，而 W1-D 的修法恰恰是**让组件自己 import 样式**、入口那两行保留。这条规则和已经合入的修复方向相反，写了会要求把 W1-D 撤回。闸门 ② 覆盖了它想覆盖的风险，而且是在产物层面。 |
| `the #shell --od-* bridge is a closed set` | **不落地**（本轮）。S5 自查当前 19 ⊆ 29 成立，风险低；而且它是纯源码集合比较，和闸门 ③ 守的是同一个桥的两端 —— 桥失效的真实原因是 portal 位置，已被 ③ + `fix-w1c` 覆盖。 |
| `shell never emits ui-/od- prefixed classes` | **不落地**（本轮）。与 `officedex-ui-class-prefix-od` 那次 `@shimo/sdk-sheet` 撞车的历史相关，规则边界要先和 sheet 那边对齐，否则会把合法的 `renderer/ui` 透传也判红。 |
| `every root data-* attribute is consumed by CSS or declared test-only` | **不落地**（本轮）。唯一的违例是 `data-loaded`，而它被**测试和 e2e helper**（`open()` 等 `data-loaded="true"`）大量消费 —— 「零 CSS 消费」在这里不是缺陷。要写得先定义「test-only 属性」这个概念，成本高于收益。 |
| `Modal` Escape / focus-trap 单测、toast 不压标签单测 | **不落地**（本轮）。属于 W1-C 的行为闸门，`e2e/fix-w1c.spec.ts` 已覆盖；重复写会制造两份会分叉的真相。 |
| 浮层「被盖住」检测（S2-010） | **不落地**，理由同 ⑥：依赖 z-index 层级表。 |

### ⑥ 的草案（**等 W3-I 的产出再落地，不要照抄这段**）

```ts
// src/shell/test/tokens.test.ts —— 放这里，不要放 scripts/：它只读源码，够快。
it("z-index values come from the declared ladder", () => {
  // ALLOWED 必须 import 自 W3-I 重建的层级表（tokens.css 的机器可读投影），
  // 不要在这里再拍一遍数字 —— 那正是 combinationSelectors 那条刻意避开的错误。
});
it("no z-index lives inside an undeclared stacking context", () => {
  // contain / container-type / filter / transform / opacity<1 / will-change
  // 的选择器集合 ∩ 其后代里带 z-index 的选择器集合 必须为空，
  // 除非规则块上一行有 /* stacking-context: intentional */
  // 现实中会命中 composer.css:5 的 container-type（S5-005/S5-011）
});
it("shell stylesheets declare no bare colours", () => {
  // 白名单逐行（chrome.css 红绿灯 3 行 + agent.css companion 6 行），
  // 且必须在 W3-I 补完 danger/warning/success 之后才有意义
});
it("font-size comes from the type scale", () => { /* 白名单当前 9 行 */ });
```

**给 W3-I 的一条请求**：把层级表做成可以被 import 的东西（一个 `.ts` 常量，或
`tokens.css` 里一段有稳定格式的注释），否则这条闸门只能抄一份数字，
而抄下来的数字必然会分叉。

## 10. 自报：没做到的

1. **闸门 ① 只在一种视口、一种主题下跑。** 见 §2 盲区 1。这不是疏忽是取舍，
   但「浮层不被裁」这句话在本仓库目前只有 1280×720 的证据。
2. **闸门 ② 的 module 闭包是我自己写的 import 解析器，不是 Vite 的。**
   它跟 `.`/`..` 相对 import，不解析 alias（`@vo-ui/backend`）和 bare specifier。
   对 `src/shell` 够用（139 个模块，包含懒加载的画布），但它和真实 chunk 图不是同一个东西。
3. **没有在真 bridge（dev-real 3210）下跑过任何一条闸门。** 全部是 fixture 服务器
   + 构建产物。S4 的那半仍然没有闸门覆盖 —— 我只是让它缺环境时会响，
   离「CI 会拉起 dev-real」还差一步（SUMMARY §3 给的另一条路）。
4. **`package.json` 没动**（不在我的文件所有权里），所以闸门 ② 目前没有 npm script。
   见 §0 的那一行。
5. **没有把任何闸门接进 CI 配置**（`.github/**` 同样不在所有权里）。
6. **闸门 ④ 的 `STYLESHEETS` 是一张手写的文件清单**，不是从 import 图算的。
   新增一个 shell CSS 文件而不加进这张表，它就不会被检查。加了一条解析器守卫
   （≥15 条规则、≥3 个文件）能抓住整体失效，抓不住「新文件被漏掉」。
