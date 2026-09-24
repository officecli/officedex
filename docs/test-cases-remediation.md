# `docs/test-cases.md` 整改意见

| 项 | 内容 |
|---|---|
| 提出对象 | `docs/test-cases.md` 起草者 |
| 依据 | `docs/test-cases-gap-review.md`（覆盖缺口审查，全部结论附 `file:line` 证据） |
| 代码基线 | `officedex` HEAD `545daf2` |
| 整改性质 | 只改文档，不改产品代码（仅 A-6 / D-3 需要产品侧决策，见文末） |
| 建议执行顺序 | **第一批 A + B**（不修则测试结论本身无效）→ **第二批 C-P0** → **第三批 C-P1/P2 + D** |

**给起草者的三条元规则**

1. **凡"期望"栏写的行为，必须能在代码里找到依据**；找不到就写成"待确认"，不要凭旧版 UI 的印象写。本次 8 处冲突全部源于旧版行为被当成新版行为（B 批）。
2. **凡声称"自动化覆盖"的 TC，必须写清 spec 的启动入口**（新 shell `/` 还是旧 UI `/legacy.html`）。本次 5 处假绿灯全部源于此（A-5）。
3. **重新编号时不要动已有 TC-ID**，只在需要处插 `-b/-c/...` 后缀或追加新号段（本意见统一用：`TC-SET-03b…`、`TC-SHL-07/08`、`TC-CNV-06/07`、`TC-FOL-04`、`TC-ERR-01/02`、`TC-NBI-02`、`TC-INS-04`）。

---

## A. 必须修正的事实性错误（5 处）

### A-1 第 19 节：4 条"自动化覆盖"实际跑在旧 UI 上 ⚠️ 最高优先级

第 19 节现在的写法会让执行人放心跳过手工测试，但下列 spec 通过 `preparePage()` 打开的是 **`/legacy.html`**（旧界面），不是发版打开的新 shell。

**证据：** `e2e/support/real-e2e.ts:70-83` —— `preparePage()` 内既 `page.goto("/legacy.html")`，又把 `officedex.locale` 钉死为 `"en"`。

| 现清单条目 | 现状 | 建议改法 |
|---|---|---|
| `e2e/generation-real.spec.ts` → TC-PPT-01/06, TC-DOC-01, TC-PLN-01, TC-XLS-01, TC-RPT-01, TC-IMG-01 | 旧 UI | 保留该行，但**标注「旧 UI」**，并把对应 TC 降级为"新 shell 路径需手工必测" |
| `e2e/shell-settings-real.spec.ts` → TC-SET-*、TC-ADV-01、TC-UPD-02 | 旧 UI（与第 13 节描述的"整页设置"对不上） | 同上，并加一句说明：它覆盖的是旧设置页 |
| `e2e/pptx-stage-real.spec.ts` → TC-PPT-02/07 | 旧 UI | 同上 |
| `e2e/artifacts-preview-real.spec.ts` → 预览/系统打开/失败上报 | 旧 UI | 同上 |

**同时修正两处引用错误：**

- 第 19 节末行 `e2e/fix-w1a/w1c/w1d/w2f/w2g/w3h/w5.spec.ts` 是**不存在的路径**（笔误），且**漏掉了真正做中文验收的 `e2e/fix-w3j.spec.ts`**。
- TC-UPD-01 引用 `e2e/fix-w1d.spec.ts` —— **已核对，该引用正确且覆盖良好**（`:107-140` 逐 phase 断言 `force-update-card` 的标题/进度条/状态行/按钮文案与禁用态），此项无需改动，仅建议在第 19 节表格里补上它覆盖 TC-UPD-01。
- 补充：`e2e/fix-w1c.spec.ts` 覆盖**模态焦点管理**（`Escape` 关闭并把焦点交回 trigger `:105`、Tab 不逃逸 `:114`、点遮罩关闭 `:134`），与新增用例 TC-SHL-08 有部分重叠——起草时请在 TC-SHL-08 里排除对话框类模态，只写菜单类（Mode / 模型 / @提及 / 标签 ⋯ / 文件行），避免重复。

