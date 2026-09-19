# W3-I 令牌收敛

日期：2026-09-20 ｜ 分支 `develop/1.0` ｜ 基线 commit `4a716ea` ｜ **未 commit**

拥有的文件：`src/shell/tokens.css`、`app.css`、`chrome/chrome.css`、`chrome/menu.css`、
`agent/agent.css`、`nav/nav.css`、`home/home.css`、`home/highlights.css`、`home/taskList.css`
（后两个本来就 0 裸值 0 离表字号，未改）。
新增：`e2e/fix-w3i.spec.ts`、`docs/ui-audit-2026-09-19/fixes/W3-I/baseline.json`。

---

## 0. 一句话结论

**68 处裸色值 → 12 处（全部是两组有理由的豁免），5 处离表字号 → 0，z-index 从 4 个文件散落
+ legacy 段无表 → 一张 9 档全量表；十个壳组合、10,152 个渲染节点、1,148 条声明逐项对照，
`0 changed`。**

这条 track 没有产生任何外观变化。下面第 4 节列出「本可以顺手做、但被我拆出来单独决定」的
两类候选项，它们都是可见的重新配色，藏在一次「统一来源」的重构里不合适。

---

## 1. 令牌结构的设计

### 1.1 一个必须先说清楚的事实：审计报告的「≥40 处可直接换」是错的

S5 表 4 写「可直接换令牌的 ≥40 处」，并举了三个例子。我把 68 处裸值逐个对每个既有令牌算了
**逐通道最大差**，结果是：

| 与既有令牌的关系 | 处数 |
|---|---|
| **完全相同**（Δ=0，换了等于没换） | **5** |
| Δ1–4（肉眼几乎不可辨，但不是同一个颜色） | 17 |
| Δ5–10 | 12 |
| Δ>10 | 34 |

S5 举的三个例子全部落在「近似」而不是「相同」：

| S5 的建议 | 实际 |
|---|---|
| `#dfe2e6` ≈ `--shell-line-strong #d9dfe4` | Δ6 |
| `#34383c` ≈ `--shell-ink-title #343a40` | Δ4 |
| `nav.css #e2e6e9` ≈ `--shell-line #e4e6e9` | Δ2 |

也就是说，**按 S5 的方案做，会在一次「令牌收敛」里悄悄改掉四十个颜色**。任务书同时写了
「不要为了消灭裸值而改变外观」，两条是冲突的，我按后者执行。

那 5 处真正的 Δ=0 是：`chrome.css:493 #ffffff`、`agent.css:203 #ffffff`（→
`--shell-ink-inverse`）、`nav.css:502 #ad5347`（→ `--shell-status-danger`）、以及
companion 的两处 `#fafafa`（= `--shell-canvas`，但 companion 整体豁免，见 §2.3）。

### 1.2 于是：令牌表不是「语义化」，是「把来源收成一处」

`tokens.css` 现在分成两层，两层的**权威性不同**，注释里写明了：

**第一层 — 设计语言**（原有的 Surfaces / Lines / Ink / Interaction / Radii / Elevation /
Metrics / Type / Motion / Document identity，加上本轮扩的 Status / Layers / Type）。
这些有原型依据或明确的设计意图，是将来做暗色主题时**要逐个重新决定**的东西。

**第二层 — `Surface palette`（新增，34 个）**。这是原先散在五个样式表里的字面量，按**使用它
的那个表面**命名，取值一字未改。注释里明说它「不是上面那些梯度的延伸，不要那样读」，它唯一
的主张是：**`src/shell` 里不再有第二个写颜色的地方**。

**第三层 — `Canvas skeleton`（新增，5 个）**，单独隔开，因为 `editor/CanvasPlaceholder.tsx`
在自己的文件头里就写明「集成时整体丢弃」。把这五个灰折进上面的梯度，等于把一个线框图里随手
挑的中性色永久固化进设计语言；单独放一块，将来跟着占位符一次删掉。

这个结构直接服务于任务书那条要求 —— **加暗色只需换一组值，不需要重写选择器**：现在
`src/shell/**.css` 里没有任何一个颜色是在选择器里写死的（两组豁免除外），一个
`#shell[data-theme="dark"]` 的覆盖块就能整体换掉。

代价是 `tokens.css` 的声明数从 50 涨到 110（其中带颜色值的从 25 涨到 71）。这个数字本身是
**审计结论的一部分**：这个壳真的有 11 个不同的墨色、6 个不同的 hover 底色，它们过去被分散在
五个文件里所以没人数得清。现在它们并排在一张表里，§4.1 那张合并候选表才有可能被编出来。

### 1.3 Status 一节

上一个 session（commit `4a716ea`）已经建了 `--shell-status-danger: #ad5347`，我在它之上补：

