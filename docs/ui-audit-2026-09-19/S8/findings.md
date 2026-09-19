# S8 — 门控与终点态

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ 负责表面：强制更新全屏页、首次启动零数据态、`notBuiltYet` 死路、内部拖放反馈

- spec：`e2e/ui-audit-s8.spec.ts`（15 个用例，全绿）
- 截图：`docs/ui-audit-2026-09-19/S8/screenshots/`（43 张）
- 运行：`PLAYWRIGHT_BASE_URL=http://localhost:3100 OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/s8 npx playwright test e2e/ui-audit-s8.spec.ts`
- 只读：除本目录与上面这个 spec 外未改任何文件。

> **与 S0-001 的边界**：S0 已确证「打包后 shell 不链 `onboarding-update.css`，这一页全无样式」。
> 本文件里所有 `GATE-*.png`（无 `-styled` 后缀）就是那个状态，**不再重复报**。
> 带 `-styled` 后缀的截图是我用 playwright `addStyleTag` 注入
> `src/renderer/styles/onboarding-update.css` 全文后拍的，等价于「S0-001 修好以后」——
> 下面关于更新页布局/文案/逻辑的每一条，都是在**注入后**的状态下成立的，与 S0-001 无关。

---

## 一、强制更新全屏页

### [S8-001] `downloaded` 这一张卡片同时给出三个互相矛盾的信号

- 壳组合：不适用（这一页替换整个应用，`UpdateGate.tsx:38`）
- 运行环境：3100 fake（`?forceUpdate=downloaded`），注入 legacy CSS 后
- 表面：`ForceUpdateOverlay` → downloaded 阶段
- 复现：`http://localhost:3100/?forceUpdate=downloaded`
- 现象：进度条停在 **39%**，正下方文案写「Download complete. Restarting…」，
  再下面一个按钮写「Restart to install」。三者说的是三件事：没下完 / 已下完且正在重启 / 请你点一下重启。
- 证据：`screenshots/GATE-downloaded-styled.png`；
  进度条填充 429→594 px，轨道 429→850 px = **165/421 = 39.2%**；
  按钮 rect 422×32；卡片 480×380。
  同一 fixture 的 `progress` 是 46,137,344 / 118,489,088 = 38.94%（`src/shell/main.tsx:63`）。
- 根因：`renderer/components/ForceUpdateOverlay.tsx:52` 的 `percent` 只来自 `progress`，
  而 `:79-84` 的文案分支在 `downloaded` 时直接写死「下载完成」——**两者没有共同的真值来源**。
  上游 `renderer/useAppUpdate.ts:139-142` 的 `downloaded` 事件只改 phase，
  **不把 progress 补到 bytesTotal**，所以真实链路里这根条会停在最后一个 progress 事件的百分比上，
  不保证是 100%。
- 类别：状态与文案不一致 ｜ 严重度：**P1**
- 同根因其它实例：**1**（`ForceUpdateOverlay.tsx:74` 在 `installing` 时把 percent 硬改成 100，
  同一个三元里的另一半，同样不看真实进度）
- 双渲染对照：不适用

### [S8-002] mandatory 路径下「Restart to install」按钮实际按不到

- 壳组合：不适用
- 运行环境：3100 fake 可截图；**真实 mandatory 链路未跑通**（本机无 updater backend），这一半是代码推导，已标注
- 表面：同上
- 复现：`?forceUpdate=downloaded` 能看到按钮；真实链路下看不到
- 现象：fixture 下按钮实存（422×32，见 `GATE-downloaded-styled.png`）；
  但真实 mandatory 流程里 `downloaded` 只存在一个 render pass。
- 证据：截图 = 按钮 422×32 的矩形；
  代码侧 `renderer/useAppUpdate.ts:156-162`——`phase === "downloaded" && status.mandatory` 时
  立刻 `void install()`，`install()` 第一行就是 `setPhase("installing")`（`:96`）。
  而 `ForceUpdateOverlay.tsx:97` 的按钮条件是 `downloaded && !installing`。
- 根因：`useAppUpdate.ts:156-162` 与 `ForceUpdateOverlay.tsx:97-101` 对「谁负责触发安装」各做了一套，
  强制更新场景下自动那套永远赢。
- 类别：死控件 / 不可达 UI ｜ 严重度：**P2**
- 同根因其它实例：**0**
- 备注：`downloaded` 那行文案（`update.force.downloadComplete` = "Download complete. Restarting..."）
  其实就是为自动安装写的；按钮是给非强制场景写的。两条路径被塞进同一个组件，没有开关区分。

### [S8-003] 七个 phase 里有三个渲染出**逐像素相同**的一张页面

- 壳组合：不适用
- 运行环境：3100 fake，注入 legacy CSS 后
- 表面：`ForceUpdateOverlay` 全部 phase
- 复现：`?forceUpdate=idle` / `=checking` / `=available` 三次对比
- 现象：三者卡片 rect 完全相同 `{left:400, top:185, width:480, height:351}`，
  按钮同为 `["Update now"]` 422×32，进度条 0 个，正文完全一致。
  `checking`（正在向服务器问版本）**没有任何「正在检查」的指示**。
- 证据：`screenshots/GATE-idle-styled.png`、`GATE-checking-styled.png`、`GATE-available-styled.png`
  三张的测量值见 spec 输出；三组 rect 三元组 `{400,185,480,351}` 一字不差。
- 根因：`ForceUpdateOverlay.tsx:48-50` 只从 7 个 phase 里抽出
  `downloading / downloaded / installing` 三个布尔，`:86` 的 `else` 吃掉剩下四个。
- 类别：状态未表达 ｜ 严重度：**P2**
- 同根因其它实例：**1**（`error` 也落进同一个 `else`，只是多了一行红字，见 S8-004）
- 补充事实（不算缺陷，但影响修复优先级）：`idle` 与 `checking` 在真实链路里**到不了这一页**——
  `UpdateGate.tsx:38` 要求 `status.mandatory && release` 同时成立，而这两个 phase 下 status 还没回来。
  真实可达的只有 available / downloading / downloaded(一帧) / installing / error 五个。

