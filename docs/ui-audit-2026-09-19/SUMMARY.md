# UI 普查汇总与修复计划

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ 输入：S0–S8 共 **124 条发现**、301 张截图、3243 行报告

---

## 1. 聚类结果：124 条现象 → 18 个根因

按「改一处能关掉几条」排序。**前 4 个根因吃掉 56 条现象（45%）。**

| # | 根因 | 位置 | 关掉的条数 | 最高级 |
|---|---|---|---|---|
| **R1** | `Menu` 不测量 rect、不 portal，`.shell-menu` 只有 `left:0`/`right:0`/`top:calc(100%+6px)` | `chrome/Menu.tsx:149-183`、`chrome.css:594-613` | **14** | P0 |
| **R2** | 悬浮面板的落点/钳位/贴边三套逻辑各自为政，且贴边规则选错了宿主 | `agent/useDraggable.ts`、`agent/AgentPresence.tsx`、`agent.css:209-253,317-336` | **15** | P0 |
| **R3** | `renderer/ui` 四个浮层 portal 到 `document.body`，`#shell` 的 `--od-*` 桥整体失效；`Modal` 无任何浮层行为 | `Modal.tsx:22-44`、`dialog.tsx:86`、`Popover.tsx:98`、`toast.tsx:151`、`tokens.css:105` | **13** | P0 |
| **R4** | 更新页：样式没进 shell 构建产物 + 组件内部状态/文案/按钮三方不同源 | `ForceUpdateOverlay.tsx`、`renderer/styles/onboarding-update.css`、`main.tsx:31`+`UpdateGate.tsx:6` | **14** | P0 |
| R5 | `.shell-list` 缺 `table-layout:fixed`，四列里只有一列有截断 | `nav.css:217-221,258-287` | 6 | P1 |
| R6 | 拖放的命中区挂错层级、两套渲染各缺一半反馈 | `nav/useFolderDrop.ts:22`、`FileTree.tsx:275/377` | 7 | P1 |
| R7 | `useComposerSettings` 每个调用点各持一份 `useState`，无 store 无广播（5 个实例） | `composer/useComposerSettings.ts:30-67` | 3 | P0 |
| R8 | `:focus-visible` 清单只列了 8 个选择器，`nav.css` 全文无焦点环 | `chrome.css:25-35`、`nav.css` | 4 | P1 |
| R9 | `home=true` 时无 tab 是 current → 7 个 `tabIndex=-1`，只剩关闭键可聚焦 | `FileTabs.tsx:89-96` | 3 | P0 |
| R10 | 画布契约没有安全区 / locale / 编辑器自带 chrome 高度的回传通道 | `editor/canvasContract.ts`、`canvas/*Canvas.tsx` | 5 | P1 |
| R11 | toast 宿主钉在窗口顶部正中，正是新壳放标签栏的位置；shell 从不挂 `ToastViewport` | `components.css:447-457`、`App.tsx:1` | 5 | P1 |
| R12 | 空态文案与该屏可用控件不对应 | `FileList.tsx:20-41`、`FileTree.tsx:346-356` | 5 | P1 |
| R13 | 模式切换：标签栏无 transition + 面板在切换瞬间卸载 | `chrome.css:137-147`、`AgentPresence.tsx:119`、`app.css:104-113` | 3 | P1 |
| R14 | 失败被吞 / 假错误：空 catch + `onError('')` 兜底文案 | `FileTabs.tsx:187-189`、`SheetCanvas.tsx:197-203` | 4 | P1 |
| R15 | 死 CSS：选择器打空、被同选择器跨文件覆盖、类名无规则 | `app.css:152`(打空)、`app.css:63-72`(被覆盖)、`composer.css` 的 `.is-dragging` | 5 | P2 |
| R16 | 行内操作位的包含块是 0×0 的 `.shell-menu-anchor` 而非行本身 | `nav.css:87-90` + `chrome.css:590` | 3 | P1 |
| ~~R17~~ | ~~暗色主题未实现~~ | — | — | **本轮不做（D4）** |
| R18 | 227 条用户可见文案零 i18n（`t(` 调用数 = 0） | `src/shell/**` 28 个文件 | 6 | P1 |

**剩余 21 条**为单点缺陷（离表字号、裸色值、`data-loaded` 无消费、ARIA 语义不一致等），归入各 track 顺手处理。

