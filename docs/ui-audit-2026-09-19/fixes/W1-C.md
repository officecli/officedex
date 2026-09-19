# W1-C — legacy 浮层与令牌桥

日期：2026-09-19 ｜ 分支：`develop/1.0`（**未 commit**，四条 track 并发共用工作树）
根因：**R3 + R11** ｜ 目标 13 条，**关掉 12 条，1 条部分**

---

## 1. portal 方案：选 (a)，overlay 挂进 `#shell`

**决定：(a) 四个 portal 改挂 `#shell` 内的一个 layer。不做 (b)。**

理由，按权重排：

1. **(b) 在文件所有权内不可行，而且会静默失效。** 桥的每一行都是
   `--od-ink: var(--shell-ink)` 这种形式，而 `--shell-*` 本身声明在
   `src/shell/tokens.css:15` 的 `#shell` 上。把桥块提到 `:root` 之后，
   `var(--shell-ink)` 在 `:root` 处**未定义** → 该自定义属性取 guaranteed-invalid
   → 等于没写。要让 (b) 真正生效，必须把整张 `--shell-*` 表（15-92 行）一起提到
   `:root` —— 那是我不拥有的段，且会把 `#shell[data-doc-type]` 覆盖与
   `prefers-reduced-motion` 块的特异度关系一起改掉。
   （附带核实：legacy 确实碰不到 `src/shell/tokens.css` —— 它只被 `src/shell/main.tsx:34`
   import，legacy 入口是 `src/renderer/main.tsx`。所以 (b) 对 legacy 无害这一条成立，
   但它不成立的原因在别处。）
2. **A track 面临同一个选择，而 (a) 是唯一能让两边一致的答案。** `.shell-menu` 用的是
   `--shell-*`；A 若 portal 到 `document.body`，Menu 会掉进和 S5-001 一模一样的坑
   （`--shell-ink`/`--shell-row-h`/`--shell-radius-*` 全部失效）。已把 `overlayHost()`
   的用法发给 W1A。
3. **SUMMARY 第 4 波闸门第 3 条写的就是「portal 必须落在 `#shell` 内」。** 选 (b) 会让
   那条闸门变成反向的。

### 实现

新文件 `src/renderer/ui/overlayHost.ts`，导出 `overlayHost()` / `setOverlayHost()`
（也从 `src/renderer/ui/index.ts` 导出）。解析顺序，先命中先用：

| | 宿主 | 用途 |
|---|---|---|
| 1 | `setOverlayHost(el)` 传入的元素 | 显式、可测的路径；host 应优先用这个 |
| 2 | `[data-od-overlay-host]` | 给「首个浮层打开前没机会跑代码」的 host 的标记 |
| 3 | `#shell` | 应用自己的令牌作用域。对 legacy 是 no-op（那边没有这个 id） |
| 4 | `document.body` | legacy 与测试环境，**与改动前逐字节相同** |

1-3 命中时，浮层进入挂在该宿主下的 `div.od-overlay-layer`（`display: contents`），
所以宿主自己的子元素布局不变，宿主的 React 树也不必在一串外来节点中间做 reconcile。
四个浮层本身都是 `position: fixed`，宿主只决定它们**继承谁的自定义属性**，不决定落点 ——
这一点在 spec 里有断言（popover 距锚点仍是 8px，横向漂移 < 1px）。

四个 portal 点改完：`Modal.tsx:29`、`dialog.tsx:86`、`Popover.tsx:98`、`toast.tsx:151`
（toast 仍优先用 `ToastViewport`，只是兜底从 body 换成 `overlayHost()`）。

---

## 2. 逐条对账