**建议在第 19 节表格前插入：**

> 下表 spec 分两类入口：**新 shell（`page.goto("/")`）** 只有 `shell-canvas-real`、`shell-generation-real`、`shell-pptx-generation-real`、`shell-outline-gate-real`、`deck-edit-routing-real` 五个；其余经 `preparePage()` 打开 `/legacy.html`，**不是发版界面**。凡 TC 只挂"旧 UI"的，新 shell 上必须手工补测。

并把 `e2e/fix-w3j.spec.ts` 补进表格：**覆盖 zh-CN 下 shell 六个区域的中文渲染 + en-US 逐字节对照 + 中文长文案不溢出**，同时挂到 TC-SET-03 上。

---

### A-2 第 20 节第 10 条 + TC-CNV-01：Writer 的英文不是"可能仍是中文"

**现文（第 20 节第 10 条）**：「Word 编辑器英文系统上可能仍是中文 UI。」
**现文（TC-CNV-01 期望）**：「英文系统上 Word 工具栏目前仍可能是中文——这是 writer 仓库缺 `en-US` 词典，不是 shell 回归。」

**事实**：`public/writer/host-runtime.js` 只有一张 **11 个词条的** `WRITER_SDK_ENGLISH_CHROME`（`toolbar.start/insert/page/reference/review/view/help` + 4 个 statusbar），其余 key 全部走 `humanizeKey()`：

```js
function englishFrom(resource) {
  for (const key of Object.keys(resource)) {
    out[key] = WRITER_SDK_ENGLISH_CHROME[key] || humanizeKey(key);
  }
}
// toolbar.font.bold -> "Toolbar Font Bold"
```

**建议改写为**：「英文下 Writer 顶层选项卡与状态栏为真英文（11 条内置词条），其余命令显示为 key 的人性化形式（如 `Toolbar Font Bold`）——这是已知降级，不是 shell 回归。」

**同时**：清单目前的措辞把 Writer 和 Excel 当成同一件事，但 **Excel 反而有完整英文**：`node_modules/@shimo/sdk-sheet/locales/{fe-common,lizard-service-sheet-sdk}/en-US.js` 与 `zh-CN.js` 同为 4380 键，**16 个语种全量**（ar/de/en/es/fr/id/it/ja/ko/ms/pt/ru/th/vi/zh-CN/zh-TW）。请在 TC-CNV-02 补一句"切成 English 后表格 UI 应整体变英文"，避免执行人以为 Excel 也会降级。

---

### A-3 第 0 节推荐环境 + 第 18 节冒烟环境：系统语言不影响首启

**现文（第 0 节）**：「语言 \| 系统中文 / 英文各一轮」
**现文（第 18 节）**：「环境：签名 DMG · 有额度账号 · **中文系统**」

**事实**：`src/renderer/i18n/index.tsx:15-17`

```ts
export function detectLocale(): Locale {
  return "en";   // 恒返回 en，不读 navigator.language
}
```

`getCurrentLocale()` = `readStoredLocale() ?? detectLocale()`，**首启永远是英文**。

**建议**：把两处都改成「**设置 → Appearance 切中文 / English 各一轮**」，并在 TC-SET-03 或 TC-INS-02 补一句：「首启语言为 English，与系统语言无关；语言只在设置里改。」

> ⚠️ 此处另有一个**产品侧待决策**：是否要让首启跟随系统语言？见文末 D-1。

---

### A-4 第 15 节表格：新 shell 里没有"导出/打印/版本历史"控件

**现文**：「标签 ⋯ 导出/打印/版本历史 \| `file-more-actions` 残留 \| 重命名/副本/置顶/移出库已接」

