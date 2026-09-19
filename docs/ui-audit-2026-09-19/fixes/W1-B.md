# W1-B —— 悬浮 agent 面板

日期：2026-09-19 ｜ 分支：`develop/1.0`（**未 commit**，四条 track 并发）
根因：R2「悬浮面板的落点/钳位/贴边三套逻辑各自为政，且贴边规则选错了宿主」+ R13 的一半

---

## 1. 改了什么

### 新增

| 文件 | 作用 |
|---|---|
| `src/shell/agent/presenceLayout.ts` | **落点/钳位/贴边的唯一来源**。`placePresence()` / `defaultPresencePosition()` / `anchorPresence()` / `detectEdge()`，加 `CHROME_RESERVE`、`PRESENCE_MARGIN`、`safeArea` 通道 |
| `src/shell/agent/useViewportSize.ts` | 视口作为 state。原来 `useDraggable` 在回调里读 `window.innerWidth`，resize 无法靠自己重渲染，只能靠**写**持久化状态跟随——这正是 S4-015 的机制 |
| `src/shell/agent/useMeasuredSize.ts` | `ResizeObserver` 测量面板真实 box，取代常量 |
| `e2e/fix-w1b.spec.ts` | 14 个用例，**零 skip**（条件的也没有） |

### 修改

| 文件 | 改动 |
|---|---|
| `agent/useDraggable.ts` | 几何全部下放给 `presenceLayout`；新增 `viewport` / `placed` / `overhang` / `safeArea` 四个入参；resize 不再对「未摆放」的对象写盘；`onPointerDown` 的控件豁免不再把手柄自己算进去；新增 `onClickCapture` 吞掉拖拽尾随的 click |
| `agent/AgentPresence.tsx` | 面板尺寸改运行时测量；默认落点走 `defaultPresencePosition`；`safeArea` 接入侧栏宽度；停靠面板延迟到列收完才卸载；面板加 `data-dockable` |
| `agent/agent.css` | 四条 overhang 规则 + opacity + limbs + hover 全部加 `[data-expanded="false"]` 限定；`.shell-presence-panel` 的 `overflow:hidden` → `clip`，宽度改响应式；`.shell-presence-collapse` 的 46px 槽改成只在 `[data-dockable="true"]` 下生效 |
| `agent/AgentPresence.test.tsx` | 3 个用例改为等待交接完成（行为按 S6-003 有意改变），新增 2 个用例断言交接不变式 |

**没有碰**：`chrome/**`、`renderer/**`、`App.tsx`、`app.css`、`editor/**`、`canvas/**`、
`agent/TaskPanel.tsx`（期间被另一条 track 重写过，见第 5 节）。

---

## 2. 逐条 finding

### 关掉了（10 条）