| 令牌 | 值 | 出处 |
|---|---|---|
| `--shell-status-danger` | `#ad5347` | **原型** `.cx-form-error{color:#ad5347}`（已有） |
| `--shell-status-done` | `#617f6f` | **原型** `#app #task .step.done{color:#617f6f}` |
| `--shell-applied-line` | `#cddac9` | 原型 0 命中，shell 自己长的 |
| `--shell-applied-surface` | `#f5f8f4` | 原型 0 命中，shell 自己长的 |

命名口径按 main 的裁定：后两个**不叫** `--shell-status-success-*`，因为那读起来像「设计定的
成功色」，而它们只是这个壳自己长出来的两个值。名字跟着表面走（「applied 的边/底」），
注释里写明原型里对应的是 `--sage/#718f80` / `--sage-soft/#edf3ef`、取值不同、本轮不对齐。

`nav.css:502` 的 `#ad5347` 换成了 `var(--shell-status-danger)` —— 这是全仓第二个「错误红」，
Δ=0，合并它是纯收敛，没有外观变化。

### 1.4 一处要更正 main 的结论（有证据）

main 给的表里写 `#617f6f` 是「假阳性 —— 落在 base64 资源里，不是 CSS」。**不是。** 它在原型里
是真 CSS，而且是同一个表面：

```
#app #task .step.done{color:#617f6f}
```

（在 27MB 文件的第 175,748 字节处，前后文是 `#app #task .user-bubble{…}` 和
`#app #task .step.working{…}`，一整段 `#app #task` 的规则。）

这正好是 `agent.css` 的 `.shell-task-step.is-done` 所移植的那条规则。所以「完成态的绿」是
**有原型依据的**，只有 `#cddac9` / `#f5f8f4` 那一组是 shell 自长的。

**方法教训（main 说得对，但我这里给出可操作的版本）**：27MB 里全是 base64，六位十六进制串
撞上是常事，`grep -c` 的计数完全不可信。可靠做法是**取前后 160 字节看有没有选择器**：

```bash
python3 -c "
import re;s=open('OfficeDex-Final-Light-Preview-2026-09-17.html',encoding='utf-8',errors='replace').read()
for m in re.finditer('617f6f',s,re.I): print(repr(s[m.start()-160:m.end()+60]))"
```

我用这个方法把四个语义色和两个 composer 色全查了一遍，结果在 §4.2。

### 1.5 Layers（z-index）

全量表进了 `tokens.css`，**分三组**，因为三组回答的是三个不同的「压过谁」：

| 组 | 令牌 | 值 | 作用域 |
|---|---|---|---|
| 根层叠上下文 | `--shell-z-chrome` | 3 | `.shell-windowbar` |
| | `--shell-z-presence` | 200 | `.shell-presence` |
| | `--shell-z-menu` | 300 | `.shell-menu`（W1-A 之后 portal 到 `#shell`） |
| **composer 局部** | `--shell-z-cx-drop` | 10 | 只在 `.shell-cx` 内部有意义 |
| | `--shell-z-cx-mention` | 180 | 同上 |
| legacy（**只声明不应用**） | `--shell-z-legacy-dialog` | 1000 | `components.css .od-dialog-mask` |
| | `--shell-z-legacy-popover` | 1050 | `.od-popover` |
| | `--shell-z-legacy-toast` | 1100 | `.od-toast-host` |
| | `--shell-z-legacy-tooltip` | 1200 | `.od-tooltip` |

三件事写进了注释：

1. **`.shell` 不建立层叠上下文**（`position:absolute; z-index:auto`，且无
   transform/filter/contain/opacity），所以 3 / 200 / 300 是直接互相比较的。
2. **S5-005 —— 10 和 180 是局部的。** `composer.css:5` 的 `container-type: inline-size`
   按 css-contain-3 施加 layout containment，**会**建立层叠上下文，于是这两个数只在
   `.shell-cx` 内部排序，而 `.shell-cx` 自身 `z-index:auto`。任务书第 ⑤ 条要求这件事必须
   写在表里，否则「表本身会骗人」—— 已写，原话是「a ladder that listed them beside 200 and
   300 without saying so would be a table that lies」。
3. **legacy 那四个只声明不应用。** `renderer/ui/styles/tokens.css` 与 `components.css` 不归
   我，值一个没动。它们在表里，是为了让 200→1000 之间那个 800 的空档成为一眼可见的事实，
   而不是靠撞车发现。

应用到了我拥有的三处（`chrome.css`、`agent.css`、`menu.css`）。composer 的两处留账（§3）。

### 1.6 Type scale

原来 4 档（10/11/12/14），现在 9 档：

| 令牌 | 值 | 出处 | 用在 |
|---|---|---|---|
| `--shell-text-xs` | 10px | 原有 | |
| `--shell-text-sm` | 11px | 原有 | |
| `--shell-text` | 12px | 原有（原型正文） | |
| **`--shell-text-md`** | **13px** | **原型** `.agent-home-hero .intro` 实测 13px/22.1px，**也是原型 `:root` 的字号** | `home.css` hero lede（13px/22px） |
| `--shell-text-lg` | 14px | 原有 | |
| **`--shell-text-xl`** | **17px** | **原型** `#od-companion .od-empty` 实测 17px | `agent.css` `.shell-task-empty strong` |
| **`--shell-text-2xl`** | **18px** | shell 自长 | `agent.css` `.shell-presence-collapse` 的「–」字形 |
| **`--shell-text-3xl`** | **26px** | shell 自长 | `home.css` `.shell-home-head h1` |
| **`--shell-text-4xl`** | **32px** | shell 自长 | `home.css` `.shell-hero h1` |

