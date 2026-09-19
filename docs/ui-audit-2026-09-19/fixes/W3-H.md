# W3-H —— 画布契约

日期：2026-09-20 ｜ 分支：`develop/1.0`（基线 `922f9e7`，**未 commit**，多条 track 并发）
根因：shell 与嵌入编辑器之间没有协商接口 —— S4 自己把这一条写成了方法论
（S4 §3 最后一段：「本 session 三个 P0/P1 根因是同一个缺口」）

---

## 0. `canvasContract.ts` 的行归属（先说这条，你要靠它决定怎么提交）

**我在 `src/shell/editor/canvasContract.ts` 里加了 0 行、删了 0 行、改了 0 行。**

```
$ git diff --stat src/shell/editor/canvasContract.ts
 src/shell/editor/canvasContract.ts | 90 ++++++++++++++++++++++++++++++++++++++
 1 file changed, 90 insertions(+)
```

这 90 行**全部是另一个 session 的**，逐块如下（`git diff` 对照 `git show HEAD:...`）：

| 工作树行号 | 内容 | 归属 |
|---|---|---|
| 60–128 | `DocumentEditPhase` / `DocumentEditRequest` / `DocumentEditResult` 三个类型及其注释 | **他们的** |
| 178–197 | `CanvasAdapter.editDocument?()` / `canEditDocument?()` 两个可选成员及注释 | **他们的** |
| 其余全文 | 与 `HEAD` 逐字节相同 | 基线 |

没有 `git checkout --`、没有 commit、没有对该文件的任何写操作。

**为什么一行都没加**（这是设计决定，不是回避）：三个通道都不该挂在 `CanvasAdapter` 上，
理由见第 2 节；把它们放进一个已经被另一条 track 占着的文件，只会让归属更难分。

---

## 1. 改了什么

### 新增（全部是我的）

| 文件 | 作用 |
|---|---|
| `src/shell/editor/canvasSurface.ts` | 通道 ① + ③：`CanvasBox` / `EditorChrome` / `CanvasSurface`，`publishCanvasBox` / `publishEditorChrome` / `readCanvasSurface` / `subscribeCanvasSurface` / `useCanvasSurface` / `canvasKeepOut` |
| `src/shell/editor/canvasLocale.ts` | 通道 ②：`publishCanvasLocale` / `readCanvasLocale` / `useCanvasLocale` / `canvasLocaleTag` |
| `src/shell/editor/canvasSurface.test.ts` | 12 个用例，**一半在测「没有信息」那一支** |
| `src/canvas/editorChrome.ts` | 桌面侧的三个常量（`SHEET_CHROME` / `SLIDES_CHROME` / `DOC_CHROME`）+ `useEditorChrome` |
| `e2e/fix-w3h.spec.ts` | 10 个用例，**零 skip**（条件的也没有） |

### 修改（全部是我的，且都是本轮开工时 `git status` 干净的文件）

| 文件 | 改动 |
|---|---|
| `src/shell/editor/EditorCanvasHost.tsx` | 上报画布矩形（`ResizeObserver` + resize）；下发 shell 语言；顺带把 `document.documentElement.lang` 设对 |
| `src/shell/agent/AgentPresence.tsx` | **填 W1-B 预留的 `safeArea` memo**：`canvasKeepOut()` 与侧栏宽度逐边 `max` |
| `src/shell/App.tsx` | 编辑器自带状态栏时让位，并把 `--shell-statusbar-h` 一起归零 |
| `src/canvas/SheetCanvas.tsx` | 有 session 时上报 `SHEET_CHROME` |
| `src/canvas/PresentationCanvas.tsx` | 有 session 时上报 `SLIDES_CHROME` |
| `src/canvas/PresentationStage.tsx` | `LocaleProvider value="en"` → 读 locale 通道（`?? "en"` 兜底） |
| `src/shell/dev/fixture.ts` | `?canvasChrome=sheet\|slides\|doc`，dev-only |
| `src/shell/main.tsx` | 发布 fixture chrome；dev-only 的 `window.__officedexCanvas` 读句柄 |