**事实**：`src/shell/chrome/FileTabs.tsx:449-479` 的 ⋯ 菜单**只有**重命名、创建副本、置顶/取消置顶、移出库四项。**没有导出/打印/版本历史控件**，所以"点了必须出 notice"这条**无从执行**。

**建议**：该行改为「⋯ 菜单仅重命名/副本/置顶/移出库；导出、打印、版本历史**在新 shell 未提供入口**」，并同步第 20 节第 9 条措辞（现在写的是"未立项"，应写"新 shell 无入口"）。

---

### A-5 TC-FOL-03：「三种空态」实为四种

**现文**：「空列表三种空态。」

**事实**：`src/shell/nav/FileTree.tsx:398-431` 的 `empty` 分支由两轴组合成 **4 种文案**：仅 pinned、仅 fileType、**pinned+fileType 同时**（独立文案 `shell.list.emptyPinnedAndType`）、无任何筛选。

**建议**：改为「四种空态（无文件 / 仅置顶 / 仅类型筛选 / 置顶+类型同时）」，并注明第 4 种是 S3-014 修的回归点。

---

## B. 必须修正的冲突条款（照原文执行会误报）

### B-1 TC-CMP-01：Home 上的 Composer 故意不变成 Stop

**现文**：「进行中空 Composer 变成 Stop。」

**事实**：`src/shell/composer/Composer.tsx:244`

```ts
const stopping = placement !== "home" && busy && !canSend;
```

Home（以及 docked 之外的 Home 位置）**有意不进入 Stop**，注释写明理由：不能让新用户第一眼就看到一个无确认的破坏性按钮；停止入口保留在任务面板与 Home 的任务列表。

**建议**：「进行中且 Composer 非 Home 位置时，空 Composer 变成 Stop；**Home 上不变 Stop**（停止走任务面板 / Home 任务列表），这是有意设计，不是缺陷。」

---

### B-2 TC-SHL-03：macOS 上不画窗口按钮，该步骤不可执行

**现文**：「1. 关闭 / 最小化 / 全屏。2. 浏览器预览里这些按钮应降级为 no-op 或隐藏…… 期望：桌面端行为与系统一致」

**事实**：`src/shell/chrome/WindowBar.tsx:83-85` —— 当 `hasOverlayWindowChrome()` 为真（macOS，`main.go` 用 `mac.TitleBarHidden()` 让系统绘制红绿灯）时，只渲染一个 `aria-hidden="true"`、`data-system-drawn="true"` 的**占位带**，**没有任何按钮**。

**建议**：「macOS：断言带 `data-system-drawn` 的占位带在、且**没有第二套自绘按钮**（用系统红绿灯操作窗口）；Windows / 浏览器预览：点自绘按钮，行为与系统一致 / 降级为 no-op。」

---

### B-3 TC-HOM-04：任务状态不是"五态"，且 `AgentStatus` 里没有 `failed`

**现文**：「覆盖：idle / 进行中 / 等待回答 / 完成 / 失败，以及超长标题。」

**事实**（`src/shared/uiPort.ts:109-116`）：`AgentStatus` 是 **7 态**——`idle | reading | writing | working | paused | awaiting-review | done`，**没有 `failed`**。失败在另一层：artifact `state` 含 `"failed"`（`:193`），`TaskPanel.tsx:290` 用 `state === "failed"` 做判断；`TaskList.tsx:127-130` 把 7 态压成 3 个点色（live / waiting / still），**不区分失败**。

**建议**：拆成两条——
- TC-HOM-04（P1）：「任务行覆盖 `AgentStatus` 全部 7 态（idle / reading / writing / working / paused / awaiting-review / done）+ 超长标题」；
- TC-TSK-04（P1，新增）：「**运行失败**与**产物失败**两种失败的表现与文案」（`artifact.state === "failed"` vs 任务无法推进），并明确失败态在哪一层呈现。

---

### B-4 TC-ADV-01：Provider 测试的花费确认 + Runtime 表被低估

