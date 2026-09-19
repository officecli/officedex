# W2-F —— chrome 与键盘

分支 `develop/1.0`，从 Wave 1 的 `df66a33` 起工作（期间另一 session 提交了 `31e79dc`，与本 track 无关）。
**未 commit**，三条 track 并发中。

拥有并改动的文件：

| 文件 | 性质 |
|---|---|
| `src/shell/chrome/FileTabs.tsx` | roving tabindex、方向键、溢出滚动控件、share 失败上报 |
| `src/shell/chrome/StatusBar.tsx` | 文件名补 `title` |
| `src/shell/chrome/chrome.css` | 焦点环清单、`:active`、溢出控件样式、Home 操作组、状态栏省略、windowbar 合并、注释订正 |
| `src/shell/app.css` | 删两段死 CSS |
| `e2e/fix-w2f.spec.ts` | **新增**，13 个用例，无任何 skip |

另外改了两个**既有测试的断言**（没有删除任何用例，详见第 4 节）：
`src/shell/notImplemented.test.tsx`、`src/shell/chrome/chrome.test.tsx`。

未动：`chrome/Menu.tsx`、`chrome/menu.css`、`chrome/ModeMenu.tsx`、`chrome/FileTypeIcon.tsx`、
`chrome/Sidebar.tsx`（S1-006 的修复落在 chrome.css 的 `.shell-sidebar-item` 规则上，不需要改组件）。

---

## 1. 逐条结论

### 关掉的（11 条）

| ID | 级别 | 改法 |
|---|---|---|
| **S6-006** | **P0** | `FileTabs.tsx`：把「选中」和「Tab 落点」拆成两个量 |
| S6-005 / S1-005（`.shell-tab-close` 那一项） | P1 | `chrome.css` 焦点环清单补 `.shell-tab-close` |
| S1-003 / S6-007 | P1 | 标签栏加可见的滚动控件，只在溢出时出现 |
| S1-014 / S6-008 / S8-010 | P2 | `visibility:hidden` → `display:none` |
| S1-004 | P2 | 打空的选择器删掉，省略规则写到真实 DOM 上，并补 `title` |
| S8-011 | P1 | 空 catch 改为「取消不是错误、其余都上报」；无文件文案换通道 |
| S1-013 / S5-008 | P2 | `app.css` 的 `.shell-windowbar` 整块删除，注释挪到真正生效处 |
| S6-016 | P3 | 注释订正（行为不变，见下） |
| S1-006 | P3 | 补 `.shell-sidebar-item.is-current:hover` |
| S1-007 | P3 | 给 8 个 chrome 控件补 `:active` |

### 没关掉的

| ID | 原因 |
|---|---|
| S1-005 的另外 6 个控件 | `nav.css` 的树控件，归 **W2-E**。本 track 只动了 `.shell-tab-close` 这一项 |
| S6-016 的几何本身 | 折叠轨下顶栏左沿仍比侧栏右沿多 80px。**这是有理由的取舍，本轮只订正注释**：132px 是红绿灯 + 侧栏开关的净空，52px 轨道下两个目标冲突，代码选了净空。改几何等于让标签跑到红绿灯底下。原注释只说「titlebar starts at the content boundary」，把让步整个略去了；新注释把两条规则、冲突、以及它是一条 **macOS 假设**（Windows 构建上这块净空留反了方向）都写明 |
| S1-007 的 `.shell-tree-*` 两项 | 同属 `nav.css`，归 W2-E |

---

## 2. 修复前后数值

全部为 1280×720、`?shellFixture=1`（7 个标签）下实测。
修复前数值取自本 track 自己跑的 baseline probe，与 S1/S6 的记录一致。

### ① S6-006 —— Tab 序（C1–C4）

| | 前 4 站 | 第 5 站 | 第 6–11 站 |
|---|---|---|---|
| 修复前 | 红绿灯 ×3 + 侧栏开关 | **`.shell-tab-close`** | 另外 6 个 close，第 12 站才到品牌菜单 |
| 修复后 | 同上 | **`.shell-tab-select`** | close ×7 |

`.shell-tab-select` 的 `tabindex` 数组：

| 组合 | 前 | 后 |
|---|---|---|
| C1 / C2 / C3 / C4 | `["-1","-1","-1","-1","-1","-1","-1"]` | `["0","-1","-1","-1","-1","-1","-1"]` |
| C7（对照，`home=false`） | `["0","-1",…]` | `["0","-1",…]` **不变** |