| finding | 级 | 状态 | 改在哪 |
|---|---|---|---|
| **S5-001** portal 到 body，`--od-*` 桥整体失效 | **P0** | ✅ 关 | 新 `overlayHost.ts` + 四个 portal 点 |
| **S7-006** 同上（S7 的实测版本） | P1 | ✅ 关 | 同上 |
| **S4-013** portal 落 body 继承 legacy 字体栈 | P2 | ✅ 关 | 同上 + `.od-dialog` 补 `font` |
| **S2-012** `Modal` Esc 不关 / 点遮罩不关 / Tab 走出 `aria-modal` | P1 | ✅ 关 | 新 `useModalBehaviour.ts`；`Modal.tsx`、`dialog.tsx` 接入 |
| **S7-008** 同上（Tab 第 8 下摸到「关闭窗口」） | P1 | ✅ 关 | 同上 |
| **S3-004** `Select` 选项行无类名，UA 按钮样式透出 | P1 | ✅ 关 | `Select.tsx:36` 补 `od-menu__item` + `data-selected`；`components.css` 的 `.od-menu__item` 补 `font-family` |
| **S7-005** `.od-input` 无 width，4 个输入框只有 173px | P1 | ✅ 关 | `components.css` 的 `.od-dialog`/`.od-form-item` 控件宽度 + `.od-input` 字号 |
| **S2-008 / R11** toast 盖住并拦截 3 个标签 | P1 | ✅ 关 | `.od-toast-host` 的 top 改吃 `--od-toast-inset-top`；shell 桥里设 `calc(var(--shell-windowbar-h) + 8px)` |
| **S2-013 / S4-013** `.od-dialog` 无 font-family，计算值 `Times` | P2 | ✅ 关 | `.od-dialog` 补 `font: 400 14px/22px var(--od-font-ui)` |
| 字体栈缺 `Microsoft YaHei` 回退 | P2 | ✅ 关 | `renderer/ui/styles/tokens.css` 的 `--od-font-ui` |
| **S2-013** 一个弹窗里 16 / 14 / 13.33 三档字号 | P2 | ⚠️ **部分** | 13.333px（UA 默认）已消除 → 现在只有 16 / 14 两档。见第 5 节 |
| **S7-009** 明文 apiKey 进 DOM `value` | P2 | ✅ 可用，待接线 | `PasswordInput` 已核实可用，`ModelMenu.tsx` 不归我。见第 4 节 |
| **S7-007** 设置表单用原生 `<select>` | P2 | ❌ 不关 | `ModelMenu.tsx:238-249` 不归我；`Select` 这一侧已修好可用。见第 4 节 |

---

## 3. 修复前后的 computed 值（实测，1280×720，fixture 3123）

「前」这一列不是抄 S5/S7 的旧记录：`document.body` 今天仍然是库默认值，而那正是 portal
改动前浮层取到的作用域，所以同一次运行里就能读出这一对。toast 那行是把
`--od-toast-inset-top` 在运行时改回 16px 复现的。

### 3.1 令牌（New folder 弹窗，C2）

| 令牌 | 前（`document.body`） | 后（`.od-dialog`） | 桥期望 |
|---|---|---|---|
| `--od-radius-dialog` | `8px` | **`10px`** | 10px ✅ |
| `--od-radius-control` | `4px` | **`5px`** | 5px ✅ |
| `--od-control-md` | `32px` | **`36px`** | 36px ✅ |
| `--od-button-primary-bg` | `#000000` | **`#41464b`** | #41464b ✅ |
| `--od-guidance` | `#5da4e3` | **`#596f86`** | #596f86 ✅ |
| `--od-surface-muted` | `#f7f7f7` | **`#f5f6f8`** | ✅ |
| `--od-border-subtle` | `#41464b1a` | **`#e4e6e9`** | ✅ |

### 3.2 可见后果

| 量 | 前 | 后 |
|---|---|---|
| `.od-dialog` 圆角 | 8px | **10px** |
| `.od-dialog` `font-family` | **`Times`** | **`PingFang SC`** |
| 主按钮 `background-color` | **`rgb(0,0,0)`** | **`rgb(65,70,75)`**（= shell 发送按钮） |
| 主按钮 `min-height` | 32px | 36px |
| `.od-input` 宽 | **173px**（UA `size=20`），行宽 430 → 空 59.8% | **370px** = `.od-dialog__content` 的 370px，空 0 |
| `.od-input` 高 / 圆角 / 字号 / 边框 | 32px / 4px / **13.333px** / `#41464b1a` | 36px / 5px / **14px** / `#e4e6e9` |
| portal 落点 | `body > .od-dialog-mask` | `#shell … > .od-overlay-layer > .od-dialog-mask` |

