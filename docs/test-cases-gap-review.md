# `docs/test-cases.md` 验收覆盖缺口审查

> 审查对象：`officedex/docs/test-cases.md`（727 行，21 节）
> 审查方法：以当前代码为基准（HEAD `545daf2`），逐模块对照 `src/shell/**`、`src/canvas/**`、`src/renderer/**`、`e2e/**` 与已构建产物 `public/writer|presentation`、`node_modules/@shimo/sdk-sheet/locales`
> 结论：**清单的整体骨架是好的**（分级、P0 冒烟、自动化对照、已知边界四件事做得比多数验收文档扎实），但存在四类问题：**(1) 语言矩阵只测了一半；(2) 有四个整类的交互完全没有用例（快捷键 / 右键与 F2 / 加载失败与离线 / 原生集成），外加一批已实现的交互；(3) 第 19 节的"自动化已覆盖"有 5 处误报，会给出假绿灯；(4) 有 8 处清单与代码不一致，照原文执行会误报或卡住。**

---

## 0. 一句话结论

清单把「语言」当成**设置页里的一个开关**来验收（TC-SET-03：切一下、看一眼），但语言同时是**编辑器状态的轴**：三个编辑器对语言切换的反应各不相同，其中一个会重载并丢未保存内容，一个根本不会变。这正是你举的例子，而且它比想象中更严重——**现有 E2E 没有任何一条在中文下打开过真实编辑器**（`e2e/support/real-e2e.ts:72` 把 locale 钉死成 `en`）。

---

## 1. 语言矩阵：清单漏掉的部分（最高优先级）

### 1.1 三个编辑器对「切换语言」的反应不一致

| 界面 | 语言来源 | 设置里切语言后 | 代价 / 风险 |
|---|---|---|---|
| Shell 自身 | `LocaleProvider`（`officedex.locale`） | ✅ 立即重渲染 | 无 |
| **docx / Writer** | `/writer/index.html?lang=` | ⚠️ **iframe `src` 变化 → 整个编辑器重载** | **未保存编辑有丢失风险** |
| **xlsx / Sheet** | 创建 SDK 时传入 | ❌ **已打开的表格不更新**，需关掉重开 | 与另两个不一致 |
| **pptx / Presentation** | `?lang=` + `localStorage` | ⚠️ **iframe 重载** | 同上，且长 deck 重新加载慢 |
| 库文件日期列 | `getCurrentLocale()`（`fileTreeModel.ts:176-183`） | ⚠️ 调用时才读，列表若被 memo 则不会自动刷新 | 语言格式（`Intl` 日期） |

证据：

- `src/renderer/word/WriterEditorFrame.tsx:136-151` — `useEffect(..., [locale, markUnavailable])` 内 `setComponentURL(withEmbedLocaleQuery(...))`，即 locale 变化 → `componentURL` 变化 → `src={componentURL}`（同文件 402-404 行）→ **浏览器必然重载 iframe**。该组件只有 `onDirtyChange` 上报脏标记（303-304 行），**没有任何「脏就不重载」的护栏**。
- `src/renderer/presentation/PresentationEditorFrame.tsx:155-172` — 同样的 `[locale]` 依赖与 `setComponentURL`。
- `src/renderer/spreadsheet/sheetSdk.ts:349-359` — locale 只在 `createOfflineSheetEditor()` 这一次调用里决定（`i18n.language`、`documentElement.lang`、两个 locale bundle），而 `src/canvas/SheetCanvas.tsx` 没有 `key={locale}`、也没有依赖 locale 的 effect。
- 值得肯定：`src/renderer/spreadsheet/sheetSdk.test.ts:93` 已有 `"reapplies the locale when a later editor switches language"`，说明"后来者切语言"这一点**在 SDK 层是被实现和单测覆盖的**；缺的是 canvas 层和真实文件上的端到端验收。

### 1.2 各编辑器「英文」的真实能力差异巨大——清单把两者当成了同一件事

