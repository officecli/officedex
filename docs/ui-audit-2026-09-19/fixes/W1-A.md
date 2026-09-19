# W1-A 浮层引擎 —— 修复报告

日期：2026-09-19 ｜ 分支：`develop/1.0`（**未 commit，改动留在工作区**）
根因：**R1 —— `Menu` 不测量 rect、不 portal**
验证环境：本 track 自起的 3121 dev server（`npx vite --port 3121 --strictPort`，已停），
Chromium，视口 1280×720，`?shellFixture=1`

---

## 1. 改了哪些文件

| 文件 | 动作 |
|---|---|
| `src/shell/chrome/menu.css` | **新建**。从 `chrome.css` 剪来的 `.shell-menu*` 全部规则（原 587–684 行），外加从 `chrome.css` 共享 `:focus-visible` 清单里摘出的那一条 `.shell-menu-item:focus-visible` |
| `src/shell/chrome/chrome.css` | **只做减法**：删掉 587–684 的整个 menu 段（684 → 586 行），并从 25–35 行的共享焦点环清单里移走 `.shell-menu-item:focus-visible` 这一行。**此后 chrome.css 不再属于 A track**，`grep shell-menu` 归零 |
| `src/shell/chrome/Menu.tsx` | portal + 四边碰撞测量。见第 3 节 |
| `e2e/fix-w1a.spec.ts` | **新建**，11 个用例、**零 skip**（含零条件 skip） |
| `docs/ui-audit-2026-09-19/fixes/W1-A/screenshots/` | 42 张修复后截图 |

`src/shell/chrome/ModeMenu.tsx` 我拥有但**没有改**：它的问题（默认 `align="start"` +
220px 面板撞 52px 轨）完全由 `Menu` 的碰撞检测解决，改调用点就是把「靠调用方猜」再猜一遍。

### chrome.css 剪切说明（这一步的唯一目的）

按分工，这一剪切没有功能价值，是**为 Wave 2 的 F track 腾开 chrome.css**，否则两条 track
必须串行。顺手把那条 `.shell-menu-item:focus-visible` 也摘了出来，原因是 W2-F 要做的
事就是往那份清单里**加**选择器，而我只是**删**一行 —— 两边不会改到同一行。

摘出来时保持了**渲染逐像素不变**：原来 `chrome.css:25-35` 给菜单项写了
`outline: 2px solid var(--shell-focus)`，但 `:632` 的 `.shell-menu-item:hover, :focus-visible { outline: 0 }`
在源序上更晚、把它整条吃掉了 —— 菜单项实际穿的焦点环一直只有
`box-shadow: inset 0 0 0 1px #9aa8b3`。menu.css 里保留的就是这一条，**没有**趁机"修好"
那个 outline：焦点环清单是 W2-F 的账，一个布局修复不该顺路带一次没人要求的视觉变更。

---

## 2. 关掉了哪几条（逐条列 finding ID）

### 直接关掉（本 track 实测）

| Finding | 内容 | 覆盖组合 | 判据 |
|---|---|---|---|
| **S2-001** | 侧栏文件夹右键菜单被左裁 185px / 55px | C1 C2 C5 C6 C7 C8 | `expectNoClip` |
| **S2-001**（文件行菜单） | S2 自报「未单独量测」的那个实例 | C2 | `expectNoClip` |
| **S2-002** | 侧栏 footer 设置菜单被裁 84% | C1 C2 C3 C4 | `expectNoClip` |
| **S2-003** | ModeMenu 折叠轨下裁 80%，Agent/Editor 两行文字全裁 | C1 C2 C3 C9 | `expectNoClip` + 两行文字 `toBeVisible` |
| **S2-004** | FileTabs "File actions" 146px 出窗口 | C7 C9 | `expectNoClip` + `right ≤ 1280` |
| **S2-005** | composer 三菜单在 docked / floating 下裁 44%–84% | C5 C6 C7 C8 C9 C10（另测 C1 C2） | `expectNoClip` ×24 |
| **S2-006** | 首页 scope 菜单 `max-height:340px` 是常量，底边出视口 1px | C1 | `bottom ≤ 720` + `max-height ≠ 340px` |
| **S2-007** | 菜单开着滚动时跟着锚点滚出可视区且不关闭 | C2 | 跟随 20px 且不横向漂移；锚点离开滚动容器后 `toHaveCount(0)` |
| **S1-002** | 折叠轨右键文件夹，220px 只剩 43px | C1（= S2-001 的 C1 实例） | `expectNoClip` |
| **S3-015** | scope 菜单底边掉出视口 1px | C1/C2（= S2-006） | `bottom ≤ 720` |
| **S5-003** | 8 个调用点里 6 个 `width` 常量大于裁切容器 | 全部 | 容器不再参与裁切；`width` 只被视口约束（`min(width, vw-16)`） |

