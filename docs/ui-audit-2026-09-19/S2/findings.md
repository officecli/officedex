# S2 浮层 — 发现清单

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ 分片：S2（menu / modal / tooltip / toast）
运行环境：**3100 fake（`?shellFixture=1`）**，Chromium（Desktop Chrome preset），视口 **1280×720**。3210 dev-real 未验证（归 S4）。

数据来源：`e2e/ui-audit-s2.spec.ts`（17 用例全通过）。复跑：

```
PLAYWRIGHT_BASE_URL=http://localhost:3100 OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/s2 npx playwright test e2e/ui-audit-s2.spec.ts
```

每个用例往 stdout 打一行 `S2-PROBE <name> <json>`。下文数字全部取自那份 JSON：rect 是 `getBoundingClientRect()`，`clippedBy` 是第一个真正裁到它的祖先，`clipped` 是四边各被裁掉多少 px，命中判定用 `document.elementFromPoint()`。

## 0. 三个根因，十五条现象

| 根因 | 位置 | 本分片实例数 |
|---|---|---|
| **R1 浮层无视口碰撞检测** | `src/shell/chrome/Menu.tsx:149-183` 从不测量 rect；`src/shell/chrome/chrome.css:594` `.shell-menu{position:absolute}` 只有 `:608 left:0` / `:611 right:0` | **8 个 `<Menu>` 调用点全中**，加 `MentionMenu` 共 9 个浮层全部非 portal |
| **R2 z-index 无统一标尺，且被祖先困住** | shell 侧 60 / 180 / 200；legacy 侧 1000 / 1050 / 1100 / 1200。`composer.css:5` 的 `container-type: inline-size` 让 `.shell-mention` 的 180 只在 composer 内有效 | 4 条 |
| **R3 legacy `Modal` 没有任何浮层行为** | `src/renderer/ui/components/Modal.tsx:22-44`：无 Escape、无遮罩点击、无焦点陷阱、无焦点归还 | 3 处调用 |

**R1 的 8 个 `<Menu>` 调用点**（`grep -rn "<Menu" src/shell`）：

| # | 文件:行 | label | align | width |
|---|---|---|---|---|
| 1 | `chrome/ModeMenu.tsx:43` | Workspace mode | start(默认) | 220 |
| 2 | `chrome/Sidebar.tsx:99` | Workspace settings | end | 250 |
| 3 | `chrome/FileTabs.tsx:209` | File actions | start(默认) | 190 |
| 4 | `nav/FileTree.tsx:228` | 文件夹 actions | end | 220 |
| 5 | `nav/FileTree.tsx:316` | 文件 actions | end | 230 |
| 6 | `composer/Composer.tsx:650` | Task scope | start | 260 |
| 7 | `composer/Composer.tsx:667` | Permissions | end | 280 |
| 8 | `composer/ModelMenu.tsx:101` | Model | end | 280 |

**8/8 在至少一个壳组合里被裁。** 这不是八个 bug，是一个根因的八个实例。动手裁它们的祖先有五个，全是 `overflow:hidden`：`.shell-sidebar`(`app.css:91`)、`.shell-sidebar-body`(`chrome.css:480`)、`.shell-agent`(`app.css:110`)、`.shell-presence-panel`(`agent.css:322`)、`.shell`(`app.css:8`)。

## 1. 逐条发现

### [S2-001] 侧栏文件夹右键菜单被左侧裁掉（折叠轨下裁 84%）
- 壳组合：**C1 / C5 / C7（折叠轨）裁 185px**；**C2 / C6 / C8（展开）裁 55px**。C3/C4/C9/C10 不复现 —— editor 模式侧栏中段为空（`App.tsx:99`）。
- 运行环境：3100 fake
- 复现：`?shellFixture=1&shell=C1` → 右键 "MO product launch" 行
- 现象：菜单宽 220px，折叠轨下只剩最右 **35px** 可见（一条白竖条）；展开侧栏下剩 165px，"New document" 被切成 "ocument"。
- 证据：`screenshots/C1-S2-001-folder-context-menu.png`、`C2-`（另有 C5/C6/C7/C8）
  - C1/C5/C7：`rect.left = -177`、`right = 43`、`width = 220`、`clippedBy = div.shell-sidebar-body`、`clipped.left = 185`、`offViewport = true`、`elementFromPoint(菜单中心) = aside.shell-sidebar`（菜单中心点不到自己）
  - C2/C6/C8：`rect.left = -43`、`right = 177`、`clipped.left = 55`