- **Excel = 真英文。** `node_modules/@shimo/sdk-sheet/locales/{fe-common,lizard-service-sheet-sdk}/en-US.js` 与 `zh-CN.js` 都是 4380 个 key，**15 种语言全部完整**。切成 English 后表格 UI 应当整体变英文。
- **Writer = 不是英文，是"把 key 变成人类可读词"。** `public/writer/host-runtime.js` 里只有一张 **11 个词条的** `WRITER_SDK_ENGLISH_CHROME`（`toolbar.start/insert/page/reference/review/view/help` + 4 个 statusbar），其余一律走 `humanizeKey()`：

  ```js
  function englishFrom(resource) {
    for (const key of Object.keys(resource)) {
      out[key] = WRITER_SDK_ENGLISH_CHROME[key] || humanizeKey(key);
    }
  }
  // toolbar.font.bold -> "Toolbar Font Bold"
  ```

  也就是说，清单第 20 节第 10 条「Word 编辑器英文系统上可能仍是中文 UI」**已经过期/不准确**：现在英文下它既不是中文，也不是英文，而是 `Tab Font Bold`、`Table Structural Reason Unavailable` 这种 humanized key。

**→ 需要新增的用例**

| 建议 ID | 用例 | 期望（应写进第 20 节） |
|---|---|---|
| TC-SET-03b（P0） | 设置 → Appearance 切中文/English，**在 docx / xlsx / pptx 各打开一个文件的情况下**各切一次 | 明确写下三种编辑器的**各自**正确行为；断言 shell 与编辑器语言一致；记录重载与脏数据后果 |
| TC-SET-03c（P0） | **有未保存编辑**时切换语言 | 要么保住编辑，要么先弹未保存确认；**不能静默丢弃**（当前行为：docx/pptx 重载） |
| TC-CNV-06（P1） | xlsx 打开时切语言 | 明确"需关闭重开才生效"是否为约定；若是，要有提示而不是静默不变 |
| TC-CNV-07（P1） | English 下逐个核对三种编辑器的可读性 | Excel 全英文；Writer 允许 humanized key 降级但**必须记进第 20 节**；PPT 按实际结果 |
| TC-SET-03d（P1） | 切语言 → 完全退出 → 重启 | 语言保持；`<html lang>` 与 UI 一致（`e2e/fix-w3h.spec.ts` 只覆盖了同一挂载内的切换） |

### 1.3 系统语言被忽略，而"推荐环境"却在说"系统中文/英文各一轮"

`src/renderer/i18n/index.tsx:15-17`：

```ts
export function detectLocale(): Locale {
  return "en";   // 永远返回 en，不看 navigator.language
}
```

`getCurrentLocale()` 是 `readStoredLocale() ?? detectLocale()`，所以**首启永远是英文**，与系统语言无关。清单第 0 节推荐环境表格写「语言：系统中文 / 英文各一轮」，第 18 节 P0 冒烟更直接写了「环境：… 中文系统」——**这两处都会误导执行人**：
- "系统英文"和"系统中文"跑出来的结果完全一样（都是英文 UI）；
- P0 冒烟在"中文系统"上跑，得到的仍是英文界面，除非手工先去设置里切中文。

**→ 用例修正**：要么把"系统语言首启"定为明确的产品决策（首启英文），并把清单里的"系统中文/英文各一轮"改成"设置里中文/英文各一轮"；要么把系统语言探测列为需求（新增 TC-SET-03e：`LC_ALL=zh_CN` 首启应…）。

### 1.4 中文下仍有硬编码英文文案（违反第 15 节自己的"必须说话"标准）

| 位置 | 文案 | 说明 |
|---|---|---|
| `src/shell/composer/Composer.tsx:521` | `"Dictation is not available in this browser…"` | 未走 `t()` |
| `src/shell/composer/Composer.tsx:844` | 权限提示整句英文拼接 | 未走 `t()` |
| `src/shell/agent/useAgentTask.ts:121` | toast 标题 `"Not built yet"` | 中文下仍英文 |
| `src/shell/port/reportPortFailure.ts:37,86` | 同上，所有 notice 的标题 | 中文下仍英文 |

第 15 节表里唯一的中文可见承诺是「必须出现明确提示（notice「Not built yet」或等价文案）」——中文用户会拿到英文标题。**建议新增 TC-NBI-02（P1）：中文下逐个点未实现控件，标题与正文都必须中文**（`src/shell/test/copyRatchet.test.ts` 只统计数量不校验语言，兜不住这个）。

---

