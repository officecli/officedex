# W4b — 补完 W4 推迟的两条闸门

日期：2026-09-20 ｜ 分支 `develop/1.0` ｜ 基线 commit `bd3b151`（验证期间 HEAD 前移到
`c3d0306`，两笔都是 docs-only，已在新 HEAD 上重跑，结果一致）｜ **未 commit**

W4 §9 把两条草案推迟，理由是「白名单要以 W3-I 重建的令牌表为准，提前写会立刻过期」。
W3-I 已在 `c9cdf6f` 落地（9 档 z-index 阶梯 + 9 档字号 + 12 处有理由的裸值豁免），
两条现在都能写了。

新增三个文件，**全部是我的**，没有改任何既有源文件：

| 文件 | 行 | 内容 |
|---|---|---|
| `src/shell/test/cssModel.ts` | 221 | 共用的 CSS 读取器（声明 / 选择器 / 注释） |
| `src/shell/test/layers.test.ts` | 597 | 闸门 ⑥ z-index 阶梯（8 条断言） |
| `src/shell/test/tokenDiscipline.test.ts` | 572 | 闸门 ⑦ 裸色值 + 字号（7 条断言） |

## 0. 交付清单

| | 闸门 | 断言 | 跑法 | 耗时 |
|---|---|---|---|---|
| ⑥ | z-index 来自声明的阶梯 + 层叠上下文必须被交代 | 8 | `npx vitest run` | **30–51ms**（三次实测） |
| ⑦ | 裸色值禁令 + 字号白名单 | 7 | `npx vitest run` | **22–44ms**（三次实测） |

**两条合计约 70ms**，和 W4 那三条（62ms）同一个量级，进 `npx vitest run` 不会让任何人
不愿意跑。不需要构建、不需要浏览器、不需要 dev server。

## 1. 验证（断言式，全部在干净 worktree）

`git worktree add /tmp/w4b-gates --detach HEAD` + 软链 `node_modules` + 拷入
`src/renderer/generated`（否则 tsc 因缺 Wails 生成物假红）。

```
$ npx tsc --noEmit > /tmp/w4b-tsc.txt 2>&1; echo "TSC_EXIT=$?"
TSC_EXIT=0                     # 重定向到文件再读 $?，没有经过管道
--- output ---
                               # 零输出

$ npx vitest run > /tmp/w4b-vitest.txt 2>&1; echo "VITEST_EXIT=$?"
VITEST_EXIT=0
 Test Files  188 passed (188)
      Tests  1337 passed (1337)      # 基线 1322 + 新增 15（8 + 7），只增不减
   Duration  8.92s

 ✓ src/shell/test/layers.test.ts (8 tests) 30ms
 ✓ src/shell/test/tokenDiscipline.test.ts (7 tests) 27ms
 ✓ src/shell/test/combinationSelectors.test.ts (5 tests) 18ms     ← W4 的三条
 ✓ src/shell/test/portalHost.test.ts (3 tests) 61ms                  仍然全绿
 ✓ src/shell/test/copyRatchet.test.ts (3 tests) 16ms
 ✓ src/shell/test/deadControls.test.ts (2 tests) 18ms
```

**在共享工作树里同样 15 绿**，包括另一个 session 正在改的
`composer.css` / `app.css` / `chrome.css` / `nav.css` / `home.css` / `highlights.css`
六个样式表都带着未提交改动的状态下（§4 说明为什么它不敏感）。

worktree 已 `git worktree remove`，临时脚本已按精确路径删除。共享工作树里我只新增了
上表那三个文件，**没有 `git checkout -- <file>`，没有 commit**。

## 2. 闸门 ⑥ z-index —— `src/shell/test/layers.test.ts`

### 守什么

两件事，分开写都不值钱。

**第一件是无聊的那件。** W3-I 之前，五个 z-index 是四个样式表里的五个字面量，没有任何
地方能一起看见它们 —— 这就是 `.shell-menu` 曾经是 60 而 `.shell-presence` 是 200 的
由来（S2-010）。60 一直好用，因为在浮动面板里打开的菜单是它的 DOM 子节点、继承了面板
自己的 200；直到 W1-A 把菜单 portal 到 `#shell`，这个数才第一次真的去和面板比较。
**缺陷是「挑数字时看不见别的数字」**，所以断言不是「值在这个集合里」，而是
「值必须是 `var(--shell-z-*)`」—— 这让加一档变成一次对 `tokens.css` 和对本文件的编辑，
而不是一行谁都能写下的数。