### 连带关掉（不是我的任务，但修法必然涉及）

| Finding | 说明 |
|---|---|
| **S2-010 / S5-006** | 悬浮 TaskPanel（z 200）压在菜单（z 60）上。**不得不一起修**：portal 之后 composer 的三个菜单从 `.shell-presence`(200) 内部搬到了外面，若仍用 60 会被面板整个盖住 —— 比修之前更糟。所以 `.shell-menu` 的 z 从 60 提到 **300**。实测 C9 拖面板压菜单：`elementFromPoint` 命中链现在是 `span.shell-menu-label → button.shell-menu-item → div.shell-menu`，`ownCentre: true`（修复前命中 `header.shell-task-head`） |
| **S4-006** | 悬浮面板里 ModelMenu 被 `.shell-presence-panel{overflow:hidden}` 切一半。3100 fake 下 C7–C10 已实测不裁。**3210 dev-real 我没跑**（见第 5 节） |
| **S5-004** | `.shell-presence-panel` 的 overflow 裁掉悬浮 composer 的四个浮层 —— 其中三个 `.shell-menu` 已关掉；`.shell-mention` 不在我的文件里，且 S2-011 实测它本来就不被裁 |
| **S2-011** 的一半 | `.shell-cx` 的 `container-type` 把 composer 内浮层的 z 折叠成一层。三个 `.shell-menu` 已 portal 出 `.shell-cx`，不再受困；`.shell-mention` 的 `z-index:180` 仍是无效数字（`composer/` 不归我） |

---

## 3. 修法

### 3.1 portal 目标：`#shell`，不是 `document.body`（与 C track 的设计耦合点）

任务书要求我先确认 `--shell-*` 的作用域再决定 portal 到哪。**确认结果：
`tokens.css:15` 和 `:105` 两个块都写在 `#shell` 选择器上** —— `--shell-*` 与 `--od-*` 桥
同一个宿主；而 `App.tsx:76-77` 里 `id="shell"` 与 `className="shell"` 是**同一个元素**，
字体栈（`app.css:3` `.shell { font: ... }`）也在它身上。

所以 portal 到 `document.body` 会同时丢掉令牌和字体 —— 正是 C track 在修的 R3 的失败方式。

**我选：portal 到 `#shell` 本身，不加 layer 包装。**
理由是 `#shell` 是 `position:absolute; inset:0`（`app.css:4-6`），而 `position:fixed` 的
子元素**不参与 flex 布局**（绝对/固定定位的子元素不是 flex item），所以直接挂上去对
`#shell` 的两行 flex 布局零影响，不需要额外的 `display:contents` 或 `inset:0` 中间层。

**与 C track 对齐情况**：C track 的 `src/renderer/ui/overlayHost.ts`（我只读没动）独立
选到了同一个宿主 `#shell`，只是多套了一个 `.od-overlay-layer{display:contents}` 层
——因为它要服务四个 legacy 浮层且必须能被 host 显式改写。两者不冲突，类名也不撞：
`.shell-menu` 是 `#shell` 的直接子节点，`.od-overlay-layer` 是它的兄弟。**汇总时按
「宿主统一为 `#shell`」记一条即可，两条 track 已经收敛到同一答案。**

实测断言（`fix-w1a.spec.ts` 「the panel is portalled inside #shell」）：

```
{"insideShell":true,"parentIsShell":true,"position":"fixed",
 "fontFamily":"\"PingFang SC\", -apple-system, \"system-ui\", \"Segoe UI\", \"Microsoft YaHei\", sans-serif",
 "shellFont":  同上（逐字符相等）}
```

### 3.2 四边碰撞

`Menu.tsx` 新增 `computePlacement()`，在 `useLayoutEffect`（提交后、绘制前）里跑一次：

- **垂直**：先试向下；`natural > roomBelow` 且上方空间更大时翻上。
  `max-height = min(340, 该侧可用高度)` —— 这一条就是 S2-006 / S3-015。
- **水平**：`align` 降级为**首选方向**。先试首选边，不 fit 就试另一边，再不 fit 才钳到
  视口内。`FileTabs.tsx:209` 漏传 `align` 不再有任何后果。