### 三条决策已拍板（2026-09-19）

| | 原决策项 | **结论** |
|---|---|---|
| D1 | legacy 设置 99 项中 94 项新壳不可达 | **不管 legacy。** 不移植、不加回退入口。S7 第 3 节的清单降级为存档，不进修复队列 |
| D2 | 新壳零 onboarding | 归入「不管 legacy」，本轮不做 |
| D3 | `DESIGN.md` 与 `CLAUDE.md` 与 `tokens.css` 三套设计语言互不相干 | **已解决：唯一基准是获批交互原型 `OfficeDex-Final-Light-Preview-2026-09-17.html`**，令牌投影在 `src/shell/tokens.css`（已核实两者一致）。冲突文档已清除，见下 |
| D4（新） | 暗色主题未实现 | **本轮不做。** R17 移出计划 |

#### D3 的清理结果

`DESIGN.md`（821 行 Notion 官网品牌提取）**已删除**。核实依据：它宣称的 `#5645d4` /
Plus Jakarta Sans，以及旧版 `CLAUDE.md` 宣称的 `#05101a` / `#006876` / `#fcfaf2` /
`#e6e4d8` / Plus Jakarta，在原型 HTML 里的命中数**全部为 0**。

而原型的 `--ink:#41464b`、`--shell:#f5f6f8`、`--nav-width:190px`、`--task-width:320px`、
`--ease:cubic-bezier(.22,1,.36,1)` 与 `src/shell/tokens.css` **逐值吻合** —— 该文件开头也
自述值取自原型的 computed styles（因为原型叠了十三层 CSS，读源码会得到永不生效的规则）。

改到的文件：`DESIGN.md`(删) · `CLAUDE.md` · `AGENTS.md` · `README.md` · `CONTRIBUTING.md` ·
`docs/README.zh-CN.md` · `docs/DEVELOPER_ONBOARDING.md` · `docs/handoff.md` ·
`docs/pptx-failure-state-ux-plan.md` · `.github/pull_request_template.md`

未动：`docs/superpowers/**` 的发布视频创意稿（那是营销物料的规范，不约束应用 UI）；
README 徽章里的 `#5645d4` 色值（shields.io 装饰，非设计规范）；
`docs/ui-audit-2026-09-19/**` 的 S4/S5 findings（它们是冲突的证据，删了就没有依据）。

**一条待办**：基准原型目前只存在于 `~/Documents/officedex/`，27MB、单机、不在版本控制里。
「一切以 html 为准」要成立，它得有个所有人都够得到的位置。见第 5 节。

## 2. 修复计划：4 波，最大并发 4

编排原则：**按文件所有权切，不按根因切**。同一文件只能有一个 owner，否则并发就是制造冲突。

### Wave 1 —— 四条 track 并发，文件集完全不相交，覆盖 4 个 P0 根因

| Track | 拥有的文件 | 关掉 | 关键动作 |
|---|---|---|---|
| **W1-A 浮层引擎** | `chrome/Menu.tsx`、**新建 `chrome/menu.css`**（把 `.shell-menu*` 从 chrome.css 抽出，**这是为了给 Wave 2 的 F track 腾开 chrome.css**） | **R1，14 条** | portal 到 `document.body` + `position:fixed` + 开面板时测一次 rect 做四边碰撞（贴边翻转、空间不足翻上、`max-height: min(340px, 可用高度)`）。翻转逻辑现成样板在 `composer/MentionMenu.tsx:117-134`。portal 后需显式实现「跟随锚点滚动或关闭」（S2-007） |
| **W1-B 悬浮 agent** | `agent/**` 全部 | **R2 + R13 的一半，15 条** | ①`useDraggable.ts:65` 的 x 下限不能是 12，要避开 `WindowBar` 保留区；②`PANEL_SIZE.height` 520 → 实测 543，或改成运行时测量；③`agent.css:236-253` 的贴边选择器从 `.shell-face` 改成面板本身，并加 `:not()` 排除面板内部头像；④`.shell-presence-panel` 的 `overflow:hidden` → `clip`（`overflow:hidden` 仍可被焦点滚动）；⑤`AgentPresence.tsx:119` 切换时不卸载 |
| **W1-C legacy 浮层与令牌桥** | `renderer/ui/**`（`Modal.tsx`、`Select.tsx`、`Popover.tsx`、`dialog.tsx`、`toast.tsx`、`components.css`） | **R3 + R11，13 条** | ①四个 `createPortal` 改挂 `#shell` 内的 layer（或把 `--od-*` 桥提到 `:root`——二选一，**不要两个都做**）；②`Modal.tsx` 补 Escape / 遮罩点击 / focus trap / 焦点归还（一处覆盖 3 个调用点）；③`Select.tsx:37` 补 `className="od-menu__item"`；④`.od-input` 补 width；⑤toast 宿主接 `ToastViewport`，锚到不压顶栏可点区的位置 |
| **W1-D 更新页** | `renderer/components/ForceUpdateOverlay.tsx`、`renderer/styles/onboarding-update.css` | **R4，14 条** | ①**把 `onboarding-update.css` 挪进 `ForceUpdateOverlay.tsx` 自己的 import**——这样一处覆盖 `UpdateGate.tsx:6` 与 `main.tsx:31` 两个调用点（S0 原方案只修了一个）；②`downloaded` 时 percent 补到 100；③错误态给第二条出路（`release.assets` 里就有下载地址，组件从未读过）；④三个逐像素相同的 phase 要么合并要么区分 |