**没有碰**：`src/shell/editor/canvasContract.ts`（0 行）、`src/canvas/CanvasContent.tsx`、
`src/canvas/DocxCanvas.tsx`、`src/canvas/createDesktopCanvas.tsx`、`src/canvas/DocxStage.tsx`、
`src/canvas/SheetStage.tsx`、`src/canvas/docxEditRun*`、`src/shell/composer/**`、
`src/shell/agent/useAgentTask.ts`、`src/shell/agent/documentEditRun*`、`src/renderer/**`、
`src/canvas/canvas.css`、`src/shell/app.css`、`src/shell/chrome/StatusBar.tsx`。

`canvas.css` 确认**不属于**另一个 session（`git status` 里没有它），但我最终**没有**走
「给 `.spreadsheet-canvas` 加 `contain:paint` 造包含块」那条路 —— 理由见第 3 节 S4-003。

---

## 2. 通道的设计与理由

### 为什么不挂在 `CanvasAdapter` 上

两条，第二条是承重的。

1. `CanvasAdapter` 已经是 `src/shell` 里最长的接口。「你自己的工具条多高」根本不是一条
   *指令*，和 `save` / `showDraft` 不是同一类问题。

2. **adapter 不是知道答案的那个东西。** 一个 adapter 服务整个 shell 的一生
   （`createDesktopCanvas` 的注释写明了这一点），而画布里画的东西**每换一个标签、每起一次
   run 都在变**：正在生成的 deck 挂的是 `position:absolute; inset:0` 且**完全没有 chrome**
   的 stage，同一个标签几秒后变成带功能区和状态栏的成品 .pptx。答案如果从 adapter 对象出，
   就必须从真正知道的叶子一路回传上来 —— 那正是 `onSave` / `onSelectionChange` /
   `onDirtyChange` 那条五层深的梯子，已经架了三遍。

   **为一条并不在屏幕上的控件条让位不是美观问题**：那正是「悬浮面板为一个正在生成的 deck
   让开一条不存在的工具条」的机制（你给的关键约束，也很可能是 S4-010 第三种行为的来源）。

所以：**叶子发布、shell 订阅，走模块通道而不是走对象。** 一个 shell 只有一个画布宿主
（decision 4，`EditorCanvasHost.test.tsx` 守着），所以模块级的值不是在绕开一个集合 ——
它就是这件事的形状。

### 为什么 locale 也走模块通道而不是 React context

画布是**另一棵 React 树**：`createDesktopCanvas` 调 `createRoot(host)`，画布里挂的任何东西
都不是 shell provider 的后代，context 到不了。这不是待修的意外，而是 decision 4 的一部分。
`PresentationStage` 就是被这一条钉在 `value="en"` 上的 —— 它用不了 `useLocale()`。

### 三个通道的缺省语义

| 通道 | 没有信息时 | 落地方式 |
|---|---|---|
| ① 安全区 | `canvasKeepOut()` 返回**全 0**（加法单位元，因为调用方要和侧栏 inset 做 `max`） | `chrome === null` 或 `box === null`（Home） |
| ② locale | `readCanvasLocale()` 返回 `null`，消费者「保持原样」 | shell 没说话 / 画布根不是这个 shell 挂的 |
| ③ 自带 chrome | `App` 照旧画自己的状态栏 | 同 ① |

**缺省 = 当前行为**，不是「编辑器没有 chrome」。这两句是相反的指令，只有一句可以乱猜。

### 一处刻意的取舍：status bar 是「让位」而不是「留位」

S4-010 里 shell 无从决定「让位还是保留」，两条路都被授权。**选了让位。**

- 编辑器那条讲的是文档（页数 / 字数 / 当前页 / 缩放）；shell 那条讲文件名 +
  「On this computer」+ 保存状态，其中文件名已经在标签里，保存状态已经是标签栏右侧那个
  **Saved / Unsaved 按钮**（`FileTabs.tsx:343-346`）。两条叠一起时，重复的那条该走。
- `--shell-statusbar-h` 必须跟着归零：那个令牌同时是 `.shell-attention { bottom }`
  （`app.css:194`），留在 32px 的话，agent 的注意力边框会画在一条已经够到窗口底的画布上方
  32px 处。已在 e2e 用例 6 里断言。

想翻盘只要改 `App.tsx` 里 `editorOwnsStatusBar` 一个布尔的消费方式，通道本身两种都支持
（`ownsStatusBar` 与 `insets.bottom` 是分开的两件事，正是为此）。

### 那三个数字从哪来