附带：补了 `ArrowLeft/ArrowRight/Home/End`。roving tabindex 只留一个 Tab 落点，
其余 6 个标签本来就只能靠方向键到达——原来没有方向键，所以即使有落点也只够到一个标签。
采用**手动激活**（焦点移动不换文档，Enter/Space 才激活）：自动激活会在「方向键路过 4 个标签」
时挂载再卸载 4 个编辑器。已断言 `data-home` 在方向键期间不变、Enter 后才变。

### ② S6-005 —— 关闭键焦点环

`.shell-tab-close` 聚焦时的 computed（判据取 `outline-style`）：

| | outlineStyle | outlineWidth |
|---|---|---|
| 前 | `"none"` | `"3px"`（这正是不能用宽度判定的原因） |
| 后 | `"solid"` | `"2px"` |

C1 / C2 / C6 / C7 四格均已断言。

### ③ + ④ 溢出与 Home 的 240.8px

| 组合 | 前 clientWidth | 前溢出 | 前完整可见 | 后 clientWidth | 后溢出 | 后完整可见 | 后可见溢出控件 |
|---|---|---|---|---|---|---|---|
| C1 | 907 | 91 | 6/7 | **1132** | **0** | **7/7** | 0（不需要） |
| C2 | 849 | 149 | 5/7 | **1074** | **0** | **7/7** | 0 |
| C3 | 907 | 91 | 6/7 | **1132** | **0** | **7/7** | 0 |
| C4 | 849 | 149 | 5/7 | **1074** | **0** | **7/7** | 0 |
| C5 | 667 | 331 | 4/7 | 607 | 383 | 4/7 | **2** |
| C6 | 529 | 469 | 3/7 | 469 | 521 | 3/7 | **2** |
| C7 | 907 | 91 | 6/7 | 847 | 143 | 6/7 | **2** |
| C8 | 849 | 149 | 5/7 | 789 | 201 | 5/7 | **2** |
| C9 | 907 | 91 | 6/7 | 847 | 143 | 6/7 | **2** |
| C10 | 849 | 149 | 5/7 | 789 | 201 | 5/7 | **2** |

`.shell-tabs-actions` 在 C1–C4：`{w: 208.8, visibility: "hidden", display: "flex"}` → `{w: 0, display: "none"}`。
右侧总预留从 240.8px 归零，S1-014 预测的 `wouldFit: true` 成立：**四个 Home 组合全部 7/7 可见，溢出为 0**。

**C5–C10 的代价要说清楚**：滚动控件本身占 52px（2×22px + 8px 内部间距，
已用 `margin-left:-8px` 把它塞回行的 16px 间隙里），所以每格溢出量 **+52px**。
完整可见的标签数一个没少（6/5/4/3 前后一致）——52px 没有把任何一个标签挤出去，
换来的是那些被裁的标签第一次有了到达路径。

C6（最坏格，469px 装 7 个标签）实测：按「向右滚动标签」按钮 ≤7 次，
**7/7 个关闭键都进入可视区且在自己中心点上是最顶层元素**（`elementFromPoint` 命中自身）。
到底后按钮转为 disabled、向左按钮 enabled。

设计取舍：两个箭头都放在标签条**右侧**。左侧加控件会把标签条左沿推走，
而那条左沿就是顶栏的内容边界（对齐侧栏或停靠列），不能因为多开了一个文件就位移。
没有做渐隐遮罩：`mask-image` 会把边缘标签的焦点环一起淡掉，与刚补上的 ② 相抵。

### ⑤ S1-004 —— 状态栏

C6 下点开 66 字中文名：

| | 前 | 后 |
|---|---|---|
| `.shell-statusbar > span` 声明数 / 命中元素数 | 1 / **0** | **0** / 0（规则已删） |
| `.shell-statusbar-facts > span` 的 `text-overflow` | `"clip"` | `"ellipsis"` |
| span `scrollWidth` / `clientWidth` | 566 / **566**（不裁，由父容器硬切） | 566 / **497**（自己裁，带省略号） |
| `title` | `null` | 完整的 `二〇二六年…三个分册）.docx` |

### ⑥ S8-011 —— share

| 场景 | 前 | 后 |
|---|---|---|
| 有文件、剪贴板被拒 | **toast 数 = 0**，完全静默 | `That did not work / Write permission denied.`（走 `reportPortFailure`，同时写 app log） |
| 有文件、用户取消系统分享面板 | 静默（正确） | 仍然静默（只放行 `AbortError`） |
| 无文件 | `Not built yet` + 「Sharing … is not built yet. Open a local file first.」（自相矛盾） | `Open a file to share it / Share sends whichever file is open on the canvas.` |

