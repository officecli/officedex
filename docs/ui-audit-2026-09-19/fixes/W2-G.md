# W2-G 设置状态 —— 修复报告

日期：2026-09-19 ｜ 分支 `develop/1.0` ｜ 起点 `df66a33`（Wave 1 六笔之后）
关掉：**R7 的 3 条** —— S7-002（P0）、S7-003（P1）、S7-004（P1）
**未 commit**（三条 track 并发中）

---

## 1. 改了什么

| 文件 | 状态 | 内容 |
|---|---|---|
| `src/shell/composer/settingsStore.ts` | **新建** | 按 port 键控的共享 store，`subscribe` / `getSnapshot` / `load` / `patch` / `reloadModels` |
| `src/shell/composer/useComposerSettings.ts` | 重写 | 从「每个调用点一份 `useState`」改成 `useSyncExternalStore`；新增窄订阅 `useReduceMotion()` |
| `src/shell/App.tsx` | 改 2 处 | 引入 `useReduceMotion()`；`<AttentionBorder>` 补 `reducedMotion` prop |
| `src/shell/composer/useComposerSettings.test.tsx` | **新建** | 7 条单测，根因本身的闸门 |
| `e2e/fix-w2g.spec.ts` | **新建** | 4 条 e2e，无任何 `test.skip` |

**对外形状没变。** hook 仍然返回 `{ value, models, patch, reloadModels }`，5 个消费方
（`Sidebar.tsx:22`、`Composer.tsx:150`、`Hero.tsx:34`、`Highlights.tsx:83`、`useAgentTask.ts:25`）
**一行都不用改**。唯一的签名变化是 `patch` 从 `Promise<void>` 变成 `Promise<boolean>`，
`void settings.patch(...)` 这个调用形式不受影响。

---

## 2. 选了哪种状态方案，为什么

**模块级 store + `WeakMap<UiPort, SettingsStore>` + `useSyncExternalStore`。**
没有 provider，没有 Context，不碰 `ShellContext`。

### 为什么不是 Context provider

两条理由，都是冲着这个缺陷本身去的：

1. **provider 会被忘掉，store 不会。** 走 Context 就得在 `main.tsx`、
   `src/shell/test/renderShell.tsx`、以及将来任何一个渲染入口上方各挂一次。挂漏了只有两种
   下场：运行时抛错，或者——如果 hook 写得「宽容」——**静默退回自己那份私有副本**，那正是
   这次要修的 bug 的新实例。按 port 键控之后，「一个 port 两份真相」在结构上不可能发生，
   因为根本没有可以忘记接的线。单测里专门有一条 `keeps two ports apart` 钉住这点。
2. **重渲染面积。** 5 个消费方分散在 5 个不同子树（侧栏 footer、composer、hero、
   功能货架、任务 hook），provider 只能挂在根上，于是**每次改设置都重渲染整个应用**。
   `useSyncExternalStore` 只唤醒真正订阅了的组件；`useReduceMotion()` 进一步把 `App` 的
   订阅收窄到一个 boolean，所以「加了个自定义模型」不会顺带重画整个壳。

（如果将来一定要改成 Context：provider 必须挂在 `App` 之上而不是之内，并且要同时给
`renderShell.tsx` 加，否则单测会在一个与生产不同的树形上绿。）

### 为什么不扩 `ShellContext`

任务里已经禁止，这里补上理由：`ShellContext` 是**这一个窗口的视图状态**，由壳自己
`persist.ts` 写 localStorage；这五个字段是**工作区偏好**，活在 port 后面，要跨设备、
要被服务侧读到。同一个词，不同生命周期、不同 owner。

### 为什么键控在 port 对象上

port 对象就是「这条工作区连接」的身份，一个 port 一个 store = 一个工作区一份偏好。
测试每次 `createFakePort()` 都是新对象，所以**不需要 reset 钩子**，也不会有一个测试的
偏好泄漏到下一个。WeakMap 让 port 被回收时 store 跟着走。

---

## 3. `port.settings.patch` 的失败路径

**问题**：改之前是 `setValue(optimistic)` 然后 `setValue(await port.settings.patch(next))`。
失败时 promise reject，而 5 个调用点全是 `void settings.patch(...)` ——
于是结果是**乐观值留在屏幕上 + 一条 unhandled rejection + 用户什么也没看见**。
控件显示的是一个端从未接受过的值，这和 S7-002 是同一种撒谎，只是换了个方向。