`src/canvas/editorChrome.ts` 里 36 / 32 / 32 是 S4 在 1440×900 真 bridge 上量的矩形
（`div.sm-sheet-footer` 864–900；`ppt-shell__statusbar` 与 Writer 状态栏文字基线 y≈853 对
画布底 868）。**是复述的常量不是运行时测量**，理由和 `presenceLayout.ts` 的 `CHROME_RESERVE`
一样：三个里两个在 iframe 里，伸手进嵌入件按 class 量，第一次改名就会静默返回 0 —— 而 0
的方向是「看起来没事」，面板会重新压回标签条上。

---

## 3. 逐条 finding

### 关掉了

| ID | 级别 | 修法 | 真环境（3210）实测前后 |
|---|---|---|---|
| **S4-002** | P1 | 落点从 `innerHeight - h - 28` 改为走 W1-B 的 `safeArea`，值由编辑器上报 | xlsx：面板 `bottom 869`、压住 `sm-sheet-tab-container` → **`bottom 836`**，(1200,880) 处 `elementFromPoint` = `div.sm-sheet-tab-container`（面板不在上面了）；pptx → **`bottom 840`** |
| **S4-003** | P1 | shell 让出状态栏；工作簿页脚随之落回画布盒内 | `.shell-statusbar` 三点探针全部命中 sdk-sheet、`overflowsCanvasBy = 32` → **`statusbarCount = 0`**，`footer 864–900` ⊂ `canvas 40–900`，**`overflowsCanvasBy = 0`** |
| **S4-010** | P2 | 契约里有了「编辑器是否自带状态栏」 | 三种行为（双栏 / 双栏 / 消失）→ **xlsx 与 pptx 各只剩编辑器自己那一条**（`statusbarCount = 0`） |
| **S6-015** | P1 | 同 S4-002 | 3100 fixture 上：`canvasChrome=sheet` 时默认落点 `bottom ≤ 视口-36`，e2e 用例 4 同一次运行里拿静默态做对照 |
| **S4-009（部分）** | P1 | locale 通道；`PresentationStage` 的 `value="en"` 硬钉改成读通道；`<html lang>` 跟着 shell | `documentElement.lang` 从恒 `"en"` 改为跟随（e2e 用例 9/10：`zh` → `lang="zh-CN"`） |

顺带（不在清单里）：`document.documentElement.lang` 以前恒为 `en`，而 W3-J 之后 shell 文案
本身已经会变中文 —— 「`<html lang="en">` 包着中文正文」是 S4-009 证据里明写的一半，辅助技术、
断词和 CJK 字体回退都读它。

### 没关掉（逐条说明）

| ID / 部分 | 为什么 |
|---|---|
| **S4-002 / S4-010 的 docx 一支** | 上报点在 `src/canvas/DocxCanvas.tsx`，**那是另一个 session 的在制品**（`git status` 里 `M`）。`DOC_CHROME` 常量和 `useEditorChrome` 已备好，docx track 加**一行** `useEditorChrome(session ? DOC_CHROME : null)` 即可。真环境实测确认现状：docx 下 `chrome: null`、`statusbarCount: 1`、面板 `bottom 872` —— **与修复前逐值相同**，这正是「缺省 = 当前行为」的活证据 |
| **S4-009 的另外两个消费者** | (a) `ui_locale` 请求参数硬钉在 `DocxCanvas.tsx:170`（`locale: "en"`），同上，是别人的文件；`canvasLocaleTag()` 已经备好，改法是 `locale: canvasLocaleTag() ?? undefined`。(b) **Writer 嵌入件只随 runtime 发了 zh-CN 词典**，要在 host 注入英文词典 —— 那在 `src/renderer/**` 且本质是打包物料，不在本 track 范围，也不是一个通道能解决的 |
| **S4-009 的术语不一致**（"Home" vs "Start"、"Efficiency"） | 三套 runtime 各自的词典，通道只能决定**说哪种语言**，决定不了**用哪个词** |
| **`.spreadsheet-canvas` 的包含块** | `canvas.css` 确实不属于别人，但 `contain:paint` / `transform` 会让 sdk-sheet 里**所有** `position:fixed` 的弹层（右键菜单、对话框）改用画布原点而不是窗口原点，在 1440 宽上整体偏移 (52,40)。那是一个我在本轮无法逐个验证的回归面。走了 shell 让位那条，结果是页脚自然落回画布盒内（实测 `overflowsCanvasBy: 32 → 0`），根因层面的「fixed 逃逸」仍在，**但已无物可撞** |
| **S4-012 的余量** | 「窄窗口自动折叠」是产品决策，W1-B 已经说过不自行发明；本轮把 1024 下的遮挡再往下压了 36px，没有解决比例问题 |