注释里明说这**不是**一个设计出来的模块化比例 ——「17 和 18 差 1px 就是破绽」—— 它是一份
**被变成可寻址的清单**。这样做的收益是 Wave 4 的「字号白名单」闸门可以做成闭集合，不带任何
逐行豁免。

**核对方法**：按 `design/prototype-README.md` 的要求读 **computed styles**，不是样式表 ——
用 Playwright 打开那份 27MB 的 HTML 逐个 `getComputedStyle`。结果见下节。

---

## 2. 改了哪些值

### 2.1 总账

| 文件 | 裸色值 前→后 | 离表字号 前→后 | z-index |
|---|---|---|---|
| `app.css` | 9 → **0** | 0 | — |
| `chrome/chrome.css` | 20 → **5**（豁免） | 0 | 3 → 令牌 |
| `chrome/menu.css` | 5 → **0** | 0 | 300 → 令牌 |
| `agent/agent.css` | 22 → **7**（豁免） | 2 → **0** | 200 → 令牌 |
| `nav/nav.css` | 12 → **0** | 0 | — |
| `home/home.css` | 0 | 3 → **0** | — |
| `home/highlights.css` | 0 | 0 | — |
| `home/taskList.css` | 0 | 0 | — |
| **合计（我的文件）** | **68 → 12** | **5 → 0** | 3 处上表 |
| `composer/composer.css`（**不归我**） | 29 | 4 + `font-weight:450` | 2 处 |

> S5 表 4 记的是 93 处裸色值（含 composer 27）。Wave 1/2 之后实际数是 68（我的）+ 29
> （composer，从 27 涨到 29）= 97。

### 2.2 逐条替换

全部是「同一个值，换一个来源」，`rgb()` 逐项相同（见 §5 的验证输出）。

`app.css`（9 处，全在 skeleton 段）：`#2536430f`×2 → `--shell-shadow-paper`；
`#eceef0`/`#e2e5e9`×2/`#f0f2f4`/`#edeff1`×2/`#f1f3f5` → `--shell-skeleton-*`。

`chrome.css`（15 处）：`#ffffff70`→`--shell-tab-hover`；`#4c5964`→`--shell-tab-ink`；
`#65748016`×2→`--shell-tab-action-hover`；`#4e5963`×2→`--shell-action-ink`；
`#30353a`→`--shell-share-hover`；`#e5e9ed`→`--shell-brand-hover`；
`#2b2b2b`→`--shell-brand-mark`；`#ffffff`→`--shell-ink-inverse`（Δ0）；
`#7d858c`→`--shell-brand-chevron`；`#354652`→`--shell-nav-current-ink`；
`#d3d6da`/`#e5dfd7`/`#857464`→`--shell-avatar-{line,fill,ink}`。

`menu.css`（5 处）：`#dfe2e6`→`--shell-menu-line`；`#34383c`→`--shell-menu-ink`；
`#edf0f3`→`--shell-menu-hover`；`#9aa8b3`→`--shell-menu-focus-ring`；
`#5c6872`→`--shell-menu-check`。

`agent.css`（15 色 + 2 字号）：`#7d7d7d`→`--shell-badge-fill`；`#ffffff`→`--shell-ink-inverse`
（Δ0）；两处 `drop-shadow` → `--shell-shadow-face{,-hover}`；`0 12px 48px #35465720` →
`--shell-shadow-float`；`#e9edf1`→`--shell-bubble-fill`；`#b6c2cd`→`--shell-bubble-quote-line`；
`#697480`→`--shell-reply-ink`；`#617f6f`→`--shell-status-done`；
`#d5dde2`/`#748997`→`--shell-spinner-{track,head}`；`#c3ccd4`→`--shell-button-hover-line`；
`#2b3035`→`--shell-button-primary-hover`；`#cddac9`/`#f5f8f4`→`--shell-applied-{line,surface}`；
`18px`→`--shell-text-2xl`；`17px`→`--shell-text-xl`。

`nav.css`（12 处）：`#374b5b`→`--shell-tree-folder-current-ink`；`#8b9eab`×2→`--shell-drop-line`；
`#e0e8ee`×2→`--shell-drop-fill`；`#929ba2`→`--shell-tree-chevron`；`#e2e6e9`→`--shell-tree-line`；
`#697885`→`--shell-tree-file-ink`；`#edf0f2`→`--shell-tree-file-hover`；
`#354a5b`→`--shell-tree-file-current-ink`；`#f0f1f3`→`--shell-list-row-line`；
`#ad5347`→`--shell-status-danger`（Δ0）。

