# W3-J — i18n：把 shell 的 227 条硬编码英文接进字典

分支 `develop/1.0`，**未提交**。dev server 用的是 3152，跑完已自行停掉。

---

## 0. 一句话

`src/shell` 的 `t("…")` 调用数从 **0** 变成 **194 个不同 key**；我拥有的 17 个文件里**已经没有一条用户可见的硬编码文案**（含 `aria-label` / `title`）。新增词条 **183 条 × 2 语言**，复用既有 key **8 条**，英文值逐字未动，七条 fix spec 74 passed 一条没改选择器。

---

## 1. ① 先摘的那一刀：`en.ts:584-603` 那 20 条现成 `shell.*`

S5-012 说「20 条现成词条躺着没人用，移植成本比从零翻译低」。**实际可用的只有 4 条**，这是本轮第一个需要纠正的判断：

| 词条 | 值 | 结论 |
|---|---|---|
| `shell.sidebar.collapse` / `.expand` | "Collapse sidebar" / "Expand sidebar" | ✅ **用了**。与 `WindowBar.tsx:33` 的硬编码逐字相同，中文 `折叠侧栏` / `展开侧栏` 也已在 zh.ts |
| `shell.nav.home` | "Home" | ✅ **用了**（Sidebar 的 Home 行） |
| `shell.nav.settings` | "Settings" | ✅ **用了**（侧栏 footer 的齿轮 aria-label + title） |
| `shell.nav.profile` | "Profile" | ❌ 新壳没有账户入口。`Sidebar.tsx:95-98` 的注释明写「没有账户系统，诚实的 footer 无话可说」 |
| `shell.projects.title/add/menu.*` (5 条) | "Projects"/"Add project"/"Reveal in Finder"/"Rename"/"Remove" | ❌ **值不同且语义不同**。新壳是 Folders / New folder / Rename folder… / Remove folder，复用等于改值（违反第 4 条纪律），而且 project ≠ folder |
| `shell.workspace` | "OfficeDex Workspace" | ❌ 新壳没有这个串 |
| `shell.brandPill.*` (6 条) | 连接状态 | ❌ 新壳没有 brand pill |
| `shell.creditMeter.*` (18 条) | 额度计 | ❌ 新壳没有额度计 |

**这 20 条描述的是一个「projects + credits」的 IA，新壳不是那个 IA。**真正能省下的是 4 条，不是 20 条。剩下 29 条既有 `shell.*` 我原样留着没动。

---

## 2. ② 26 条「可逐字复用」的逐条核对结论

S5 表 9 给的是候选。我按「这个 key 的 namespace 是否诚实地覆盖这个用法」逐条判：

### 复用了（4 条 legacy + 4 条 shell）

| 新壳位置 | 复用的 key | 核对理由 |
|---|---|---|
| StatusBar 脏态、FileTabs 标签脏点、FileTree 列表脏点、TaskPanel 产物卡 | `workbench.state.dirty` | legacy workbench 的「文档有未保存改动」和新壳问的是**同一个领域概念**，不是恰好同字。zh 已有「有未保存的改动」 |
| FileTabs 关闭确认弹窗的取消键 | `ui.text.Cancel` | `ui.text.*` 是真正跨产品的通用词汇表；而且 `dialog.tsx:92-95` 本来就用它——**不复用反而会在同一个弹窗里出现两个「取消」的不同译法**，正是 S5 点名的那处控件内混排 |
| FileTabs 标签关闭键 title | `ui.text.Close` | 同上 |
| ModeMenu 品牌名、TaskPanel 回复署名 | `settings.about.productName` | 产品名，两语言同值，`i18n.test.ts` 的 PROPER_NOUNS 已白名单 |
| WindowBar 折叠/展开 | `shell.sidebar.collapse` / `.expand` | 见上表 |
| Sidebar Home 行 | `shell.nav.home` | 见上表 |
| Sidebar 设置入口 | `shell.nav.settings` | 见上表 |

### 拒绝复用（并说明为什么）

| 候选 | 新壳位置 | 拒绝理由 |
|---|---|---|
| `waiting2048.collapse` = "Collapse" | AgentPresence 收起键 | namespace 说谎：那是等待小游戏覆盖层的按钮。哪天 2048 那边改成「收起面板」，Agent 面板会跟着变。新增 `shell.presence.collapse` |
| `image.fullscreen` = "Full screen" | FileTabs / WindowBar 全屏 | 同理：图片查看器的 key。新增 `shell.common.fullscreen` |
| `home.lessTasks` = "Show less" | FileTree「显示更少」 | **语义不同**：legacy 是「少显示几个任务」，新壳是「折叠文件夹里多出来的文件」。zh 都是「收起」只是碰巧 |
| `projectSidebar.home` = "Home" | Sidebar Home | 值对，但 `shell.nav.home` 是为新壳建的同值 key，用后者 |
| `projectSidebar.settings` / `.rename` / `.cancel` 等 | 侧栏 / 文件夹菜单 | 同上：有 shell 专属的就不跨 IA 借 |