- 根因：`chrome/Menu.tsx:149-183` 不读任何 rect；`chrome.css:611` `[data-align="end"]{right:0}` 把 220px 面板从 190px（折叠 52px）宽的锚点右缘往左推，溢出由 `chrome.css:480` 裁掉。
- 类别：浮层定位 ｜ 严重度：**P0**（折叠轨是默认启动态）
- 同根因其它实例数：**7**
- 双渲染对照：`ComfortableList` 不挂 `onContextMenu`，首页那套不复现；但两套共用 `nav.css`。
- 备注：PLAN 说的「约 60px」= 展开态 55px，**已量化确认**；折叠轨下是它的 3.4 倍。

### [S2-002] 侧栏 footer 设置菜单被裁 84%，且 C1–C4 全中（不只 C1）
- 壳组合：**C1 / C2 / C3 / C4 全部复现**（PLAN 2.1 预判只有 C1 高危，实测展开侧栏一样坏）
- 现象：250px 面板只剩最右 **40px**，三行设置一个字读不到。
- 证据：`screenshots/C{1,2,3,4}-S2-002-settings-menu.png`
  - C1/C3（轨宽 52px）：`rect.left = -210.5`、`right = 39.5`、`clippedBy = aside.shell-sidebar`、`clipped.left = 210.5`
  - C2/C4（栏宽 190px）：`rect.left = -210`、`right = 40`、`clipped.left = 210`
  - 四组合 `rect.bottom = 720` = 视口底，顶 559，同时顶死下缘
- 根因：`chrome/Sidebar.tsx:99` 用 `align="end" width={250}`，侧栏最宽 190px（`app.css:82-92`），`app.css:91` 裁掉 210px。
- 类别：浮层定位 ｜ 严重度：**P0**（新壳仅有的三处设置入口之一）
- 同根因其它实例数：7
- **交叉确认**：S7 独立测得同一组数值（`left = -210.5` / `-210`，可见 15.8%），两个分片互不知情地收敛到同一结论。

### [S2-003] ModeMenu 在折叠轨下右侧被裁 80%
- 壳组合：**C1 / C3 / C9 裁 176px**；**C2 裁 42px**。C4–C8/C10 未单测（见第 4 节自报）。
- 现象：220px 面板只剩左 **44px**，两行只看得到两个 16px 图标，"Agent"/"Editor" 文字与描述全被裁 —— **整个产品的模式切换在默认启动态下不可读**（截图视觉确认）。
- 证据：`screenshots/C1-S2-003-mode-menu.png`、`C2-`、`C3-`、`C9-`
  - C1/C3/C9：`rect = {left:8, right:228, width:220}`、`clippedBy = aside.shell-sidebar`、`clipped.right = 176`，锚点 `.shell-brand` 仅 `36×36`
  - C2：`rect.left = 12`、`clipped.right = 42`，锚点 `165×36`
  - **`offViewport = false`** —— 它没出视口，是被 `overflow:hidden` 吃掉的；只看视口坐标的检查抓不到这类。
- 根因：`chrome/ModeMenu.tsx:43` 用默认 `align="start"`（`Menu.tsx:62`）→ `chrome.css:608 left:0`，撞上 `app.css:91`。
- 类别：浮层定位 ｜ 严重度：**P0** ｜ 同根因其它实例数：7