**第二件是真会咬人的那件。** 阶梯只在一个层叠上下文里成立，而 `composer.css:5` 开了
另一个：`.shell-cx` 上的 `container-type: inline-size` 按 css-contain-3 施加布局限制，
于是 `.shell-cx-drop` 的 10 和 `.shell-mention` 的 180 只跟彼此排序（S5-005）。
把这两个数和 200、300 并排印在一张表里，那张表就在撒谎。

### 八条断言

| | 断言 | 抓什么 |
|---|---|---|
| 1 | 阶梯就是 `tokens.css` 声明的那个集合 | 双向：表里多一档 / `tokens.css` 少一档都红 |
| 2 | 每个 z-index 都由阶梯供给 | 裸数字；且 debt 条目的字面量必须**等于它欠的那档的值**，所以欠着令牌期间数字也不能漂 |
| 3 | 每个 z-index 都登记了它所在的层叠上下文 | 双向：新 z-index 没登记 / 登记的规则没了 |
| 4 | 根阶梯与局部阶梯**不相交** | 任务书那条「交集必须为空」的机器可判形式 |
| 5 | 有 z-index 的样式表里，每个层叠上下文都被交代 | 双向；可用 `/* stacking-context: … */` 在自己文件里就地回答 |
| 6 | 没有 z-index 的样式表也不能悄悄绕过 | §2 那个窄作用域的安全前提，钉成一张 7 条的名单 |
| 7 | 数一数 TypeScript 写过去的样式字面量 | 双向，见 §5 发现 1 |
| 8 | 扫描器还在读东西 | 解析器失效时上面七条会全绿 |

**已登记**：9 档阶梯、5 个 z-index 站点（3 个 root + 2 个 composer 局部）、
**23 个层叠上下文**（composer 2 + agent 13 + chrome 7 + menu 1），每个带一句
「它裹住了谁 / 为什么裹不住 z-index」。

### 两条设计决定

**① 层叠上下文的判定按规范收窄，不是启发式。** `opacity: 1`、`transform: none`、
`filter: none`、`will-change: auto` 在这些样式表里真实存在，而它们**不开**层叠上下文 ——
规范是明确的。排掉它们是正确性不是聪明，代价为零，收益是要交代的清单从 **31 条降到 19 条**
（再加上解析器找到的 4 条多行 `transform`，最终 23 条）。

**② 阶梯的断言是「必须是 `var(--shell-z-*)`」，不是「值在 {3,10,60,180,200} 里」。**
S5 草案是后者。前者强在它顺带把「新数字必须先进阶梯」变成强制：写 400 会红，把 400
加进 `tokens.css` 也会红（断言 1），只有同时改了 `tokens.css` 和本文件的表才绿。

### 盲区（写在文件头，这里摘要）

1. **包含关系来自 DOM，而这条读的是 CSS。** `.shell-mention` 在 `.shell-cx` 里面是因为
   `Composer.tsx` 那么渲染的；这些是扁平的 BEM 式类名，没有后代组合子，**任何选择器分析
   都恢复不出这件事**。所以登记表里的 `context:` 是**一个人做出的断言**，闸门检查的是这个
   断言自洽、且 CSS 仍然支持它 —— 不是它对渲染树为真。互补的那半应该在运行时：
   对面板中心做 `elementFromPoint`，放在 `e2e/`。**那条还没写。**
2. **跳过 `@keyframes`。** 一个正在跑 `transform` 动画的元素在动画期间确实会开层叠上下文，
   所以 companion 那 7 个关键帧 transform 是个**只在动画期间存在**的上下文。排除它们是因为
   替代方案是登记 17 个关键帧步骤、而它们没有任何定位后代。**如果哪天一个带关键帧的元素
   裹住了 z-index，这条不会说。**