**现文（表格行）**：「LLM Provider \| Test connection 有通过/失败/网络错误……」
**现文（表格行）**：「Runtime runs \| 调试表能打开，不崩」

**事实**：
- Provider 测试在 `src/shell/settings/AdvancedControls.tsx:130-147` **会先弹确认框（因为会消耗额度）**，结果标签有 **4 种**（`:430-441`）；未登录 + 自定义 endpoint 会跳账号页（`:155-164`）。
- Runtime 表有**逐行 Cancel**（`:526-532`）、**Retry**（`:533-537`）、**历史显示切换**（`:547-553`）、**翻页 `pageSize 8`**（`:556`）。

**建议**：「Provider \| Test connection **先出花费确认框**，确认后有 4 种结果（通过/失败/网络错误/…）；未登录自定义 endpoint 跳账号页」；「Runtime runs \| 表的**打开、逐行 Cancel / Retry、历史切换、翻页**均可用」。

---

### B-5 TC-CMP-06 / TC-CMP-03：权限与 Enter 的两个副本

**事实**（供起草者定稿时写清，避免漏测）：
- 权限菜单里**也**有一行 `Enter sends · on/off`（`Composer.tsx:853-858`），与设置页 Appearance **共用同一份 store（`composer/settingsStore.ts`）**——这是"两处一致"的真实断言点，清单目前只在 TC-CMP-03 提了 Enter，没提这个重复入口。
- `⌘/Ctrl+Enter` 是**无条件发送**（`Composer.tsx:764-769`），不受 `Enter sends` 开关影响，清单未提。

**建议**：TC-CMP-03 增加「在设置页与权限菜单两处分别切换 Enter sends，另一处立即同步」；并补「`⌘/Ctrl+Enter` 始终发送」。

---

## C. 建议新增的用例

### C-P0（会漏严重缺陷）

| ID | 标题 | 要点 |
|---|---|---|
| **TC-SET-03b** | 打开文件时切换语言（三编辑器） | docx / xlsx / pptx 各开一个文件，各切一次中文↔English。**必须分别写明三者期望**：docx、pptx 会重载 iframe；xlsx **不即时更新**，需关掉重开。断言 shell 与编辑器语言一致 |
| **TC-SET-03c** | **有未保存编辑时切换语言** | 当前 docx/pptx 会重载（`WriterEditorFrame.tsx:136-151`、`PresentationEditorFrame.tsx:155-172`，`[locale]` 依赖改 `src`）。要么保住编辑，要么先出未保存确认——**不能静默丢弃**。这条要写成明确期望，若是缺陷就按缺陷记 |
| **TC-SHL-07** | 键盘快捷键 | `⌘W`/`Ctrl+W` 关当前标签（`closeTabShortcut.ts` + `FileTabs.tsx:232-238`）；**无打开文件时 ⌘W 应落到"关窗口"**；长按不连关；非拉丁键盘布局仍生效。另需明确：`⌘S`/`⌘N`/`⌘,` **当前未实现**，不要写成用例 |
| **TC-ERR-01** | 列表读取失败必须有错误态 | `state/ShellContext.tsx:70-91` 不捕获；`agent/useAgentTasks.ts:35-53` 只打日志；`settings/SettingsSections.tsx:176-198` 的 Activity 读取失败会渲染成"没有运行记录"。**读取失败目前与空工作区不可区分**，违反第 0 节"失败路径要能看见原因" |

### C-P1