`home.css`（3 处字号）：`26px`→`--shell-text-3xl`；`32px`→`--shell-text-4xl`；
`13px`→`--shell-text-md`。

### 2.3 两组豁免（保留裸值，旁边写了为什么）

**macOS 红绿灯，5 行**（`chrome.css`）：`#ff5f57` / `#febc2e` / `#28c840` / 描边 `#00000018` /
字形墨 `#343434c9`。注释的论证是：它们不是这个产品的调色板，是 macOS 的系统色；放进
`tokens.css` 等于把它们归档到「为了被主题化而存在」的那一栏，第一个做暗色的人会很合理地
调它们 —— 那一刻控件就不再像平台的了，而像个 bug。同时记下了它们在 Windows/Linux 上是错的
（控件在另一侧、方形、由系统绘制），并把这条指回 `.shell-tabs` 那个 132px 的 macOS 假设。

**companion 自己的调色板，7 行**（`agent.css:19/23/28/34/39/169/170`）：原注释只有一句
「the mark is ink-on-ink, not a themed control」，我把理由补全了：这个角色是**画**出来的
不是**样式**出来的，外壳/面板/眼睛/角标是四个值之间的固定关系，40px 下正是这个对比度让它
读起来像一张脸；一个主题如果各自挪动它们，不是给 companion 换色，是把它弄坏。

顺带记一件事：`--shell-brand-mark` 和 companion 的外壳**都是 `#2b2b2b`**。两处分开写是
刻意的（品牌方块属于 chrome、可以跟主题走；角色不跟），两边的注释互相指了一下，免得将来
有人当成重复而合并。

### 2.4 `.shell-home` 重复定义（S5-008 第二处）

`app.css` 和 `home.css` 各写一次 `.shell-home`，同选择器同特异度，谁赢取决于 `App.tsx` 的
import 求值顺序 —— 一个没有任何规则保证、任何 import 排序工具都能翻转的顺序。

两块的并集才是实际渲染结果：`app.css` 贡献 `flex:1` / `min-width:0` / `background`，
`home.css` 贡献 `padding` / `scrollbar-gutter`，`overflow:auto` 两边都写且相同。

**做法**：三条搬进 `home.css`，`app.css` 那块换成注释。归 `home.css` 的理由是
**渲染 `.shell-home` 的只有 `AgentHome.tsx` 和 `EditorHome.tsx`，两个都 import `home.css`**
—— 样式跟着组件走。并集逐字不变，所以 10 个组合的渲染指纹 `0 changed`。

（第一处 `.shell-windowbar` 已由 W2-F 修掉，`app.css` 的注释指回去了。）

---

## 3. 欠 `composer.css` 的账（下一轮逐条接）

`src/shell/composer/composer.css` 归另一个 session，本轮一行未动。**当前状态（行号按本轮
工作树，那个 session 仍在改，接手时请重新 grep）**：

### 3.1 裸色值 29 处

| 行 | 值 | 建议 |
|---|---|---|
| 14 | `#c7ced5` | 新令牌（composer 边框 hover） |
| 15 | `#00000008` | 新令牌（阴影） |
| 26 | `#00000005` | 新令牌（阴影） |
| 90/91/92 | `#eef3ef` / `#dce6de` / `#657b6c` | 一组绿，**原型 0 命中** |
| 96/97/98 | `#eff3f6` / `#dde5ec` / `#536879` | 一组蓝 |
| 121/176 | `#00000010` ×2 | 同值，应合并成一个令牌 |
| 231/237 | `#596f861a` / `#596f8629` | **是 `--shell-doc-accent #596f86` 加 alpha**，可用 `color-mix` 或新令牌 |
| 281 | `#f0f1f2` | |
| 310/311/316/317 | `#fdecea` / `#b3392c` / `#fadfdb` / `#8f2d22` | **录音红，原型 0 命中**（S5-011） |
| 350 | `#2b3035` | **与 `--shell-button-primary-hover` 同值，直接用** |
| 354/355 | `#e6e8ea` / `#ffffff` | `#ffffff` **= `--shell-ink-inverse`，Δ0，直接用** |
| 444/446 | `#7c8791` / `#f4f5f6ed` | |
| 523 | `#f0f2f3` | |
| 582/583 | `#efefef` / `#a0a3a6` | |
| 595/597/598 | `#e6dcc4` / `#fbf5e6` / `#7a6533` | **警告黄，原型 0 命中**（S5-011） |

**三处是白送的**：350 与 355 直接换既有令牌（Δ0 / 同值），231/237 是既有 accent 加 alpha。

### 3.2 离表字号 4 处 + 字重 1 处

| 行 | 值 | 备注 |
|---|---|---|
| 55 | `16px` | 需要新档（现有表没有 16） |
| 489 | `15px` | 需要新档 |
| 563 | `15px` | 同上，两处同值 |
| 584 | `9px` | 比现有最小档 10px 还小 |
| 549 | `font-weight: 450` | **令牌表完全没有 weight 一节**，要新建 |