**现在的行为**（`settingsStore.ts` 的 `patch`）：

1. 先乐观应用（一个刚被按下的开关不能等一个来回，否则手感就是坏的）；
2. 成功 → 用端返回的权威值覆盖；
3. 失败 → **只回滚这次调用碰过的字段**，然后 `reportPortFailure(reason)` 出 toast + 写日志；
4. **永不 reject**，返回 `Promise<boolean>` 表示端是否接受。

「只回滚碰过的字段」不是洁癖：两个开关可能同时在飞（设置菜单一直可点），整份快照回滚会
**悄悄把另一个成功的改动也撤掉**。单测 `rolls back only the field it tried to change` 钉住了它。

另外两处同类处理：

- **初始读失败**：原来是 unhandled rejection + 所有人停在 fallback 且一声不吭。现在
  `reportPortFailure` 并把 `#load` 重置回 `idle`，下一个挂载的组件会重试。
- **初始读与 patch 赛跑**：`#patched` 标志保证一个慢 `settings.get()` 落地时不会把用户刚
  选的值盖回去——那个症状看起来和本次要修的 bug 一模一样。

---

## 4. 关掉的三条

| 编号 | 级别 | 断言证据（e2e 实测输出） |
|---|---|---|
| **S7-002** | **P0** | 从 composer 点一次 Enter sends 后，侧栏读到 `{"label":"Enter adds a line","checked":"false"}`（S7 当时是 `checked:"true"` 没变）。反向同样成立 |
| S7-003 | P1 | 同一挂载内切 Reduced motion：`baseline {twoFrames:1, settled:337}`（动画）→ `sameMount {twoFrames:337, settled:337, instant:true}`（瞬时）。S7 当时 sameMount 是 `1/337` |
| S7-004 | P1 | C5 工作区 `.shell-workspace .shell-attention`：切换前 `moved:true` → 切换后 `moved:false`。S7 当时永远 `true` |

「同一挂载内」不是假设而是断言：两条动画类用例在测量前给 DOM 节点打 `data-w2g-mark`，
切换后校验戳还在——**重挂载会让坏的实现看起来是好的**，S7 当初正是靠这个把两者分开的。

---

## 5. 需要改但不归我的消费方清单

以下**一处都没动**，留给汇总/后续 wave：

| # | 位置 | 事实 | 建议 |
|---|---|---|---|
| 1 | `composer/Composer.tsx:695-699` | composer 的 Enter 行是裸 `menuitem`、无 `aria-checked`，状态写在 label 后缀（`· on` / `· off`）里；侧栏那行是 `menuitemradio` + `aria-checked`。**屏幕阅读器在 composer 里读不出开关状态**（S7-012） | 给这一项加 `checked: settings.value.enterToSend`，`Menu.tsx` 会自动升级成 `menuitemradio`。同时统一两处文案与副标题（`Shift + Enter **always** adds a line` vs `Shift + Enter adds a new line`） |
| 2 | `chrome/Sidebar.tsx:99-124` + `Composer.tsx:667-690` | `Review changes` 同名不同义（侧栏是开关，composer 是三档权限之一），两处按下弹同一句 toast | 产品决策，不是技术债；本轮不动 |
| 3 | `home/Hero.tsx:34`、`home/Highlights.tsx:83` | 现在通过共享 store 已经正确，但它们各自取的是整个 `useComposerSettings()`，只用到 `reduceMotion` | 可改成 `useReduceMotion()` 缩小订阅面。**不是 bug，是优化**；我没动是因为不归我 |
| 4 | `tokens.css:94`、`taskList.css:103`、`composer.css:288`、`agent.css:175/289/526` | **6 处 CSS 动画完全不受这个应用内开关管辖**，只认系统 `prefers-reduced-motion`。这是 S7-003 里「CSS 也没兜住」的那半 | 需要在 `#shell` 上挂 `data-reduce-motion`（`App.tsx` 我可以加）**并且**改这 6 个 CSS 文件加上对应选择器。我**故意没有单独加那个 attribute**——一个没有消费方的 `data-*` 正是本次普查点名过的味道（`data-loaded` 无消费）。建议整包丢给 **W3-I 令牌收敛**，那一波本来就要动所有 CSS |
| 5 | `agent/attentionOverlay.ts:268` | `setReducedMotion` 机制本身是好的（e2e 已证），无需改动 | — |