- **宽度**：`min(width, vw - 16)`。
- 四边各留 `VIEWPORT_EDGE = 8px`，锚点间隙 `ANCHOR_GAP = 6px`（沿用原 `calc(100% + 6px)`）。

### 3.3 锚点取 wrapper，不取 trigger

`.shell-menu-anchor` 的 rect 就是原 CSS 的定位基准（`top: calc(100% + 6px)` 的 100%、
`left:0` / `right:0` 都解析在这个盒子上），所以取它 = 忠实移植原锚定 + 加碰撞。

**这一条是实测逼出来的**，第一版我写的是「trigger 有盒子就用 trigger，否则回退 wrapper」，
结果 S2-007 那条用例抓到菜单在滚动时**横移 28px、纵移 44px**：文件树的行内按钮
（`.shell-tree-folder-add` / `.shell-tree-file-more`）是 hover 才 `display:flex` 的，而菜单
活得比 hover 久 —— 鼠标一离开行，锚点来源就从 trigger 切回 wrapper，面板当场跳一下。
折叠轨上更糟：trigger 永远 `display:none`，rect 全零，菜单会跳到窗口左上角。
改成恒取 wrapper 后，实测 `left` 在滚动前后都是 177，纵向位移严格等于滚动距离 20px。

### 3.4 S2-007：**跟随重定位**，而不是滚动即关闭（理由已写进代码注释）

选跟随的理由：滚动跟随在修复前是「绝对定位子节点」的自然副作用，**用户已经见过这个
行为**；改成「滚动即关闭」是引入新行为而不是恢复旧行为。而且文件夹菜单是右键行打开的
——用户右键完想把侧栏推一下看清菜单，结果菜单消失，这是把一个定位 bug 换成一个交互 bug。

跟随在「跟随不再有意义」的那一刻停止：`visibleBox()` 把锚点的 rect 与所有会裁切的祖先
求交，交集为空（= 锚点已经被滚出它自己的滚动容器）时 `close(false)`。实测：
`scrollTop=20` → 菜单跟随且仍不裁；`scrollTop=scrollHeight` → 菜单关闭。

监听用 `window.addEventListener("scroll", reposition, true)`（捕获阶段，因为 scroll 不冒泡）
+ `resize`。`.shell-menu` 加了 `overscroll-behavior: contain`，免得在菜单里滚到底后把
背后的锚点也滚走。

---

## 4. 修复前 / 修复后数值对照

全部取自同一个探针：修复前 = `docs/ui-audit-2026-09-19/S2/findings.md` 的记录，
修复后 = 本次重跑 `e2e/ui-audit-s2.spec.ts`（**17 用例全通过**）的 `S2-PROBE` 输出。

### 4.1 `.shell-menu` 的 `clippedBy` / `offViewport`

| 浮层 | 组合 | 修复前 | 修复后 |
|---|---|---|---|
| 文件夹右键菜单 | C1/C5/C7 | `left=-177 right=43`，`clippedBy=div.shell-sidebar-body`，裁 185px，`offViewport=true` | **`left=43 right=263`，`clippedBy=null`，`clipped` 四边全 0，`offViewport=false`** |
| 文件夹右键菜单 | C2/C6/C8 | `left=-43 right=177`，裁 55px | **`left=177 right=397`，`clippedBy=null`** |
| 侧栏设置菜单 | C1/C3 | `left=-210.5 right=39.5`，`clippedBy=aside.shell-sidebar`，裁 210.5px，可见 15.8% | **`left=11.5 right=261.5`，`clippedBy=null`，可见 100%** |
| 侧栏设置菜单 | C2/C4 | `left=-210 right=40`，裁 210px | **`left=12 right=262`，`clippedBy=null`** |
| ModeMenu | C1/C3/C9 | `left=8 right=228`，`clippedBy=aside.shell-sidebar`，**裁右 176px**，`offViewport=false`（被 overflow 吃掉） | **`left=8 right=228`，`clippedBy=null`** —— rect 没变，被裁的那 176px 现在画得出来了 |
| ModeMenu | C2 | 裁右 42px | **`clippedBy=null`** |
| FileTabs More | C7/C9 | `left=1236 right=1426`，`clippedBy=div.shell`，裁右 146px，`offViewport=true` | **`left=1074 right=1264`，`clippedBy=null`，`offViewport=false`** |

