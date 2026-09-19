# OfficeDex shell UI 全量问题普查 — 并发执行 plan

日期：2026-09-19 ｜ 分支：`develop/1.0` ｜ 范围：`src/shell/**`（新 IA shell，`index.html` 入口）

> **v2 修订**：v1 把 editor/agent 当成 S4 的一个分片，错了。模式是贯穿全部表面的维度，
> 且与 home / placement / navCollapsed 组合出 10 个渲染上不同的壳。见第 2 节。

## 0. 为什么这么排

四个已知截图分属四个不同缺陷类别（浮层定位 / 两套设计系统混用 / 行内操作位 / 窗口 chrome），
而且**四张全部落在同一个壳组合里**（agent + home + 侧栏展开）。
人肉点界面既慢又漏，正确姿势是：

- **机械扫描**（静态，不用跑 UI）把「同一根因的其它实例」一次性捞干净；
- **运行时遍历**（跑起来 + 截图 + computed style）把「只有渲染出来才看得见」的捞干净；
- **组合遍历**：每个表面都要在它实际会出现的壳组合下各看一遍。

三条路并行，互不阻塞。

## 1. 硬前置：S0 —— **已完成**（见 `S0/findings.md`）

各 session 的入口：

```
http://localhost:3100/?shellFixture=1&shell=C7
```

`shell=C1..C10` 是第 2 节的十个组合；单轴参数写在后面覆盖它
（`mode=agent|editor`、`home=1|0`、`nav=collapsed|expanded`、`presence=docked|floating`）。
`?forceUpdate=<phase>` 单独渲染强制更新页。fixture 下不写 localStorage。

dev server：`preview_start ui-audit`（3100，playwright baseURL 默认值）。
采集与断言：`e2e/ui-audit-helpers.ts` 的 `open` / `capture` / `expectNoClip`，
照 `e2e/ui-audit.spec.ts` 写自己的 spec。

S0 已顺带查实一条 **P0**（打包后 shell 的强制更新页无任何样式），记在 `S0/findings.md`，未修。

<details>
<summary>S0 原始交付清单（已全部完成，留档）</summary>

1. dev-only fixture 开关 `?shellFixture=1` → `src/shell/dev/fixture.ts`，`import.meta.env.DEV` 守卫，
   守卫本身有测试（`fixture.test.ts` 断言生产分支拿不到 fake）。
2. 壳状态直达 URL 参数 —— 同上模块。
3. 审计数据集 `src/shell/port/fake/auditSeed.ts`：空文件夹、45 文件（触发「Show 40 more」）、
   超长中文名与超长英文名各一、7 个打开的标签、五种任务态、pinned 若干。
4. 共享 dev server（`.claude/launch.json` 的 `ui-audit`）。
5. 采集/断言骨架 `e2e/ui-audit-helpers.ts` + 冒烟 `e2e/ui-audit.spec.ts`。
6. 更新页 phase 预览 `?forceUpdate=`。
7. 产出目录 `docs/ui-audit-2026-09-19/{S0..S8}/`。

回归：vitest 1280 通过，`tsc --noEmit` 退出 0，e2e 冒烟 4/4。

</details>


## 2. 壳组合矩阵（v2 新增，全员必读）

`App.tsx:78-81` 往根节点挂四个属性，CSS 已经在写三条件选择器（`chrome.css:149`）。
渲染上真正不同的壳有 **10 个**：

| # | mode | home | navCollapsed | presence | 说明 |
|---|---|---|---|---|---|
| C1 | agent | true | true（默认） | 不渲染 | **新用户第一眼看到的** |
| C2 | agent | true | false | 不渲染 | 已知四张截图都在这 |
| C3 | editor | true | true | 不渲染 | EditorHome + 折叠轨 |
| C4 | editor | true | false | 不渲染 | EditorHome 全貌 |
| C5 | agent | false | true | docked | |
| C6 | agent | false | false | docked | |
| C7 | agent | false | true | floating | 悬浮面板 + 折叠轨 |
| C8 | agent | false | false | floating | |
| C9 | editor | false | true | **强制 floating** | 悬浮面板压在画布上 |
| C10 | editor | false | false | **强制 floating** | 同上，侧栏展开 |