3. **它看样式表。** `attentionOverlay.ts` 从 TypeScript 给元素内联 `zIndex: "3"`，
   任何 CSS 扫描都够不着。那一个被断言 7 双向盯着，所以它是个已知的洞而不是未知的洞。
4. **正确的修法不是更聪明的扫描器**（两种都不是）：是 `position` + `z-index` 由一个接受
   档位名的共用 helper 设置，根本不存在可被找到的字面量。

### 红 → 绿证明（八条全部，原始输出）

每一条：注入缺陷 → 跑 → 还原 → 再跑。`injected exit=1  restored exit=0` 是自动对账的。

```
L1 一个第十档出现在 tokens.css 里而没人决定它排在哪
   injected exit=1 restored exit=0
   × the z-index ladder > is exactly the set tokens.css declares 22ms
   → expected { '--shell-z-chrome': '3', …(9) } to deeply equal { …(8) }

L2 样式表写了数字而不是档位            （menu.css: var(--shell-z-menu) → 400）
   injected exit=1 restored exit=0
   × the z-index ladder > supplies every z-index in the shell's stylesheets
   AssertionError: expected [ Array(1) ] to deeply equal []
   + [ "src/shell/chrome/menu.css:36 .shell-menu -> 400" ]

L3 新的 z-index 出现而站点表里没有它
   injected exit=1 restored exit=0
   × the z-index ladder > names, for every z-index, the stacking context it sorts in
   → expected [ …(6) ] to deeply equal [ …(5) ]

L4 有人声称 mention 浮层在根上排序（S5-005 这个误解本身）
   injected exit=1 restored exit=0
   × the z-index ladder > keeps root rungs and context-local rungs disjoint
   + [
   +   ".shell-mention claims root but .shell-cx contains it",
   +   ".shell-mention sorts at the root on the local rung --shell-z-cx-mention"
   + ]

L5 有 z-index 的样式表里冒出一个新的层叠上下文   （menu.css 加 contain: layout）
   injected exit=1 restored exit=0
   × the z-index ladder > accounts for every stacking context in a stylesheet that has a z-index
   AssertionError: expected [ Array(1) ] to deeply equal []

L6 没有 z-index 的样式表里冒出一个层叠上下文     （app.css 加 transform: translateZ(0)）
   injected exit=1 restored exit=0
   × the z-index ladder > is not quietly bypassed by a stylesheet that declares no z-index of its own
   @@ -1,6 +1,7 @@
   +   "src/shell/app.css  .shell-probe { transform }",
       "src/shell/home/highlights.css  .shell-highlight-play { transform }",
       …

L7 一个颜色和一个 z-index 被从 TypeScript 写出来
   injected exit=1 restored exit=0
   × the z-index ladder > counts the style literals TypeScript writes past it
   → expected { …(2) } to deeply equal { …(1) }

L8 CSS 读取器停止读取                     （在 cssModel.ts 里把解析短路掉）
   injected exit=1 restored exit=0
   × the z-index ladder > finds the declarations it is meant to be checking
   → expected 0 to be greater than or equal to 5
```

L4 和 L8 的缺陷注入在**闸门自己的表**里而不是 CSS 里，因为它们模拟的缺陷是**一个主张**
而不是一行样式：L4 就是「以为 180 对外有效」这个误解，L8 是扫描器瞎掉。

## 3. 闸门 ⑦ 裸色值 + 字号 —— `src/shell/test/tokenDiscipline.test.ts`

### 守什么

S5 在 `src/shell` 里数出 93 处裸色值，并写明这条闸门当时**写不了**，因为它会带着九个
常设豁免出生 ——「一条自带九个豁免的禁令不是禁令」。W3-I 把壳自己的样式表从 68 降到 12、
把 5 处离表字号降到 0，规则这才可写。

**规则不是为了「用令牌」而用令牌。** 它挡的缺陷很具体：`tokens.css` 声称换掉一组值就能
给壳加暗色主题，而这个声称**恰好在「没有颜色写在选择器里」时为真**。每一处裸值都是一块
换主题后仍然会亮着的表面。

### 七条断言