### [S2-004] FileTabs "File actions" 菜单有 77% 在窗口外
- 壳组合：**C5–C10**（`home=false` 才有标签工具条），实测 C7/C9，逐像素相同。
- 证据：`screenshots/C7-S2-005-tab-more-menu.png`、`C9-`；`rect = {left:1236, right:1426}`、`viewport.width = 1280`、`clippedBy = div.shell`、`clipped.right = 146`、`offViewport = true`
- 根因：`chrome/FileTabs.tsx:209` 的 `<Menu>` **没传 `align`**，落到默认 `"start"`，于是从一个距右边框 44px 的按钮向右展开。对错只取决于调用方有没有写 `align="end"` —— 正说明它靠猜而不是测量。
- 类别：浮层定位 ｜ 严重度：**P0** ｜ 同根因其它实例数：7

### [S2-005] composer 三个菜单在 docked 列与悬浮面板里被裁 44%–84%
- 壳组合：**C5/C6（docked，裁切者 `section.shell-agent`）+ C7/C8/C9/C10（floating，裁切者 `div.shell-presence-panel`）** 六个全中。

| 组合 | 菜单 | rect | 被裁(px) | 剩余可见 |
|---|---|---|---|---|
| C5 | scope (260×340) | left=112 bottom=1004 | bottom 284 | 16% |
| C5 | permission (280×210) | left=**-94** bottom=874 | left 146 + bottom 154 | 21% |
| C5 | model (280×259) | left=30 bottom=923 | left 22 + bottom 203 | 19% |
| C6 | 同上（整体右移 138px） | — | 同上 | 同上 |
| C7/C8/C9/C10 | scope | left=974 bottom=**999** | bottom 284 | 16% |
| C7/C8/C9/C10 | permission | left=792 bottom=869 | left 124 + bottom 154 | 27% |
| C7/C8/C9/C10 | model | left=916 bottom=918 | bottom 203 | 22% |

- 证据：`screenshots/C{5,6,7,8,9,10}-S2-004-composer-{scope,permission,model}.png`（18 张）
- 根因：`chrome.css:594` `.shell-menu{top:calc(100% + 6px)}` 永远向下开，而 composer 在 docked 列与悬浮面板里都贴容器底 → 「向下」必然出界；`app.css:110` 与 `agent.css:322` 裁掉。`Menu.tsx` 没有 `MentionMenu` 那样的翻转逻辑 —— **同一个 composer 里两个浮层，一个会翻转一个不会**（对照 `composer/MentionMenu.tsx:117-134`）。
- 类别：浮层定位 ｜ 严重度：**P0**（Model/Permissions 是 composer 仅有的两个配置入口）｜ 同根因其它实例数：7
- **交叉给 S3**：C5–C10 下 composer 工具条按钮互相压叠 —— `.shell-cx-scope` 与 `.shell-cx-permission` 水平重叠 **28px**，与 `.shell-cx-model` 重叠 **37px(floating)/61px(docked)**；Playwright 鼠标点击被 permission 拦截，必须用键盘才点得到 scope。探针字段 `toolbarOverlap`。属行内布局，不是浮层。

### [S2-006] 首页 scope 菜单没有视口感知的高度上限
- 壳组合：C1/C2 ｜ 证据：`screenshots/C1-S2-004-composer-scope.png`；`rect = {top:381, bottom:721, height:340}`，视口 720，`clipped.bottom = 1`
- 根因：`chrome.css:598` `max-height: 340px` 是常量，不是 `min(340px, 可用高度)`。
- 严重度：P2（S2-005 的轻症）｜ 同根因其它实例数：7
- 交叉：S3-015 在 composer 侧独立测到同一处（`bottom:721`），两边数值一致。

### [S2-007] 菜单开着滚动侧栏时跟着锚点滚出可视区且不关闭
- 壳组合：C2 ｜ 证据：`screenshots/C2-S2-006-menu-after-scroll.png`；`before.rect.top = 620 / clipped.bottom = 170` → `after.rect.top = 812 / clipped.bottom = 362`，`delta = 192`（与滚动距离一致）
- 根因：`.shell-menu` 是锚点的绝对定位子节点（`chrome.css:590-591`），跟随是自然结果；`Menu.tsx` 无 scroll 监听去重定位或关闭。
- 严重度：P2 —— **这条是修复方案的约束，不是独立 bug**：portal 化之后「跟随」会从副作用变成必须显式实现的行为。