ModeMenu 那一行值得单独说：**rect 前后完全一样**。它从来不是「位置算错了」，是
`.shell-sidebar` 的 `overflow:hidden` 把 220px 面板吃掉 176px。只查视口坐标的检查
（`offViewport`）抓不到这类，只有祖先遍历抓得到 —— 这也是为什么闸门必须用
`expectNoClip` 而不是 `rect ⊂ viewport`。

### 4.2 composer 三菜单（S2-005，6 个组合全中 → 全清）

修复前（S2 表）：

| 组合 | 菜单 | rect | 被裁 | 剩余可见 |
|---|---|---|---|---|
| C5 | scope | left=112 bottom=**1004** | bottom 284 | 16% |
| C5 | permission | left=**-94** bottom=874 | left 146 + bottom 154 | 21% |
| C5 | model | left=30 bottom=923 | left 22 + bottom 203 | 19% |
| C7–C10 | scope | left=974 bottom=**999** | bottom 284 | 16% |
| C7–C10 | permission | left=792 bottom=869 | left 124 + bottom 154 | 27% |
| C7–C10 | model | left=916 bottom=918 | bottom 203 | 22% |

修复后（24 个格子，`clippedBy` 全为 `null`，`offViewport` 全为 `false`）：

| 组合 | scope | permission | model |
|---|---|---|---|
| C1 | left=319 bottom=712 | left=570 bottom=591 | left=697 bottom=640 |
| C2 | left=388 bottom=712 | left=639 bottom=591 | left=766 bottom=640 |
| C5 | left=112 bottom=**654** | left=**158** bottom=654 | left=30 bottom=654 |
| C6 | left=250 bottom=654 | left=44 bottom=654 | left=168 bottom=654 |
| C7 | left=974 bottom=**631** | left=792 bottom=628 | left=916 bottom=628 |
| C8 | left=974 bottom=634 | left=792 bottom=628 | left=916 bottom=628 |
| C9 | left=974 bottom=617 | left=792 bottom=628 | left=916 bottom=628 |
| C10 | left=974 bottom=614 | left=792 bottom=628 | left=916 bottom=628 |

C5 的 permission 从 `left=-94`（146px 在窗口外）变成 `left=158`；所有 `bottom > 720` 的
格子现在都翻到了锚点上方。

### 4.3 S2-007 滚动跟随

| | 修复前 | 修复后 |
|---|---|---|
| 滚动前 | `top=620`，`clipped.bottom=170` | `top=246`，`clippedBy=null` |
| 滚动后 | `top=812`，`clipped.bottom=362`，`delta=192`（跟着滚出可视区，**不关闭**） | `top=226`，`left` 不变（177），`delta=-20` = 滚动距离，`clippedBy=null` |
| 锚点滚出容器 | 菜单留在原地继续裁 | **菜单关闭**（`toHaveCount(0)`） |

### 4.4 S2-010 命中测试（连带）

| | 修复前 | 修复后 |
|---|---|---|
| 菜单 z / position | 60 / absolute | **300 / fixed** |
| 重叠点 `elementFromPoint` | `header.shell-task-head.is-grip`（链 `… → div.shell-presence-panel`） | **`span.shell-menu-label` → `button.shell-menu-item` → `div.shell-menu` → `div.shell`** |
| `menu.ownCentre` | `false`（菜单中心点不到自己） | **`true`** |

---

## 5. 没关掉的，以及原因