## 2. 漏掉的按钮与交互（按模块）

以下都是代码里已经存在、清单里**没有对应用例**的交互。标 ★ 的是我认为最该补的。

### 2.1 快捷键（**整类缺失**——`grep ⌘|Cmd|Ctrl|快捷键|shortcut` 在清单里 0 命中）

- ★ **⌘W / Ctrl+W 关闭当前标签** — `src/shell/chrome/closeTabShortcut.ts` 整套实现（含"非拉丁键盘布局靠 `event.code`"、"长按不连关"、"⇧⌘W/⌥⌘W 不吞"三条明确设计），且 `FileTabs.tsx:232-238` 挂载。清单只在 TC-SHL-04 提了 Tab/方向键，**完全没提 ⌘W**。
- ★ **无打开文件时 ⌘W 应落到"关窗口"** — `FileTabs.tsx:225-231` 的注释明确写了这个平台约定，无用例。
- ★ **`⌘S` / `Ctrl+S` 保存：不存在**（`grep KeyS|metaKey.*s` 在 `src/shell`、`src/canvas` 无命中）。保存只有点击路径；`⌘N`、`⌘,` 同样没有。→ 要么补实现，要么在清单里明确"快捷键只承诺 ⌘W"。
- `SettingsPage.tsx:195` 的全局捕获式 `keydown`（设置页打开时的按键拦截），无用例。
- 建议：TC-SHL-07（P1）键盘快捷键一致性（⌘W 的三种前置态：有脏文件 / 干净文件 / 无文件）。

### 2.1b 右键菜单与 F2（**整类缺失**——`grep 右键|context menu` 0 命中）

`src/shell/nav/FileTree.tsx` 里文件夹行（`:215-218`）和文件行（`:329-332`）都有 `onContextMenu` → 打开同一套 Menu；键盘侧 **F2** 在 `:241-245`（文件夹）与 `:348-352`（文件）做同样的事，并复用 Menu 的 Escape 关闭与焦点归还。清单**一条都没有**。建议 TC-FOL-04（P1）：右键/F2 打开行菜单，与 ⋯ 菜单动作一致。

### 2.1c 加载失败与离线（**整类缺失**——`grep 离线|offline|网络中断` 0 命中）

- **库/文件夹/任务列表读取失败没有错误态**：`src/shell/state/ShellContext.tsx:70-91` 不捕获错误；`src/shell/agent/useAgentTasks.ts:35-53` 只打日志；`SettingsSections.tsx:176-198` 的 Activity 在读取失败时**渲染成"没有运行记录"的空态**。→ **读取失败与空工作区在界面上不可区分**，这违反清单第 0 节"失败路径：用户能看见原因"。
- **运行中网络中断没有统一表面**，只有逐动作 toast（`src/shell/agent/useAgentTask.ts:120-129`）。
- 建议：TC-ERR-01（P1）列表读取失败必须有错误态，且与空态文案不同；TC-ERR-02（P2）生成中途断网的表现。

### 2.2 菜单的键盘与焦点（TC-SHL-01 只测"菜单不被裁切"）

`src/shell/chrome/Menu.tsx` 实现了 ArrowDown/ArrowUp 循环、Escape 关闭、**关闭后焦点回到 trigger**（176-178）、`role="menu"/menuitem/menuitemradio`（317/361）。清单没有一条断言菜单键盘可达性与焦点归还。建议 TC-SHL-08（P1）：品牌 Mode 菜单 / 模型菜单 / @ 菜单 / 标签 ⋯ 菜单的键盘全流程。

### 2.3 侧栏与文件树