| ID | 标题 | 要点 |
|---|---|---|
| **TC-CNV-06** | xlsx 打开时切语言 | 明确"需关闭重开才生效"是否为约定；若是，要有提示而非静默不变（`sheetSdk.ts:349-359` 只在创建时定语言；`SheetCanvas.tsx` 无 locale 依赖） |
| **TC-CNV-07** | English 下三编辑器可读性矩阵 | Excel 全英文；Writer 允许 humanized key 降级（见 A-2）；PPT 按实测 |
| **TC-SET-03d** | 切语言后重启 | 语言保持；`<html lang>` 与 UI 一致（`e2e/fix-w3h.spec.ts:207-230` 只覆盖同挂载内切换） |
| **TC-SHL-08** | 菜单键盘契约 | `Menu.tsx` 是全 shell 8 个菜单的共用原语：↑↓ 开合（`:390-395`）、roving focus 跳禁用项（`:284-292`）、Home/End（`:345-351`）、Escape + **焦点归还 trigger**（`:176-179, 329-334`）、Tab（`:335-338`）、点外关闭（`:273-282`）。逐个菜单抽测：品牌 Mode / 模型 / @提及 / 标签 ⋯ / 文件行 |
| **TC-FOL-04** | 右键与 F2 行菜单 | `nav/FileTree.tsx` 文件夹行 `:215-218`、文件行 `:329-332` 的 `onContextMenu`，以及 F2 在 `:241-245 / :348-352`；动作应与 ⋯ 菜单一致 |
| **TC-NBI-02** | 中文下未实现提示必须中文 | 现有多处硬编码英文：`Composer.tsx:521`（听写）、`Composer.tsx:844`（权限）、`agent/useAgentTask.ts:121`、`port/reportPortFailure.ts:37,86`（**所有 notice 的标题 "Not built yet"**）。第 15 节承诺"必须出现明确提示"，中文用户却拿到英文标题 |
| **TC-ACC-02** | 账号页次要动作 | `AccountPage.tsx` 的**复制登录链接**（`:248`）、**在浏览器打开**（`:252`）、**Check status**（`:258`）、**失败后 Try again**（`:287`）、**返回**（`:293`）——TC-ACC-01 只覆盖了登录/登出/取消/关闭 |
| **TC-HOM-06** | Editor Home 的筛选器 | `EditorHome.tsx:57-70` 的 **Group by（时间/文件夹）** 与 **文件类型**两个下拉，TC-FOL-03 完全没提；含"分组切到 Folder 后与侧栏树逐行对齐"这一设计意图 |
| **TC-TSK-05** | 任务面板按钮六态可用性矩阵 | 把散落的 Stop / Finish / Pause / Resume / Retry / Apply / Undo 集中成一张"某状态下某按钮必须启用/禁用"的表（`TaskPanel.tsx:153-171` 是 Pause 仅非 docx/xlsx 的实现点） |
| **TC-FOL-05** | 侧栏分页与键盘展开 | 侧栏 `SIDEBAR_PAGE = 5` + "更多"溢出（`FileTree.tsx` 的 `onToggleOverflow`）；显式展开箭头（`:223` `aria-expanded`）与键盘 ArrowLeft/Right（`:248-252`） |

### C-P2

| ID | 标题 | 要点 |
|---|---|---|
| **TC-INS-04** | Finder 拖入 / 双击打开 | **当前是无反应死路**：`main.go:50-53` 开 `EnableFileDrop` 且 `DisableWebViewDrop: true`，而 `app_local_files.go:61 ImportLocalFile` 在新 shell **无任何调用方**（只有旧渲染器的 `homeDropZone.ts`）。要么补实现后测，要么记 `not-implemented.md`（见 D-3） |
| **TC-ERR-02** | 生成中途断网 | 现在只有逐动作 toast（`useAgentTask.ts:120-129`），无统一离线表面 |
| **TC-SHL-09** | 最小窗口与面板折叠不变式 | `main.go` 的 `MinWidth 1040 / MinHeight 720`；侧栏 190px / 折叠轨 52px / agent 列 320px 常量；折叠后画布宽度与悬浮面板不重叠 |
| **TC-IMG-03** | 图片水印与额度的联动 | 免费强制开且开关禁用、付费可关（TC-ADV-01 有一行，但 TC-IMG-01 只提"带水印"），建议合并去重 |

---