### [S2-008] toast 盖住 7 个文件标签里的 3 个，并吃掉它们的点击
- 壳组合：**C5–C10**（有标签栏的全部）｜ 触发点：`chrome/Sidebar.tsx:124` 的 "Review changes"
- 复现：`?shellFixture=1&shell=C7` → 侧栏 footer 齿轮 → Review changes
- 现象：toast 从窗口顶部中间落下，正压标签条。第 3/4/5 个标签各被覆盖 **140px = 100% 标签宽**，三者中心 `elementFromPoint` 返回 `div.od-toast` → **点不动**；第 6 个被压 16.1px（仍可点）。
- 证据：`screenshots/C7-S2-008-toast-over-tabs.png`、`C7-S2-015-toast-covers-tabs.png`
  - toast `rect = {left:416.9, top:7.27, right:863.1, bottom:89.7}`，`.od-toast-host` `z-index = 1100`、`position = fixed`
  - 标签条 `{x:132, y:8, width:907.2, height:32}`；横向重叠 **446.2px（49%）**，纵向重叠 **32px（100%）**
  - 重叠点命中链：`div.od-toast → div.od-toast-clip → div.od-toast-slot → div.od-toast-host`
- 根因：`renderer/ui/styles/components.css:447-457` 把通知钉在窗口顶部正中；新壳把文件标签放在**同一条带**上（`chrome.css:138-147` `.shell-tabs`，标签本身无 z-index，`.shell-windowbar` 只有 `chrome.css:121 z-index:3`）。`.od-toast` 是 `pointer-events:auto`（`components.css:495`），所以它不只遮挡，是拦截。toast 组件搬自 legacy 全屏布局，那套布局顶部没有可点控件。
- 类别：z-index ｜ 严重度：**P1**（默认 3s 消失，但 `toast.loading` 的 `duration:null`（`toast.tsx:81`）会永久停留）
- 同根因其它实例数：**5 个 `notBuiltYet` 入口全走这条路**（`home/Highlights.tsx:211`、`composer/Composer.tsx:449`、`composer/Composer.tsx:685`、`chrome/FileTabs.tsx:165`、`chrome/Sidebar.tsx:124`），另加 `port/reportPortFailure.ts:31/46` 的所有 port 失败与 `FileTabs.tsx:180/183/185` 的成功提示 —— 全仓 toast 只有这一个宿主。

### [S2-009] 「toast 盖住所有菜单」—— **未复现**（反证，按原样记录）
- PLAN 对 S2 的推断是「toast 大概率盖住所有菜单」。**z 序确实如此（1100 ≫ 60），但几何上在 1280×720 不成立**。
- 证据：`screenshots/C7-S2-009-toast-over-menu.png`；toast `left=415.2 right=864.8 top=9.4 bottom=92.5`，ModeMenu `left=8 right=228 top=94 bottom=206`，`menuVsToast = {horizontal: -187.2, vertical: -1.5}`（两向都是负重叠）。
- 逐个核对其余浮层区间：Settings `x∈[-210,40] y∈[559,720]`、FileTabs More `x∈[1236,1426] y∈[46,212]`、composer 三菜单 `y>380` —— **没有一个落进 toast 的 `x∈[415,865] y∈[7,93]` 带**。
- 结论：toast 唯一受害者是标签条。「盖住菜单」只会在窗口变窄（`.od-toast-host` 宽 `min(460px, 100vw-32px)`）或将来有浮层开在顶部正中时发生。**窄视口复测归 S6**。