无文件那条用 `toast.info` 而不是 `notBuiltYet`：后者的语义是「这个控件背后什么都没有」
（`reportPortFailure.ts:66-81`），而 share 背后**有**实现，缺的是前置条件。

### ⑦ S1-013 —— windowbar

| | 前 | 后 |
|---|---|---|
| `.shell-windowbar` 规则条数 | 2（`app.css:63` + `chrome.css:117`，同选择器同特异度） | **1**（只在 chrome.css） |
| 十个组合的 `minWidth` | 全部 `"0px"`，而 `app.css:66` 写着 `132px` | 仍是 `0px`，但没有任何地方再声称 132px 在这儿 |
| `paddingLeft` | `12px`（app.css 的 shorthand 其实活着——S1 说「padding 被覆盖」只对了右侧） | `12px`（已显式写成 `padding-left`） |
| 红绿灯净空 | 132px，来自 `chrome.css` 的 `.shell-tabs { padding-left: max(…, 132px) }` | 同上，注释挪到了这里 |

`app.css` 里删掉的是 `width` / `min-width` / `flex` / `transition:width` 四条死声明（元素是 `position:absolute; inset:0`，这四条全不生效），
活着的 `display/align-items/gap/padding-left` 合并进 chrome.css。
十格实测 `控件 left=12`、`toggle right=127`、`标签条 left ∈ {132,190,372,510}`，断言「标签条左沿永远 ≥ 侧栏开关右沿」。

**一条跨 track 提示**：`src/shell/agent/presenceLayout.ts:58` 的注释把 132px 指向
「`.shell-windowbar` 的 `min-width` in `app.css`」，那个指针现在指空了（数值仍然正确，
`CHROME_RESERVE.width = 132` 是活的常量）。我不拥有 `agent/**`，没有改它；
作为补偿，chrome.css 里新注释显式写了「`agent/presenceLayout.ts` 的 `CHROME_RESERVE.width` 复述同一个数」，
这样从我这侧出发的引用是能解析的。W1-B 或 W3 谁先碰 `agent/**` 都可以顺手把那半句改成 `chrome.css`。

### ⑧ S1-006 / S1-007

- `.shell-sidebar-item.is-current` hover：`rgb(228,233,236)` → `color(srgb 0.830 0.850 0.862)`（`hoverDiffers` 从 false 变 true）。
  用 `color-mix(in srgb, var(--shell-active) 90%, var(--shell-ink))` 而不是 `var(--shell-hover)`：
  hover 令牌比 active 令牌**更浅**，直接套上去会让「当前项被指到」比静息还亮，方向是反的。
- `:active`：补了 `.shell-icon-button / .shell-tab-select / .shell-tab-close / .shell-tab-bookmark /
  .shell-sidebar-item / .shell-brand / .shell-profile / .shell-save-state / .shell-tabstrip-scroll` 九个，
  统一用 `color-mix(… --shell-active 88%, --shell-ink)`；唯一的实心按钮 `.shell-share` 用 `filter: brightness(.9)`。
  **没有新增裸色值**——chrome.css 那 25 处仍然原样留给 W3-I。

顺带把 `.shell-tab-bookmark:focus-visible` 从自己的单独规则折进共享清单：
「焦点环在两个地方声明」正是这次漏掉 `.shell-tab-close` 的成因。

---

## 3. 验证（真实输出）

### 3.1 `npx tsc --noEmit`

```
TSC_EXIT=0
```

### 3.2 `npx vitest run`

```
 Test Files  183 passed (183)
      Tests  1309 passed (1309)
```

基线是 1294（182 文件）。差额 +15 来自并发的另外两条 track，不是我：
`31e79dc feat(shell): 把 deck 的页列表挪到对话旁边` 往 `src/shell/agent/TaskPanel.test.tsx` 加了用例，
W2-G 新建了 `src/shell/composer/useComposerSettings.test.tsx`（7 个用例，尚未提交）。
**本 track 自己的净增减为 0**：改了 3 处断言，删了 0 个用例。新增的回归覆盖全在 `e2e/fix-w2f.spec.ts`（13 例）。

### 3.3 `e2e/fix-w2f.spec.ts`（新增，13 个用例，0 skip）