| | 断言 | 抓什么 |
|---|---|---|
| 1 | 字号档就是 `tokens.css` 声明的那 9 档 | 双向 |
| 2 | `tokens.css` 之外的样式表不写颜色 | hex / `rgb()`/`hsl()`/`lab()`/… / 一张具名色清单 |
| 3 | 不写字号档之外的 `font-size` | |
| 4 | 引用的每个 `--shell-text-*` 都真的存在 | 拼错的 `var()` 解析成空、元素继承，看起来像布局 bug |
| 5 | **每一条豁免仍然是违例** | 双向；**并且钉住取值** |
| 6 | 没有一条豁免是「整个文件」或空理由 | 防「加一行让 CI 变绿」 |
| 7 | 扫描器还在读东西 | |

**43 条豁免**：chrome.css 5（macOS 红绿灯）+ agent.css 7（companion）+ composer.css 31
（27 色 + 4 字号）。

### 白名单为什么按「选择器 + 属性」而不是 `文件:行`

任务书要求「精确到行，不要按文件豁免」。**按文件豁免我没有做**；但键我没有用行号，
用的是 `(file, selector, property)`，理由是可测量的：

> `composer.css` —— 这里唯一真有欠账的文件 —— 在写这两条闸门的**同一个 session 期间**，
> 把它的 z-index 从第 382 行挪到了第 449 行（**67 行位移**），因为拥有它的 session 正在
> 上面加规则。一条会因为别人编辑了自己根本不检查的文件顶部而变红的闸门，一周内就会被删掉
> —— 这正是 W4 闸门 ④ 刻意避开的那个错误（「行号会因为上面任何一次编辑而移动」）。

`(file, selector, property)` 在全部 43 条里唯一，对别处的插入免疫，而且**在真正要紧的
那一点上比行号更严**：它把**取值也钉住**了，所以偷偷把一处豁免的颜色改掉会红，而
`chrome.css:137` 会心满意足地继续指向一个不同的红（**T5b 实测，见下**）。
唯一比行号弱的地方：一条豁免的声明原样搬到同一文件的另一个位置 —— 但那是个空操作，
搬到**另一个选择器**上照样会红。

### 豁免分两类，它们不是同一种东西

数据结构上分开、报错信息上也分开：

- **by-design（chrome.css 5 + agent.css 7）**：W3-I 在样式表里逐条论证过为什么令牌化会让
  产品更糟。它们没有到期日，所以每条写的是**撤销条件**：红绿灯的是「窗口控件改由平台绘制、
  或非 macOS chrome 发版的那天」（它们在 Windows/Linux 上已经是错的：另一侧、方形、系统绘制）；
  companion 的是「这个角色从插画变成一个可主题化的控件的那天」。
- **debt（composer.css 31）**：令牌已经存在或应该存在，文件有主，每条写了**谁欠的**
  （「拥有 `src/shell/composer` 的人 —— 整个 Wave 4 期间它都在被并发编辑，这正是 W3-I
  不动它而把替换方案写下来的原因」）和**什么删掉这一行**（逐条指到 W3-I.md §3 的对应项）。

三处是白送的，注释里点名了：`#2b3035` = `--shell-button-primary-hover`（Δ0）、
`#ffffff` = `--shell-ink-inverse`（Δ0）、`.shell-cx-drop` 的两处与 `nav.css` 的
`--shell-drop-line` / `--shell-drop-fill` 是同一个手势。

### 盲区

1. **它读样式表，所以从 TypeScript 上样式的东西全看不见。** `attentionOverlay.ts` 用
   `Object.assign(el.style, …)` 写了四个渐变停靠点。**那个洞被闸门 ⑥ 的断言 7 双向盯着**
   —— 这是它在这里只是个脚注而不是未知数的唯一原因。
2. **它找 hex、`rgb()`/`hsl()` 和一张具名色清单。** 用别的拼法到达的颜色
   （`color(display-p3 …)`、系统色关键字）不会被发现。`currentColor` 和 `transparent`
   是颜色但不钉值，刻意放行。
3. **「来自档位」不是「尺寸对」。** 标题上写 `var(--shell-text-xs)` 会过。这条让尺寸集合
   闭合，某个表面选对没选对是设计评审。