### [S8-004] 错误态只给了一个与「从没试过」完全同名的按钮，没有任何第二条出路

- 壳组合：不适用
- 运行环境：3100 fake，注入 legacy CSS 后
- 表面：`ForceUpdateOverlay` → error
- 复现：`http://localhost:3100/?forceUpdate=error`
- 现象：这是后端拒绝旧版本时用户唯一的界面。出错后画面上只有：
  红字「The download could not be verified.」+ 一个按钮「Update now」。
  没有「重试」措辞、没有手动下载地址、没有支持/反馈入口、没有「查看日志」。
  按钮文案与 available 态**逐字相同**，用户无法从按钮上看出自己已经失败过一次。
- 证据：`screenshots/GATE-error-styled.png`；
  `buttons` 数组在 available 与 error 两个 phase 下同为 `[{text:"Update now", width:422, height:32}]`；
  error 卡片 480×379 vs available 480×351（唯一差别就是多出的 16px 高红字）。
- 根因：`ForceUpdateOverlay.tsx:86-96`（else 分支只渲染一个 `onUpdate` 按钮）
  与 `:102`（错误只是一行 div）。
  **能用而没用的东西就在手边**：`AppUpdateRelease.assets`（`src/shared/types.ts:954`，
  `Record<string, AppUpdateAsset>`）里就有各平台的下载资源，
  而 `grep -c assets ForceUpdateOverlay.tsx` = **0**——组件从未读过它。
- 类别：终点态无出路 ｜ 严重度：**P1**
- 同根因其它实例：**0**（这一页是独一份的全屏门）
- 备注：窗口控件这条我查过后**不成立**，不要误记：
  `main.go:63` 用的是 `mac.TitleBarHidden()`，其定义 `HideTitleBar: false`
  （`wails/v2@v2.12.0/pkg/options/mac/titlebar.go`），原生红绿灯仍在；Windows 保留原生边框。
  所以用户没有被关在窗口里，只是**壳自绘的那三个按钮消失了**（测得 `windowControls: 0`，7 个 phase 全部为 0）。

### [S8-005] 中文系统下这张卡片是中英混排，而混进来的英文恰好是最要紧的两句

- 壳组合：不适用
- 运行环境：3100 fake，playwright `locale: "zh-CN"`，注入 legacy CSS 后
- 表面：`ForceUpdateOverlay` → zh
- 复现：spec 的 `S8-1b` describe（`test.use({ locale: "zh-CN" })`）
- 现象：标题「需要更新」、版本行「版本 1.4.0（当前 1.3.2）」、理由句、按钮「立即更新」全是中文，
  **release notes 与 error 两块仍是英文**。error 那句正是用户需要看懂的那句。
- 证据：`screenshots/GATE-error-zhCN-styled.png`、`GATE-available-zhCN-styled.png`、
  `GATE-downloading-zhCN-styled.png`；
  zh-CN error 页 `documentText` 里 6 个文本块有 **2 块**英文
  （notes + "The download could not be verified."）。
- 根因：`ForceUpdateOverlay.tsx:64` 直出 `release.notes`（服务端文本），
  `:102` 直出 `error`（`useAppUpdate.ts:76/89/99/147` 里全是 `err.message` 原文），
  两处都没有经过 `t()`。其余每一行都走了 `renderer/i18n`。
- 类别：i18n ｜ 严重度：**P2**
- 同根因其它实例：**0**（这是**反方向**的 i18n 缺口：PLAN 2.2 说的是「shell 全硬编码英文」，
  而这一页是全 app 唯一走 i18n 的表面，问题反而是有两块漏网）
- 交叉：同一次运行里在 zh-CN locale 下拍了 shell（`screenshots/C1-S8-shell-under-zhCN-locale.png`），
  `navigator.language = "zh-CN"`，侧栏文案全英文（"Home / New task / Folders"），
  只有文件名是中文（CJK 串 5 处）。PLAN 2.2 的断言在本机成立。

### [S8-006] 这一页画了一层 70% 的黑色蒙版，盖在**什么都没有**的上面

- 壳组合：不适用
- 运行环境：3100 fake（注入 legacy CSS 后才看得见；未注入时它是白底）
- 表面：`.force-update-overlay`
- 复现：`?forceUpdate=available` + 注入 CSS
- 现象：全屏 1280×720 的 `rgba(15,15,15,0.7)` + `backdrop-filter: blur(6px)`。
  这层蒙版的设计意图是「压在应用上面」，但这里它背后**没有应用**，
  于是模糊了个寂寞，蒙版只是把页面变成一块深灰色。
- 证据：`screenshots/GATE-available-styled.png`（纯深灰底，无任何被模糊的内容）；
  测得 overlay rect `{0,0,1280,720}`、background `rgba(15, 15, 15, 0.7)`，
  同一次测量 `shellRoots: 0`（`#shell` 元素数为 0，7 个 phase 全部为 0）。
- 根因：`renderer/styles/onboarding-update.css:342-353` 按「模态遮罩」写的
  （`position:fixed; inset:0; z-index:9999; 半透明 + backdrop-filter`），
  而 `chrome/UpdateGate.tsx:38` 是 `return <ForceUpdateOverlay .../>`——**整片替换而非叠加**，
  legacy 入口 `renderer/main.tsx` 下它确实叠在 app 上，shell 入口下不是。
- 类别：legacy 组件语义在 shell 里改变 ｜ 严重度：**P3**（视觉浪费，不阻断）
- 同根因其它实例：**0**（S0-001 已认定 `ForceUpdateOverlay` 是唯一绕过 `renderer/ui` 的 legacy 组件）
- 备注：与 S0-001 是**同一个组件的两个不同问题**：S0-001 是「样式没打进包」，
  这一条是「样式打进去了以后，它的设计前提也不成立」。修 S0-001 那一行 import 不会让这条消失。

### [S8-007] release notes 是唯一没有断词保护的文本块（潜在）