### 3.3 `Select` 选项行（EditorHome，C4）

| 量 | 前（S3-004 实测） | 后 |
|---|---|---|
| `className` | **`(none)`** | **`od-menu__item`** |
| `border-style` / `width` | **`outset` / `2px`** | `none` / `0px` |
| `background` | `rgb(239,239,239)` | 透明（选中行 `--od-guidance` 8%） |
| `font-family` / `font-size` | **`Arial`** / 13.333px | **`PingFang SC`** / 13px |
| `text-align` | **`center`** | `left` |
| 行高 | **19px** | 32px |
| 圆角 | 0 | 8px |

> 注意：只补 `className` **不够**。`.od-menu__item`（`components.css:648`）原本没有
> `font-family`，而 `<button>` 不继承字体，所以加上类名之后行仍然是 Arial。已在同一条
> 规则里补 `font-family: var(--od-font-ui)` —— S3-004 说的「四条规则」少算了这一条。

### 3.4 toast 与标签栏（C7）

| 量 | 前（`--od-toast-inset-top: 16px`） | 后（48px） |
|---|---|---|
| `.od-toast-host` 纵向区间 | `top 16 → bottom 109` | **`top 48 → bottom 141`** |
| `.shell-tabstrip` | `top 8 → bottom 40` | 同 |
| 中心被 toast 命中的标签数 | **3 / 7**（与 S2-008 的实测一致） | **0 / 7** |
| host 的父节点 | `body` | `div.od-overlay-layer`（在 `#shell` 内） |

---

## 4. 没关掉的，和为什么

1. **S7-007（原生 `<select>`）—— 不关。** 位置在 `src/shell/composer/ModelMenu.tsx:238-249`，
   不归我。我这一侧的前提已经修好：`Select` 现在渲染的是真正的 `.od-menu__item` 行
   （见 3.3），换过去不会再掉进 S3-004。**汇总侧需要做的**：把那个裸 `<select>` 换成
   `renderer/ui` 的 `Select`，并删掉 `composer.css:536-547` 的 `.shell-dialog-select`。
2. **S7-009（apiKey 明文进 DOM）—— 只做到「可用」。** `src/renderer/ui/index.ts:17` 导出的
   `PasswordInput` 已核实可用（`.od-password-input__field` 有 36px 右内边距与显隐按钮，
   本轮还让它在弹窗里占满行宽）。**汇总侧需要做的**：`ModelMenu.tsx:264-269` 把 legacy
   `Input type="password"` 换成 `PasswordInput`，并补 `autoComplete="new-password"`、
   `spellCheck={false}`。换组件本身**不会**消除 `value` 属性（受控 input 的 React 行为
   与组件无关）——要真正不写进 DOM，得改成非受控 + `defaultValue`，或提交时才读
   `ref.current.value`。这属于 ModelMenu 的改法，不是原语的。
3. **S2-013 的字号 —— 部分。** UA 默认的 13.333px 已消除，弹窗现在是 16（标题）/ 14（正文
   与输入）两档。**14 与壳的 12px 仍不同**：把弹窗正文压到 12px 是设计口径问题，会同时改
   legacy 的全部弹窗，按 SUMMARY 归 W3-I（令牌收敛）。本轮不擅自做。
4. **`ToastViewport` 仍未被 shell 挂。** 能力本来就在（`toast.tsx:121`，
   `.od-toast-host--anchored` 在 `components.css:757`）。因为默认位置已经不压顶栏，接线不再是
   P1。**汇总侧若要接**：在 shell 里某个不压可点区的容器内渲染 `<ToastViewport className="…" />`
   即可（最后注册的 viewport 生效），`App.tsx:1` 现在只 import 了 `ToastHost`。