4. **`font-weight` 完全没被守。** `src/shell` 里有 **17 处裸字重**（400/450/500/600），
   而 `tokens.css` 没有 weight 一节可以对照 —— 闸门会是在对着空气断言。建那一节是前置
   条件，是某个人的工作，不是这个文件的豁免。记在这里，好让它是个已知的缺口而不是沉默的。
5. **正确的修法在任何扫描器的上游**：颜色要么经过自定义属性上屏、要么上不了屏。那是一条
   stylelint 规则（`declaration-property-value-disallowed-list`，同一套豁免），编辑器在你
   打字时就跑。这条闸门是今天存在的那个版本。

### 红 → 绿证明（七条全部）

```
T1 第十档字号出现而没人决定
   injected exit=1 restored exit=0
   × the type scale is exactly the set tokens.css declares
   → expected { '--shell-text-xs': '10px', …(9) } to deeply equal { …(8) }

T2 一个裸色值被写进样式表               （nav.css: color: #123456）
   injected exit=1 restored exit=0
   × no stylesheet outside tokens.css writes a colour

T2b 同一件事，拼成 rgb() 而不是 hex      （nav.css: color: rgb(18 52 86)）
   injected exit=1 restored exit=0
   × no stylesheet outside tokens.css writes a colour

T3 一个离表字号被写进样式表             （nav.css: font-size: 19px）
   injected exit=1 restored exit=0
   × no stylesheet writes a font-size the scale does not name

T4 引用了一个档位表里没有的档           （var(--shell-text-xxl)）
   injected exit=1 restored exit=0
   × every step a stylesheet names is one the scale declares

T5a 一处豁免被修好了，但那一行被留在表里  （#ff5f57 → var(--shell-status-danger)）
   injected exit=1 restored exit=0
   × every exemption is still a violation
   + [ "src/shell/chrome/chrome.css  .shell-window-close::before { background: #ff5f57 }" ]

T5b 一处豁免被就地悄悄改了颜色           （#ff5f57 → #ff5f58）
   injected exit=1 restored exit=0
   × every exemption is still a violation
   AssertionError: expected [ Array(1) ] to deeply equal []

T6 第四个文件被整体豁免（空理由的一行）
   injected exit=1 restored exit=0
   × holds no exemption that is not one file's debt or one stylesheet's argument
   → .x has no reason: expected 5 to be greater than 30

T7 颜色扫描器被弄瞎
   injected exit=1 restored exit=0
   × finds the declarations it is meant to be checking
   → expected 0 to be greater than 30
```

**T5b 是这套键设计的理由**：把一处 by-design 豁免的颜色悄悄换掉，正是红绿灯那条论证
明令禁止的动作，而按 `文件:行` 的白名单会放它过去。

## 4. 为什么它在共享工作树里也绿

我验证期间，共享工作树里至少三个别的 session 在写 `composer/**`、`canvas/**`、
`home/**`，并且把 `app.css` / `chrome.css` / `nav.css` / `home.css` / `highlights.css`
五个样式表也改了（这些改动在我开工时还不存在）。**15 条断言在那个状态下全绿**，
在 HEAD 从 `bd3b151` 前移到 `c3d0306` 之后又跑了一遍，仍然全绿。

这不是运气，是 §3 那个键设计的直接结果：这些闸门对**行号**、对**DOM 里新增的节点**、
对**别的文件里的编辑**都不敏感，只对「新的颜色 / 新的字号 / 新的 z-index / 新的层叠
上下文」敏感。

## 5. 闸门当场抓到的东西（只报不修）