**Wave 1 合计关掉 56 条，含全部 4 个最大根因。**

### Wave 2 —— 三条 track 并发（W1-A 抽走 menu.css 之后无冲突）

| Track | 拥有的文件 | 关掉 | 关键动作 |
|---|---|---|---|
| **W2-E 文件列表与树** | `nav/**` | **R5 + R6 + R16 + R8 的一半，18 条** | ①`.shell-list` 加 `table-layout:fixed`，四列都给截断；②`.shell-tree-folder-add` 的定位脱离 0×0 锚点，并给 toggle 补 `padding-right`（对照文件行已有的 26px）；③`data-drop-folder` 从 row 提到包含文件区的祖先；④`ComfortableList` 接 `dropFolderId` 反馈；⑤补 `nav.css` 的 `:focus-visible` |
| **W2-F chrome 与键盘** | `chrome/FileTabs.tsx`、`chrome/StatusBar.tsx`、`chrome/Sidebar.tsx`、`chrome/WindowBar.tsx`、`chrome.css`（menu 段已被 A 抽走） | **R9 + R14 的一半 + R15 的一半，14 条** | ①`FileTabs.tsx:89` 的 `current` 判定拆开——`home` 不该抹掉整条 Tab 序；②`:focus-visible` 清单补 `.shell-tab-close` 等；③标签栏溢出给可见提示；④Home 上 `visibility:hidden` 改 `display:none`（释放 240.8px，实测正好够放下全部标签）；⑤`app.css:152` 打空的选择器修到真实 DOM；⑥`FileTabs.tsx:187` 的空 catch 不能吞 share 失败 |
| **W2-G 设置状态** | `composer/useComposerSettings.ts`、`App.tsx:118` | **R7，3 条** | 改成共享 store + 订阅（当前 5 个独立实例）；`App.tsx:118` 的 `AttentionBorder` 补 `reducedMotion` prop |

### Wave 3 —— 需要前序产物或产品决策

| Track | 依赖 | 内容 |
|---|---|---|
| **W3-H 画布契约** | W1-B（落点逻辑） | `canvasContract.ts` 加三个通道：安全区/内容矩形、locale、编辑器自带 chrome 高度。关掉 R10 的 5 条（含工作簿状态栏被 `position:fixed` 页脚盖住、三语言同屏、双状态栏） |
| **W3-I 令牌收敛** | W1/W2 全部合入（D3 已解，不再阻塞） | 93 处裸色值换令牌（基准 = 原型/`tokens.css`）、补 danger/warning/success、补 z-index 层级表、9 处离表字号归档。**暗色按 D4 移出本轮**。动所有 css 文件，必须最后做 |
| **W3-J i18n** | W1/W2 全部合入 | 227 条文案接 i18n。`en.ts:584-603` 已有 20 条 `shell.*` 词条从未被用，先摘这批。**动所有 tsx，必须最后做** |

### Wave 4 —— 闸门（不做这步，上面全部会回归）

S2 与 S5 已给出可直接落地的草案：