| Finding | 为什么没关 |
|---|---|
| **S2-008** toast 盖住 3 个文件标签并吃掉点击 | 宿主在 `renderer/ui/styles/components.css:447`，是 **C track** 的文件（R11）。我只把菜单抬到 z 300，toast 是 1100，仍在菜单之上 —— S2-009 已证实二者在 1280×720 几何不相交，所以这不构成新问题 |
| **S2-012 / S2-013** legacy `Modal` 无 Esc / 无遮罩点击 / 无 focus trap / 字体回落 Times | `renderer/ui/**`，**C track**（R3）。我的用例顺手复验了 shell 自研 `Menu` 的键盘契约（S2-015）在 portal 之后依然成立 |
| **S2-014** 全壳没有 tooltip 组件，167 个原生 `title` | 不是 R1，也不在 Wave 1 任何 track 的文件集里。**建议单独立项**：折叠轨下用户本来就只能靠 `title` 认按钮，这条和 S2-003 是同一个体验的两半 |
| **S2-011** `.shell-mention` 的 `z-index:180` 被 `container-type` 困住 | 三个 `.shell-menu` 已 portal 出去，但 `.shell-mention` 在 `composer/MentionMenu.tsx`，不在我的文件集。它本来就不被裁（S2-011 实测），所以不是回归，是遗留 |
| **S4-006** 在 **3210 dev-real** 下的表现 | 我只跑了 3100 fake（3121 端口上的同一份 fixture）。dev-real 归 S4，且它的 spec 30 个用例全是条件 skip（SUMMARY 第 3 节的工程债）。**真编辑器自带工具栏与 z 300 谁赢，本 track 没有答案** |
| **S5-002** 声称设置菜单在**全部 10 个**组合下被裁 | 我实测了 C1–C4（S2 实测过的那四个）。C5–C10 的设置菜单没有逐组合量测 —— 几何只由 `navCollapsed` 决定，两种取值各测了两遍，**这是推断不是实测**，与 S2 自报的同一处口径一致 |
| **R16** `.shell-menu-anchor` 是 0×0 包含块 | `nav.css:87-90`，**W2-E**。我保留了 `.shell-menu-anchor{position:relative}`，他们的定位不会被我打断。⚠️ **给 W2-E 的提醒**：菜单现在以这个 wrapper 的 rect 为锚点，如果你们把 `.shell-tree-folder-add` 的定位从 0×0 锚点挪走、顺手改动 wrapper 的盒子，文件夹/文件菜单的落点会跟着变（不会被裁，碰撞检测兜底，但位置会挪）。改完请重跑 `e2e/fix-w1a.spec.ts` |
| `.shell-menu` 里的裸色值 `#dfe2e6` / `#34383c` / `#edf0f3` / `#9aa8b3` / `#5c6872` | 原样从 chrome.css 搬过来，一个字没改。归 **W3-I 令牌收敛**（93 处裸色值），现在动它等于替 W3-I 做一半 |

---

## 6. 四项验证的真实输出

### 6.1 `npx tsc --noEmit`

```
$ npx tsc --noEmit
TSC_EXIT=0
```

无输出，退出码 0。

### 6.2 `npx vitest run`

```
 Test Files  181 passed (181)
      Tests  1291 passed (1291)
```

全绿，**0 failed / 0 skipped**。

关于基线：任务书写的基线是 180 文件 / 1280 测试。现在是 **181 / 1291** —— 只增不减，
多出来的是 B/C/D 三条 track 本轮新加的测试（四条 track 共用一个工作区）。**没有测试被删。**

**并发干扰与隔离验证（必须记录）**：中途跑 vitest 出现过 `73 failed`，全部堆栈指向
`src/shell/agent/presenceLayout.ts:120`（B track 当时写到一半的未追踪新文件），凡是走
`renderShell()` 挂载 `<App/>` 的用例一律在 mount 处炸掉，包括我自己的 `chrome.test.tsx`。
为了不把别人的半成品算到自己头上、也不把自己的回归藏在别人的红里，我做了 A/B 隔离：

```
rsync 当前工作区 → /tmp/w1a-mine
cp -R /tmp/w1a-mine → /tmp/w1a-base
git show HEAD:src/shell/chrome/Menu.tsx   > /tmp/w1a-base/…/Menu.tsx
git show HEAD:src/shell/chrome/chrome.css > /tmp/w1a-base/…/chrome.css
rm /tmp/w1a-base/…/menu.css
```

同一份快照、只差我这三个文件，两边各跑一次：

| | 那次快照 | 最终快照 |
|---|---|---|
| BASE（W1-A 还原） | `11 failed / 1278 passed` | `181 files passed` |
| MINE（W1-A 应用） | `11 failed / 1278 passed` | `181 files passed` |

两侧**逐条相同**（11 条当时属于 B track 的 `AgentPresence`/`Composer`/`Hero` 与 D track 的
`ForceUpdateOverlay`；我还逐字对比了 `Composer.test.tsx` 那条的断言文本，两边都是
`expected length 1 but got 2`，同因同果）。结论：**W1-A 的回归数 = 0**，中途那 73 条与我无关。
等 B track 把 `presenceLayout.ts` 写完，工作区自己恢复到 181/1291 全绿。