- 壳组合：不适用
- 运行环境：3100 fake，注入 legacy CSS 后，用 DOM 注入长 URL 测量
- 表面：`.force-update-notes`
- 复现：spec 的 "release notes are server text with no wrapping guard"
- 现象：把 notes 换成一个 109 字符的无断点 URL 后，文本溢出自己的盒子 **6px**，
  被卡片 28px 的 padding 吃掉，**没有真的冲出卡片**。
- 证据：`screenshots/GATE-available-styled-longnotes.png`；
  `notes.scrollWidth = 428` vs `clientWidth = 422`（溢出 6px）；
  `notes.right - card.right = -29`（仍在卡内）；
  `.force-update-notes` 的 `overflow-wrap = normal`，
  而同一张卡上的 `.force-update-reason` 是 `anywhere`（`onboarding-update.css:413`），
  `.force-update-error` 也是 `anywhere`（`:436`）。
- 根因：`onboarding-update.css:401-407` 漏写 `overflow-wrap`。
  notes 是这张卡上**唯一**由发布源（服务端）决定内容的文本。
- 类别：长文案 ｜ 严重度：**P3**（当前不破版，是缺一道护栏）
- 同根因其它实例：**0**（同卡片另外两个长文本块都已加了 `anywhere`）

### 更新页的两个阴性结果（也记下来，免得别人重查）

- 窄视口不裁切：600×420 下卡片 480×363，`top:16`，底边 379 < 420，`.force-update-overlay`
  有 `overflow:auto`，`@media (max-width:600px)` 会把 padding 收到 16px。
  截图 `screenshots/GATE-error-styled-600x420.png`。
- 用户没有被关在窗口里，见 S8-004 备注。

---

## 二、首次启动零数据态

### [S8-008] 默认壳 C1 上，空态文案叫用户做的两件事，屏幕上一个控件都没有

- 壳组合：**C1**（默认：agent + home + 折叠轨）；C2（展开）同样成立，见下
- 运行环境：3100，**不带 `shellFixture`**（浏览器预览 port 就是显式空工作区，与首次启动同形）
- 表面：AgentHome → `FileList` → `ComfortableList` 空态
- 复现：`http://localhost:3100/`（干净 profile）
- 现象：首屏是 hero 输入框 + 三个提示按钮 + 「Feature highlights」轮播（四张卡全是死路，见 S8-012），
  往下滚到底是「**No files yet / Create a file, or open one from this computer.**」。
  这句话点名了两个动作，而 C1 上 **28 个可见控件里没有任何一个能做这两件事**。
- 证据：`screenshots/C1-S8-first-run-empty.png`；
  测得 `controlCount: 28`，其中名称匹配 `new|create|open|blank|import|add file` 的只有三个：
  `"New task"`、`"New task instructions"`（textarea）、`"Add files or folders"`——**全是任务侧的**，
  没有一个是建文件或开文件。另测 `folderRows: 0`、`tabCount: 0`、`taskRows: 0`。
  展开侧栏后（`?nav=expanded`，`screenshots/C2-S8-first-run-empty-expanded.png`）多出的只有
  `"New folder"`，仍然没有建文件/开文件；侧栏全文只有 `"OfficeDexHomeNew taskFolders"`。
- 根因：`home/FileList.tsx:20-41` 只渲染列表，不渲染任何新建/打开动作；
  空态文案写在 `nav/FileTree.tsx:355-357`，是两套 density 共用的，
  但只有 editor 侧的 `home/EditorHome.tsx:62-82` 真的提供了那四个按钮
  （Blank document / Blank workbook / Blank presentation / Open from this computer）。
  agent 首页没有对应物。
- 类别：空态与可用动作不对应 ｜ 严重度：**P1**
- 同根因其它实例：**1**——同一句文案在 EditorHome（C3/C4）下是成立的：
  `screenshots/C4-S8-first-run-empty-editor.png` 里那四个按钮就在空态正上方，
  测得 `actions: ["Blank document","Blank workbook","Blank presentation","Open from this computer"]`。
  **同一句话，在 agent 首页是空头支票，在 editor 首页是真的。**
- 双渲染对照：空态由 `ComfortableList` 出（density=comfortable）；
  compact 那套（侧栏）零数据时连文件夹行都没有，只显示 "Folders" 标题 + 一个 "New folder" 图标按钮，
  不出这句文案。所以本条**只在 comfortable 复现**。
- 真实路径（数一下步数）：C1 → 展开侧栏（无文字标签的图标）→ New folder → 填对话框 →
  文件夹行 hover 出 "+" → 菜单 → New document。**6 步**，且第一步的入口是个没有文字的图标。

### [S8-009] 新壳没有任何 onboarding（量化确认，归产品决策）

- 壳组合：C1 / C2 / C4
- 运行环境：3100，不带 fixture
- 表面：首屏全局
- 复现：同上
- 现象：首屏正文里 0 处 `get started` / `welcome` / `tour` / `step 1` 之类的引导措辞。
- 证据：`screenshots/C1-S8-first-run-empty.png`；测得 `onboardingMarkers: false`，
  首屏全文为「What would you like to get done? / Bring your files and a goal. Jump in and edit at any time.
  …Feature highlights…Your files / No files yet」。
- 根因：**根因待定（按产品决策处理）**。引导只存在于 legacy 设置页的 `rerunOnboarding`，
  `grep -rn legacy src/shell` 为空 → 新壳没有任何入口通向它。
- 类别：功能缺失（PLAN 第 9 节第 3 条）｜ 严重度：**P2**
- 同根因其它实例：不适用
- 备注：「Feature highlights」四张卡在视觉上是唯一像引导的东西，
  而它们**全部是死路**（S8-012）——所以新用户第一眼能看见的「学一下怎么用」入口，点下去只会得到
  「视频还没拍」。这两条叠在一起才是真正的首次体验问题。

### [S8-010] Home 上的文件操作组用 `visibility:hidden` 藏起来，注释声称保留了键盘可达，实际不可达