> 顺带：原型的 `.cx-shortcut-heading>span` 里就写着 `font-weight:450`，所以 450 有原型依据，
> 但 shell 目前是零 weight 令牌、全部裸写（`500`/`550`/`600` 散在各文件）。建新 weight 一节
> 时应当把这些一起收，不只是 composer 那一处。

### 3.3 z-index 2 处

`composer.css:449 z-index:10`、`:457 z-index:180`。令牌已建好
（`--shell-z-cx-drop` / `--shell-z-cx-mention`），换上去即可。

### 3.4 S5-005 本体

`composer.css:5` 的 `container-type: inline-size` 建立层叠上下文，是让上面两个数对外失效的
根因。**本轮我只在令牌表的注释里写清楚了这件事**（任务书第 ⑤ 条），没有改那个文件。
接手时要决定：是接受它们是局部的（那就在 composer.css 里也写一句注释），还是
`.shell-cx` 显式声明一个 z-index 把这个上下文纳入阶梯。

### 3.5 语义色的原型对账结果（省得下一轮重查）

用 §1.4 的字节窗口法逐个查过：

| 值 | 语义 | 原型 | 结论 |
|---|---|---|---|
| `#ad5347` | 错误红 | ✅ `.cx-form-error` | 已成令牌 |
| `#a04e48` | 错误红（第二个） | ✅ `.form-error`（被后层覆盖） | 不用管 |
| `#617f6f` | 完成绿 | ✅ `#app #task .step.done` | 已成令牌 |
| `#cddac9` / `#f5f8f4` | applied 绿 | ❌ 0 命中 | 已成令牌，标注 shell 自长 |
| `#b3392c` 等 4 个 | 录音红 | ❌ 0 命中 | **composer，欠账** |
| `#7a6533` 等 3 个 | 警告黄 | ❌ 0 命中 | **composer，欠账** |
| `#718f80` / `#edf3ef` | 原型的 `--sage` | ✅ `:root`，全原型只用 1 次（表格合计行底色） | 见 §4.2 |

---

## 4. 本可以顺手做、但被我拆出来单独决定的

两类都是**可见的重新配色**。任务书写了「基准是原型，不是『更整齐』」，main 在 sage 那条上
也裁定「不要藏在一次收敛重构里，作为独立候选项让它被单独看见」。同一条原则适用于两类。

### 4.1 合并候选：与既有令牌差 ≤7 的 17 组

每合并一组，令牌表少一个条目、屏幕上变一点点。**逐通道最大差**：

| Δ | 新令牌 | 值 | 最近的既有令牌 | 用在 |
|---|---|---|---|---|
| 1 | `--shell-brand-hover` | `#e5e9ed` | `--shell-active #e4e9ec` | 品牌按钮 hover |
| 1 | `--shell-bubble-fill` | `#e9edf1` | `--shell-hover #e9edf0` | 用户气泡 |
| 2 | `--shell-tree-line` | `#e2e6e9` | `--shell-line #e4e6e9` | 文件夹竖线 |
| 2 | `--shell-skeleton-line-strong` | `#e2e5e9` | `--shell-line #e4e6e9` | 占位符 |
| 3 | `--shell-menu-check` | `#5c6872` | `--shell-ink-muted #596773` | 菜单对勾 |
| 3 | `--shell-skeleton-line` | `#eceef0` | `--shell-hover #e9edf0` | 占位符 |
| 4 | `--shell-menu-ink` | `#34383c` | `--shell-ink-title #343a40` | 菜单文字 |
| 4 | `--shell-menu-hover` | `#edf0f3` | `--shell-hover #e9edf0` | 菜单项 hover |
| 4 | `--shell-tree-file-hover` | `#edf0f2` | `--shell-hover #e9edf0` | 文件行 hover |
| 4 | `--shell-drop-fill` | `#e0e8ee` | `--shell-active #e4e9ec` | 拖放高亮 |
| 4 | `--shell-spinner-track` | `#d5dde2` | `--shell-line-strong #d9dfe4` | spinner 轨 |
| 4 | `--shell-skeleton-rule` | `#edeff1` | `--shell-hover #e9edf0` | 占位符 |
| 4 | `--shell-skeleton-thumb` | `#f1f3f5` | `--shell-chrome #f5f6f8` | 占位符 |
| 5 | `--shell-menu-line` | `#dfe2e6` | `--shell-line #e4e6e9` | 菜单边框 |
| 5 | `--shell-list-row-line` | `#f0f1f3` | `--shell-chrome #f5f6f8` | 列表行分隔 |
| 5 | `--shell-skeleton-block` | `#f0f2f4` | `--shell-chrome #f5f6f8` | 占位符 |
| 6 | `--shell-share-hover` | `#30353a` | `--shell-ink-title #343a40` | Share hover |
| 7 | `--shell-brand-chevron` | `#7d858c` | `--shell-ink-subtle #7e8285` | 品牌箭头 |