1. **浮层无裁切**：10 个组合各渲染一次，断言 `clippedBy === null && offViewport === false`（判定复用 `e2e/ui-audit-helpers.ts` 的 `expectNoClip`）
2. **组件的样式随组件发货**：从 `src/shell` 做 import 图可达闭包，每个可达 `.tsx` 的字面量 class 必须在其可达 CSS 并集里有定义 —— 这条今天就会红（`force-update-*` 13 个 class），是 R4 的回归防线
3. **portal 必须落在 `#shell` 内**（R3 的防线）
4. **组合选择器登记表**：任何 `#shell[data-*]` 规则必须声明它覆盖哪几个组合，新增规则必须来登记
5. **裸色值禁令 + 字号白名单**（依赖 W3-I 先补令牌，否则永远带 9 个豁免）
6. **文案棘轮**：`src/shell` 的可见英文字面量数不得超过基线 227 并只减不增

---

## 3. 一条必须先处理的工程债

`e2e/ui-audit-s4.spec.ts` 的 **30 个用例 100% 是 `test.skip(!BRIDGE)`**。不带 `S4_BRIDGE` 跑输出 `30 skipped`、退出码 0，CI 摘要行读起来与成功无异。

**在把它接进任何闸门之前**，要么把缺环境从 `skip` 改成 `fail`，要么由 CI 负责拉起 dev-real 并注入端点。S4 的发现本身有真实截图佐证（真 sdk-sheet 功能区 + 单元格数据），不受影响。

---

## 3.2 合并期新发现（无 owner，需排进后续波次）

### [MERGE-001] 浮动面板里「发送」按钮被文件名盖住，鼠标点不到 — P1

- 壳组合：C7–C10（凡 floating 面板里的 composer）｜ 运行环境：3140 fake
- 现象：Playwright 报 `<span class="shell-cx-output-name">MO launch plan.docx</span>
  from <div class="shell-cx-left"> subtree intercepts pointer events`，点击等满 60s 超时。
  **用鼠标无法在这个面板里按下发送**；键盘 Enter 可以。
- 根因：`composer/Composer.tsx:804` 的 `.shell-cx-output-name` 所在的 `.shell-cx-left`
  在 340px 的面板宽度下压在 `.shell-cx-send` 上。`composer.css:385` 的窄容器分支没有
  为这一组重排。
- 归属：**composer 的行内布局，Wave 1 与 Wave 2 没有任何 track 拥有它。**
- 与既有发现的关系：S2 早就报过同一族（`toolbarOverlap`：`.shell-cx-scope` 与
  `.shell-cx-permission` 重叠 28px、与 `.shell-cx-model` 重叠 37/61px，并注明
  「Playwright 鼠标点击被拦截，必须用键盘」），当时作为交叉项给了 S3。
  **S3 只覆盖了 Home 宽度的 composer，窄面板这一半没有人接。这是波次规划的缺口。**
- 临时处理：`e2e/fix-w1b.spec.ts` 的 `growConversation()` 改用键盘发送并在注释里
  指回本条。修好后可以改回点击。

### [MERGE-002] `e2e/fix-w1b.spec.ts` 在布局动画未结束时取基准 — 已修

`open()` 只等 `data-loaded`，而那只表示数据到了、与布局无关。面板落位带过渡
（`--ease`，约 300ms）。实测 panel top：+0ms **302.56** → +100ms **354.63** → +300ms 起 **355**。

两条用例因此误判：一条把动画尾巴当成「focus 导致滚动 12.9px」（**面板稳定后同一个
focus 的位移是 0**），另一条在手柄到位前就读它的盒子、拖到了错的地方，于是
`data-edge` 始终为空。都不是产品缺陷。

已加 `settle()`：轮询到连续两次 rect 相同为止，不硬编码时长（过渡时长是设计令牌，
写死 300ms 的测试会在有人调它的那天悄悄变错）。修复后 14/14 通过，耗时 2.1 分钟 → 31 秒。

**这条要推广**：`e2e/ui-audit-helpers.ts` 的 `open()` 有同样的问题，只是普查阶段
拍的是静态截图没被咬到。Wave 4 接闸门前应统一。

## 3.1 重跑普查 spec 会毁掉「修复前」证据（W2-E 发现）