| ID | 级别 | 修法 | 修复前 → 修复后（1280×800，C9） |
|---|---|---|---|
| **S4-001** | **P0** | `presenceLayout.CHROME_RESERVE = {width:132, height:40}`。任何**锚定后**顶边落在 40px 带内的对象，x 下限抬到 132 | 收起态标记贴顶：`{l:12,t:0}`，三颗红绿灯 `elementFromPoint` 全部返回 `header.shell-task-head is-grip` → **`{l:132,t:0,r:188,b:56}`，三颗全部 `reachable`**；展开面板贴顶 → `{l:60,t:48}`，整块在窗口栏**下方** |
| S4-004 | P1 | 展开态的「贴边」= 贴齐边缘且不透明，不再只是 `opacity:.82` 的幽灵 | `opacity 0.82`、面板 340px 全幅压在正文上 → **`opacity 1`**，右贴边 `{l:940,r:1280}`、左贴边 `{l:52}` |
| S4-005 | P1 | 四条 overhang 规则加 `[data-expanded="false"]`；展开态 overhang 恒为 0 | 面板内每个 `.shell-face` `matrix(0,-1,1,0,312,0)`、`right:1468 > 1440` → **全部 `transform:none`，rect 全在视口内**（e2e 断言覆盖 header + 每条回复的头像，≥2 个） |
| S4-007 | P1 | `.shell-presence-panel` 的 `overflow:hidden` → `clip` | `overflowY:hidden`，`panel.scrollTop = 240` 写得进去、焦点滚动把标题栏推出 36px → **`overflowY:clip`，`scrollTop` 写不进去恒 0** |
| S4-008 | P2（左半 + 顶半） | 顶边：面板落在 `y=48`（窗口栏之下）；左边：`safeArea.left = 侧栏宽度` | 顶边 `{t:0}` 压住 FileTabs；左边 `{l:0,r:340}` 盖住整条侧栏 → **顶边 `{t:48}`；左边 C9 `{l:52}`、C10 `{l:190}`，侧栏 `right` 与面板 `left` 逐值相等** |
| S4-011 | P2 | `data-dockable` 驱动 `right: 16px / 46px` | editor 下 `gapToPanelEdge = 46`（30px 死区）→ **editor = 16，agent = 46**（e2e 两边都断言） |
| S4-012 | P2（部分） | 面板宽度 `min(340px, max(272px, calc(100vw - 940px)))` | 1024 宽下 340px（占画布 32%）→ **272px**；1280/1440 不变仍 340 |
| S4-015 | P3 | resize 只钳「摆过的」；未摆放的默认值每次从 viewport 重新推导 | 1280×720 加载一次即把 `{x:916,y:172}` 写进 localStorage，放大到 1440×900 后停在原坐标 → **`presence.x/y` 保持 `null`，面板落在 `right=1416, bottom=872`（= 1440-24 / 900-28）** |
| **S6-011** | P1 | `useMeasuredSize` 运行时测量，取代 `PANEL_SIZE.height = 520` | 声明 520 / 实测 543，拖到角落 `bottom` 超视口 15px → **测量值喂给全部三个消费点；e2e 先把对话撑到 >520px 再拖，四条边 rect 全部在视口内** |
| S6-012 | P1 | 同 S4-005 | `.shell-face` `{l:1268,r:1308}`（超视口 28px）→ **面板内所有头像 `transform:none`** |
| **S6-003** | P1 | 停靠面板留到列收完（200ms，或 `transitionend` 提前结束；`prefers-reduced-motion` 下为 0），同期压住悬浮面板 | 0ms 帧：320px 空列 + 右侧满不透明度的悬浮面板 → **逐帧采样 60+ 帧，`columnWidth>8 && !columnFilled` 的帧数 = 0，`columnWidth>8 && floating` 的帧数 = 0，`.shell-task` 计数恒 1** |

> 表里 11 行 + 下面 S6-015 的部分收敛。

### 顺带发现并修掉的（不在清单里）

- **收起态标记根本拖不动**：`useDraggable.onPointerDown` 的 `closest("button, a, input, textarea, select")`
  豁免把**手柄自己**也算了进去——`.shell-presence-face` 就是一个 `<button>`。于是那个最可能压在红绿灯上的
  对象，唯一的移动方式是先用键盘聚焦再按方向键。改成 `control !== event.currentTarget`。
  顺带补 `onClickCapture`：拖完松手后 `dragging` 已经是 false，click 会把标记重新展开。
  **这一条不修，S4-001 的回归断言就是空的**（测不到收起态那条路径）。

### 没关掉（逐条说明）

| ID | 为什么 |
|---|---|
| **S4-002** | 需要编辑器上报安全区。默认落点压住的是 xlsx 的工作表标签条 / pptx 的 statusbar / docx 的标尺，这些矩形只有嵌入编辑器知道，`editor/canvasContract.ts` 没有回传通道，而那个文件归 **Wave 3-H**。本轮做到的是：落点逻辑收敛成 `presenceLayout` 一个来源，并把 `safeArea: Insets` 作为形参一路打通（`placePresence` / `defaultPresencePosition` / `useDraggable`），侧栏宽度已经用这个通道接上去当样例。**W3-H 只需要把 canvas 的 insets 填进 `AgentPresence.tsx` 的 `safeArea` memo，其余零改动。** |
| **S6-015** | 同上。画布遮挡比例只随 S4-012 的宽度收窄小幅下降，没有真正让位 |
| **S4-012（余量）** | 只收窄了宽度（1024 下 340→272）。「窄窗口自动折叠 / 自动让位」是产品决策，没有拍板，不自行发明 |
| **S4-008（右/下两条边 + z-index）** | 收起态标记贴左/贴下仍然会压在侧栏或状态栏上 28px——那是「角色挂在窗口边上」的设计本身。真正的根因是四个文件里四个互不知情的 z-index 魔数（`agent.css:200`、`chrome.css:60/3`、`composer.css:180`、legacy 1000-1200），SUMMARY 已把统一层级表排给 **W3-I** |