**判据是一条规则而不是逐条感觉**：只从真正跨切面的 namespace（`ui.text.*`）、同领域概念（`workbench.state.dirty`）和本产品自己的 `shell.*` 里借；feature-scoped 的 namespace（`image.`、`waiting2048.`、`projectSidebar.`、`home.`）一律新增，因为那些 key 的主人有权为自己的界面改词。

---

## 3. 覆盖了什么

17 个文件，按 S5 表 9 的条数排：

| 文件 | S5 计数 | 用到的 key 数 | 状态 |
|---|---|---|---|
| `nav/FileTree.tsx` | 34 | 36 | ✅ 全覆盖（两个密度、两套菜单、三种空状态、表头、时间分组计数） |
| `chrome/FileTabs.tsx` | 31 | 40 | ✅ 全覆盖（标签、溢出滚动、保存/分享、四条文件菜单、重命名弹窗、三条 toast、关闭确认） |
| `agent/TaskPanel.tsx` | 19 | 33 | ✅ 全覆盖（头部、大纲六种页状态 aria、追问卡、暂停/继续/结束、产物卡、建议卡） |
| `chrome/Sidebar.tsx` | 22 | 21 | ✅ 全覆盖（含三条菜单 description 与 `notBuiltYet` 的长句） |
| `home/Highlights.tsx` | 16 | 14 | ✅ 全覆盖（四条片名 + 四个分区名改成 key，模块级常量表改存 key） |
| `home/EditorHome.tsx` | 13 | 14 | ✅ 全覆盖（两个 Select 的 6 个选项在渲染时解析） |
| `chrome/WindowBar.tsx` | 10 | 7 | ✅ 全覆盖 |
| `nav/fileTreeModel.ts` | 10 | 6 | ✅ 全覆盖（见下「插值与非组件模块」） |
| `agent/companion.ts` | 7 | 7 | ✅ 七个 `Agent xxx` 状态改成 `labelKey` |
| `chrome/ModeMenu.tsx` | — | 8 | ✅ |
| `nav/useFolderDialogs.tsx` | — | 8 | ✅（三种弹窗标题、删除说明、错误文案） |
| `agent/AgentPresence.tsx` | — | 5 | ✅ |
| `chrome/StatusBar.tsx` | 4 | 4 | ✅（**做了两遍**，见第 7 节） |
| `home/FileList.tsx` | — | 3 | ✅ |
| `nav/SidebarTree.tsx` | 3 | 2 | ✅ |
| `home/TaskList.tsx` | 3 | 2 | ✅ |
| `nav/useLibraryActions.ts` | 1 | 1 | ✅（"Moved to {folder}" toast） |

机械复扫我拥有的这些文件：**剩余硬编码用户可见串 = 0**（三个正则命中全是假阳性：`Date.now()`、两个 `Promise` 类型名）。

### 插值与非组件模块

- 带 `{}` 的 22 条全部走 `index.tsx:76` 的 `replaceAll` 机制，没有一处字符串拼接。中文语序因此能真的调整：`Move to {folder}` → `移动到 {folder}`、`{folder}, {count} files` → `{folder}，{count} 个文件`（逗号也换成了中文逗号）、`Files in {folder}` → `{folder} 里的文件`（前后调换）。
- `fileTreeModel.ts` 不是组件，用的是导出的 `translate()`。顺手修掉一个结构问题：`timeBucket()` 原来**返回英文标题本身**，`BUCKET_ORDER` 拿它做相等比较，也就是说标题既是分组键又是文案——翻译它会静默改掉分组身份。拆成 `bucketOf()`（返回 `"today" | "previous7" | …`）+ `bucketLabel()`，group id 也从 `time:Today` 变成 `time:today`，跨语言稳定。
- `formatTouched()` 里两处写死的 `"en-US"` 也跟着改成跟随 locale：中文读者原来会在「最近打开」这一列看到 `Sep 17`。
- `companion.ts` 的 `Pose.label` 改成 `labelKey`，`PresenceFace.statusLabel()` 用 `translate()` 解析——它有三个调用点要把结果塞进模板（live region、presence 的 aria-label、Home 的任务行），签名保持 `(status) => string` 不变。