---

## 4. 五项验证的真实输出

### 4.1 `npx tsc --noEmit`（直接读退出码）

```
$ npx tsc --noEmit > /tmp/w3h-tsc2.txt 2>&1; echo "TSC_EXIT=$?"
TSC_EXIT=0
$ cat /tmp/w3h-tsc2.txt
(空)
```

### 4.2 `npx vitest run`

```
VITEST_EXIT=0
 Test Files  194 passed (194)
      Tests  1396 passed (1396)
```

开工基线（本 track 任何改动之前，同一命令）：`193 passed (193)` / `1384 passed (1384)`。
差额 **+1 文件 / +12 用例**，全部来自 `canvasSurface.test.ts`。**无用例减少，无 skip。**

### 4.3 `e2e/fix-w3h.spec.ts`（10 用例，0 skip）

```
npx vite --port 3171 --strictPort
PLAYWRIGHT_BASE_URL=http://localhost:3171 npx playwright test e2e/fix-w3h.spec.ts
```

```
  ✓  1 with no editor mounted the channel is empty, not zero (1.1s)
  ✓  2 silence leaves the panel in the corner it used before this channel existed (671ms)
  ✓  3 silence leaves the shell's own status bar exactly where it was (670ms)
  ✓  4 a reported bottom strip moves the panel's first landing point off it (1.1s)
  ✓  5 the panel dragged to the bottom edge still stops above the editor's strip (1.2s)
  ✓  6 an editor that owns a status bar takes the shell's place, not a second row (672ms)
  ✓  7 the three editors report three different strips, and each is honoured (1.6s)
  ✓  8 going Home withdraws the box, so nothing is reserved over the hero (835ms)
  ✓  9 the locale channel carries the shell's language, not navigator's (679ms)
  ✓ 10 the locale channel follows a change rather than sampling once (1.1s)
  10 passed (10.2s)
```

要求的三条断言分别是用例 1/2/3（通道缺省 ⇒ 行为与现在一致，逐值：落点 `bottom = 视口-28`、
`--shell-statusbar-h = 32px`）、4/5/7（有上报时默认落点与**拖拽钳位**都避开安全区）、
9/10（locale 通道能被读到，且跟随变化）。

**红→绿的判别力，没有做 A/B 归因目录**（干净 worktree 在多 track 并发下风险大于收益）。
代之以**同一次运行内的对照**：用例 4 先在静默态量一次 `before`，再在 `canvasChrome=sheet`
下量 `after`，断言 `after.bottom < before.bottom` 且 `≤ 视口-36` —— 若消费端忽略通道，
两次读数相同，这条必红。用例 6 同理（消费端不改则 `.shell-statusbar` 仍在）。

### 4.4 `e2e/fix-w1b.spec.ts`（W1-B 守的表面）

```
  14 passed (30.5s)
```
14/14，与 W1-B 交付时逐条同名同绿。

### 4.5 `e2e/gates.spec.ts`

```
  1 failed
    gate: shell overlays are never clipped › every <Menu> in src/shell is registered in CALL_SITES
  10 passed
```

**这条红不是我的，且可以证明。** 失败信息：

```
src/shell has 9 <Menu> call sites, CALL_SITES has 8:
  chrome/FileTabs.tsx, chrome/ModeMenu.tsx, chrome/Sidebar.tsx,
  composer/Composer.tsx ×3, composer/ModelMenu.tsx, nav/FileTree.tsx
```

第 9 个在 `src/shell/composer/Composer.tsx` —— 那是**另一个 session 未提交的改动**
（`git status` 里 `M`；`git show HEAD:...` 只有 1 处 `<Menu`，工作树有 3 处）。这正是该 gate
注释里写过的那个场景（「a 'What this message makes' menu being added to Composer.tsx on
another branch」）。我改的 5 个 `.tsx` 里 `<Menu` 出现次数为 0，均不在上面那张清单里。
**处理：不动，交 composer track 注册第 9 个 CALL_SITE。** 另外 10 条几何用例全绿。

### 4.6 真编辑器（3210 dev-real）—— **跑了，有数**