## D. 需要同步到 `not-implemented.md` 的产品缺失（**不要写成测试用例**）

以下不是"漏测"，是**产品本身没有的能力**。写进验收清单只会让执行人去找不存在的按钮。

| # | 缺失 | 证据 |
|---|---|---|
| **D-1** | **系统语言不影响首启**（首启恒英文）。**待产品决策**：是否应跟随 `navigator.language`？ | `i18n/index.tsx:15-17` |
| **D-2** | **侧栏与 agent 列不可缩放**：reducer 有 `set-nav-width` / `set-task-width` 与 `NAV_MIN 160 / NAV_MAX 300 / TASK_MIN 320 / TASK_MAX 660`，但**全仓库无任何非测试 dispatch**（只在 `shellReducer.test.ts:206-213` 出现）。面板恒为 190 / 320 | `state/shellReducer.ts:28-33,128-129`；消费点 `App.tsx:155-156` |
| **D-3** | **无 Finder 文件关联 / 无应用菜单栏 / 无深链**：`wails.json` 未声明 `fileAssociations` / `protocols`，故 `build/darwin/Info.plist` 的 `{{if .Info.FileAssociations}}` / `{{if .Info.Protocols}}` 块不展开；Go 侧无 NSMenu | `wails.json`、`build/darwin/Info.plist` |
| **D-4** | **无 `⌘S` / `⌘N` / `⌘,`**；保存仅点击路径 | `grep KeyS` 在 `src/shell`、`src/canvas` 无命中 |
| **D-5** | **新 shell 无多选 / 无面包屑 / 无文本搜索**（`FileFilter` 只有 `"pinned" \| "all"`） | `src/shell/nav/fileTreeModel.ts` |

> D-2 与 C-FOL-05 不冲突：前者是"面板宽度不可调"，后者是"列表分页与展开"。

---

## E. 维护性建议（可选，但强烈建议）

1. **第 19 节表格加"入口"列**：`新 shell (/)` / `旧 UI (/legacy.html)`。这是本次 5 处假绿灯的根因，加一列即可长期防复发。
2. **第 19 节加"覆盖强度"列或注释**：区分"端到端断言了结果"与"只断言了不崩"。`shell-settings-real` 是单条巨型测试，`Runtime runs` 现在只要求"不崩"。
3. **第 21 节维护规则补一条**：「新增/修改交互前，先在清单加 TC，再挂 spec」；并补「spec 若走 `legacy.html`，禁止在第 19 节标为覆盖新 shell」。
4. **补齐清单从未引用、但已存在的 spec**（15 个）：`fix-w1b`、`fix-w1c`、`fix-w2e`、`fix-w3i`、`fix-w3j`、`ui-audit-s1/s4/s6/s7*`/`s8`、`ui-audit`、`tiktok-ops-ui-generation`。至少把 `fix-w3j`（中文验收）挂上 TC-SET-03。
5. **TC-CMP-07 的"key 不出现在界面明文持久化（按实现：会话内存）"**：请核对 `composer/settingsStore.ts` 与 `App` 的 provider 配置实现后改写；"按实现"这种措辞应替换为确定结论。

---

## 附：验收本次整改是否到位

起草者交回后，按下面 6 条自检：

- [x] 第 19 节每条 spec 都标了入口（`/` 或 `/legacy.html`）
- [x] 第 19 节表格出现 `fix-w3j.spec.ts`；`fix-w1a/w1c/...` 笔误已修
- [x] 第 20 节第 10 条已按 A-2 改写（humanized key，而非"仍是中文"）
- [x] 第 0 节 / 第 18 节不再出现"系统中文/英文各一轮"这类无效变量
- [x] B 批 5 条冲突已按代码事实修正（TC-CMP-01 / TC-SHL-03 / TC-HOM-04 / TC-ADV-01 / TC-CMP-03）
- [x] D 批 5 项已进 `not-implemented.md`，且**没有**被写成验收用例