`home=true` 时 presence 完全不渲染（`AgentPresence.tsx:53-54` 的 `!state.home`），所以那四格没有 presence 维度。
`editor` 模式下 `canDock()` 恒 false（`shellReducer.ts:124`），docked 永远进不去——**C9/C10 是独立高风险区**：
一个可拖拽的悬浮面板压在嵌入编辑器上面，涉及遮挡、拖出视口、z-index、与编辑器自带工具栏打架。

**第 11 个面：模式切换的过渡中间态。** `App.tsx:42` 说明布局靠 flex item width transition 做连续切换，
「nothing unmounts」。过渡期间的抖动/闪烁/错位没有任何静态检查能发现，必须录像或分帧截图。

### 2.1 设置：没有页，只有碎片（v2.1 新增，S7 专属）

新 shell **没有设置页**。设置碎在三处菜单里，且彼此重复、其中有假开关：

| 入口 | 内容 | 已知问题 |
|---|---|---|
| 侧栏 footer 菜单 `Sidebar.tsx:99` | Review changes / Enter sends / Reduced motion | Review changes 是 `notBuiltYet` 假开关 |
| composer 菜单 `Composer.tsx:676` | 权限 / **Enter sends（与上重复）** | 同一设置两个入口，措辞不一致："Enter adds a line" vs "Enter sends · off" |
| ModelMenu → `CustomModelDialog`（`ModelMenu.tsx:136`） | Provider 下拉 + apiKey + 模型 ID | 设置表单藏在输入框的模型菜单里；用 legacy `Modal`+`Input`+原生 `<select>`，与 `useFolderDialogs` 同一个病 |

**真正的设置页只存在于 legacy，新壳够不到。**
`src/renderer/screens/SettingsScreen.tsx`(721) + `styles/settings.css`(786) +
`screens/settings/{Jira,Liquipedia,Proxy,RedeemCode}Card.tsx` + `components/ProviderForm.tsx` = **2130 行**，
含语言选择、通知测试、水印开关、重跑引导、全量重置、About。
`grep -rn legacy src/shell` 为空——**新壳里没有任何入口通向它**。

组合陷阱：侧栏 footer 设置菜单是 `align="end" width={250}`，
而 **C1（默认折叠轨）下锚点只有一个图标宽**，250px 面板挂 48px 轨上，溢出几乎必然。

### 2.2 i18n：全员必查的一条横切缺陷（v2.1 新增）

`src/shell` 里 `t("...")` 调用数 = **0**，全部硬编码英文；
只有 `chrome/UpdateGate.tsx` 走 `renderer/i18n`。
该处语言由系统决定：`renderer/i18n/index.tsx:16` 在 `navigator.language` 以 `zh` 开头时选中文，否则英文。
后果：**在中文系统上**，同一个窗口里会出现英文 shell + 中文强制更新页 + 中文文件名；
英文系统上只剩硬编码英文与中文文件名的混排。

**每个 session 在自己的表面上都要记一条**：该表面的文案是硬编码英文还是 i18n，
中英混排出现在哪。全量清单由 S5 静态扫描出（第 3 节第 9 条）。

### 2.2.1 契约事实，别凭空要（S0 实测修正）

- `AgentStatus` 只有 idle / reading / writing / working / paused / awaiting-review / done，
  **没有 failed**。失败是 `AgentEvent` 的 `kind: "error"`，走 toast，不是任务行的状态。
  要「失败的任务行」是要契约表达不了的东西。
- `FileType` 只有 **3 种**：`doc | sheet | slides`。
- 这两条都由 fixture 如实兑现：`auditSeed.ts` 铺了五种任务态、三种文件类型。

### 2.3 两个运行环境是互斥的（v2.2 新增，最容易漏的一条）

`createShellCanvas()`（`port/createShellCanvas.ts:23`）在没有 backend 时返回 **null**：

| 环境 | adapter | 看得到 | **看不到** |
|---|---|---|---|
| 3100（fake，浏览器） | **null** | `CanvasPlaceholder` 的三套骨架（Doc / Sheet / Slides） | 真编辑器、C9/C10 的悬浮遮挡 |
| 3210（dev-real） | 非 null | 真嵌入编辑器 | **三套骨架永远不出现** |