### [S2-010] 悬浮 TaskPanel（z 200）压在打开的菜单（z 60）上面
- 壳组合：**C7/C8/C9/C10**（presence 强制 floating），实测 C9。C5/C6 docked 不复现。
- 复现：`?shellFixture=1&shell=C9` → 鼠标拖 `.shell-task-head.is-grip` 到标签条下方 → 点 "…"
- 现象：菜单**同时**被窗口右缘裁 146px（S2-004）**并且**被悬浮面板盖住剩余部分；截图里只看得到 "Rena…"、"Remo…" 与垃圾桶图标边缘从面板右侧漏出。
- 证据：`screenshots/C9-S2-011-presence-over-menu.png`
  - presence `rect = {left:940, top:48, right:1280, bottom:591}`、`z-index = 200`、`position = fixed`
  - menu `rect = {left:1236, top:46, right:1426, bottom:212}`、`z-index = 60`、`position = absolute`
  - 重叠 `{horizontal: 44, vertical: 164}`；重叠点 `elementFromPoint` → `header.shell-task-head.is-grip`（链 `… → div.shell-task → div.shell-presence-panel → div.shell-presence`）；菜单中心命中 `div.shell-task-scroll`，`ownCentre = false`
- 根因：`agent/agent.css:209-211` `.shell-presence{position:fixed; z-index:200}` vs `chrome/chrome.css:597` `.shell-menu{z-index:60}`。两个数字来自两个作者、没有共同层级表；`.shell-menu` 又不是 portal，连「后来居上」的兜底都没有。
- 类别：z-index ｜ 严重度：**P1**
- 同根因其它实例数：**8 个 `<Menu>` 全是 z 60**，悬浮面板可拖到任意位置 → 理论上八个都能被盖。`MentionMenu` 的 180 同样小于 200。
- 说明：只在 3100 验证。**真编辑器自带工具栏与它谁赢归 S4。**

### [S2-011] `.shell-mention` 的 `z-index:180` 是无效数字 —— 被 `container-type` 困在 composer 里
- 壳组合：C1/C2（首页）、C7/C9（悬浮面板）
- 现象：mention 列表的定位与翻转**都正确**（首页 `data-side="below"`，悬浮面板 `data-side="above"`，两处 `clippedBy = null`、`offViewport = false`）—— 它是 shell 里唯一会量测的浮层。但 `z-index:180` 永远出不了 composer。
- 证据：`screenshots/C1-S2-012-mention-home.png`、`C2-`、`C7-S2-012-mention-floating.png`、`C9-`
  - 首页 C1 `rect = {left:267, top:396, right:637, bottom:711}`；悬浮 C7 `rect = {left:931, top:231, right:1241, bottom:571}`
  - 四处的 `stackingAncestors` 第一项都是 **`div.shell-cx {z-index:auto; container-type:inline-size}`**；C7/C9 还多一层 `div.shell-presence {z-index:200}`
- 根因：`src/shell/composer/composer.css:5` `.shell-cx{container-type: inline-size}`。`container-type` 隐含 `contain: layout style`，**会建立层叠上下文**；`.shell-cx` 自身 `z-index:auto`，于是 `.shell-mention`（`composer.css:390`）与 composer 里三个 `.shell-menu`（60）的层级全被折叠成 `.shell-cx` 在文档流里的那一个层级。写 180 还是 18000 没区别。
- 类别：z-index ｜ 严重度：P2（今天没造成可见遮挡，但它让这个数字对读代码的人撒谎，也让「排一张浮层层级表」无法生效）
- 同根因其它实例数：**4**（`.shell-mention` + composer 内三个 `.shell-menu`）

### [S2-012] legacy `Modal`：Esc 不关、点遮罩不关、Tab 能走出 `aria-modal` 走到「关闭窗口」
- 壳组合：与组合无关（portal 到 `document.body`），实测 C2
- 表面：`nav/useFolderDialogs.tsx:79`；同一实现还用于 `composer/ModelMenu.tsx:195` 与 `chrome/FileTabs.tsx:267`
- 证据（探针 `modal-behaviour`，截图 `screenshots/C2-S2-014-modal-behaviour.png`、`C2-S2-007-folder-dialog.png`）：
  1. **按 Escape 后 `document.querySelectorAll('.od-dialog-mask').length` 仍为 `1`**，焦点停在 `input.od-input` 没动。对照：shell 自己的 `Menu` 按 Escape 会关闭并把焦点还给触发器（S2-015）。**同一窗口里两套浮层，Esc 语义相反。**
  2. **点遮罩（40,40，远离对话框）后仍为 `1`**。
  3. **焦点没被困住**：连按 Tab 落点依次是 `input.od-input`(内) → `button.od-button` Cancel(内) → `button.od-button` Save(内) → **`body`(出) → `button.shell-window-close` "Close window"(出) → `button.shell-window-minimize`(出)**。第 4 次 Tab 就出了 `aria-modal="true"` 区域，第 5 次落在**关闭整个窗口**的按钮上。