- ★ **侧栏与 agent 列的拖拽缩放：不是"没测"，是根本没接线。** `src/shell/state/shellReducer.ts:28-33` 定义了 `NAV_MIN_WIDTH 160 / NAV_MAX_WIDTH 300 / TASK_MIN_WIDTH 320 / TASK_MAX_WIDTH 660`，reducer 也处理 `set-nav-width`（`:128`）与 `set-task-width`（`:129`）——但**全仓库没有任何非测试代码 dispatch 这两个 action**（只在 `shellReducer.test.ts:206-213` 出现）。`App.tsx:155-156` 只是把 `state.navWidth` / `state.taskWidth` 写进 CSS 变量，没有手柄、没有拖动、没有双击复位。→ 面板**用户不可缩放**，始终是 190/320。清单里不该有这条用例（无控件可测），但应记入 `not-implemented.md`，或在补上拖拽手柄后立刻加用例。
- ★ **Editor 模式侧栏的「New」「Open」按钮**（`Sidebar.tsx:95-103`）——只出现在 Editor 模式，`deadControls.test.ts` 的注释专门记录过这两个按钮曾是死按钮。清单无。
- **显式展开/收起箭头**（`FileTree.tsx:223` 的 `aria-expanded`）+ **键盘展开**（248-252，含 ArrowLeft/ArrowRight）——清单只有鼠标点文件夹。
- **文件夹分页/溢出"更多"**（`FileTree.tsx` 的 `onToggleOverflow`，`SIDEBAR_PAGE = 5`）——清单无。同理 TaskList 限 8 条、Activity 限 20 条、Runtime 表 `pageSize 8`（`AdvancedControls.tsx:556`）都有分页，无用例。

### 2.4 Home 控件

- ★ **Editor Home 的 `Group by` 与文件类型两个下拉**（`EditorHome.tsx:57-70`）——清单 TC-FOL-03 只测了 Recent/Pinned 切换，这两个筛选器完全没提。
- **"Watch deck drawing"（看 PPT 生成录像）**（`EditorHome.tsx:103-111`，`useDeckDemo`）——清单无。
- 清单 TC-HOM-05 说 Highlights 点击"提示尚未有视频素材"，但 `Highlights.tsx:234` 的卡片是 `aria-label="Play …"` 的**播放按钮**，旧 shell 里是"打开新标签页"。建议明确：点卡片=notice，还是=打开预览？现在是 notice。

### 2.5 账号页

`AccountPage.tsx` 除登录/登出/取消外还有：**复制登录链接**（248）、**在浏览器中打开**（252）、**Check status**（258）、**失败后 Try again**（287）、**返回**（293）。TC-ACC-01 只覆盖了 4 条主路径，缺"轮询状态""复制链接""失败重试"。

### 2.6 生成阶段与任务面板

- **Finish**（`TaskPanel.tsx`）在 TC-TSK-03 里与 Stop 并列提了一句，但 TC-TSK-03 标 P1 且没有"Finish 后文件内容"的断言细节——这条其实很关键（已写盘的改动不回滚），建议升 P0 或至少补断言。
- **Retry**（TC-PPT-07）之外，任务面板还有 `Review and apply`、`Undo`（TC-EDT-02 已覆盖）。
- 建议补：任务面板各按钮在 **空闲/进行中/等待回答/完成/失败/取消** 六态下的可用性矩阵（现在散落在多个 TC 里，没有一处集中断言"某态下某按钮必须禁用"）。

### 2.7 窗口与画布尺寸

- TC-CNV-02 只说"短窗口是更少行"，**没有最小窗口尺寸用例**（`useViewportSize`、`presenceLayout` 有明确边界逻辑）。
- 侧栏折叠轨 52px、agent 列 320px、侧栏 190px 这些常量在 `CLAUDE.md` 里是硬约定，清单无用例断言折叠/展开时画布宽度与面板不重叠。

### 2.8 原生集成（整个产品面缺失）

- **macOS 原生菜单、文件关联、深链都没有**：`wails.json` 未声明 `fileAssociations` / `protocols`，因此 `build/darwin/Info.plist` 里的 `{{if .Info.FileAssociations}}` / `{{if .Info.Protocols}}` 块**不会展开**——发布包里既没有 `CFBundleDocumentTypes` 也没有 `CFBundleURLTypes`。Go 侧也搜不到 NSMenu / tray / recent-docs / single-instance。
- ★ **Finder 拖文件到窗口是死路（用代码追踪确认，不是猜）**：`main.go:50-53` 设 `EnableFileDrop: true` + **`DisableWebViewDrop: true`**（原生层吞掉拖放，webview 不再派发 drop 事件）；而 Go 侧为此准备的入口 `app_local_files.go:61 ImportLocalFile`（注释原话："a drop, a command or a Finder open"）**在 `src/shell/**` 里没有任何调用方**——唯一的生产调用是 `app_local_files.go:58` 的 `OpenFileDialog` 回调，其余全是 `_test.go`。旧渲染器的 `src/renderer/homeDropZone.ts` 也只被旧界面引用。→ **往新 shell 窗口拖一个 .docx 不会有任何反应**，且没有 notice（违反第 15 节"不能没反应"）。
- 建议：TC-INS-04（P2）"Finder 拖入 / 双击打开"——要么补实现并测，要么记 `not-implemented.md` 并在清单里写明不支持。