---

## 6. 四项验证的真实输出

> 这个工作树有另外两条 track（W2-E 改 `nav/**`、W2-F 改 `chrome/**`）在并发写。
> 我先在一个干净的隔离 worktree（`git worktree add --detach HEAD`，只拷进我的 4 个文件）
> 里取了断言式结果，再回共享树复跑。两组都给出。

### 6.1 `npx tsc --noEmit`

**隔离 worktree（HEAD + 仅我的改动）**
```
TSC_EXIT=0
```
（无输出）

**共享树（含 W2-E / W2-F）** —— 第一次跑时有两条红，**都不是我的**：
```
src/shell/agent/TaskPanel.tsx(132,16): error TS2304: Cannot find name 'OutlineList'.
src/shell/chrome/FileTabs.tsx(306,17): error TS2304: Cannot find name 'notBuiltYet'.
```
等对方补完 import 后复跑：
```
TSC_EXIT=0
```

### 6.2 `npx vitest run`

**基线（隔离 worktree，纯 HEAD）**
```
 Test Files  1 failed | 181 passed (182)
      Tests  1 failed | 1293 passed (1294)
```
基线条数 **1294 对上**。那 1 条红是 `src/canvas/PresentationCanvas.test.tsx >
PresentationCanvas selection > reports nothing selected as nothing to quote`
（`expected last "spy" call to have been called with [ null ]`）——**HEAD 自带、与 shell 无关，
且在随后的每一次运行里都绿，属抖动**。

**隔离 worktree + 我的改动**
```
TSC_EXIT=0
VITEST_EXIT=0
 Test Files  183 passed (183)
      Tests  1301 passed (1301)
```
1294 + 7（我的新单测）= 1301，**条数只增不减，零失败**。

**共享树最终复跑**（此时 W2-E/W2-F 的红已被对方修掉）
```
VITEST_EXIT=0
 Test Files  183 passed (183)
      Tests  1308 passed (1308)
```
1294 + 7（我）+ 7（另两条 track）= 1308。

> 中途共享树曾有 56 条红，我做过隔离判断：其中 **55 条是同一个
> `TypeError: current?.scrollIntoView is not a function`（`chrome/FileTabs.tsx:122`，jsdom 无此方法）**，
> 剩 1 条是 `notImplemented.test.tsx` 等 Share 的 "Not built yet"。两者都在 `chrome/**`，归 W2-F。
> 隔离 worktree 里只带我的改动时 1301/1301 全绿，即**没有一条红能算到我头上**，
> 我也没有藏在这些红里——上面的绿是隔离跑出来的。

### 6.3 `e2e/fix-w2g.spec.ts`

dev server：`npx vite --port 3133 --strictPort`（自起自停，已停；没碰 3131/3132）。
**全文无 `test.skip`**，条件的也没有。

先证它在**没有修复时是红的**（隔离 worktree 里把我的 3 个源文件还原成 HEAD，HMR 后原地跑）：
```
W2G-ENTER-SYNC composer->sidebar {"label":"Enter sends","checked":"true"}     ← S7-002 原样复现
  ✘  1  S7-002 the two Enter sends menus agree, in both directions
W2G-MOTION baseline   {"twoFrames":1,"settled":337,"instant":false}
W2G-MOTION sameMount  {"twoFrames":1,"settled":337,"instant":false}           ← S7-003 原样复现
  ✘  2  S7-003 Reduced motion reaches the carousel in the same mount
W2G-ATTENTION before {"moved":true}
W2G-ATTENTION after  {"moved":true}                                           ← S7-004 原样复现
  ✘  3  S7-004 the workspace attention border obeys Reduced motion
  ✘  4  a preference set in the workspace is already set on Home
  4 failed
```

把修复放回去：
```
W2G-ENTER-SYNC composer->sidebar {"label":"Enter adds a line","checked":"false"}
W2G-ENTER-SYNC sidebar->composer "Enter sends · on"
  ✓  1  S7-002 the two Enter sends menus agree, in both directions (890ms)
W2G-MOTION baseline   {"twoFrames":1,"settled":337,"instant":false}
W2G-MOTION sameMount  {"twoFrames":337,"settled":337,"instant":true}
  ✓  2  S7-003 Reduced motion reaches the carousel in the same mount (2.8s)
W2G-ATTENTION before {"moved":true}
W2G-ATTENTION after  {"moved":false}
  ✓  3  S7-004 the workspace attention border obeys Reduced motion (1.3s)
  ✓  4  a preference set in the workspace is already set on Home (808ms)
  4 passed (6.1s)
```