v2 把 S4 定为 dev-real 独占，等于三套骨架全程无人看。**两个环境必须双跑**：
骨架归 3100 上的 session（S6 主责，S3 交叉），真编辑器归 S4。
记录时必须写明是在哪个环境下看到的——同一个表面在两个环境下是两张不同的界面。

### 2.4 一个组件、两套渲染（v2.2 新增）

`FileTree`（`nav/FileTree.tsx:70`）按 `density` 分叉成两套完全不同的界面：

| density | 渲染 | 用在 | 特征 |
|---|---|---|---|
| `compact` | `CompactTree` | 侧栏（`SidebarTree.tsx:38`） | 文件夹行 + 文件行、右键菜单、拖放、`SIDEBAR_PAGE` 分页（截图里的「Show 40 more」） |
| `comfortable` | `ComfortableList` | 首页 `FileList.tsx:25`、`EditorHome.tsx:86` | 按 group 分组，**三种空态**：No pinned files / No files of this type / No files yet |

**两套共用 `nav.css`** —— S1 只看侧栏那套、S3 只看首页那套，改一边必然影响另一边。
两个 session 都必须在发现里注明「另一套是否同样复现」。

同类：`CanvasPlaceholder`（`editor/CanvasPlaceholder.tsx:12`）按文件类型分叉出
Doc / Sheet / Slides 三套骨架，各有独立 CSS 类族，只在 3100 可见（见 2.3）。

### 2.5 平台假设：自绘窗口控件（v2.2 新增）

`WindowBar.tsx:7` 自己画 close / minimize / fullscreen 三个按钮（SVG hairline，hover 才显形），
按 **macOS 约定**左置、顺序 close→minimize→fullscreen。
`app.css:66` 的 `min-width: 132px` 注释也写着「traffic lights and the sidebar toggle always fit」。

**全仓没有任何平台分叉代码**（grep platform/darwin/windows/isMac 全空）。
Windows 构建上这套控件的位置与顺序都是错的约定。
本次普查在 macOS 上做，所以这条只出「macOS 约定假设清单」，
由 S1 负责列出所有依赖 macOS 外观的位置，标记为**需在 Windows 构建上单独验证**，不在本轮下结论。

### 模式分叉的五处结构性位置（S1/S3/S4 各自对号入座）

| 分叉点 | agent | editor |
|---|---|---|
| `App.tsx:99` 侧栏中段 | `SidebarTree` 文件夹树 | 空 |
| `App.tsx:122` 首页 | `AgentHome` | `EditorHome`（完全另一套） |
| `Sidebar.tsx:40` 侧栏按钮 | New task | New + Open |
| `Sidebar.tsx:75` 视图过滤 | 无 | Recent / Pinned |
| `shellReducer.ts:128` agent 面板 | 可 docked | 强制 floating |

## 3. 并发分片（8 个 session，按「表面所有权」切，不重叠）

**每个 session 都必须在自己表面所涉及的全部壳组合下遍历**，不是只看默认态。
下表「必过组合」是硬要求。