- 根因：`src/renderer/ui/components/Modal.tsx:22-44` —— `ModalRoot` 只渲染 `createPortal(<div class="od-dialog-mask"><section aria-modal="true">…)`，**没有 keydown 监听、没有遮罩 onClick、没有 focus trap / inert、没有卸载时焦点归还**。`aria-modal="true"` 是一句没有行为兑现的声明。
- 类别：浮层行为 / 可访问性 ｜ 严重度：**P1** ｜ 同根因其它实例数：**3 处调用点**，`Modal` 本体 1 处需修
- 交叉确认：S7 独立测到同一条（Esc 不关 + 第 8 次 Tab 落在 `shell-window-close`）。

### [S2-013] 对话框里同屏三种字号，`.od-dialog` 本体回落到浏览器默认衬线体
- 证据（探针 `modal-behaviour.fonts`，截图 `screenshots/C2-S2-013-custom-model-dialog.png`）：

| 选择器 | font-family | font-size |
|---|---|---|
| `.shell`（壳基准） | `"PingFang SC", -apple-system, system-ui, "Segoe UI", "Microsoft YaHei", sans-serif` | **12px** |
| `.od-dialog` | **`Times`**（浏览器默认衬线） | 16px |
| `.od-dialog__header h2` | 同上但**少 `Microsoft YaHei`** | 16px |
| `.od-dialog__content` / `.shell-dialog-label` | 同上 | **14px** |
| `.od-input` / `.od-button` | 同上 | **13.3333px**（UA 默认表单字号） |

- 现象：一个对话框里 16/14/13.33 三档字号，壳是 12px 第四档。`.od-dialog` 盒子自身没写 `font-family`，计算值是 `Times` —— 今天所有可见文字都落在写了字体的子元素里，**屏幕上暂时看不到衬线体**，但任何直接塞进 `.od-dialog` 的文本节点都会变 Times。两套字体栈还差一个 `Microsoft YaHei` 回退（Windows 中文）。
- 根因：`components.css:408-419` `.od-dialog` 只设 `background/border/radius`；`.od-input` 设了 family 未设 size。`src/shell/tokens.css` 的 `--shell-font` 与 legacy 的 `--od-font-ui` 是**两条独立字体栈**。
- 类别：两套设计系统混用 ｜ 严重度：P2 ｜ 同根因其它实例数：7 处 `src/shell` → `renderer/ui` import（本分片撞到 3 处），完整清单归 S5
- 另记（供 S7）：`#shell-model-key` 的 `type = "password"` **已核实，API key 有掩码不泄露**。
  （S7 补充：React 仍把明文同步进 DOM 的 `value` 属性，`documentHTMLContainsSecret: true`。两条一起看。）

### [S2-014] 全壳没有 tooltip 组件，折叠轨完全依赖原生 `title`
- 证据（探针 `tooltips`，C1）：`[title]` = **167**；`.od-tooltip, .od-tooltip-anchor` = **0**；侧栏+窗口栏范围内 `[title] = 37`、`[aria-label] = 28`
- 现象：`components.css:612` 有一个完整的 `.od-tooltip`（`z-index:1200`），**shell 一次都没用**。折叠轨按钮没有文字标签（`chrome/Sidebar.tsx:194` `{collapsed ? null : <span>}`），唯一名字来源是原生 `title` —— 延迟约 1s、样式不可控、键盘 focus 不触发、触摸屏没有。这也解释了 S2-003 为什么那么难受：折叠轨下用户本来就没别的途径知道那两行是什么。
- 根因：`chrome/Sidebar.tsx:190`、`chrome/WindowBar.tsx:45/63`、`chrome/FileTabs.tsx:98/110/125/152/161/204/258`、`agent/AgentPresence.tsx:144/156`、`agent/TaskPanel.tsx:64/241/285` 一律用 `title=`；`src/shell` 内 `grep -rn "Tooltip"` 只在 `tokens.css:102` 的注释里出现。
- 类别：浮层缺失 ｜ 严重度：P2 ｜ 同根因其它实例数：**37**