---

## 3. 清单与代码不一致的 8 处（应修正文档）

| # | 清单位置 | 清单说法 | 代码事实 |
|---|---|---|---|
| 1 | 第 15 节表格 | 「标签 ⋯ **导出/打印/版本历史** \| `file-more-actions` 残留 \| 重命名/副本/置顶/移出库已接」 | `FileTabs.tsx:449-479` 的 ⋯ 菜单**只有**重命名/创建副本/置顶/移出库。**导出/打印/版本历史在新 shell 里根本不存在**，没有控件可点，也就没有"点了要出 notice"这回事 |
| 2 | 第 20 节第 10 条 + TC-CNV-01 | 「英文系统上 Word 工具栏目前仍可能是中文——这是 writer 仓库缺 `en-US` 词典」 | 见 §1.2：英文下走 `humanizeKey()`，输出像 `Tab Font Bold`，不是中文。描述需重写 |
| 3 | 第 0 节 / 第 18 节 | 「系统中文 / 英文各一轮」「环境：中文系统」 | `detectLocale()` 恒为 `"en"`，系统语言不影响首启（§1.3） |
| 4 | TC-CMP-08 | 「有 API 则有可视状态；无 API 则提示，不假装在听」 | 提示文案硬编码英文（`Composer.tsx:521`），中文环境不成立 |
| 5 | TC-PKG-06 | 「只读 bundle Vite SSR：cacheDir 在 `/var/folders`…事后 codesign 仍过」 | 这是**从签名**角度写的；同类问题在"已签名后再 bundle"的构建顺序里更危险，建议补一条"构建顺序门禁"：先 bundle → 再 codesign → `stapler` |
| 6 | **TC-CMP-01** | 「进行中空 Composer 变成 Stop」 | **按字面测会误判正确代码**：`Composer.tsx:244` 是 `const stopping = placement !== "home" && busy && !canSend`，**Home 上的 Composer 故意不变成 Stop**（注释写明理由：不能让新用户第一眼就看到一个无确认的破坏性按钮）。清单需补"Home 例外" |
| 7 | **TC-SHL-03** | 「关闭 / 最小化 / 全屏 —— 桌面端行为与系统一致」 | 在 **macOS 主目标平台上这一步不可执行**：`WindowBar.tsx:83-85` 在 `hasOverlayWindowChrome()` 为真时只渲染一个 `aria-hidden` 的占位带，**不画任何窗口按钮**（真按钮由系统绘制）。清单应改成"确认没有第二套自绘按钮（`data-system-drawn`）"，Windows/浏览器才点按钮 |
| 8 | **TC-FOL-03** | 「空列表**三种**空态」 | `FileTree.tsx:400-431` 实际有**四种**分支（pinned 与 fileType 组合是独立文案）。要么改成四种，要么说明算三种的口径 |

另：TC-ADV-01 的「Runtime runs 调试表能打开，不崩」——该表其实有**逐行 Cancel（`AdvancedControls.tsx:526-532`）、Retry（`:533-537`）、历史显示切换（`:547-553`）、翻页（`:556`）**，"不崩"这个标准太低。同理 Provider "Test connection"在 `AdvancedControls.tsx:130-147` **会先弹确认框（因为要花额度）**，且有 4 种结果标签（`:430-441`），TC-ADV-01 一句"有通过/失败/网络错误"漏了确认框与额度消耗。

---

## 4. 第 19 节"自动化对照"的 5 处误报（假绿灯，建议修）

这是我认为**最危险**的一节，因为它让手工测试放心地跳过。