5. **`aria-modal` 的背景 inert 没做。** 焦点陷阱已经拦住 Tab，但背景元素仍能被鼠标点到
   （遮罩会吃掉点击，所以实际不可达）、也仍出现在无障碍树里。真正的 `inert`/`aria-hidden`
   处理需要拿到 `#shell` 的兄弟节点集合，属于 host 的职责，记在这里。

---

## 5. 一条本track之外、但被测出来的现象

C7 下 `.shell-tab` 的中心 `elementFromPoint` 有 **1 个（"Scratch notes"）落在
`BUTTON.shell-save-state` 上，与 toast 无关** —— 开 toast 之前就如此，关掉也如此。
这是标签栏溢出到 `.shell-tabs-actions` 底下，属于 **W2-F**（R9/标签栏溢出提示）。

所以 spec 里那条断言写成了两句更严的话，而不是原文的「每个标签中心仍落在它自己身上」
（那句今天为别人的原因就是假）：
- 没有任何一个标签中心命中 `.od-toast-host` 内的节点（= R11 的主张）；
- 开 toast 前后，七个标签中心的命中元素**逐个相同**（= toast 什么都没改变）。
加上一条与命中测试无关的几何断言：`host.y >= tabstrip.bottom`。

---

## 6. 四项验证的真实输出

### 6.1 `npx tsc --noEmit`

```
tsc exit=0
```

### 6.2 `npx vitest run`

基线（改动前，22:07 之前本机跑）：`Test Files 180 passed (180)` / `Tests 1280 passed (1280)`。
改动后：

```
 Test Files  181 passed (181)
      Tests  1289 passed (1289)
```

**零 skipped**（汇总行没有 skipped 段）。数字比基线多，是因为四条 track 共用一个工作树，
B track 期间新增了 `src/shell/agent/TaskPanel.test.tsx`；我**没有新增、修改或删除任何
vitest 测试文件**（`git status` 里 test 文件只有 D track 的
`src/renderer/components/ForceUpdateOverlay.test.tsx` 一个，不是我的）。

针对「共享组件会不会破 legacy」的定点复核（legacy 渲染器那一侧的全部相关套件）：

```
 ✓ src/renderer/ui/feedback.test.tsx (8 tests)         ← Modal / dialog / Popover / toast
 ✓ src/renderer/ui/services/toast.test.tsx (6 tests)
 ✓ src/renderer/ui/strictmode-select.test.tsx (2 tests)
 ✓ src/renderer/ui/form.test.tsx (5 tests)
 ✓ src/renderer/ui/ui.test.tsx / data-display / layoutStyles / icons
 ✓ src/renderer/components/ReportIssueDialog.test.tsx (7 tests)   ← legacy 唯一带输入框的 <Modal>
 ✓ src/renderer/screens/SettingsScreens.test.tsx (32 tests)
 ✓ src/renderer/screens/OnboardingScreen.test.tsx (11 tests)
 ✓ src/renderer/screens/HomeScreen.test.tsx (32 tests)
 ✓ src/shell/notImplemented.test.tsx (4 tests)  ✓ src/shell/composer/Composer.test.tsx (24 tests)
 Test Files  16 passed (16)      Tests  156 passed (156)
```

### 6.3 `e2e/fix-w1c.spec.ts`（新增，**零条件 skip**）

`npx vite --port 3123 --strictPort`（自起自停），
`PLAYWRIGHT_BASE_URL=http://localhost:3123 npx playwright test e2e/fix-w1c.spec.ts`：

```
Running 7 tests using 1 worker
  ✓  1 the dialog mounts inside #shell and reads the bridged tokens (513ms)
  ✓  2 Escape closes the dialog and hands focus back to the trigger (496ms)
  ✓  3 Tab cannot leave the dialog (519ms)
  ✓  4 clicking the mask closes the dialog (508ms)
  ✓  5 the dialog's text fields take the row instead of the UA's 173px (480ms)
  ✓  6 the Select's option rows are menu rows, not raw UA buttons (408ms)
  ✓  7 a notification leaves every file tab clickable (441ms)
  7 passed (3.9s)
```