`e2e/ui-audit-s*.spec.ts` 里带 `capture()` 的用例会把截图**写回** `docs/ui-audit-2026-09-19/S*/screenshots/`。
修复后重跑一次，「修复前」的那张就被同名覆盖了 —— 而各 findings.md 全部按文件名引用它们。

好在截图已随 `b9c8404` 进了版本控制，所以：

```bash
git checkout -- docs/ui-audit-2026-09-19/S8/screenshots/
```

**每次重跑普查 spec 之后都要做这一步**（或先 `git stash` 截图目录）。
真要留「修复后」的图，另存到 `fixes/<track>/screenshots/`，不要盖原证据。

## 3.3 共享工作树的两起数据丢失（都已恢复，但机制是结构性的）

这个工作树同时有多个 session 在写。本轮发生两起误删他人未提交/未跟踪内容的事故，
**两起都不是粗心，而是两个看起来无害的日常操作在共享树里换了语义**：

| | 操作 | 后果 |
|---|---|---|
| 1 | 清理自己的临时文件 | 删掉了另一条 track 的未跟踪探针脚本 `w2f-probe.mjs`，git 无法恢复 |
| 2 | `git checkout -- StatusBar.tsx en.ts zh.ts` 退自己的改动 | **连带回滚了另一条 track 在同一批文件里的未提交 i18n 改造**，183 个 key 的字典全没 |

第二起的规模一度被低估：肇事方报告缺 46 个 key（它只扫了四个文件），实测是
**188 个引用里缺 183 个**，涉及 16 个文件。界面当时会渲染出原始 key 字符串。

### 规则

- **`git checkout -- <file>` 对任何多人动过的文件都是危险操作**，它按文件回滚，
  不分辨改动归属。先 `git diff <file>` 看清楚里面有几个人的东西，或者用
  `git stash push -- <file>` 之后挑拣。
- **未跟踪文件没有任何安全网。** 清理临时产物时用精确路径，不要用通配符扫目录。
- **值钱的未提交工作要有幂等的重放路径。** W3-J 恢复后把字典块和一个 `apply.py`
  落在树外，再被冲一次一条命令复原、重复跑是 no-op —— 这是对已经发生两次的风险
  做的实际防御，比写在报告里的教训有用。
- 冲突真发生时，**从 HEAD 重新拉基线、把 diff 压小、尽快落地**，比试图锁住文件现实。
  没有锁。

### 更一般的形式

`git` 的很多命令以**文件**为单位，而共享工作树里的所有权是以**行**为单位的。
凡是参数接文件路径的破坏性操作，在共享树里都默认做错事：

| 命令 | 在共享树里的真实语义 |
|---|---|
| `git checkout -- <file>` | 回滚该文件里**所有人**的未提交改动 |
| `git restore <file>` | 同上 |
| `git add <files> && git commit` | 提交**整个索引**，包括别人 stage 的东西 |
| `git stash` / `git clean` | 同样按文件/目录，不按归属 |

安全形式：提交用 `git commit -- <paths>` 显式限定路径；回滚前先 `git diff <file>`
看清里面有几个人的东西；清理临时产物用精确路径，不要用通配符扫目录。

（本轮协调方的 11 笔提交是用 `git add <files> && git commit` 做的，事后逐笔核对
干净——但那是运气：每次提交前重新看过 `git status`，而对方恰好没有 stage 过东西。）

### 第三条：量具对准了错的时刻

事故 2 的肇事方两次误报损失范围，第二次是**基线取错**——它量的是已经被恢复之后的
工作树，却把结果当成「从未损坏」的证据。量具本身没问题，问题是它对准了当下的磁盘，
而要回答的问题是「checkout 那一刻发生了什么」，那需要 `git show <当时的 HEAD>:file`。

协调方同期也犯了同类错误：`npx tsc --noEmit | tail -3; echo "exit=$?"` 取到的是管道
末端 `tail` 的退出码、**恒为 0**，因此连报了几次不成立的「tsc 通过」。

**量具对着错的东西，和量具坏掉，在输出上一模一样。** 这是本轮所有误报的共同形状，
比「粗心」或「证据不足」更接近根因。

## 3.4 合并期由外部 session 带来的发现

### [MERGE-003] 生成进行中时，状态栏说「No file open」，而画布上正画着一个 deck — P2

由并发的另一个 session 在实现 deck 生成时撞到并诊断，记录在此以免随它的回退一起蒸发。