| Session | 负责表面 | 主要文件 | 必过组合 | 入口 |
|---|---|---|---|---|
| **S1 窗口 chrome & 导航** | 红绿灯安全区、标签栏溢出/关闭键、侧栏折叠轨、**两个模式下不同的侧栏内容**、文件树行内 hover 操作位、状态栏 | `chrome/WindowBar.tsx` `chrome/FileTabs.tsx` `chrome/Sidebar.tsx` `chrome/StatusBar.tsx` `nav/FileTree.tsx` `nav/SidebarTree.tsx` `chrome.css` `nav.css` | **C1–C10 全部**（侧栏是分叉最密的地方） | 3100 |
| **S2 浮层（最高优先级）** | 所有 menu/modal/tooltip/**toast** 的定位、裁切、z-index、滚动跟随、Esc/焦点归还 | `chrome/Menu.tsx` `chrome/ModeMenu.tsx` `composer/MentionMenu.tsx` `composer/ModelMenu.tsx` `nav/useFolderDialogs.tsx` + `src/renderer/ui` 的 Modal/Input 与 **`ui/services/toast.tsx`** | C1/C2（折叠轨里的 ModeMenu 是高危）+ C7/C9（浮层与悬浮面板叠加） | 3100 |
| **S3 两个首页 & composer** | **AgentHome 与 EditorHome 两套都要过**；功能货架轮播、任务列表、Recent/Pinned 切换、快捷提示、文件列表、hero 输入框与附件条 | `home/AgentHome.tsx` `home/EditorHome.tsx` `home/*.tsx` `composer/Composer.tsx` + 四个 css | C1/C2/C3/C4 | 3100 |
| **S4 编辑态画布 & 悬浮 agent** | shell 与嵌入编辑器的接缝；**重点 C9/C10：editor 模式强制悬浮的 TaskPanel 压在画布上**；拖拽边界、贴边、缩起、与编辑器自带工具栏的 z-index | `editor/*` `agent/*` `canvas/*` `agent.css` `agent/useDraggable.ts` | C5–C10 | **dev-real 3210（独占）** |
| **S5 机械扫描（不用跑 UI）** | 全量 CSS/JSX 静态扫描 + DESIGN.md 对账 + **组合选择器覆盖率表** + **硬编码文案清单** | `src/shell/**/*.css` `**/*.tsx` `DESIGN.md` `tokens.css` | — | 无 |
| **S6 组合 × 环境矩阵** | 10 个壳组合 × 视口/亮暗/长文案/键盘；外加模式切换过渡中间态 | 跨全部表面 | C1–C10 + 过渡 | 3100 |
| **S7 设置与偏好一致性** | 三处设置入口的重复/冲突/假开关；`CustomModelDialog` 表单；legacy 2130 行设置页的可达性与覆盖对账；设置改完是否真生效 | `chrome/Sidebar.tsx:94-160` `composer/Composer.tsx:660-700` `composer/ModelMenu.tsx` `composer/useComposerSettings.ts` vs `renderer/screens/SettingsScreen.tsx` | **C1（折叠轨，高危）** + C2/C3/C4 | 3100 |
| **S8 门控与终点态** | 强制更新全屏页、首次启动零数据态、5 处 `notBuiltYet` 死路、两套拖放的拖拽中反馈 | `chrome/UpdateGate.tsx` + `renderer/components/ForceUpdateOverlay` `nav/useFolderDrop.ts` `composer/Composer.tsx:528-545` + 5 处 notBuiltYet 调用点 | C1（零数据）+ 各自触发点 | 3100 |

### S4 为什么独占 dev-real

真实嵌入编辑器需要真 bridge：`node scripts/dev-real.mjs --port 3210 <文档路径>`。
其它 session 不要碰这个端口，也不要在里面做删除操作。
C9/C10 只有在真编辑器挂载时才有意义——假画布占位不会暴露遮挡问题。

### S5 的扫描清单（照着做，每条出一张表）

1. `position: absolute|fixed` 的规则，逐条回答「谁是包含块、会不会出视口、外层有没有 overflow 裁它」；
2. `overflow: hidden|auto` 的容器，列出内部有没有浮层/焦点环/徽标会被裁；
3. `z-index` 全量取值表，找互相打架和魔数（浮动 TaskPanel vs `.shell-menu` 的 60 必须比对）；
4. 硬编码颜色/px 与 `tokens.css`、`DESIGN.md` 令牌的偏差（如 `chrome.css:602` 的 `#dfe2e6`、`:605` 的 `#34383c` 都是裸色值）；
5. `src/shell` 里 import `../../renderer/ui` 的全部调用点（当前 7 处非测试），逐个判断有没有带进 legacy 视觉；
6. `ui-` / `od-` class 前缀与 `@shimo/sdk-sheet` 的冲突面（见既往事故）；
7. 固定 `width`/`height` 导致中文文案撑爆或截断的点；
8. **（v2 新增）组合选择器覆盖率**：枚举所有 `#shell[data-*]` / `.shell[data-*]` 规则，
   对照第 2 节的 10 个组合做一张覆盖表，找出「只为某一个组合写了样式、其余组合裸奔」的规则。
   `chrome.css:149` 的三条件选择器是典型嫌疑。
9. **（v2.1 新增）硬编码文案清单**：`src/shell` 里 `t("` 调用数为 0，全部硬编码英文。
   出一张「文件 → 用户可见英文字串」的全量表，标出哪些在中文环境下会与 legacy 的中文 UI 混排。
   同时给出 `renderer/i18n` 已有词条与这些字串的重合度——决定移植成本。

### S6 的矩阵（每格都要截图，文件名带组合号）

第一维：**10 个壳组合 C1–C10**（这是主维，不能省）
第二维：窗口宽度 `1024 / 1280 / 1440 / 最小可用宽`
第三维：亮 / 暗
第四维：空态 / 加载中 / 错误 / 超长中文名 / 超长英文名
外加：
- **模式切换过渡**：agent↔editor 切换过程分帧截图（至少 0ms/100ms/300ms/结束），看抖动与错位；
- 键盘：Tab 序、焦点环可见性、菜单开关后焦点是否回到触发器——**每个模式各一遍**（侧栏按钮集合不同，Tab 序必然不同）。

全量笛卡尔积太大，按「主维必全 + 其余维抽样」：C1–C10 全过一遍默认视口亮色；
异常/长文案/暗色/窄视口在 C1/C2/C4/C9 四个代表性组合上做全覆盖。

## 4. 统一的发现记录格式（不按这个写不计入）

每条写进 `docs/ui-audit-2026-09-19/S{n}/findings.md`：

```
### [S2-007] 右键菜单在侧栏左边界被裁
- 壳组合：C2、C6、C8（C1/C5/C7 折叠轨下不复现——菜单锚点不同）
- 运行环境：3100 fake（3210 未验证）
- 表面：侧栏 > 文件夹行 > 右键
- 复现：3100?shellFixture=1&mode=agent&home=1&nav=expanded → 右键 "yirentk" 行
- 现象：面板左侧约 60px 被切，"New document" 只剩 "ew document"
- 证据：screenshots/C2-S2-007.png ；getBoundingClientRect().left = -58
- 根因：chrome/Menu.tsx 无视口碰撞检测；chrome.css:594 .shell-menu 绝对定位仅 left:0
- 类别：浮层定位 ｜ 严重度：P1 ｜ 同根因其它实例：ModeMenu / MentionMenu / ModelMenu（共 4 处）
- 双渲染对照：不适用（若涉及 FileTree，须填另一套 density 是否复现）
```

**「壳组合」「运行环境」两个字段是必填。** 不写清楚在哪些组合下复现，修一个组合就会打破另一个；
不写运行环境，3100 与 3210 互斥的那部分（PLAN 2.3）会被误当成同一个界面。

**完成判据（断言式，逐条核对）**：

- 每条必须同时有「截图路径」+「一个可验证的数值」（rect/computed style/DOM 断言），只有文字描述的不算；
- 每条必须给到 `文件:行` 级根因，给不出就标 `根因待定` 并说明卡在哪，不许含糊带过；
- 每条必须填「同根因其它实例数」和「复现的壳组合」；
- session 结束时必须自报：**覆盖了哪几个壳组合、哪些没覆盖、为什么**。
  「我扫完了」这种结论不接受，要能对到组合号。

## 5. 汇总（S0 的人做，全部 session 交付后）

1. 按「根因」而非「现象」聚类去重；
2. 交叉检查：同一根因在不同组合下的表现是否一致——不一致的说明还有第二个根因；
3. 排出修复批次：先修产生最多实例的根因（预计是浮层定位 + 两套设计系统混用 + 组合选择器漏写）；
4. 对可机械化的类别补静态闸门，仿 `src/shell/test/deadControls.test.ts`：
   - 浮层必须 portal + 碰撞检测；
   - shell 内禁止直接 import `renderer/ui` 的视觉组件；
   - 裸色值禁令；
   - **组合覆盖闸门**：任何 `#shell[data-*]` 组合选择器必须在测试里被 10 个组合各渲染一次并断言无裁切/无重叠。
   **没有闸门的修复会回归**，这一步不能省。

## 6. 各 session 的启动 prompt（直接粘）

> 公共前缀（每个 session 都带上）：
> 仓库 `/Users/luyang/Workspace/shimo/vibe-officing/officedex`，分支 `develop/1.0`。
> **只读模式**：除了你自己的 `docs/ui-audit-2026-09-19/S{n}/` 目录，不要改任何文件，不要 commit。
> 先完整读 `docs/ui-audit-2026-09-19/PLAN.md`，特别是第 2 节壳组合矩阵、第 4 节记录格式与完成判据。
> 界面跑在 `http://127.0.0.1:3100/?shellFixture=1`，用 `&mode=&home=&nav=&presence=` 直达壳组合，
> 用 preview_* 工具驱动（不要用 Bash 起服务）。
> **默认态是 C1（agent + home + 折叠轨），不是你截图看到的 C2——两个都要看。**
> 另：`src/shell` 里 `t("` 调用数为 0，文案全硬编码英文。在你的表面上遇到中英混排，按第 4 节格式记一条。

- **S1**：`你负责 S1 窗口 chrome & 导航，必过 C1–C10 全部十个组合。侧栏是模式分叉最密的地方：agent 有文件夹树、editor 是空的且底部多一组 Recent/Pinned，按钮集合也不同（见 PLAN 第 2 节表）。逐个排查红绿灯安全区、标签栏溢出与关闭键、折叠轨下的图标与 tooltip、文件树缩进与行内 hover 操作位（已知 "+" 按钮跑出行外）、状态栏。每个控件 hover/focus/active 三态各看一次。三件额外的事：(1) 你看到的文件树是 CompactTree（density=compact），首页那套 ComfortableList 由 S3 看，但两者共用 nav.css——每条发现都要注明另一套是否同样复现（见 PLAN 2.4）；(2) 测 SIDEBAR_PAGE 分页的「Show 40 more」展开前后；(3) 按 PLAN 2.5 列出 WindowBar 里所有依赖 macOS 外观的假设（自绘 close/minimize/fullscreen 的顺序与左置、app.css:66 的 132px），标为需在 Windows 构建单独验证，本轮不下结论。`
- **S2**：`你负责 S2 浮层，最高优先级。把 shell 里所有 menu/modal/tooltip/toast 找全（至少 Menu/ModeMenu/MentionMenu/ModelMenu/useFolderDialogs 的 Modal/renderer/ui 的 toast），逐个测：贴近视口四边会不会被裁、外层 overflow 会不会裁、z-index 是否打架、滚动时是否跟随、Esc 后焦点是否回到触发器。重点组合：C1（折叠轨里的 ModeMenu，锚点只有一个图标宽）、C7/C9（浮层与悬浮 TaskPanel 叠加，z-index 必然冲突）。两条已确认的线索必须验证并量化：(1) chrome.css:594 .shell-menu 只有 left:0/right:0 没有碰撞检测；(2) od-toast-host 是 position:fixed; top:16px; z-index:1100，而 .shell-menu 才 60——toast 大概率从顶部盖住 FileTabs 标签栏并盖住所有菜单，用 S8 的五个 notBuiltYet 入口触发它来实测。`
- **S3**：`你负责 S3 两个首页与 composer，必过 C1/C2/C3/C4。注意 AgentHome 和 EditorHome 是完全不同的两套首页（App.tsx:122），两套都要全覆盖——只测 AgentHome 算没做完。EditorHome 还要测 Recent/Pinned 两个视图切换（fixture 里有 pinned 数据）。另覆盖功能货架轮播含左右箭头边界态、任务列表的五种状态（idle / working / paused / awaiting-review / done——没有 failed，见 PLAN 2.2.1）与空列表、快捷提示、hero 输入框与附件条。两件额外的事：(1) 首页的文件列表是 ComfortableList（density=comfortable），与侧栏的 CompactTree 共用 nav.css，S1 看另一半——每条发现注明另一套是否复现（PLAN 2.4），并把三种空态 No pinned files / No files of this type / No files yet 各截一次；(2) 测把 Finder 里的文件直接拖进 composer（Composer.tsx:541 走 dataTransfer.files），看拖拽中的高亮 is-dragging、放置反馈、附件条溢出。`
- **S4**：`你负责 S4 编辑态画布与悬浮 agent，必过 C5–C10，用 dev-real 独占端口：node scripts/dev-real.mjs --port 3210 <真实 pptx/docx/xlsx>。最高价值的是 C9/C10——editor 模式下 canDock() 恒 false（shellReducer.ts:124），TaskPanel 被强制悬浮压在真编辑器上面。测：遮挡了什么、能不能拖出视口、贴边与缩起、与编辑器自带工具栏的 z-index 谁赢、画布滚动时悬浮层是否跟错。另看 shell 外壳与嵌入编辑器的接缝（滚动条、边框、字体不一致）与注意力边框对齐。注意 PLAN 2.3：你这个环境 adapter 非 null，所以 CanvasPlaceholder 的三套骨架在你这里永远不出现，不要以为没有——那是 S6 在 3100 上的活。`
- **S8**：`你负责 S8 门控与终点态，都是整片替换或阻断用户的界面，至今无人看过。四件事：(1) 强制更新全屏页——UpdateGate.tsx:38 在 mandatory 时用 legacy ForceUpdateOverlay 整片替换 UI，且包在 LocaleProvider 里是中文的，而 shell 全英文；把它的每个 phase（待下载/下载中/进度/出错/待安装）各截一次，重点看中英文反差与全屏布局。需要 mock update 状态，做法与 S0 商量。(2) 首次启动零数据态——新壳没有任何 onboarding（grep 全空，引导只存在于 legacy 设置页的 rerunOnboarding），所以新用户第一眼是 C1 + 空 fixture：没有文件夹、没有文件、没有任务。把这个界面完整截下来并评估它是否说得清下一步做什么。(3) 五处 notBuiltYet 死路：Highlights.tsx:211 视频卡、Composer.tsx:449 听写、Composer.tsx:685 权限 review、FileTabs.tsx:165 分享、Sidebar.tsx:124 review changes——逐个点开，看提示文案是否说清了替代路径，以及提示（toast）本身盖住了什么（与 S2 交叉，把现象给 S2）。(4) 内部拖放：把文件从树里拖到另一个文件夹（useFolderDrop.ts，私有 MIME），看拖拽中的 overFolderId 高亮、拖到不可放置目标（时间分组）时的反馈、拖到侧栏外的反馈。`
- **S5**：`你负责 S5 机械扫描，不需要跑 UI。照 PLAN 第 3 节的八条清单做全量静态扫描，每条出一张表，与 DESIGN.md 令牌对账。第 8 条最重要：枚举所有 #shell[data-*] 组合选择器，对照 PLAN 第 2 节的 10 个组合做覆盖表，找出只为某一个组合写了样式、其余组合裸奔的规则。产出要能直接变成静态闸门测试。`
- **S6**：`你负责 S6 组合 × 环境矩阵。主维是 PLAN 第 2 节的 10 个壳组合，全部要过一遍；再在 C1/C2/C4/C9 上做视口(1024/1280/1440/最小宽) × 亮暗 × 空态/加载/错误/超长中英文名的全覆盖。额外三项：(1) agent↔editor 切换的过渡中间态分帧截图（0/100/300ms/结束），App.tsx:42 说布局靠 flex width transition，看有无抖动错位；(2) 键盘 Tab 序与焦点环，两个模式各一遍（侧栏按钮集合不同，Tab 序必然不同）；(3) CanvasPlaceholder 的三套骨架 Doc/Sheet/Slides——按 PLAN 2.3，它们只在 3100 出现（adapter 为 null），S4 的 dev-real 环境永远看不到，所以归你，三种文件类型各开一次。用 preview_resize 切视口，截图文件名必须带组合号。`
- **S7**：`你负责 S7 设置与偏好一致性，先完整读 PLAN 第 2.1 节。四件事：(1) 把三处设置入口（侧栏 footer 菜单 Sidebar.tsx:99、composer 菜单 Composer.tsx:676、ModelMenu 的 CustomModelDialog）的全部条目列成一张表，标出重复项、措辞不一致项、假开关（已知 Review changes 是 notBuiltYet）；(2) 重点测 C1 折叠轨下 footer 设置菜单——align="end" width=250 挂在 48px 图标上，测它是否溢出或被裁；(3) CustomModelDialog 的 UI 审查：它用 legacy Modal+Input+原生 select，和 shell 视觉必然不一致，apiKey 输入框还要看有无掩码/泄露；(4) 覆盖对账：把 renderer/screens/SettingsScreen.tsx(721行) + screens/settings/*Card.tsx + ProviderForm.tsx 共 2130 行的全部设置项列出来，逐条标「新壳可达 / 新壳不可达」——grep 显示 src/shell 里没有任何通往 legacy 的入口，所以不可达的那些等于用户永久失去。最后验证设置改完是否真生效（改 Reduced motion 后看 Highlights 轮播与 AttentionBorder 动画是否真变）。`

## 7. 表面清单是怎么枚举出来的（方法，供后续复用）

v1 的分片是从**代码目录**推的，于是 `home/`、`nav/`、`chrome/` 各得一个 session，
而 editor 模式（`App.tsx` 里一个三元）、设置（三个菜单的 items 数组）、
强制更新（一个 `if` 早退）——**凡是没有独立目录、只以条件分支存在的界面，全被漏掉**。

v2.2 改用四条机械规则重新枚举，不看目录：

1. **早退门**：`grep -B2 "if (.*) return <"` → UpdateGate 的两道门、FileTree 的 density、CanvasPlaceholder 的三型
2. **整区三元**：`state.X ? <A/> : <B/>` → AgentHome/EditorHome、Sidebar 的模式分叉
3. **根节点 data 属性 × CSS 组合选择器** → 第 2 节的 10 个壳组合
4. **死路与空态文案**：`notBuiltYet(` / `"No …"` / `"Loading"` / `"Failed"` → 5 处死路、3 种空态

补充维度（不产生新表面，但会让同一表面变成另一张界面）：
运行环境（2.3）、组件内双渲染（2.4）、平台假设（2.5）、i18n（2.2）。

5. **运行中才存在的状态**（2026-09-20 补，由并发的 pptx track 发现并验证）

前四条规则**全部作用于静态结构**，因此全都到不了「只在一次真实运行进行中才存在」
的界面。这不是覆盖不足，是这批规则的能力边界：C1–C10 十个壳组合与整个 fixture
都描述**静止的**工作区，而一次生成过程中的壳是另一组状态。

那条 track 用**对真 bridge E2E 的 Playwright 录像抽帧**找到了三条本轮普查完全没看到
的缺陷：

```bash
ffmpeg -i test-results/real-e2e-*/playwright-output/*/video.webm -vf fps=1/12 frame-%03d.png
```

录像在失败的 run 里一定有，成功的看 config。三条记录在
`docs/ui-audit-2026-09-19/findings-pptx-track.md`，其中一条（生成中状态栏说
「No file open」，而画布上正画着 deck）已并入 SUMMARY §3.4 的 MERGE-003。

另有一个可复用的入口：`?shellFixture=1&deckRun=1`（`src/shell/dev/fixture.ts`）
免后端渲染一个生成中的 pptx 任务、五种页状态同屏。**刻意做成 opt-in**，所以不会让
既有的基线截图漂移。

**后续如果还怀疑有漏**，就再跑一遍这五条规则，而不是再读一遍目录树。
特别是第 5 条：静态规则给出的是「界面有多少种长相」，它给出的是「界面在多少个
时刻存在」，两者不能互相替代。

## 8. 时间预估

- S0：40–50 分钟（壳状态 URL 参数 + 更新状态 mock）
- S1–S8 并发：各 90–120 分钟
- 汇总 + 闸门设计：60 分钟

即约 **3 小时**拿到全量清单 + 修复批次。

## 9. 已知会跳出 UI 范畴的三条（汇总时单独成节，不要混进 UI 清单）

1. **legacy 2130 行设置页在新壳里不可达**（第 2.1 节）——功能缺失，不是样式问题。
   S7 出「不可达设置项清单」，需要产品决定：移植、加回退入口、还是明确放弃。
   **账号 / credit / 兑换码也在这份清单里**——新壳的 footer 注释明说去掉了账号 chip。
2. **shell 全英文硬编码**（第 2.2 节）——i18n 工程量，不是 UI bug。
   S5 出字串清单与移植成本，需要产品拍板再排期。
3. **新壳没有 onboarding**（S8 第 2 项）——引导只存在于 legacy 设置页的 `rerunOnboarding`。
   新用户第一眼是空工作区，这是产品决策而非缺陷，但要有人看见并决定。

这三条都会被普查大量撞到，事先分离，免得淹没真正能改的样式缺陷。