七条都是无条件的（文件里没有 `test.skip`，跑的是 fixture 服务，不需要 bridge 也不需要
真工作区）。第 1 条同时断言 `document.body` 仍是库默认值（8px / 32px / `#000000` /
`#5da4e3`），所以这一对「前/后」是同一次运行里读出来的，不是引旧报告。

### 6.4 legacy 不破

- `legacy.html` 在 3123 加载：`#root` 有内容，**`pageerror` 与 console error 均为 0 条**，
  `document.getElementById("shell") === null`，`.od-overlay-layer` 数量 **0**
  → `overlayHost()` 在那边返回 `document.body`，portal 落点与改动前逐字节相同。
- legacy 的 `--od-*` 由 `renderer/ui/design-tokens.css` 映射（实测 body 上
  `--od-radius-dialog: 14px`），我没有动那个文件，也没有动 legacy 的作用域。
- legacy 侧受影响的只有三处刻意的改进，都在共享 CSS 里：`.od-dialog` 补 font（原来是
  `Times`）、弹窗/表单里的输入框占满行宽（legacy 唯一带输入的 `<Modal>` 是
  ReportIssueDialog，本来就该占满）、`--od-font-ui` 多一个 `Microsoft YaHei` 回退。

---

## 7. 改动清单

新增
- `src/renderer/ui/overlayHost.ts`
- `src/renderer/ui/useModalBehaviour.ts`
- `e2e/fix-w1c.spec.ts`

改
- `src/renderer/ui/components/Modal.tsx` — portal 目标；接 `useModalBehaviour`；
  `tabIndex={-1}`；新增 `maskClosable` / `keyboard`（默认 true）
- `src/renderer/ui/services/dialog.tsx` — portal 目标；接同一个 hook（Escape 留在原有
  effect 里，因为它要在 `submitting` 期间仍然生效，hook 侧传 `keyboard: false`）
- `src/renderer/ui/components/Popover.tsx` — portal 目标
- `src/renderer/ui/services/toast.tsx` — portal 兜底目标
- `src/renderer/ui/components/Select.tsx` — 选项行补 `od-menu__item` + `data-selected`
- `src/renderer/ui/index.ts` — 导出 `overlayHost` / `setOverlayHost`
- `src/renderer/ui/styles/components.css` — `.od-overlay-layer`；`.od-toast-host` 的 top
  改吃令牌；`.od-input` 字号 / `.od-select` 字号；`.od-dialog` 的 font；弹窗与表单里的控件
  宽度；`.od-menu__item` 补 `font-family`
- `src/renderer/ui/styles/tokens.css` — `--od-font-ui` 补 `Microsoft YaHei`
- `src/shell/tokens.css` — **只动 `--od-*` 桥那一段**（100-133 行）：补
  `--od-toast-inset-top`，并把「桥要生效必须 portal 进这个子树」写进注释

没动（不归我）：`src/shell/chrome/**`、`src/shell/agent/**`、
`src/renderer/components/ForceUpdateOverlay.tsx`、`src/renderer/styles/onboarding-update.css`、
`src/shell/tokens.css` 的其余部分、`src/shell/App.tsx`、`src/shell/composer/ModelMenu.tsx`。

## 8. 给闸门的两句话

- 第 4 波第 3 条（「portal 必须落在 `#shell` 内」）现在可以直接写成：
  `renderer/ui` 里 `createPortal` 的第二参数必须是 `overlayHost()`，禁止 `document.body`
  字面量。当前仓库内 `createPortal(..., document.body)` 的命中数为 **0**。
- 可以再加一条更便宜的：`#shell` 的 `--od-*` 桥里每个令牌，都必须能在一个 portal 出来的
  浮层上读回同一个值（`e2e/fix-w1c.spec.ts` 第 1 条就是这条闸门的现成实现）。