| 清单声称 | 实际情况 |
|---|---|
| `e2e/generation-real.spec.ts` → TC-PPT-01/06、TC-DOC-01、TC-PLN-01、TC-XLS-01、TC-RPT-01、TC-IMG-01 | 该 spec 用 `preparePage` → `e2e/support/real-e2e.ts:70-83`，**打开的是 `/legacy.html`（旧 UI）并把 locale 钉成 en**。它验证的是旧界面，**不是发版打开的新 shell** |
| `e2e/shell-settings-real.spec.ts` → TC-SET-*、TC-ADV-01、TC-UPD-02 | 同样走 `preparePage` → **旧 UI**；而清单第 13 节开头写的是"齿轮打开**整页**设置"，那是新 shell 的行为。**新旧对不上** |
| `e2e/pptx-stage-real.spec.ts` → TC-PPT-02/07 | 同样走 `preparePage` → 旧 UI |
| `e2e/artifacts-preview-real.spec.ts` → 预览/系统打开/失败上报 | 同样走 `preparePage` → 旧 UI |
| `e2e/fix-w1a/w1c/w1d/w2f/w2g/w3h/w5.spec.ts`（第 19 节末） | 该行本身是**笔误**（路径不存在）。且漏掉了真正做中文验收的 **`e2e/fix-w3j.spec.ts`**——`"zh-CN renders the shell in Chinese"`（6 条：窗口栏/侧栏/模式切换、设置页、文件树/列表表头、状态栏/标签栏/agent 面板、Editor Home、Agent Home）+ en-US 逐字节对照 + 中文长文案不溢出。这是清单里**最有价值的自动化之一，却完全没被引用** |

**真正跑在新 shell 上的 real spec 只有 5 个**：`shell-canvas-real`、`shell-generation-real`、`shell-pptx-generation-real`、`shell-outline-gate-real`、`deck-edit-routing-real`（均 `page.goto("/")`，未钉 locale → 默认英文路径）。

**→ 建议**：在第 19 节加一列「入口」，明确标注 `新 shell (/)` 还是 `旧 UI (/legacy.html)`；把 `fix-w3j` 补进对照表；并把"新 shell 的设置页/生成/取消/预览"从"已自动覆盖"降级为**手工必测**，直到有对应的 `/` 入口 spec。

---

## 5. 建议的补测优先级

**P0（会漏严重缺陷）**
1. TC-SET-03b/03c：打开文件时切语言（三编辑器 × 脏/净），含数据丢失护栏。
2. TC-SHL-07：⌘W 关标签 / 无文件时关窗口。
3. 第 19 节入口列修正：把"新 shell 的设置与生成"改为手工必测。
4. TC-SET-03e 或文档修正：系统语言 vs 首启语言（现在清单假设与代码相反）。
5. 冲突 6/7 修正：TC-CMP-01 的 Home 例外、TC-SHL-03 的 macOS 不可执行（**照原文测会误报**）。

**P1**
6. TC-CNV-06/07：Excel 语言不即时生效；English 下三编辑器可读性矩阵。
7. TC-ERR-01：列表读取失败必须有错误态（现在与空态不可区分）。
8. 右键 / F2 行菜单（TC-FOL-04）与 Menu 键盘契约（TC-SHL-08，含焦点归还）。
9. TC-EDT-02 升级：Finish/Stop 后文件内容一致性断言集中化。
10. Editor Home 的 Group by / 文件类型筛选；侧栏 New/Open；文件夹键盘展开与溢出分页。
11. 账号页 Check status / 复制链接 / 失败重试。
12. TC-NBI-02：中文下未实现提示必须中文。

**P2**
13. Finder 拖入 → 目前是**无反应的死路**（或补实现，或记 `not-implemented.md`）；应用菜单栏 / 文件关联 / 深链。
14. 最小窗口尺寸（`MinWidth 1040 / MinHeight 720`）与面板折叠后的画布尺寸不变式。
15. 把"面板不可缩放"记入 `not-implemented.md`（reducer 有 action、UI 无入口）。

---

## 6. 已经做得好的地方 / 不必当成缺陷的