### 6.3 新 spec `e2e/fix-w1a.spec.ts`

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3121 npx playwright test e2e/fix-w1a.spec.ts
  ✓  1 › S2-003 ModeMenu is fully visible on the collapsed rail and expanded (1.5s)
  ✓  2 › S2-002 sidebar settings menu is fully visible in C1-C4 (1.4s)
  ✓  3 › S2-001 folder context menu is fully visible wherever the tree exists (2.0s)
  ✓  4 › S2-001 file row menu, the instance the audit inferred rather than measured (542ms)
  ✓  5 › S2-004 FileTabs More menu stays inside the window (743ms)
  ✓  6 › S2-005 composer scope, permission and model menus in every placement (3.5s)
  ✓  7 › S2-006 a menu never grows past the room it has (478ms)
  ✓  8 › S2-007 a menu follows its anchor while the sidebar scrolls, then closes (894ms)
  ✓  9 › the panel is portalled inside #shell, not onto document.body (478ms)
  ✓ 10 › none of the four inner overflow containers is above an open panel (416ms)
  ✓ 11 › the keyboard contract S2-015 recorded as correct still holds (540ms)
  11 passed (13.1s)
```

**11 passed / 0 skipped。** 文件里没有任何 `test.skip` 语句、没有任何条件跳过
（唯一出现 "test.skip" 字样的地方是文件头注释，说明为什么这里不允许有它）。
覆盖了任务书点名的全部五项，且每项都比要求多测了几个组合：

- C1 的 ModeMenu ✓（另测 C2/C3/C9）
- C1/C2 的设置菜单 ✓（另测 C3/C4）
- C1 的文件夹右键菜单 ✓（另测 C2/C5/C6/C7/C8）
- C7 的 FileTabs 菜单 ✓（另测 C9）
- C5/C7 的 composer 三菜单 ✓（另测 C1/C2/C6/C8/C9/C10，共 24 个格子）

所有断言都落在 `expectNoClip`（`e2e/ui-audit-helpers.ts:84`）上，判据与 S2 原报告同源。
另外三条是结构断言：portal 宿主、裁切祖先链、键盘契约不回归。

一个被实测推翻的写法记在这里：第一版我用 `.shell-tree-file-more` 点开文件行菜单，
超时；探针测得 C1 折叠轨下 `.shell-tree-file-row` 的盒子是 **0×0**，用户根本右键不到，
所以文件行菜单只在 C2 覆盖，**没有把 C1 的不可达当成通过**。

### 6.4 重跑 `e2e/ui-audit-s2.spec.ts`

```
$ PLAYWRIGHT_BASE_URL=http://localhost:3121 npx playwright test e2e/ui-audit-s2.spec.ts
  17 passed (18.6s)
```

该 spec 是探针不是闸门（它只打印不断言），所以「17 passed」本身不证明什么 —— 有价值的
是它打印的 `S2-PROBE` JSON，已经在第 4 节逐条与修复前对照。汇总一句：

> **本分片 8 个 `<Menu>` 调用点 × 全部受测组合，`clippedBy` 全为 `null`、
> `offViewport` 全为 `false`、`clipped` 四边全为 0。**

`mention-*` 四个探针不变（`.shell-mention` 我没碰，仍是 `clippedBy:null`），
`toast-*`、`modal-*`、`tooltips` 三组探针与修复前一致（不属于 R1）。

### 6.5 截图

42 张，`docs/ui-audit-2026-09-19/fixes/W1-A/screenshots/`，与 S2 的命名规则同构
（`C{n}-W1A-{surface}.png`）。逐像素核过两张最严重的：

- `C1-W1A-mode-menu.png` —— 修复前只剩 44px 两个图标，现在 "Agent / Give a goal; edit
  alongside it" 与 "Editor / The document, full width" 两行完整可读，勾选态可见。
- `C1-W1A-settings-menu.png` —— 修复前 250px 只剩最右 40px，现在三行
  "Review changes / Enter sends / Full motion" 连副标题一起完整可读。

---

## 7. 给 Wave 4 闸门的两条现成素材

1. **浮层无裁切**：`e2e/fix-w1a.spec.ts` 可以直接当 SUMMARY 第 5 节第 1 条闸门的实现，
   已经是断言式、零 skip、覆盖 10 个组合中的 9 个（C4 只覆盖设置菜单，因为 editor 首页
   没有 composer、没有树）。
2. **portal 必须落在 `#shell` 内**（第 3 条闸门）：`fix-w1a.spec.ts` 里
   「the panel is portalled inside #shell」那条已经是它的最小实现 ——
   断言 `parentIsShell` 且 `fontFamily === shellFont`。C track 的 `overlayHost.ts`
   可以复用同一条断言，两边共用一个宿主 `#shell`。