### [S2-015] `Menu` 的 Escape 焦点归还 —— **正确**（核实通过，留档）
- 证据（探针 `menu-focus`，C2）：打开后焦点在 `button.shell-menu-item`；按 **Escape** → 焦点回到 `button.shell-icon-button`（`aria-label="Settings"`，即触发器），菜单节点数归 0。按 **Tab** → 关闭，焦点落到 `textarea.shell-cx-input`（DOM 顺序上的下一个可聚焦元素，行为合理）。
- 实现：`chrome/Menu.tsx:74-77` `close(focusTrigger)` + `:159-168`。
- 结论：**shell 自研 `Menu` 的键盘行为没问题**，问题全在定位（R1）与层级（R2）。这条的存在是为了给 S2-012 一个对比基准 —— 同一应用里，自研浮层做对的事，legacy `Modal` 一件没做。

## 2. 修复建议（按根因，不按现象）

1. **R1**：`.shell-menu` 改成 portal 到 `document.body` + `position:fixed` + 开面板时测一次 rect 做四边碰撞（水平贴边翻转、垂直空间不足翻上、`max-height: min(340px, 可用高度)`）。一处改动关掉 S2-001~006，共 **8 个调用点**。翻转逻辑现成样板：`composer/MentionMenu.tsx:117-134`。注意 portal 化后 S2-007 的「跟随锚点滚动」需显式实现。
2. **R2**：建一张全应用层级表（建议 `src/shell/tokens.css`，把 legacy 的 1000/1050/1100/1200 一并纳入），并处理 `composer.css:5` 的 `container-type` 与浮层的关系（浮层 portal 出去即可，与 R1 同一动作）。toast 宿主需要一个「不压住顶栏可点区」的锚点 —— `toast.tsx:121` 的 `ToastViewport` 已提供该机制，shell 一次都没挂。
3. **R3**：`Modal.tsx` 补 Escape、遮罩点击、focus trap、焦点归还 —— 一处改动覆盖 3 个调用点。

## 3. 可机械化的闸门（供 PLAN 第 5 节）

- `Menu` 单测：十个组合各渲染一次，断言 `.shell-menu` 的 `clippedBy === null && offViewport === false`（判定直接复用 `e2e/ui-audit-helpers.ts` 的 `expectNoClip`）。
- 静态闸门：`src/shell` 内任何 `position: absolute|fixed` 且带 `z-index` 的规则必须在层级表里有名字（仿 `src/shell/test/deadControls.test.ts`）。
- `Modal` 单测：开着对话框按 Escape 断言关闭；连按 6 次 Tab 断言 `document.activeElement.closest('.od-dialog')` 始终非空。
- toast 单测：弹出时断言每个 `.shell-tab` 的中心 `elementFromPoint` 仍落在它自己身上。

## 4. 自报覆盖率

### 覆盖到的浮层（9/9 个 shell 浮层调用点 + 3 个 legacy 表面）