```
  ✓   1 S6-006 the Tab order reaches a tab before it reaches a close button (1.5s)
  ✓   2 S6-006 exactly one tab is the tab stop, on Home and off it (1.3s)
  ✓   3 S6-006 the arrow keys reach the tabs the single tab stop does not (506ms)
  ✓   4 S6-005 the close button draws a focus ring (1.1s)
  ✓   5 S1-003 every combination either fits its tabs or says it does not (2.7s)
  ✓   6 S1-003 in C6 — the worst case — every close button can be brought into reach (1.1s)
  ✓   7 S1-014 Home's file actions take no room at all (2.6s)
  ✓   8 S1-004 a long file name in the status bar ends in an ellipsis and keeps its full text (635ms)
  ✓   9 S8-011 Share reports a failure instead of swallowing it (647ms)
  ✓  10 S8-011 with no file open, Share says what is missing and not that it does not exist (474ms)
  ✓  11 S1-013 the window bar is declared once, and the 132px clearance is where the comment says (3.0s)
  ✓  12 S1-006 the current sidebar row answers the pointer (474ms)
  ✓  13 S1-007 the chrome has press feedback (415ms)
  13 passed (16.9s)
```

关键取证行（spec 自己 `console.log` 出来的，报告里的数字都能对上）：

```
W2F-FIXED taborder C1 select@4 close@5 [...,"shell-tab-select","shell-tab-close","shell-tab-close"]
W2F-FIXED tabstop C1 ["0","-1","-1","-1","-1","-1","-1"]
W2F-FIXED closering C6 {"focused":true,"outlineStyle":"solid","outlineWidth":"2px"}
W2F-FIXED overflow C1 {"overflow":0,"tabs":7,"fullyVisible":7,"visibleCues":0}
W2F-FIXED overflow C6 {"overflow":521,"tabs":7,"fullyVisible":3,"visibleCues":2}
W2F-FIXED C6-close-reachable 7/7
W2F-FIXED home-actions C2 {"width":0,"display":"none","overflow":0}
W2F-FIXED statusbar {"title":"二〇二六年…三个分册）.docx","textOverflow":"ellipsis","scrollWidth":566,"clientWidth":497}
W2F-FIXED dead-selector {"declared":0,"matches":0}
W2F-FIXED share-failure "That did not work\nWrite permission denied."
W2F-FIXED share-nofile "Open a file to share it\nShare sends whichever file is open on the canvas."
W2F-FIXED windowbar C6 {"declarations":1,"padding":"12px","controlsLeft":12,"toggleRight":127,"stripLeft":510}
W2F-FIXED current-hover rest=rgb(228, 233, 236) hover=color(srgb 0.830196 0.849804 0.862353)
W2F-FIXED active-rules {"missing":[]}
```

两条防「假绿」的写法值得记一笔：

- 第 10 例**不能**用 `?shellFixture=1`——fixture 一开就是 7 个标签，永远有 activeFile，
  「无文件」那条分支根本走不到。第一版就是这么写的，它失败了（拿到的是剪贴板失败的 toast 而不是提示文案），
  改成不带 fixture 的 `/?shell=C9`（预览 port = 真空工作区）才真正覆盖到。
- 第 9 例用 `addInitScript` 把 `navigator.clipboard.writeText` 钉成 reject，
  而不是指望这台机器的剪贴板权限恰好被拒——断言的是代码路径，不是本机环境。

### 3.4 Wave 1 回归

```
e2e/fix-w1a.spec.ts   11 passed (12.9s)
e2e/fix-w1c.spec.ts    7 passed        （与 w1a 同批跑，17 passed 中的 7 条）
e2e/ui-audit-s6.spec.ts 12 passed (55.4s)
```

**一次需要说明的红**：第一次把 w1a + w1c 放在一批跑时，
`fix-w1a.spec.ts:155 S2-006 a menu never grows past the room it has` 超时失败
（`locator.waitFor` 等 `.shell-menu` 60s 超时，触发点是 `.shell-cx-scope` 聚焦 + ArrowDown）。

隔离判断：
1. 单独 `-g "never grows past"` 跑 → **passed (512ms)**；
2. 整个 `fix-w1a.spec.ts` 重跑 → **11/11 passed**；
3. 同一文件里第 6 例（`S2-005`）对同一个 `.shell-cx-scope` 在含 C1 的 8 个组合上做完全相同的操作，两次都通过；
4. 我的改动不含 `composer/**`、`chrome/Menu.tsx`、`chrome/menu.css` 中的任何一行。

结论：**复合菜单打开的既有 flake，不是本 track 造成的**。没有把它算到自己头上，也没有藏起来。