```
node scripts/dev-real.mjs --port 3210 /tmp/s4-docs/sample.pptx /tmp/s4-docs/sales-report.xlsx /tmp/s4-docs/sample.docx
bridge: http://127.0.0.1:55541
```

用一次性 spec（跑完已按精确路径删除：`e2e/tmp-w3h-devreal.spec.ts` 与
`test-results/playwright/tmp-w3h-devreal-*`）在 1440×900、editor + floating 下逐标签读数：

| 文件 | `chrome` | `statusbarCount` | `.shell-canvas` | 面板 rect |
|---|---|---|---|---|
| **sales-report.xlsx** | `{insets:{bottom:36}, ownsStatusBar:true}` | **0** | `40–900` | `{1076,415,1416,836}` |
| **sample.pptx** | `{insets:{bottom:32}, ownsStatusBar:true}` | **0** | `40–900` | `{1076,419,1416,840}` |
| **sample.docx** | **`null`** | **1**（`868–900`） | `40–868` | `{1076,451,1416,872}` |

DOM 探针（同一次运行）：

```
xlsx  footer  = {top:864, bottom:900, left:52, right:1440}      ← 在画布盒内，overflowsCanvasBy = 0
      wrapper = {top:40,  bottom:900}
      elementFromPoint(400,880)  = div.sm-sheet-tab-container
      elementFromPoint(1200,880) = div.sm-sheet-tab-container    ← 面板不再压在标签条上
pptx  elementFromPoint(400,880)  = iframe.pptx-embed-frame
docx  elementFromPoint(400,880)  = div.shell-statusbar-facts     ← 未接线，行为与修复前一致
```

对照 S4 原始读数：`.sm-sheet-footer` 仍是 864–900（SDK 自己的 `position:fixed`，没动它），
但 `.shell-canvas` 从 `40–868` 变成 `40–900`，所以 `overflowsCanvasBy` 从 **32 → 0**，
shell 状态栏三点探针那张表整张失效 —— 因为那条状态栏不再被画出来。

### 明确**未验证**的

1. **docx 在真环境下接上通道之后的样子**。`DocxCanvas.tsx` 是别人的在制品，我没有加那一行，
   所以「docx 也只剩一条状态栏」这句**没有实测**，上表里 docx 那一行是**未接线的对照组**。
2. **`PresentationStage` 读到中文 locale 时的画布文案**。那个 stage 只在 pptx 生成途中出现，
   本轮没有起真 run（需要平台凭据），`?? "en"` 兜底路径与通道路径都只在单元/契约层面验证。
3. **中文系统下的真环境整屏**。dev-real 那台机器 `navigator.language` 是 en，
   `locale:"en" / lang:"en"`；中文分支只在 3171 fixture 上用 `localStorage` 强制验证过。
4. **Windows 构建**。同 W1-B，不下结论。
5. **`SHEET_CHROME` 等三个常量在别的视口/别的文档下是否仍然准确**。它们是 S4 在 1440×900
   下的复述值；本轮只证明 shell 拿它们做对了事，没有证明它们还是对的数。

---

## 5. 给其它 track 的话

1. **docx track：两行就能把剩下的关掉。**
   `src/canvas/DocxCanvas.tsx` 加
   `useEditorChrome(session ? DOC_CHROME : null)`（import 自 `./editorChrome`）→ 关 S4-002 /
   S4-010 的 docx 一支；`DocxCanvas.tsx:170` 的 `locale: "en"` 改成
   `canvasLocaleTag() ?? "en"`（import 自 `../shell/editor/canvasLocale`）→ 把 planner 的
   summary 语言接到同一个源。**stage（`DocxStage` / `SheetStage`）不要上报** —— 它们没有
   chrome，上报会让悬浮面板为一条不存在的控件条让位。
2. **composer track**：`e2e/gates.spec.ts` 的 CALL_SITES 少注册了你们新加的第 9 个 `<Menu>`，
   现在那条 gate 是红的。
3. **W3-I 的 z-index 层级表**：安全区只管「不落在上面」，管不了「谁压谁」。悬浮面板仍然是
   `z-index: 200`。
4. **`--shell-statusbar-h` 现在会变成 `0px`**（`#shell` 内联）。任何新写的、按这个令牌算
   底部留白的规则要能接受 0。
5. `window.__officedexCanvas` 只在 `readDevFixture()` 非 null 时挂，生产构建里 `fixture`
   恒为 null，整段被 Vite 编译掉。