**建议的下一步不是「全合」**，而是分两批：
skeleton 那 5 个不用合（跟着占位符一起删更省）；
剩下 13 个里，`--shell-menu-hover` / `--shell-tree-file-hover` / `--shell-skeleton-line` /
`--shell-skeleton-rule` 四个都是「比 `--shell-hover` 亮 3–4」的同一族，它们合在一起才是
一条有意义的决定（「hover 只有一个底色」），单独合任何一个都只是少一行。

### 4.2 与原型的真实分歧：Agent Home 的大标题

用 Playwright 读原型的 computed styles（`design/prototype-README.md` 要求的方法）：

| | 原型 `.agent-home-hero h1` | shell `.shell-hero h1` |
|---|---|---|
| font-size | **31px** | 32px |
| line-height | **38.75px** | 38px |
| font-weight | **550** | 500 |
| letter-spacing | **-1.1px** | -0.4px |

四项里三项不同，**letter-spacing 差 0.7px 是四项里最看得出来的**（一行 20 个字累计 14px）。

另两条对得上，作为对照证明方法可信：`.agent-home-hero .intro` 原型 13px/22.1px vs shell
13px/22px；`#od-companion .od-empty` 原型 17px vs shell 17px。

还有一条更大的：**原型的 `:root` 字号是 13px，shell 的正文是 12px**。`.shell-home-head h1`
的 26px 在原型里 0 命中，而 `26 = 2em × 13px` 正好是一个无样式 `<h1>` 在 13px 根下的
UA 默认值 —— 我的猜测是这个 26px 是从原型某个没有显式字号的 `h1` 上量下来的。
（原型全文没有 `h1{}` 规则、也没有任何 em/rem 字号，所以这只是猜测，不是结论。）

**这些我都没动。** 它们是产品/设计要拍的，不是一次收敛重构该夹带的。

### 4.3 sage

原型 `:root` 里有 `--sage:#718f80` / `--sage-soft:#edf3ef`，全原型只用过一次
（`.cell.total` 表格合计行的底色）。它更像调色板里的一个强调色，不像一个被反复使用的
success 语义。把 `--shell-applied-*` 对齐到它是一次可见的重新配色，按 main 的裁定
**单列为候选项，不在本轮做**。

---

## 5. 四项验证的真实输出

### 5.1 并发污染与 A/B 隔离

本条 track 执行期间，共享工作树里至少有三个别的 session 在写：`canvas/**`、`composer/**`、
以及一个 i18n track（`main.tsx` / `FileTree.tsx` / `fileTreeModel.ts` / `Sidebar.tsx` …）。
所以**每一项验证都在干净 worktree 里做了 A/B**：

```bash
git worktree add /tmp/w3i-ab --detach 4a716ea
ln -s <repo>/node_modules /tmp/w3i-ab/node_modules
cp -R src/renderer/generated /tmp/w3i-ab/src/renderer/generated   # 否则 tsc 因缺 Wails 生成物假红
```

worktree 里只有 HEAD + 我的 9 个 CSS 文件 + 我的 spec，别人的改动进不来。

### 5.2 `npx tsc --noEmit`

**直接跑、读真实退出码，没有经过管道**（任务书点名的坑：`| tail` 之后的 `$?` 是管道末端的）。

```
共享工作树:  tsc exit=2
  src/canvas/SheetStage.tsx(76,52): error TS2554: Expected 2 arguments, but got 1.

干净 worktree (4a716ea + 仅 W3-I):  tsc exit=0   （零输出）
```

那一条红在 `src/canvas/SheetStage.tsx` —— 一个**未跟踪的新文件**，属于并发的 canvas session。
A/B 证明它与本 track 无关。

`tsconfig.json` 的 `include` 只有 `src`，**e2e 不在 `npm run lint` 的覆盖里**，所以新 spec
另外单独过了一遍：

```
npx tsc --noEmit --skipLibCheck --target es2022 --module esnext \
  --moduleResolution bundler --strict --lib es2023,dom e2e/fix-w3i.spec.ts
→ exit=0
```

### 5.3 `npx vitest run`

```
共享工作树:       exit=1   Test Files 1 failed | 190 passed (191)
                          Tests      1 failed | 1362 passed (1363)
  FAIL src/canvas/PresentationCanvas.test.tsx > PresentationCanvas selection
       > reports nothing selected as nothing to quote

干净 worktree:    exit=0   Test Files 183 passed (183)
                          Tests      1311 passed (1311)
```

**1311/1311，一个不少**，正好是任务书给的基线。共享树里多出的 52 个用例和那一个失败都是
并发 session 的（失败在 `src/canvas/`，同一个 canvas track）。

### 5.4 视觉不回归：`e2e/fix-w3i.spec.ts`

新 spec，**四个 pass，零条件 skip**（任务书硬要求；对照 `ui-audit-s4.spec.ts` 那 30 个
`test.skip(!BRIDGE)` 报「30 skipped / exit 0」的反面教材）。