| 浮层 | 文件 | 覆盖组合 | 结论 |
|---|---|---|---|
| 文件夹右键菜单 | `nav/FileTree.tsx:228` | C1/C2/C5/C6/C7/C8 | S2-001 |
| 文件行菜单 | `nav/FileTree.tsx:316` | — **未单独量测** | 同 `align="end"`、同裁切者，归入 S2-001；宽 230 比 220 多 10px，只会更糟 |
| 侧栏设置菜单 | `chrome/Sidebar.tsx:99` | C1/C2/C3/C4 | S2-002 |
| ModeMenu | `chrome/ModeMenu.tsx:43` | C1/C2/C3/C9 | S2-003 |
| FileTabs File actions | `chrome/FileTabs.tsx:209` | C7/C9 | S2-004 |
| composer Task scope | `composer/Composer.tsx:650` | C1/C2/C5/C6/C7/C8/C9/C10 | S2-005 / S2-006 |
| composer Permissions | `composer/Composer.tsx:667` | 同上八个 | S2-005 |
| ModelMenu | `composer/ModelMenu.tsx:101` | 同上八个 | S2-005 |
| MentionMenu | `composer/MentionMenu.tsx` | C1/C2/C7/C9 | S2-011 |
| `Modal`（新建文件夹） | `nav/useFolderDialogs.tsx:79` | C2 | S2-012 / S2-013 |
| `Modal`（CustomModelDialog） | `composer/ModelMenu.tsx:195` | C2 | S2-013 |
| toast | `renderer/ui/services/toast.tsx` | C7（几何），C5–C10 同构 | S2-008 / S2-009 |
| tooltip | **不存在** | C1 | S2-014 |

### 覆盖到的壳组合

| 组合 | 状态 | 说明 |
|---|---|---|
| C1 | **全覆盖** | 右键菜单 / 设置菜单 / ModeMenu / 三个 composer 菜单 / mention / tooltip 统计 |
| C2 | **全覆盖** | 同 C1，另加滚动跟随、两个 Modal、焦点行为 |
| C3 | 部分 | 设置菜单 + ModeMenu。editor 首页没有 composer，无 composer 菜单；无文件夹树故无右键菜单 |
| C4 | 部分 | 只测设置菜单；ModeMenu 未单测 |
| C5 | 部分 | 右键菜单 + 三个 docked composer 菜单；ModeMenu / 设置菜单未单测 |
| C6 | 部分 | 同 C5 |
| C7 | **全覆盖** | 右键菜单 / 三个 composer 菜单 / FileTabs More / toast×2 / presence 默认位 / mention |
| C8 | 部分 | 右键菜单 + 三个 composer 菜单 + presence 默认位；FileTabs More / toast 未单测 |
| C9 | **全覆盖** | ModeMenu / FileTabs More / 三个 composer 菜单 / presence 拖拽压菜单 / mention / presence 默认位 |
| C10 | 部分 | 三个 composer 菜单 + presence 默认位；ModeMenu / FileTabs More 未单测 |

### 明确没做的、以及为什么

1. **C4/C5/C6/C8/C10 的 ModeMenu 与设置菜单没有逐组合量测。** 这两个浮层的几何只由 `navCollapsed` 决定（锚点 36px vs 165px、侧栏 52px vs 190px），C1/C2/C3/C9 已把两种取值各测两遍且逐像素一致。没测的格子按「同取值同结果」归类 —— **这是推断不是实测**。
2. **`nav/FileTree.tsx:316` 的文件行菜单没有单独跑。** 时间给了更高危的八个；它与文件夹菜单共享全部相关属性，归入 S2-001 同根因。
3. **3210 dev-real 一次都没跑**（按 PLAN 归 S4 独占）。所以 **S2-010 在真编辑器里会不会更糟、编辑器自带工具栏与 `.shell-presence` 谁赢，本分片没有答案。**
4. **视口只跑 1280×720、只跑亮色。** 窄视口下 toast 会变宽（`min(460px, 100vw-32px)`）从而可能盖到更多东西，**S2-009 的反证在窄窗口下可能翻转** —— 这一维归 S6，我只给出了会翻转的阈值条件。
5. **模式切换过渡期间的浮层行为没测**（菜单开着时切 agent↔editor）。归 S6。
6. **没测触摸 / 高对比 / `prefers-reduced-motion` 下的 toast 动画。**
7. **没改任何源文件，没有 commit。** 新增文件只有 `e2e/ui-audit-s2.spec.ts` 与 `docs/ui-audit-2026-09-19/S2/screenshots/` 下的 56 张截图。