- 分级（P0/P1/P2）+ "怎么用这份清单" + P0 冒烟可打勾，工程上很实用。
- 第 20 节"记缺陷时不要误报的已知边界"——12 条非常有价值，是这份文档最扎实的部分。
- `src/shell/test/deadControls.test.ts`（无空按钮闸门，且**自己写明了** `<SidebarButton>` 这类"组件包 button"的盲点）与 `src/shell/test/copyRatchet.test.ts`（中英文案棘轮）作为自动门禁的思路正确。
- 大量 TC 直接挂了 spec 路径，可追溯性好——这也是为什么第 19 节的入口误标值得优先修。
- **以下不是清单漏项，是产品本身没有的能力，别写成测试用例**（应记 `not-implemented.md`）：新 shell 没有多选、没有面包屑、没有文本搜索（`FileFilter` 只有 `"pinned" | "all"`，`src/shell/nav/fileTreeModel.ts`）；没有拖拽缩放面板（§2.3）；没有 `⌘S`（§2.1）。这些写进验收清单只会让执行人去找不存在的按钮。

---

## 附：本次核查的一手证据索引

| 主题 | 文件:行 |
|---|---|
| locale 恒为 en | `src/renderer/i18n/index.tsx:15-17` |
| Writer iframe 随 locale 重载 | `src/renderer/word/WriterEditorFrame.tsx:136-151, 402-404` |
| Presentation iframe 随 locale 重载 | `src/renderer/presentation/PresentationEditorFrame.tsx:155-172` |
| Sheet locale 只在创建时固定 | `src/renderer/spreadsheet/sheetSdk.ts:349-359`；`src/canvas/SheetCanvas.tsx` 无 locale 依赖 |
| Sheet 有完整 16 语种 | `node_modules/@shimo/sdk-sheet/locales/*/en-US.js`（4380 key，与 zh-CN 同级） |
| Writer 英文靠 humanizeKey | `public/writer/host-runtime.js`：`WRITER_SDK_ENGLISH_CHROME`（11 条）+ `englishFrom()` |
| E2E 钉死 en + 走旧 UI | `e2e/support/real-e2e.ts:70-83` |
| 中文 shell 已自动覆盖 | `e2e/fix-w3j.spec.ts:90+`；`e2e/fix-w3h.spec.ts:207-230` |
| 标签 ⋯ 菜单实际条目 | `src/shell/chrome/FileTabs.tsx:449-479` |
| 硬编码英文提示 | `Composer.tsx:521,844`；`useAgentTask.ts:121`；`reportPortFailure.ts:37,86` |
| ⌘W 实现 | `src/shell/chrome/closeTabShortcut.ts`；`FileTabs.tsx:225-238` |
| 无 ⌘S（保存只有点击） | `grep KeyS` 在 `src/shell`、`src/canvas` 无命中；保存 UI 见 `FileTabs.tsx:356-376` |
| 右键 + F2 行菜单 | `src/shell/nav/FileTree.tsx:215-218, 241-245, 329-332, 348-352` |
| 菜单键盘/焦点 | `src/shell/chrome/Menu.tsx:176-178,317,329-393` |
| 面板缩放 action 无调用方 | `state/shellReducer.ts:28-33,128-129`；非测试 dispatch 为空；消费点 `App.tsx:155-156` |
| 列表读取失败无错误态 | `state/ShellContext.tsx:70-91`；`agent/useAgentTasks.ts:35-53`；`settings/SettingsSections.tsx:176-198` |
| Home Composer 不变 Stop | `src/shell/composer/Composer.tsx:244` |
| macOS 不画窗口按钮 | `src/shell/chrome/WindowBar.tsx:83-85` |
| Finder 拖放死路 | `main.go:50-53`（`DisableWebViewDrop: true`）；`app_local_files.go:58,61`（`ImportLocalFile` 仅测试调用） |
| Editor Home 筛选器 | `src/shell/home/EditorHome.tsx:57-70` |
| 侧栏 New/Open | `src/shell/chrome/Sidebar.tsx:95-103` |
| 无原生菜单/文件关联 | `wails.json`（无 fileAssociations/protocols）；`build/darwin/Info.plist` 的条件块不展开 |
| 暂停仅非 docx/xlsx | `src/shell/agent/TaskPanel.tsx:153-171` |
| Provider 测试要花额度先确认 | `settings/AdvancedControls.tsx:130-147, 430-441` |
| Runtime 表逐行 Cancel/Retry/翻页 | `settings/AdvancedControls.tsx:526-537, 547-556` |