- 壳组合：C1–C4（所有 `home=true` 的壳）
- 运行环境：3100，不带 fixture（带 fixture 同样成立）
- 表面：`FileTabs` → `.shell-tabs-actions`（Saved / Share / Full screen / More actions）
- 复现：`http://localhost:3100/` → 检查 `.shell-share`
- 现象：四个按钮在 DOM 里、占着 70×28 的盒子，但看不见也点不到；
  CSS 注释说这是为了「Keep the controls in the DOM for keyboard/tests and preserve their handlers」，
  而 `visibility: hidden` 恰恰会把元素移出 tab 序和可访问性树。
- 证据：`screenshots/C1-S8-first-run-empty.png`（右上角空白）；
  测得 `.shell-share`：`visibility: "hidden"`、`pointerEvents: "none"`、`rect 70×28`、
  **`focusable: false`**（`element.focus()` 后 `document.activeElement !== element`）。
- 根因：`chrome/chrome.css:330-337`——注释的意图（保留键盘可达）与选用的属性
  （`visibility:hidden`）互相矛盾。若真要保留键盘可达应该用 `opacity:0` + 保留 `pointer-events`，
  或干脆条件渲染。
- 类别：注释与实现不符 / 可访问性 ｜ 严重度：**P2**
- 同根因其它实例：**3**（同一条规则一次性藏掉 Saved / Full screen / More actions 另外三个按钮）
- 双渲染对照：不适用

---

## 三、五处 `notBuiltYet` 死路

五个调用点全部触发成功，截图齐全：

| # | 调用点 | 触发后的文案 | 有没有说清替代路径 | 截图 |
|---|---|---|---|---|
| 1 | `home/Highlights.tsx:211` | "The feature videos have not been filmed yet. They will play right here when they land." | 半——只说了「等」，没有替代 | `C2-S8-deadend-highlights.png` |
| 2 | `composer/Composer.tsx:449` | "Dictation is not available in this browser. Type your instruction for now." | **是**（改用打字） | `C2-S8-deadend-dictate.png` |
| 3 | `composer/Composer.tsx:685`（review） | "Review changes is not available yet — every run applies its changes directly. Full access is the only mode the agent honours." | **是**（Full access 是唯一生效档） | `C2-S8-deadend-permission-review.png` |
| 3b | `composer/Composer.tsx:685`（**custom**） | "Custom is not available yet — …（同上后半句）" | 是 | `C2-S8-deadend-permission-custom.png` |
| 4 | `chrome/FileTabs.tsx:165` | "Sharing a file from OfficeDex is not built yet. Open a local file first." | **误导**，见 S8-011 | `C5-S8-deadend-share-nofile.png` |
| 5 | `chrome/Sidebar.tsx:124` | 与 3 **逐字相同** | 是 | `C1-/C2-S8-deadend-review-changes.png` |

补充：`Composer.tsx:449` 的听写分支在 Chromium 下不会触发（实测 `nativeSupport: true`），
我在 spec 里用 `addInitScript` 删掉 `SpeechRecognition` / `webkitSpeechRecognition` 才走到它。
真实会撞上这条的是没有该 API 的 webview（Windows/Linux 的 Wails 构建），本轮未在那些平台验证。

### [S8-011] share 的提示文案与实际行为对不上；而真正有文件时它彻底静默

- 壳组合：C5–C10（`home=false` 才看得见这个按钮；C1–C4 被 S8-010 那条规则藏了）
- 运行环境：3100（无文件那半不带 fixture，有文件那半用 C6 fixture）
- 表面：`FileTabs` → Share
- 复现：无文件 `http://localhost:3100/?home=0` → 点 Share；
  有文件 `?shellFixture=1&shell=C6` → 点 Share
- 现象（两半都是问题）：
  1. **无文件时**：提示「Sharing a file from OfficeDex is not built yet. **Open a local file first.**」——
     前半句说功能没做，后半句说「先打开一个文件」。这两句互相取消：如果功能没做，开了文件也没用。
     实际代码是反的：功能**做了**（复制文件名/调用系统分享面板），只是没文件时走不下去。
  2. **有文件时**：点下去 **什么都不发生**。没有成功提示，没有失败提示，没有 toast。
- 证据：
  - 无文件：`screenshots/C5-S8-deadend-share-nofile.png`，toast 文本如上，rect `{410,16,460×93}`。
  - 有文件：`screenshots/C6-S8-share-withfile.png`，点击后等 300ms，
    **`.od-toast-host` 查询结果为 `null`（toast 数 = 0）**。
    而这条路径上三个成功分支各自都会发 toast（`FileTabs.tsx:180/183/185`）。
- 根因：
  - 文案矛盾：`FileTabs.tsx:165-168`——`notBuiltYet` 的语义是「这个控件背后什么都没有」
    （见 `port/reportPortFailure.ts:68-81`），但这里背后**有**实现，只是缺前置条件。
    用错了报告通道。
  - 静默：`FileTabs.tsx:187-189` 的 `catch {}`，注释只想吞掉「用户取消系统分享面板」，
    实际吞掉了这条路径上的**每一种**失败（`pathOf` 拒绝、`navigator.share` 抛错、
    剪贴板权限被拒——本次实测就是被剪贴板权限拒掉的）。
- 类别：文案与行为不符 + 失败被吞 ｜ 严重度：**P1**
- 同根因其它实例：**0**（`grep -n "catch {}" src/shell` 只此一处空 catch）

### [S8-012] 「五处死路」实为**六个**死控件，其中两个给出逐字相同的文案并共用同一个 toast key

- 壳组合：C1/C2（侧栏 footer 与 composer 都在）
- 运行环境：3100 fixture
- 表面：`Sidebar` footer 设置菜单 vs composer 权限菜单
- 复现：C2 → 侧栏 footer Settings → "Review changes"；再 C2 → composer 盾牌图标 → "Review changes"
- 现象：两个位于完全不同表面的控件，弹出**一字不差**的同一条提示。
  另外 composer 那个调用点还服务第二行「Custom」，所以 PLAN 写的「5 处调用点」对应的是 **6 个用户可点的死控件**。
  「Custom — Use your own instructions」承诺的是本 app 任何界面都写不了的东西
  （见 `Composer.tsx:41-43` 自己的注释）。