### 顺带的一处接线：`main.tsx`

`LocaleProvider` 原来**只包住强制更新页**（`main.tsx:60`），这正是 S8-005 / S4-009 那半边的机制原因：中文系统下更新页读 `navigator.language` 走中文，而 shell 那棵树根本没有 provider。现在整棵 shell 树也包上了。

没有 provider 时 `useLocale()` 会落到 context 默认值（也是 `detectLocale()`），所以 navigator 那条路本来就通；**provider 真正补上的是 `localStorage` 里那份用户在 Settings 选过的 locale**——不接的话 shell 会无视用户的选择。

`main.tsx` 不在我的所有权清单里，也不在禁区清单里，改动是 1 处包裹、无逻辑。**如果 owner 有异议请直接回退这一处，其余不受影响。**

> 按要求没有碰 `ForceUpdateOverlay`。补齐 shell 这一侧之后中英混排自然消失。

---

## 4. 因所有权跳过的（欠下一轮）

| 文件 | S5 计数 | 原因 |
|---|---|---|
| `composer/Composer.tsx` | 35 | 明确不归我；且 `git status` 确认另一个 session 正在改 |
| `composer/ModelMenu.tsx` | 22 | 明确不归我 |
| `composer/MentionMenu.tsx` | 16 | 明确不归我 |
| `home/QuickPrompts.tsx` | 6 | 明确不归我；另一个 session 正在改。**注意这 3 条是会被塞进输入框发给模型的英文长句，不只是界面文案** |
| `home/Hero.tsx` | — | 明确不归我；另一个 session 正在改 |
| `agent/useAgentTask.ts` | — | 明确不归我；另一个 session 正在改 |
| `editor/**`、`canvas/**` | — | 明确不归我 |
| `dev/fixture.ts` | 12 | 明确不归我（且是开发夹具，不面向用户） |
| 全部 `*.css` | — | W3-I 正在重建令牌 |

另外两个**没被 S5 表 9 计入、但确实是用户可见**的面，我也没动（不属于我拥有的目录）：

- `port/fake/auditSeed.ts` 11 条 + `port/fake/fakeAgent.ts` 7 条 —— 假端口的种子数据与脚本回复。浏览器预览和全部 fixture e2e 看到的就是这些串。
- `port/reportPortFailure.ts` 4 条 —— `"Not built yet"` / `"That did not work"` 两个 toast 标题是**所有**端口失败的统一外壳，覆盖面比任何单个组件都大。**这条建议优先排进下一轮**：现在中文系统下点任何一个没做的按钮，标题是英文、正文（我传进去的 `description`）是中文。

合计还欠 **约 94 条**（含假端口与上面两处）。

---

## 5. 改了哪些 spec 的选择器

**一条都没改。**

这是本 track 最大的风险，结论是它没有发生，而且是有道理地没有发生：**新增词条的英文值逐字等于原来的硬编码串**，所以 en-US 下 `getByTitle("Collapse")`、`getByRole("button", {name: "Group by"})`、`{name: /Agent/}`、`{name: "Scroll tabs right"}`、`["Name","Folder","Last opened","Pin"]` 全部原样命中。

七条 fix spec 全跑，**74 passed / 0 failed**：

```
fix-w1a + fix-w2e + fix-w2f   38 passed (42.3s)
fix-w1b + fix-w1c + fix-w1d + fix-w2g   36 passed (45.3s)
```

新 spec `e2e/fix-w3j.spec.ts` 自己也把这件事钉住了：`en-US is byte-for-byte what it was` 那个 describe 逐条断言上面这些选择器仍然命中。**以后谁改了这些英文值，是这条 spec 先红，而不是六条回归 spec 一起红。**

---

## 6. 验证（真实输出）

### 6.1 `npx tsc --noEmit`（直接读退出码，没有管道）

**隔离工作树**（`git worktree add --detach /tmp/w3j-wt HEAD` + 软链 `node_modules` + 拷 `src/renderer/generated` + 只拷我改的 22 个文件）：

```
worktree tsc exit=0
```

**主工作树**：`exit=2`，3 条错误，**全部在 `src/shell/agent/documentEditRun.test.ts`**（另一个 session 未跟踪的在制品，`DocumentEditResult.saveError` 契约和它的测试对不上）。与本 track 无关。

### 6.2 `npx vitest run`

**隔离工作树**（权威基线）：