**后续（W2-G 的交叉验证 + 机制怀疑点）**：W2-G 在同一棵共享树（含双方全部改动）上把
`fix-w1a + fix-w1c + fix-w2f + fix-w2g` 整批连跑 3 次，每次 35 passed，
S2-006 耗时 477 / 506 / 529ms，**0/3 复现**。合并两边的样本是 **1/5**——稀有的加载时序竞态，与观察一致。

它指出的机制（是怀疑点不是结论，但与症状吻合）在 `e2e/fix-w1a.spec.ts:157-160`：

```ts
const trigger = page.locator(".shell-cx-scope").first();
await trigger.focus();
await page.keyboard.press("ArrowDown");   // 打在「当前焦点」上，不是打在 trigger 上
await page.locator(MENU).waitFor();       // 丢键则空等满 60s
```

这是**纯键盘开菜单**：ArrowDown 只有落在 `.shell-cx-scope` 上才会触发 `Menu` 的 `openAt`。
`open()` 等的是 `data-loaded`，它并不覆盖 composer 的设置读取与挂载后的异步 setState；
整批跑时时序与单跑不同，只要焦点在 `focus()` 与 `press()` 之间被挪走，这一按就丢了，
随后 `waitFor` 空等到超时——正是「偶发 60s、单独跑必过」的形状。

两条建议（**`fix-w1a.spec.ts` 归 W1-A，我和 W2-G 都不拥有它，双方都没有动**）：

1. `page.keyboard.press` → `trigger.press("ArrowDown")`。locator 版本会把「聚焦 + 按键」
   合成一个动作并在按键前重新聚焦，**真正收窄窗口**，而不只是检测它。
2. 再加 `await expect(trigger).toBeFocused()`。这条不消除竞态，但把 60s 的沉默空等
   换成秒级、指名道姓的失败——对闸门来说这才是关键差别。

Wave 4 若要把 `fix-w1a.spec.ts` 接进闸门，请先落这两条；一个会静默挂 60s 的用例，
在 CI 摘要里和 `ui-audit-s4.spec.ts` 的 30 个 skip 是同一类问题。

### 3.5 对 S1 的旁证 spec 的影响（无风险，但记录在案）

`e2e/ui-audit-s1.spec.ts` 的 `Home reserves space for invisible file actions` 会继续运行，
只是记录的数字从 `{visibility:"hidden", width:208.8, wouldFit:true}` 变成
`{visibility:"visible", width:0}`。该文件 `expect(` 数 = **0**，是纯取证器不是闸门，不会因此变红。
它的注释仍指向 `chrome.css:334-337`（现在是别的内容），属于历史证据，按 SUMMARY 第 1 节的约定不动。

---

## 4. 动了别人测试文件的两处（逐条对账）

| 文件 | 改法 | 为什么必须改 | 用例数变化 |
|---|---|---|---|
| `src/shell/notImplemented.test.tsx` | 两个 `it` 的断言从「Share 说 *Not built yet* / *Sharing … is not built yet*」改成「Share 说 *Open a file to share it*，且**不**含 *not built yet*」 | 这两条断言把 S8-011 的缺陷**钉住**了：它们要求 share 继续声称自己没做。测试要的那条规则（「能按的控件一定会回答」）一字未动，仍然被断言 | 2 → 2 |
| `src/shell/chrome/chrome.test.tsx` | 重命名用例里的 `getByTitle("Launch deck final.pptx")` 改为在 `tablist` 内 `within(...)` 查找 | 状态栏的 span 现在也带同名 `title`（这正是 S1-004 要的），全文档查询变成两个命中而报错。断言的含义完全不变 | 14 → 14 |

**没有删除任何测试用例。** 全量 183 文件 / 1309 用例全绿。

---

## 5. 留给后面的

1. **W2-E**：`nav.css` 里 S1-005 的另外 6 个焦点环、S1-007 的 2 个 `:active`，与本 track 同族但不同文件。
2. **W1-B / W3**：`agent/presenceLayout.ts:58` 那半句注释的指针（见 §2⑦）。
3. **Wave 4**：`fix-w1a.spec.ts` 的 `S2-006` 在整批运行下会偶发超时（§3.4），进闸门前需要先稳定。
4. **W3-I**：本 track 新增的样式一律走令牌或 `color-mix`，没有给那 25 处裸色值添新账。
5. C5/C6 在 1280 宽下仍然只能完整显示 4/3 个标签——滚动控件让它们**可达**了，但没让它们**可见**。
   真要在 320px 停靠列旁边放下 7 个标签，得动 `.shell-tab { min-width: 140px }`，
   那是可读性与可见数的另一次取舍，不在本轮范围内。