- 证据：两次截图的 toast 文本完全相同：
  `"Not built yetReview changes is not available yet — every run applies its changes directly. Full access is the only mode the agent honours."`
  （`C2-S8-deadend-review-changes.png` 与 `C2-S8-deadend-permission-review.png`）；
  key 也相同——`Sidebar.tsx:125` 写死 `"composer.permission.review"`，
  `Composer.tsx:686` 拼出 `` `composer.permission.${entry.value}` `` = 同一个字符串，
  而 `reportPortFailure.ts:85` 用 key 去重，所以先后点两个控件只会看到**一条**提示。
  权限菜单实测 4 行：`["Full access…","Review changes…","Custom…","Enter sends · on…"]`。
- 根因：`chrome/Sidebar.tsx:99-143` 与 `composer/Composer.tsx:667-700` 两个菜单重复承载同一组设置
  （PLAN 2.1 已记，属 S7），死路这一面的根因是两处各写了一份同样的文案，没有共享常量。
- 类别：重复控件 / 文案复制 ｜ 严重度：**P2**
- 同根因其它实例：**1**（`Enter sends` 也同时出现在两个菜单里，且措辞不同：
  侧栏写 "Enter sends" / "Enter adds a line"，composer 写 "Enter sends · on" / "Enter sends · off"——
  这条归 S7）
- 交叉：设置项重复与措辞不一致归 **S7**；我这里只认死控件数量与文案复制。

### [S8-013] 按下死控件后菜单关闭、按钮状态不变，唯一的反馈在 574px 之外的窗口顶端

- 壳组合：C2（C1 同样复现）
- 运行环境：3100 fixture
- 表面：五个死路的共同行为
- 复现：C2 → composer 权限菜单 → "Review changes"
- 现象：菜单像接受了选择一样关闭，但权限按钮仍然写「Full access」；
  唯一告诉用户「刚才那下没生效」的东西是一条从窗口**顶部**飞出来的 toast，
  离用户刚点的位置很远。在首页视频卡这个例子里，卡片中心 y≈636、提示中心 y≈62，**相距 574px**，
  两者不在同一屏注意力范围内。
- 证据：
  - `menuStillOpen: 0`（点完菜单 DOM 里 `.shell-menu` 数量为 0）；
  - 权限按钮点击后 `textContent` 仍为 `"Full access"`；
  - `screenshots/C2-S8-deadend-highlights.png`：卡片 rect `{x:238,y:523,w:321,h:226}`，
    toast rect `{left:410, top:16, width:460, height:93}` → 中心相距 **574px**。
- 根因：`chrome/Menu.tsx` 的行选中即关闭（对真能生效的行是对的），
  与 `port/reportPortFailure.ts:84-88` 把唯一反馈交给全局 toast——
  两者组合下，「点了没用」这件事在原地不留任何痕迹。
- 类别：反馈位置 ｜ 严重度：**P2**
- 同根因其它实例：**6**（六个死控件全部如此）
- 双渲染对照：不适用

### [交叉 S2] toast 从窗口顶端盖住标签栏（现象登记，不在此处定根因）

- 壳组合：C1、C2、C5（凡是触发 toast 的壳）
- 运行环境：3100
- 现象：五个死路触发的提示一律落在 `{left:410, top:16, width:460, height:93}`，
  正好压在文件标签栏上。截图 `C2-S8-deadend-highlights.png` 里可见它盖住了第 3、4 个标签
  （"MO launch deck" / "Positioning brief"）连同它们的关闭 ×。
- 量化：`.od-toast-host` → `position: fixed`、`z-index: 1100`；
  与 `.shell-tabs` 重叠 **11040 px²**，与 `.shell-windowbar`（`z-index: 3`）重叠 **11040 px²**；
  与 `.shell-sidebar` 不重叠。
- **交叉 S2**（PLAN 第 3 节把 z-index 1100 vs `.shell-menu` 60 的比对划给 S2）。
  我这边只提供触发器与实测数值，**不在 S8 认定根因**，避免两边重复报同一条。

### [交叉 S2 / S7] 侧栏 footer 设置菜单整体落在视口左侧之外

- 壳组合：**C1 与 C2 都复现**（不只是 PLAN 猜测的折叠轨 C1）
- 运行环境：3100 fixture
- 量化：菜单 boundingBox C1 = `{x: -210.5, y: 559, width: 250, height: 161}`，
  C2 = `{x: -210, y: 559, width: 250, height: 161}`。
  宽 250 而左边缘在 −210，**右边缘只到 x≈39.5**，整块面板几乎完全在视口外。
  截图：`C1-S8-settings-menu-open.png`、`C2-S8-settings-menu-open.png`。
- **交叉 S2（浮层碰撞检测）/ S7（设置入口）**，此处只登记数值。
  注意这条推翻了 PLAN 2.1 的假设「C1 折叠轨下锚点只有一个图标宽，溢出几乎必然」——
  **C2 侧栏展开时同样溢出**，所以根因不是锚点宽度。

---

## 四、内部拖放（私有 MIME `application/x-officedex-file`）

方法：HTML5 拖放无法用 playwright 的鼠标驱动，spec 里用共享 `DataTransfer` 合成
`dragstart / dragover / dragleave` 事件（浏览器自己也是这么派发的，`useFolderDrop` 读的就是这些）。
每一步都记录 `event.defaultPrevented`（= 该目标是否接受投放）与 `.is-drop-target` 元素清单。

### [S8-014] 展开的文件夹只有 14%–19% 的面积接受投放，文件区域（视觉上同一个文件夹）拒收

- 壳组合：**C2**（以及 C6/C8 等侧栏展开的 agent 壳；C1/C5/C7 折叠轨另见 S8-019）
- 运行环境：3100 fixture
- 表面：侧栏 `CompactTree`（density=compact）
- 复现：C2 → 从 "MO launch plan" 行开始拖 → 先悬停 "Archive 2026" 文件夹行，再悬停它下面的文件区
- 现象：拖到文件夹**标题行**上：接受，有高亮。
  拖到同一个文件夹**展开出来的文件列表区域**上：拒收，无任何提示，连高亮都没有。
  对用户来说这两块是同一个文件夹。