```
Test Files  183 passed (183)
     Tests  1311 passed (1311)
isolated vitest exit=0
```

**正好 1311，没有变少。** `i18n.test.ts` 4 passed（en/zh 双向齐全、无英文占位、占位符不漂移）。

主工作树：`1 failed | 1362 passed`，唯一失败是 `documentEditRun.test.ts > runs the editor's own undo…`，同上，别人的在制品。

### 6.3 新 spec `e2e/fix-w3j.spec.ts`

```
12 passed (5.9s)
```

三个 describe，各自 `test.use({ locale })`，**无任何 skip，条件的也没有**：

- `zh-CN renders the shell in Chinese`（6 条）：窗口栏 / 模式菜单 / 侧栏行 / 设置菜单（含 description）/ 文件树与文件夹菜单 / 状态栏 / 标签栏 / Agent 列与 live region / Editor Home 的四个空白按钮与四个表头 / 时间分组 / 亮点架 / 文件带。
- `en-US is byte-for-byte what it was`（3 条）：上面第 5 节列的那些选择器逐条断言英文原值。
- `Chinese copy does not break the rows it sits in`（3 条）：文件夹名 / 文件名 / 状态栏文件名三处断言 `white-space: nowrap` + `text-overflow: ellipsis` **仍在**（W2-E 修的截断没被回退）且高度 < 2.6 倍行高；Home 的表格不超出容器；侧栏按钮不越出轨道右边。

跑的时候发现并修掉一处我自己写的取元素方式：文件夹行的 `+` 在未 hover 时 `opacity:0`（`nav.css:150`），要先 `hover()` 才点得到——**改的是 spec 拿元素的方式，不是文案，也不是 CSS。**

### 6.4 六条回归 spec

见第 5 节，74 passed。

---

## 7. ⚠️ 事故：`git checkout --` 连带回滚了别人未提交的改动

本轮做完第一遍验证（当时 tsc=0、vitest 1356 全绿）之后，e2e 突然把 `shell.list.columnName` 原样渲染了出来。回查 `git diff --stat src/renderer/i18n/` 是**空的**——我在 `en.ts` / `zh.ts` / `StatusBar.tsx` 三个文件里的全部改动被清零，而 16 个文件里的 `t()` 调用全都还在，界面直接渲染 key 字符串。

原因（由协调方查清）：另一个 session 在 `StatusBar.tsx` 里加东西弄崩了 shell 启动，用 `git checkout -- StatusBar.tsx en.ts zh.ts` 退自己的改动。**`git checkout -- <file>` 不分辨改动归属，是按文件整体回到 HEAD。**

- 损失范围：183 个 key × 2 语言 + `StatusBar.tsx` 的 4 条。
- 恢复：中文是我翻的那一版原文，从我自己的上下文重写，**没有重译、没有塞英文占位**。
- 对账：协调方算出的 `docs/ui-audit-2026-09-19/fixes/W3-J-missing-keys.txt` 183 个 key，en 缺 0 / zh 缺 0；我另外全量扫了 `src/shell` 的 `t("…")` / `translate("…")` / `labelKey` 常量表，**209 个 key 引用，未解析 0 个**。
- 防护：两段字典块和一个幂等脚本落在 `/tmp/w3j/`，`python3 /tmp/w3j/apply.py` 可重复执行，已应用时是 no-op。

**这是本轮第二次有 session 删掉别人的未跟踪/未提交内容**（前一次是 W2-G 删了 W2-F 的探针脚本）。共享工作树里，对多人动过的文件用 `git checkout --` / `git stash` / `git add -A && commit` 都有同样的风险面。

---

## 8. 留给下一轮的四条

1. **`port/reportPortFailure.ts` 的两个 toast 标题优先**（第 4 节）：它是所有端口失败的统一外壳，现在中文系统下标题英文、正文中文，是最显眼的一处混排。
2. **composer 三个文件 73 条**是剩下最大的一块，其中 `QuickPrompts.tsx` 的 3 条会被发给模型，不只是界面问题。
3. **假端口种子数据 18 条**：浏览器预览和全部 fixture e2e 的可见内容都来自这里，翻译它会同时改掉 e2e 的可见串，需要和 spec 一起动。
4. **可以考虑一个闸门**：仿 `src/shell/test/deadControls.test.ts`，扫 `src/shell` 里 `aria-label|title|placeholder` 后面跟大写字母开头字面量的情况并计数设上限。本轮我是用一次性脚本扫的（结果：我拥有的文件 0 条残留），做成测试才不会回潮。