| pass | 覆盖 | 为什么单独存在 |
|---|---|---|
| `declarations` | `src/shell` 全部样式表的每条颜色/尺寸声明，在 `#shell` 里解析成实际会画的值 | **唯一能到达 fixture 渲染不出来的规则**：`:hover` / `:active` / `[data-applied]` / `.is-drop-target` / skeleton。一个 hex 和替换它的令牌解析成同一个 `rgb()`，所以保值的替换在这里是隐形的、不保值的会带着选择器名字报出来 |
| `tree` | 10 个组合下 `#shell` 全子树的 computed 指纹 | pass 1 孤立地读规则，这个读**层叠**；也是唯一能看见 `.shell-home` 去重的 |
| `menu` | portal 出去的菜单面板 | 不打开就不在树里，而它占了 5 处裸值 |
| `probes` | fixture 永不渲染的表面，注入 `#shell` 后按真实层叠渲染再取指纹 | 覆盖状态专属规则；也是 `.shell-task-spinner` 的**唯一**证据（见下） |

**基线**：`docs/ui-audit-2026-09-19/fixes/W3-I/baseline.json`（2.9MB，未缩进 —— 一万条机器
指纹，缩进只会让体积翻倍而不会更易读），在干净 `4a716ea` 上录制。

**改后（干净 worktree，只有我的改动）**：

```
W3I declarations: 1203 probed, 0 moved, 60 added, 5 accepted
W3I tree C1:  1539 nodes, 0 changed, 0 added, 0 removed
W3I tree C2:  1541 nodes, 0 changed, 0 added, 0 removed
W3I tree C3:  1132 nodes, 0 changed, 0 added, 0 removed
W3I tree C4:  1137 nodes, 0 changed, 0 added, 0 removed
W3I tree C5:   543 nodes, 0 changed, 0 added, 0 removed
W3I tree C6:   545 nodes, 0 changed, 0 added, 0 removed
W3I tree C7:   537 nodes, 0 changed, 0 added, 0 removed
W3I tree C8:   539 nodes, 0 changed, 0 added, 0 removed
W3I tree C9:   325 nodes, 0 changed, 0 added, 0 removed
W3I tree C10:  330 nodes, 0 changed, 0 added, 0 removed
W3I menu C2/C6/C8:  11 nodes each, 0 changed
W3I probes C2/C6:  159 nodes each, 0 changed
  4 passed
```

`60 added` = 我新增的 55 个令牌声明 + 5 个新规则位；**`0 moved` 表示 1,148 条原有声明的
解析值一条没变**。10,152 个渲染节点 `0 changed`。

**在共享工作树里跑（含所有并发改动）同样 4 passed**：`0 changed`，只是多报
`11–14 added`（composer/Hero 新增的 DOM）和 `62 added`（多出 2 条 composer 新规则）。
这说明这条闸门不会因为别人往 DOM 里加东西就红。

**白名单只有 5 项，全部是同一个 CSSOM 缺陷，不是外观变化**：

`.shell-task-spinner` 的规则形状是 `border: 2px solid <track>` 后面跟
`border-top-color: <head>`。这两个值一旦变成 `var()`，简写就成了 pending-substitution，
而同一个盒子的长写又覆盖了它的一部分 —— **这个状态没有任何序列化形式**：
`getPropertyValue("border")` 返回空串，`cssText` 直接把 border 整条丢掉，探针的两条路都拿不到。
规则本身没问题，**是读法在替换之后才失效**，这正是假阳性的形状。

我没有为了迁就测量去改样式表，而是加了第四个 pass：真渲染一个 `.shell-task-spinner`，
断言它四条边的 computed 颜色 —— 同一个主张，换一个不涉及序列化的地方证明：

```
W3I probes C2: spinner {"top":"rgb(116, 137, 151)","left":"rgb(213, 221, 226)","width":"2px"}
W3I probes C6: spinner {"top":"rgb(116, 137, 151)","left":"rgb(213, 221, 226)","width":"2px"}
```

这个断言是**硬编码期望值**的，所以哪天 `agent.css` 没被加载、探针拿到未加样式的节点，
它会红而不是悄悄匹配一份陈旧基线。

> **一个值得推广的坑**（和 SUMMARY §3.2 的 `settle()` 同类）：指纹最初按**文档顺序下标**做
> key。在共享树里跑，composer session 往 DOM 里插了 11 个节点，结果报 **886 个「moved」**，
> 其中一个都没真的变。按下标 key 的快照会把一次插入放大成整棵子树的告警，这种闸门第一天
> 就会被关掉。改成**从 `#shell` 起的 `tag.class` 路径**（只在同 key 兄弟间加序号）之后，
> 同样的插入报 `0 changed, 11 added`。

### 5.5 前两波没被打破

```
npx playwright test e2e/fix-w1a e2e/fix-w1b e2e/fix-w2e e2e/fix-w2f
干净 worktree:  52 passed (1.2m)
共享工作树:     52 passed (1.2m)
```