- 证据：`screenshots/C2-S8-drag-over-folder-row.png`、`C2-S8-drag-over-files-area.png`；
  逐个文件夹实测 `行高 / 整段高`：

  | 文件夹 | 整段高 | 标题行高 | **可放置占比** |
  |---|---|---|---|
  | MO product launch（展开，4 文件） | 187 | 36 | **19.3%** |
  | Archive 2026（展开，分页 5 行） | 258 | 36 | **14.0%** |
  | yirentk（展开，空） | 77 | 36 | 46.8% |
  | 超长中文名（折叠） | 36 | 36 | 100% |
  | Documents（折叠） | 36 | 36 | 100% |

  `dragover` 到 `.shell-tree-folder-row[data-drop-folder="folder-bulk"]` → `defaultPrevented: true`，
  `.is-drop-target` = 1 个；
  `dragover` 到 `.shell-tree-files` → `defaultPrevented: **false**`，`.is-drop-target` = **0** 个。
- 根因：`nav/useFolderDrop.ts:22` 用 `closest("[data-drop-folder]")` 向上找；
  而 `nav/FileTree.tsx:180` 把 `data-drop-folder` 放在 `.shell-tree-folder-row` 上——
  它是 `.shell-tree-files`（`:105`）的**兄弟节点，不是祖先**。于是文件区向上找不到任何可放置目标。
- 类别：命中区域 ｜ 严重度：**P1**
- 同根因其它实例：**0**（comfortable 那套把属性挂在 `<tbody>` 上，整组都收——见下面的双渲染对照）
- 双渲染对照：**comfortable 不复现**。`FileTree.tsx:377` 的 `<tbody data-drop-folder>` 包住整组行，
  所以首页整组都接受投放（但没有高亮，见 S8-015）。
  **两套对「文件夹的可放置范围」的定义不一致**，这本身也是一个待统一的点。

### [S8-015] 首页文件列表接受投放（会真的移动文件），却零视觉反馈

- 壳组合：**C2**（AgentHome，`FileList`）；同一组件也用在 C1/C3/C4
- 运行环境：3100 fixture
- 表面：`ComfortableList`（density=comfortable）
- 复现：C2 → 从首页列表某一行拖起 → 悬停 "Archive 2026" 分组标题
- 现象：文件**会被移动**，但拖拽过程中屏幕上什么都不变：没有高亮、没有边框、没有底色。
  用户无法在松手前知道自己会把文件放进哪里，也不知道会不会放进去。
- 证据：`screenshots/C2-S8-drag-home-list-no-highlight.png`；
  `dragover` 到 `tbody[data-drop-folder="folder-bulk"]` → **`defaultPrevented: true`**（= 会接受投放），
  同时 `.is-drop-target` 元素数 = **0**；
  该 tbody 实测 `className: ""`（没有任何状态类）、`background: rgba(0,0,0,0)`、`outline: none`。
- 根因：两处配合缺失——
  1. `home/FileList.tsx:16,35` 算出了 `overFolderId` 并作为 `dropFolderId` 传进去，
     但 `nav/FileTree.tsx:335-430` 的 `ComfortableList` **从头到尾没有读过 `props.dropFolderId`**
     （compact 那套在 `:95` 读了并传给 `FolderRow` 的 `dropTarget`）；
  2. `nav/nav.css:38-41` 只为 `.shell-tree-folder-row.is-drop-target` 写了样式
     （`outline: 1px solid #8b9eab; background: #e0e8ee`），没有 comfortable 的对应规则。
- 类别：状态未渲染 ｜ 严重度：**P1**
- 同根因其它实例：**1**（`home/EditorHome.tsx:37` 同样算出 `overFolderId` 并传入同一个组件，
  同样被丢弃；不过 EditorHome 默认还有 S8-016 的问题）
- 双渲染对照：**compact 复现相反**——侧栏有高亮，实测
  `outline: rgb(139, 158, 171) 1px` + `background: rgb(224, 232, 238)`。
  所以这是「一个组件两套渲染，只实现了一半」的典型：**改 `nav.css` 时两边都要顾**。
- 备注：裸色值 `#8b9eab` / `#e0e8ee` 不在 `tokens.css` 里 → 归 S5 第 4 条。

### [S8-016] EditorHome 的默认视图（时间分组）一个可放置目标都没有，行却依然 `draggable`

- 壳组合：**C3 / C4**（editor + home）
- 运行环境：3100 fixture
- 表面：`EditorHome` → `ComfortableList`，`grouping="time"`
- 复现：C4 → 从列表任一行拖起 → 悬停 "Previous 7 days"
- 现象：三个分组（Today / Previous 7 days / Previous 30 days）**没有一个**接受投放，
  而每一行都标了 `draggable`。用户拖起来、拖一圈、放不下、松手没反应，全程没有一个字解释为什么。
  代码注释（`useFolderDrop.ts:8-13`、`fileTreeModel.ts:10-13`）说得很清楚这是**故意**的——
  时间桶是视图不是位置——但这个理由从未出现在界面上。
- 证据：`screenshots/C4-S8-drag-editorhome-time-bucket.png`；
  `groupHeadings: ["Today6","Previous 7 days17","Previous 30 days30"]`；
  `totalTbodies: 3`，**`droppableTbodies: 0`**（带 `data-drop-folder` 的 tbody 数为 0）；
  `dragover` 到分组标题 → `defaultPrevented: **false**`；`.is-drop-target` = 0。
- 根因：`home/EditorHome.tsx:35` 默认 `grouping = "time"` →
  `nav/fileTreeModel.ts` 的 `groupByTime` 令 `folderId: null` →
  `nav/FileTree.tsx:377` 的 `data-drop-folder={group.folderId ?? undefined}` 不渲染属性。
  三者都对，缺的是「不能放」这件事的 UI 表达。