- 现象：`StatusBar` 在生成过程中显示 `No file open`，同一时刻画布上有一个正在绘制的 deck。
- 与既有发现的关系：S1-004 报过这一行的**文案截断**，没有报这个**语义**问题。两条是
  同一个组件的两件事。
- 根因方向：`StatusBar` 只认 `activeFile`（`App.tsx` 的 `useShell()`），而「正在生成的
  产物」当前不经过那条路径。
- **修法约束（重要）**：那个 session 最初试的是在 `StatusBar` 里直接读 renderer 层的
  `useTaskStore`，结果 shell 启动即崩 —— shell 入口没有挂 `TaskStoreProvider`，而 shell
  和 legacy 是两个入口、provider 要各挂各的。它自己否掉了这个方向，理由是对的：
  **`src/shared/uiPort.ts` 是 shell 唯一的服务接缝**，chrome 组件不该跨过它去拉 renderer
  层的 store。正确修法是让这个事实从 `UiPort` 过来。
- 归属：未分配。与 MERGE-001 一样属于「波次规划没覆盖到」的一类。

## 4. 交叉验证与自我纠错记录（保留，供后续复盘）

**独立收敛**：S2 与 S7 互不知情测得设置菜单同一组数值（`left = -210.5`，可见 15.8%）；S5 静态预测的 8 个令牌差值被 S7 用 computed style 证实；S1/S5/S8 三方独立确认设置菜单溢出**与折叠轨无关**，共同推翻 PLAN 2.1 的猜测。

**被推翻的**：
- S5 说 FileTabs 菜单「唯一安全」→ S2 实测 146px 出窗口（S5 只查了 overflow 容器没查视口边界）
- S5 预测 `.shell-mention` 会被裁 → 实测没有，它是全壳唯一会测量并翻转的浮层
- S0-001 我写「同根因实例 = 1」→ S5 找出第二个调用点（`main.tsx:31`，我 S0 自己加的预览路径）
- S0-001 我写「从 `renderer/ui` 来的组件都带样式」→ S3 发现 `Select.tsx:37` 缺类名，CSS 在但选择器对不上
- S8 主动推翻两个可能被误传的假设：「更新时用户被关在窗口里」不成立（`HideTitleBar: false`）；「拖出侧栏残留高亮」是它自己合成事件不完整造成的假象
- S4 自查出方法错误：按文本 "sample" 选标签导致 pptx 从未被打开、slides 测成 Word 两次，删掉错标截图后重跑

**未被验证的**：S1 自报 C5–C10 的行内按钮是「推论不是实测」；S2 自报 5 个组合的两个浮层「按同取值同结果归类」；S5 全部条目为静态预测。这三处在当闸门基线前需补测。

---

## 5. 基准原型的存放问题（待办，需你决定）

「一切以 `OfficeDex-Final-Light-Preview-2026-09-17.html` 为准」现在写进了 `CLAUDE.md`、
`AGENTS.md`、`CONTRIBUTING.md`、两个 README 和 PR 模板。但这份文件：

- 只在 `~/Documents/officedex/`，**不在版本控制里**
- 27MB（内嵌全部 base64 资源）
- 只在这一台机器上

结果是：**新人、CI、以及任何其他机器上的 session 都无法核对基准。**
规范指向一个够不到的东西，等于没有规范——这正是刚被删掉的 `DESIGN.md` 的失败方式。

三个选项：

| | 做法 | 代价 |
|---|---|---|
| A | 原样提交进仓库（如 `design/prototype/`） | 仓库 +27MB；git 对单个大二进制不友好，但只此一份、不会反复改 |
| B | 提交进仓库 + Git LFS | 需要 LFS 配置，clone 多一步 |
| C | 不提交，只认 `src/shell/tokens.css` 为基准，原型作为离线参考 | 零代价，但「以 html 为准」退化成「以 tokens.css 为准」——两者当前逐值一致，可接受；风险是将来原型改版无处对照 |

**建议 C + 一条补充**：把原型的关键 computed 值（令牌 + 关键几何）落成
`src/shell/tokens.css` 的注释已有的形式，再加一个 `design/prototype-README.md` 说明原型的
出处、版本日期和如何获取。这样规范可核对，仓库不膨胀。
若将来要做设计回归（截图对比），再按 A/B 补。