---

## 3. 一处与 SUMMARY 方案不同的取舍（需要知会）

SUMMARY 的 W1-B ③ 写的是「贴边选择器从 `.shell-face` 改成**面板本身**」——照做的话，
展开态面板会被 `translate(312px)` 推出窗口，只留 28px。

**没有照做。** 两个理由：

1. 交给我的验收断言写的是「展开态贴边时，面板内所有 `.shell-face` 的 rect 都在视口内」。
   把面板整体推出去，面板内的头像必然出视口——两条要求直接冲突。
2. 340px 宽的面板只露 28px，既不可读也不可辨认；而 56px 的标记挂在窗口边上是原型里成立的
   设计。overhang 这个概念只对标记有意义。

落地的语义是：`placePresence` 多一个 `overhang` 参数——**标记挂出去，面板贴齐**。
展开态贴边 = 贴齐窗口（或侧栏）边缘 + 保持满不透明度，`data-edge` 仍然记录是哪条边
（所以 resize 之后它还黏在那条边上）。四条 overhang CSS 规则原样保留，只是加了
`[data-expanded="false"]` 限定，收起态行为逐值不变（e2e 用例 7 专门守这一条）。

---

## 4. 四项验证的真实输出

### 4.1 `npx tsc --noEmit`

```
TSC_EXIT=0
```
（无输出即无错误。基线同样为 0——`officedex` 仓库的 tsc 是干净的，可以当闸门。）

### 4.2 `npx vitest run`

```
 Test Files  181 passed (181)
      Tests  1291 passed (1291)
```

基线（21:56，本 track 改动前）：`180 passed (180)` / `1280 passed (1280)`。

差额 +1 文件 / +11 用例，其中**本 track 贡献 +2**（`AgentPresence.test.tsx` 11 → 13）。
另外 +1 文件 / +9 用例来自并发 track：期间 `develop/1.0` 落了 commit `01f17f6`
（重写 `agent/TaskPanel.tsx` 的文件卡 + 新增 `agent/TaskPanel.test.tsx` 3 个用例），
以及 W1-C/W1-D 对 `renderer/**` 的改动。**没有任何用例减少，没有任何 skip。**

> 一次瞬时失败记录在案：全量跑中 `src/renderer/screens/HomeScreen.test.tsx > deletes a
> local PPT template after confirmation` 失败过一次；单独重跑 `32 passed`，随后全量重跑
> `181/1291 passed`。该文件在 W1-C 的 `renderer/ui/**` 改动范围内，判断为并发写入造成的
> 瞬时状态，非本 track 引入——**但这是判断，不是证明**，如果它在合入后复现，应归 W1-C 查。

### 4.3 `e2e/fix-w1b.spec.ts`（14 用例，0 skip）

```
npx vite --port 3122 --strictPort
PLAYWRIGHT_BASE_URL=http://localhost:3122 npx playwright test e2e/fix-w1b.spec.ts
```