- 类别：可拖但不可放，无解释 ｜ 严重度：**P2**
- 同根因其它实例：**1**（AgentHome 的 `FileList.tsx:24` 写死 `grouping="folder"`，所以那边不复现；
  但用户在 EditorHome 把 Group by 切到 folder 后会掉进 S8-015 —— 两个视图分别缺一半）
- 双渲染对照：侧栏 compact 永远 `grouping="folder"`（`SidebarTree.tsx:39`），不复现。

### [S8-017] 拖拽源没有任何「正在拖」的状态

- 壳组合：C2（compact）与 C2/C4（comfortable），两套都是
- 运行环境：3100 fixture
- 表面：`FileTree` 的两个 `onDragStart`
- 复现：任一列表拖起一行后观察源行
- 现象：被拖走的那一行不变暗、不变半透明、不加边框——屏幕上没有任何东西表示「你正在拖这个」。
- 证据：`screenshots/C2-S8-drag-start-no-source-feedback.png`；
  `dragstart` 成功（payload = `"file-plan"`），随后测得
  `.is-dragging, [data-dragging]` 元素数 = **0**，源行 `className` 仍为 `"shell-tree-file-row"`（无新增类）。
- 根因：`nav/FileTree.tsx:285-288`（compact）与 `:389-392`（comfortable）
  两个 `onDragStart` 都只调 `setData` + `effectAllowed`，不置任何状态。
- 类别：状态未渲染 ｜ 严重度：**P2**
- 同根因其它实例：**2**（上面两个调用点）
- 双渲染对照：**两套都复现**。
- 对照事实：外部文件拖进 composer 时是有 `is-dragging` 的（归 S3）——
  所以「拖拽中有高亮」这件事在本仓库里已有先例，内部拖放只是没做。

### [S8-018] 拖拽时侧栏不自动滚动，折叠线以下的 3 个文件夹拖不到

- 壳组合：C2（侧栏展开且内容超出）
- 运行环境：3100 fixture
- 表面：`.shell-sidebar-body`
- 复现：C2 默认滚动位置下，尝试把文件拖到视口外的文件夹
- 现象：拖拽过程中把指针压到侧栏底边，列表不滚动，够不到的文件夹就是够不到。
- 证据：`.shell-sidebar-body` 实测 `clientHeight: 477`、`scrollHeight: 636` →
  **159px 在折叠线之外**；同一时刻 bottom 超出容器 bottom 的文件夹行 = **3 个**（共 5 个文件夹）。
  截图 `C2-S8-drag-over-empty-folder.png` 可见 "yirentk" 已经贴近底边。
- 根因：`nav/useFolderDrop.ts` 全文没有 auto-scroll 逻辑（`onDragOver` 只做命中判定）。
- 类别：拖放可达性 ｜ 严重度：**P2**
- 同根因其它实例：**0**
- 双渲染对照：首页 comfortable 列表在页面主滚动容器里，浏览器原生拖拽边缘滚动可用，不复现。

### [S8-019] 折叠轨（C1/C5/C7）下的投放目标是 5 个 35px 宽、没有名字的图标

- 壳组合：**C1 / C5 / C7**（C1 是默认壳）
- 运行环境：3100 fixture
- 表面：折叠轨里的 `SidebarTree`
- 复现：`?shellFixture=1&shell=C1`
- 现象：折叠轨里文件夹树**照样渲染**（不是被隐藏），但只剩 5 个文件夹图标叠成一列，
  没有名字、没有计数、没有展开箭头，而且图标几乎全都一样。
  从首页列表把文件拖到这一列上是能放进去的——但用户无法分辨自己正放进哪个文件夹。
- 证据：`screenshots/C1-S8-collapsed-no-drop-targets.png`（左轨 5 个相同的文件夹图标）；
  实测 C1：`treeInDom: true`、`treeRect: 35×188`、`dropTargetsInDom: 9`、`draggableRows: 62`；
  C5/C7：`treeRect: 35×188`、`dropTargetsInDom: 5`、`draggableRows: 9`。
  每个投放目标宽 35px，`.is-drop-target` 的反馈是 1px 描边 + 底色，落在 35×36 的方块上。
- 根因：`chrome/Sidebar.tsx` 在折叠态仍渲染 `SidebarTree`，折叠靠 CSS 收窄，文字被裁掉；
  `nav/FileTree.tsx:224` 的 `<span>{folder.label}</span>` 在 35px 宽里无处可去。
  拖拽期间 `title` 属性的原生 tooltip 不会弹出，所以没有任何补救。
- 类别：折叠态信息丢失 ｜ 严重度：**P2**
- 同根因其它实例：**1**（同一处折叠也吃掉了文件计数 `<small>{folder.count}</small>`，`FileTree.tsx:225`）
- 双渲染对照：comfortable 不受折叠影响，不复现。
- 交叉：折叠轨本身的渲染归 **S1**；我这里只认「它作为投放目标不可辨识」这一面。

### 拖放的两个阴性结果

- **拖出侧栏后高亮会清掉**：先 `dragover` 到 `.shell-home`（此时高亮还在，因为事件没冒泡进侧栏），
  再补一次浏览器真实会发的 `dragleave`（relatedTarget = `.shell-home`）后，
  `.is-drop-target` 归 0。`useFolderDrop.ts:32-35` 的 `contains(relatedTarget)` 判断是对的。
  最初我只发 `dragover` 时看到残留高亮，那是合成事件不完整造成的假象，**不是缺陷**。
- **空文件夹 yirentk 可以正常接收**：`defaultPrevented: true`，高亮正常
  （`outline rgb(139,158,171) 1px` + `background rgb(224,232,238)`），
  截图 `C2-S8-drag-over-empty-folder.png`。

---

## 收尾自报：做到哪、没做哪、为什么

### 1. 强制更新全屏页 — **超额完成**

- **七个 phase 覆盖 7/7**，且每个 phase 拍了**两遍**：
  原样（= S0-001 的无样式状态）`GATE-<phase>.png`，
  以及注入 `onboarding-update.css` 后的 `GATE-<phase>-styled.png`。
  按要求，findings 里每一条更新页问题都注明了是**注入后**的结果。