| | 发现 | 抓到它的 | 归属 |
|---|---|---|---|
| 1 | **`src/shell/agent/attentionOverlay.ts` 从 TypeScript 写样式字面量**：`zIndex: "3"`（数值上就是 `--shell-z-chrome`，拼成了字符串）+ 4 个渐变停靠点 hex。任何 CSS 闸门都看不见 | ⑥ 断言 7 | agent / attention track |
| 2 | **W3-I.md §2.1 的「composer.css 29 处裸色值」已过期**：现在是 **27**。§3.1 列的 `231 #596f861a` / `237 #596f8629` 已被 composer 的 owner 换成 `color-mix(in srgb, var(--shell-doc-accent) 10%, transparent)`，hex 只剩在一段解释为什么这么做的**注释**里 | ⑦（人工对账时） | 文档 |
| 3 | **`grep -nE '#[0-9a-f]{3,8}'` 在这个仓库里会数注释**：发现 2 就是这么被我自己先误报出来的。`cssModel.ts` 剥注释，两棵树里都读到 27 | 本轮方法 | —— |
| 4 | **多行 `transform:` 会被按行的 grep 截断**：`agent.css` 有 4 条（`.shell-face-gaze` 和三个 `[data-edge]` 的 `.shell-face`），我最初的 survey 全漏了，是闸门 ⑥ 第一次跑红时报出来的 | ⑥ 断言 5 | 本轮方法 |
| 5 | **`.shell-presence` 折叠贴边时自己带 `opacity: .82`**，于是**在它自己身上**开了一个层叠上下文。它自己的 z-index 不受影响（仍然是父上下文里的 200），但这意味着**贴边期间 companion 画的任何东西都无法从它里面逃出去**。已登记并写明 | ⑥ 断言 5 | agent owner |
| 6 | **17 处裸 `font-weight`**（400/450/500/600）散在 6 个样式表，`tokens.css` 没有 weight 一节。W3-I §3.2 提过 composer 那一处，全仓的规模是 17。**建那一节之前，字重闸门无法存在** | ⑦ 盲区 4 | W3-I 后续 / 设计 |
| 7 | **`composer.css` 在一个 session 内位移 67 行**（z-index 382 → 449）。这是我不按 `文件:行` 做白名单的全部理由 | 本轮方法 | —— |

发现 1 值得单独说一句：`zIndex: "3"` 和 `--shell-z-chrome: 3` 是同一个数。这个 overlay
挂在它被给到的 host 里，今天不在根上下文，所以没撞车；**但它是这个壳里唯一一个不在阶梯上
的 z-index，而且没有任何 CSS 闸门能看见它**。闸门 ⑥ 的断言 7 双向盯着它的数量，
修好了必须删条目。

## 6. 给 merge 的人

- **不需要接线。** 两条都在 `src/shell/test/**`，`npx vitest run` 自动跑到，
  不像 W4 闸门 ② 那样欠一条 npm script。
- **composer 的 owner 还账时**：改 `composer.css` 的同一个 commit 里删掉
  `tokenDiscipline.test.ts` 的对应行、和 `layers.test.ts` 里那两条 `debt` 字段
  （站点本身留着）。**不删就会红** —— 这是设计。
- **`--shell-z-cx-drop` / `--shell-z-cx-mention` 的值已经被钉死**：换成令牌之前，
  那两个字面量也不能改成别的数（断言 2）。

## 7. 自报：没做到的

1. **遮挡检测仍然没有落地。** W3-I §6 写「W4 那条被推迟的重叠检测现在也解锁了：
   `.shell-menu` 300 > `.shell-presence` 200，S2-010 应当能在 `elementFromPoint` 上
   直接断言」。**我没有写它。** 本轮两条都是静态的；那条必须是运行时的（`e2e/`），
   而且它要的是渲染树而不是选择器文本。盲区 1 里点明了这是缺口，不是取舍。
2. **`context:` 是人做出的断言。** 闸门验证它自洽、且 CSS 仍支持它；不验证它对渲染树为真。
   这是静态扫描的硬边界，不是实现的偷懒 —— 见盲区 1。
3. **`@keyframes` 完全不算。** 见盲区 2。
4. **`font-weight` 没有闸门**，因为没有可对照的表。见 §5 发现 6。
5. **没有接进 CI 配置**（`.github/**` 不在我的文件所有权里）。
6. **`legacy` 那四档（1000/1050/1100/1200）只在阶梯里，没有任何断言检查
   `renderer/ui/styles/components.css` 是否还是那些值。** 那个文件与旧渲染器共享、不归这里；
   如果它哪天改了，这张表会安静地过期。要守它得先和 `renderer/ui` 的 owner 对齐规则边界 ——
   和 W4 §9 里 `shell never emits ui-/od- prefixed classes` 那条被推迟的理由是同一个。