其中 `fix-w2f.spec.ts` 的 `S1-013 the window bar is declared once` 用例仍然
`{"declarations":1}` 通过 —— 它和我对 `.shell-home` 做的去重是同一个形状，可以直接照抄
一条 `.shell-home` 的版本进 Wave 4 闸门。

> **副作用已清理**：重跑这四个 spec 会把 `docs/ui-audit-2026-09-19/fixes/W*/screenshots/`
> 的图按当前工作树重写 —— 而当前工作树里有 i18n track 的半成品，那些图会变成中英混排的
> 假证据。已 `git checkout --` 还原 W1-A / W1-B / W2-E / W2-F 四个目录。
> （W2-G 的两张 `M` 不是我造成的，我没跑过 `fix-w2g`，未动。）
> 这和 SUMMARY §3.1 记的是同一个陷阱，只是那条记的是 `S*/screenshots/`，`fixes/*/screenshots/`
> 同样会被盖，建议补进 SUMMARY。

---

## 6. 交给 Wave 4 的闸门素材

W4 track 已经在 `29bea0a` 落地（`e2e/gates.spec.ts` + `scripts/verify-shell-styles.mjs` +
三个 `src/shell/test/*`）。它的文件头第 2 条盲点明确写着，重叠检测
**「不在这里，因为 W3-I 还在重建 z-index 阶梯，按今天的数字写的闸门在它落地那天就作废」**
—— 阶梯现在在了，那条可以补了。

我这边跑过它的两个闸门，都过：
`npx vitest run src/shell/test` → `13 passed (4 files)`；
`node scripts/verify-shell-styles.mjs` → `exit=0`（`4217 classes, OK`）。

S5 的闸门草案里有三条依赖本轮，现在可以落地了：

1. **裸色值禁令** —— 逐行白名单从 S5 预计的「永远带 9 个豁免」缩到 **12 行两组**，
   且两组都有成文理由（`chrome.css` 的 5 行红绿灯、`agent.css` 的 7 行 companion）。
   composer.css 的 29 行要么先还账、要么暂时进白名单。
   （`agent.css` 那段注释已经刻意不写出色值本身，否则按文本计数的闸门会数出 8 而不是 7。）
2. **字号白名单** —— 我的文件里已是**闭集合零豁免**；composer 的 4 处（9/15/15/16px）
   决定「补档」还是「进白名单」之前，这条不能全仓开。
3. **z-index 阶梯** —— `ALLOWED` 不再是 S5 草案里手抄的 `{3,10,60,180,200}`，改成
   「`z-index` 的值必须是 `var(--shell-z-*)`」，这比枚举数字强，因为它顺带把
   「新数字必须先进表」变成强制。当前全仓只有 `composer.css` 的两处还是裸数字（§3.3）。
   S5 草案的第二条（「z-index 不得落在未声明的层叠上下文里」）现在有了对照物：
   `composer.css:5` 是那个上下文，`--shell-z-cx-*` 是被声明过的两个。
   **W4 那条被推迟的重叠检测现在也解锁了**：`.shell-menu` 300 > `.shell-presence` 200，
   S2-010 的场景应当能在 `elementFromPoint` 上直接断言。

另外，`e2e/fix-w3i.spec.ts` 本身可以直接当 Wave 4 的「外观棘轮」用：它不关心值是多少，
只关心值有没有在无人声明的情况下变过。重录一次基线的命令写在文件头。

---

## 7. 没做 / 做不到 / 存疑

- **暗色：没做**（产品决策 D4）。但结构已经就位：`src/shell/**.css` 里不再有选择器内写死的
  颜色，一个 `#shell[data-theme]` 覆盖块就能整体换。未验证过暗色下这 71 个颜色令牌够不够 ——
  很可能不够（阴影、alpha 叠色、companion 的四个值都需要单独处理）。
- **26px 的来源是猜测**（§4.2），不是结论。
- **`--shell-text-2xl: 18px` 名不副实**：它唯一的用途是折叠按钮那个「–」字形的字号，
  是个字形度量不是排版级差。我把它放进 type scale 是为了让字号闸门成为闭集合；
  如果 Wave 4 觉得这算作弊，替代方案是单开一个「glyph metrics」小节。
- **没有截图对比**。本轮的视觉证据全部是 computed value 的逐项断言，不是像素 diff。
  computed value 相同不能 100% 推出渲染像素相同（例如子像素抗锯齿），但对于「只改了颜色和
  字号的来源」这个变更面，它是充分的，而且比截图 diff 稳定得多（截图会被并发 session 的
  DOM 改动和 i18n 文案全部搅浑 —— 这不是假设，§5.5 那 15 张被重写的图就是实证）。
- **`baseline.json` 2.9MB**。任务书指定了路径和格式。已去掉缩进；进一步压缩需要给指纹做
  字典编码，会让 spec 多一层编解码，判断不值得。