- 中文 locale：只做了 **3/7**（available / downloading / error）。
  没做另外四个，因为 idle/checking/available 在注入样式后是同一张页面（S8-003 已量化证明），
  downloaded/installing 与 downloading 共用同一块文案区，中英差异不会有新信息。
- 窄视口只在 error 上做了一次（600×420），结果是阴性。
- **没做**：真实 updater 链路（本机无 backend），所以 S8-002 的「按钮不可达」有一半是代码推导，
  已在该条里明确标注。phase 之间的**真实迁移时序**没看过——fixture 是静态渲染单个 phase，
  无法观察 downloading→downloaded→installing 的过渡。
- 产出 7 条：S8-001 ~ S8-007（P1×2、P2×2、P3×2）+ 2 条阴性结果。

### 2. 首次启动零数据态 — **完成，并扩到三个壳**

- 覆盖 **C1（默认折叠）、C2（展开）、C4（editor + 展开）**。
- **没做 C3**（editor + 折叠轨）：零数据下 editor 模式侧栏本就是空的（PLAN 第 2 节分叉表），
  C3 与 C4 的差别只在侧栏宽度，而侧栏在这个状态下没有内容，不会有新信息。
- 已按要求给出评估：**说不清下一步**（S8-008，给了 6 步真实路径与 28 个控件的清点），
  **有死路**（首屏唯一像引导的东西是四张全为死路的视频卡，S8-009 备注）。
- 产出 3 条：S8-008（P1）、S8-009（P2，归产品决策）、S8-010（P2）。

### 3. 五处 `notBuiltYet` 死路 — **5/5 全部触发，另外多找出 1 个**

- 五个调用点逐个点开并截图，见上面的表；另发现 `Composer.tsx:685` 同时服务 **Custom** 行，
  所以用户可点的死控件实为 **6 个**。
- 文案是否说清替代路径：逐条判定写在表里（2 个清楚、2 个半清楚、1 个误导、1 个重复）。
- toast 遮挡：按要求**只登记现象与数值，明确标注「交叉 S2」，不在 S8 认定根因**
  （`z-index: 1100`、与 `.shell-tabs` 重叠 11040 px²）。
- **没做**：C3–C10 下逐个重跑死路。除 review changes 在 C1/C2 各做一遍外，
  其余死路只在 C2 触发一次。理由：这五个控件的位置由 `home` 与 `navCollapsed` 决定，
  而 toast 是 `position: fixed` 挂 `document.body`，落点与壳组合无关（C1/C2/C5 三次实测 rect 完全相同）。
  **唯一的例外我已经补测了**：share 按钮在 `home=true` 的四个壳里被 CSS 藏起来（S8-010），
  所以它只在 C5–C10 可点，我用 C5 与 C6 各测了一次。
- **没做**：听写在真实缺少 SpeechRecognition 的 webview（Windows/Linux Wails 构建）上的表现，
  本轮用 `addInitScript` 删 API 模拟，平台层面未验证。
- 产出 3 条：S8-011（P1）、S8-012（P2）、S8-013（P2），外加 2 条交叉登记。

### 4. 内部拖放 — **完成，四个问的点全部有答案**

- 问的四件事逐一对应：
  - 拖拽中的 `overFolderId` 高亮 → **S8-015**（comfortable 完全没有）+ S8-014（compact 有但命中区只占 14%）
  - 拖到不可放置目标（时间分组）的反馈 → **S8-016**（零反馈，`droppableTbodies: 0 / 3`）
  - 拖到侧栏外的反馈 → **阴性结果**，`dragleave` 会正确清掉高亮（已写明最初的残留是合成事件不完整造成的假象）
  - 拖到空文件夹 yirentk → **阴性结果**，正常接收并高亮
- 额外覆盖：拖拽源无状态（S8-017）、无 auto-scroll（S8-018）、折叠轨下目标不可辨识（S8-019）。
- 覆盖的壳：**C2**（侧栏 compact + 首页 comfortable folder 分组）、
  **C4**（EditorHome comfortable time 分组）、**C1/C5/C7**（折叠轨，只测目标可辨识性）。
- **没做**：C6/C8/C10 的拖放。理由：C6/C8 的侧栏树与 C2 是同一组件同一 `grouping`，
  唯一差别是 agent 面板的 docked/floating，不参与拖放；
  C10 的首页列表在 `home=false` 时根本不渲染。这三个组合在本项上没有新表面。
- **没做**：真实鼠标拖拽。全部用合成 `DataTransfer` 事件，所以**拖拽预览图（drag image）长什么样我没看到**——
  `setDragImage` 全仓没有调用点，默认是浏览器对源节点的截图，但我没有视觉证据，故不下结论。
- 产出 6 条：S8-014（P1）、S8-015（P1）、S8-016（P2）、S8-017（P2）、S8-018（P2）、S8-019（P2），
  外加 2 条阴性结果。

### 总计

**19 条发现**（P1×6、P2×10、P3×2、产品决策×1）+ **2 条交叉登记**（给 S2/S7）+ **4 条阴性结果**。
每条都有截图路径与至少一个可验证数值；每条都给到 `文件:行` 级根因，
唯一标「根因待定」的是 S8-009（没有 onboarding），因为那是产品决策而非实现缺陷。
与 S0-001 重复的部分（更新页无样式）已在本文件开头统一说明并明确标注**已由 S0-001 覆盖**，
下文 19 条中**没有一条**重复它。

### 我知道自己没覆盖的洞

1. **真实 updater 链路**（需要 backend）：S8-002 的一半、phase 之间的真实过渡时序。
2. **打包后的更新页**：我全程在 3100 dev server 上；S0-001 已在构建产物层面查过，不重复。
3. **真实鼠标拖拽**：drag image、拖拽过程中的光标形态、跨窗口拖拽。
4. **Windows / Linux webview**：更新页、拖放、听写降级分支在非 macOS 构建上的表现
   （PLAN 2.5 的平台假设，本轮不下结论）。
5. **C3、C6、C8、C10** 四个壳我一次都没开过——理由逐条写在上面，都是「该表面在这些组合下不渲染
   或与已测组合同构」，不是漏做。