```
  ✓  1 … expanded panel tucked to the top leaves all three controls hittable (1.1s)
  ✓  2 … collapsed mark tucked to the top leaves all three controls hittable (1.6s)
  ✓  3 … dragged into the bottom-right corner, the panel stays inside the window (4.9s)
  ✓  4 … the same holds at every edge, not just the corner (6.9s)
  ✓  5 … every avatar inside a tucked panel stays in the viewport and untransformed (4.9s)
  ✓  6 … a parked panel is fully opaque, not a ghost over the document (1.0s)
  ✓  7 … the collapsed mark still hangs off the edge (1.6s)
  ✓  8 … moving focus inside the panel never scrolls it (349ms)
  ✓  9 … scrollTop cannot be written (345ms)
  ✓ 10 … agent → editor never shows two task panels, or none (1.2s)
  ✓ 11 … undocking never shows two task panels, or none (1.2s)
  ✓ 12 … the collapse key only steps aside where a dock button exists (534ms)
  ✓ 13 … a narrow window gets a narrower panel (557ms)
  ✓ 14 … an unplaced panel follows the window instead of being written down (647ms)
  14 passed (27.1s)
```

要求的四条断言分别是用例 1/2（S4-001 反向断言，`elementFromPoint` 打三个控件中心）、
3/4（S6-011，`bottom <= innerHeight`）、5（S4-005/S6-012，面板内全部 `.shell-face`）、
8/9（S4-007，`scrollTop === 0` 且写不进去）；第 4 项（切模式那一帧只有一个 TaskPanel）
是用例 10/11。

### 4.4 红→绿对照（同一份 spec 跑在未修复的代码上）

把 `agent/` 的 4 个改动文件 `git checkout` 回去、3 个新文件移走，原样重跑：

```
  ✘  1 …  ✘  2 …  ✘  3 …  ✘  4 …  ✘  5 …  ✓  6 …  ✘  7 …
  ✓  8 …  ✘  9 …  ✘ 10 …  ✘ 11 …  ✘ 12 …  ✘ 13 …  ✘ 14 …
  12 failed / 2 passed
```

**两条在旧代码上也是绿的，必须说清楚**：

- 用例 6（贴边后 `opacity === 1`）：旧代码把面板拖到右缘时 `detectEdge` 实际选中的是
  `left`（旧实现里 `top` 距离用的是 `y - 40` 的魔数，且四条距离并列时按数组序取），
  于是这条断言没打到它想打的状态。它是围栏，不是证据；S4-004 的证据是用例 5 与上表的
  `opacity 0.82 → 1` 实测。
- 用例 8（焦点移动不滚动面板）：S4-007 原始复现要开 composer 的模型菜单（绝对定位的菜单
  会撑大 `scrollHeight`），单纯 `.focus() + scrollIntoView()` 撑不破。而 W1-A 正在把菜单
  portal 到 `document.body`，那条复现路径本身会消失。**真正有判别力的是用例 9**
  （`overflowY === "clip"` 且 `scrollTop` 写不进去），它在旧代码上是红的。

另：S6-011 的原始数值（543 vs 520）在当前 fixture 下**已经复现不出来**——并发 track 改写
`TaskPanel` 的文件卡之后，C9 初始面板只有 417px（实测 1280×800 / 1440×900 均为 417，
1024×700 为 435）。所以用例 3/4 先通过 composer 跑一轮真任务把对话撑到 >520px
（`growConversation`，并显式断言 `height > 520` 作为前提），否则测试会在坏代码上一起变绿。
第一版正是这样——记录在此，因为这就是「把跳过/空转当通过」的另一种形态。

---

## 5. 给其它 track 的话

1. **`agent/TaskPanel.tsx` 在本 track 工作期间被改写并 commit（`01f17f6`）。**
   我没有碰它，改动也不冲突（`TaskPanel` 的 props 没变），但文件所有权表上它归 B track，
   实际却由别人动了。后果是 S6-011 的基线数值失效（见 4.4）。
2. **`chrome/menu.css` 已经被 W1-A 拆出来**，我的 e2e 用例 10 用 `ModeMenu`
   （`role="menuitemradio"`, name `Editor`）驱动模式切换。若 A track 改了菜单项的 role 或
   可访问名，这条会红——不是 B 的退化。
3. **W3-H 的接口已经留好**：`AgentPresence.tsx` 里的 `safeArea` memo 是唯一的填入点，
   `presenceLayout` 的四个函数已经全程带着它。填进去即可关掉 S4-002 / S6-015。
4. **W3-I 的 z-index 层级表**要收掉 `agent.css` 的 `z-index: 200`（S4-008 的真根因）。