**共享树上（含 W2-E / W2-F 的改动）复跑，同样 4 passed**，数值逐条一致。

截图：`docs/ui-audit-2026-09-19/fixes/W2-G/screenshots/`
`C2-W2G-enter-sync.png` · `C2-W2G-motion-same-mount.png` · `C5-W2G-attention-reduced.png`

### 6.4 单测（根因本身）

`src/shell/composer/useComposerSettings.test.tsx`，7 条全绿：

```
 ✓ one settings store per port > shows a patch from one caller in another, with no remount
 ✓ one settings store per port > reaches a caller that subscribed to one field only
 ✓ one settings store per port > reads the port once however many callers there are
 ✓ one settings store per port > keeps two ports apart
 ✓ a patch the port refuses > rolls the control back rather than leaving the optimistic value on screen
 ✓ a patch the port refuses > says so, instead of swallowing it
 ✓ a patch the port refuses > rolls back only the field it tried to change
```

两个 hook 调用点是**兄弟**而不是父子，因为父传子那种排布从来就没坏过——坏的是树的两个
分支各自去问 hook。`reads the port once` 那条顺带钉住了旧实现的另一个副作用：一次挂载
读 5 遍同样的两个端点。

---

## 7. 一处失误（已与 W2-F 对账）

清理自己的临时文件时，我在仓库根目录误删了 **W2-F 的未跟踪文件 `w2f-probe.mjs`**。
未跟踪，无法从 git 恢复。已通过 SendMessage 告知 W2-F。

**W2-F 回复：不用补** —— 那是一次性探针，产出已固化进 `e2e/fix-w2f.spec.ts` 的断言里。
教训照记：只删自己明确创建的文件。

除此之外我没有改动任何不属于我的文件。

---

## 8. S2-006 flake 的排查（W2-F 报来，与我相邻）

W2-F 报 `e2e/fix-w1a.spec.ts:155 S2-006` 在整批跑时偶发 60s 超时（等 `.shell-cx-scope` 的
`.shell-menu`），并指出触发点在 composer 工具条、与我的 track 沾边。

**实测 0/3 复现**：共享树（含双方全部改动）+ 3133，
`fix-w1a + fix-w1c + fix-w2f + fix-w2g` 整批连跑 3 次，每次 `35 passed`，
S2-006 用时 **477ms / 506ms / 529ms** —— 离 60s 超时差两个数量级。

**机制上的怀疑点**（交给 W1-A/汇总，`fix-w1a.spec.ts` 不归我，未动）：
该用例是**纯键盘开菜单**

```ts
await trigger.focus();
await page.keyboard.press("ArrowDown");
await page.locator(MENU).waitFor();
```

ArrowDown 只有打在 `.shell-cx-scope` 上才触发 `Menu.openAt`。只要 `focus()` 与 `press()`
之间焦点被挪走（整批跑时加载时序不同、composer textarea 的 autofocus、或任何挂载后的
异步 setState 落地），这一按就丢了，`waitFor` 随后空等满 60s —— 症状与描述吻合。
一行加固可把 60s 空等变成秒级且指名道姓的失败：

```ts
await expect(trigger).toBeFocused();   // 插在 press 之前
```

**我这边是否沾边**：本次改动让设置读取从「5 个实例各自 async setState」变成
「per-port store 只 emit 一次」，挂载后的异步 setState 次数**只减不增**；而
`open()` 等待的 `data-loaded` 改前改后都不覆盖设置读取，所以那个时序窗口不是我新开的。
但也不能据此断言无关 —— 上面 0/3 的实测是目前能给的全部证据。

---

## 9. 给 Wave 4 闸门的建议

`e2e/fix-w2g.spec.ts` 可以直接当 R7 的回归防线（不需要 bridge，只要 dev server）。
真正该进闸门的是那条单测里的 **`reads the port once however many callers there are`** ——
它是「偏好唯一真相源」这条规则最便宜的表达：一旦有人再引入第二份 `useState`，
读端计数立刻从 1 变成 N，不需要开任何菜单就能红。
