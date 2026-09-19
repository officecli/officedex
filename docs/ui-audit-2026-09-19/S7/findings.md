# S7 — 设置与偏好一致性

日期：2026-09-19 ｜ 分支 `develop/1.0` ｜ 运行环境：**3100 fake（浏览器）**，3210 dev-real 未验证
覆盖组合：**C1 / C2 / C3 / C4**（S7 必过四组，全部覆盖）；C5–C10 未覆盖，理由见第 4 节自报。

spec：`e2e/ui-audit-s7.spec.ts`、`e2e/ui-audit-s7-probe.spec.ts`、`e2e/ui-audit-s7-motion.spec.ts`、`e2e/ui-audit-s7-attention.spec.ts`
跑法：`PLAYWRIGHT_BASE_URL=http://localhost:3100 OFFICEDEX_E2E_PLAYWRIGHT_OUTPUT=test-results/s7 npx playwright test e2e/ui-audit-s7*.spec.ts`
全部 11 个 case 通过（这些 spec 是采集器，不是闸门——数字打在 stdout 的 `S7-*` 行里）。

---

## 第 1 节 — 三处设置入口的条目对账

三处入口共 **12 个可见条目**，其中真正的偏好只有 **5 个**。实测抓取（`S7-INVENTORY`）：

| # | 入口 | 条目 label | 副标题 | ARIA role | 勾选态 | 性质 |
|---|---|---|---|---|---|---|
| 1 | 侧栏 footer `Sidebar.tsx:99` | `Review changes` | Ask before applying Agent edits | `menuitem` | 无 | **假开关**（`notBuiltYet`，`Sidebar.tsx:124`） |
| 2 | 侧栏 footer | `Enter sends` ⇄ `Enter adds a line` | Shift + Enter **always** adds a line | `menuitemradio` | `aria-checked=true` | **与 #7 重复** |
| 3 | 侧栏 footer | `Reduced motion` ⇄ `Full motion` | Use the system animation preference | `menuitemradio` | `aria-checked=false` | 唯一入口；**不生效**（S7-003/004） |
| 4 | composer 权限菜单 `Composer.tsx:667` | `Full access` | Apply edits inside this folder | `menuitemradio` | `true` | 真选项（唯一被 runtime 承认的） |
| 5 | composer 权限菜单 | `Review changes` | Nothing is applied without you | `menuitemradio` | `false` | **假开关**（`available:false` → `notBuiltYet`，`Composer.tsx:685`）；**与 #1 同名不同义** |
| 6 | composer 权限菜单 | `Custom` | Use your own instructions | `menuitemradio` | `false` | **假开关 + 永久不可配**（见 S7-013） |
| 7 | composer 权限菜单 | `Enter sends · on` ⇄ `Enter sends · off` | Shift + Enter adds a new line | `menuitem`（**无 radio**） | **无 aria-checked** | **与 #2 重复** |
| 8–11 | ModelMenu `ModelMenu.tsx:101` | GPT-6 Astra / GPT-5.6 Sol / K3 / DeepSeek 4.1 | provider · 用途 | `menuitemradio` | 单选 | 模型选择 |
| 12 | ModelMenu | `Add model…` ⇄ `Replace custom model…` | Point the shell at your own endpoint | `menuitem` | 无 | 打开 `CustomModelDialog`（第 3 节） |

**对账结论**

- **重复项 1 个（Enter sends），三层不一致**：
  1. label 文案 —— `Enter sends` / `Enter adds a line`（状态写在 label 里）vs `Enter sends · on` / `· off`（状态写在后缀里）；
  2. 副标题 —— `Shift + Enter **always** adds a line` vs `Shift + Enter adds a new line`；
  3. **无障碍语义** —— 侧栏是 `menuitemradio` + `aria-checked`，composer 是裸 `menuitem`，屏幕阅读器在 composer 里读不出开关状态。
- **同名不同义 1 组**：`Review changes` 在侧栏是「Agent 编辑前先问我」的**开关**，在 composer 是三档权限里的**一档**。两处按下去弹同一句 toast，概念层级不同。
- **假开关 3 个**：侧栏 `Review changes`、composer `Review changes`、composer `Custom`。
- **两处状态不同步**：见 S7-002，同一页面内两个菜单会显示互相矛盾的状态。
- **文案全硬编码英文**：三处入口 12 个 label + 12 条副标题，`t("` 调用数 = 0（PLAN 2.2）。见 S7-011。

---

## 第 2 节 — UI 缺陷（按 PLAN 第 4 节格式）

### [S7-001] 侧栏 footer 设置菜单在**全部四个组合**下被侧栏裁掉 84%

- 壳组合：**C1、C2、C3、C4 全部复现**（PLAN 2.1 只预测了 C1 折叠轨，实测侧栏展开也一样坏）
- 运行环境：3100 fake（3210 未验证）
- 表面：侧栏 > footer > Settings 齿轮按钮
- 复现：`http://localhost:3100/?shellFixture=1&shell=C1` → 点左下角齿轮
- 现象：250px 宽的菜单只露出最右侧约 40px，三行文字全部在视口外。屏幕上看到的是**一条空白竖条 + 一个孤零零的对勾**，完全无法使用。
- 证据：
  - `screenshots/C1-S7-footer-settings-open.png`（默认态，最严重）、`C2-` / `C3-` / `C4-S7-footer-settings-open.png`
  - `getBoundingClientRect()` 四组合实测：

    | 组合 | 侧栏宽 | 触发器 rect | 菜单 rect | 视口外 | 裁它的容器 |
    |---|---|---|---|---|---|
    | C1 | 52 | left 11.5 → 39.5 | **left −210.5**, right 39.5, w 250, h 161 | `offViewport: true` | `shell-sidebar shell-region` |
    | C2 | 190 | left 12 → 40 | **left −210**, right 40, w 250, h 161 | true | 同上 |
    | C3 | 52 | left 11.5 → 39.5 | **left −210.5**, right 39.5 | true | 同上 |
    | C4 | 190 | left 12 → 40 | **left −210** | true | 同上 |

  - 可见比例 = 39.5 / 250 = **15.8%**（C1）、40 / 250 = **16%**（C2/C4）
  - 菜单行自身没有文字溢出：每行 `scrollWidth == clientWidth == 236` —— 证明这是**定位问题**，不是宽度问题
  - 菜单底边 `bottom = 720` 恰好贴住 720px 视口底边（`top 559 + h 161`），纵向同样零余量
- 根因（四条同时成立）：
  1. `src/shell/chrome/Sidebar.tsx:101` `align="end"` + `width={250}`
  2. `src/shell/chrome/chrome.css:611` `.shell-menu[data-align="end"] { right: 0 }` —— 锚点是 28px 宽的按钮，`right:0` 必然把 250px 面板推到 left = 28 − 250 = −222
  3. `src/shell/app.css:91` `.shell-sidebar { overflow: hidden }` —— 溢出部分直接被剪掉，连「露在侧栏外面」都做不到
  4. `src/shell/chrome/Menu.tsx:150-157` 面板 `position:absolute` 且**无视口碰撞检测、无 portal**
- 类别：浮层定位 + 结构性错误 ｜ 严重度：**P0**（唯一的偏好入口整体不可用）
- 同根因其它实例：**4 个**菜单挂在 `overflow:hidden` 的 `.shell-sidebar` 里 —— `ModeMenu`（`ModeMenu.tsx:43`，w220）、本条 footer 菜单（w250）、`FileTree` 文件夹菜单（`FileTree.tsx:228`，w220 align=end）、`FileTree` 文件菜单（`FileTree.tsx:316`，w230 align=end）。`Menu.tsx` 无碰撞检测这一条影响全部 **7 个** `<Menu>` 调用点。（S2 负责浮层通例；本条只对设置入口下结论）
- 双渲染对照：不适用

---

### [S7-002] 同一个 Enter sends 开关，两个菜单在同一页面里显示互相矛盾的状态

- 壳组合：C1–C4 全部（两个入口在四组合下都存在）；实测记录在 C2
- 运行环境：3100 fake
- 表面：侧栏 footer 菜单 ⇄ composer 权限菜单
- 复现：C2 → 打开 composer 权限菜单 → 点 `Enter sends · on` → 再打开侧栏 footer 菜单
- 现象：**不刷新页面**，两个菜单对同一个 `enterToSend` 给出相反答案。
- 证据：`screenshots/C2-S7-enter-desync.png`；`S7-ENTER-SYNC`：

  | 时点 | 侧栏 footer 行 | composer 行 |
  |---|---|---|
  | 初始 | `Enter sends`，`aria-checked="true"` | `Enter sends · on` |
  | 从 composer 点一次后 | `Enter sends`，**`aria-checked="true"`（没变）** | `Enter sends · off`（变了） |

  即 patch 之后 `enterToSend === false`，而侧栏仍然渲染 `true` 的 label 与 `aria-checked="true"`。
- 根因：`src/shell/composer/useComposerSettings.ts:30-67` 是**每个调用点各持一份 `useState`** 的 hook，没有共享 store、没有订阅。`:39-56` 的 `useEffect` 依赖 `[port]`，一辈子只跑一次；`:58-64` 的 `patch` 只 `setValue` 自己这一份。同一棵树里有 **5 个独立实例**：`Sidebar.tsx:22`、`Composer.tsx:150`、`Hero.tsx:34`、`Highlights.tsx:83`、`useAgentTask.ts:25`。
- 类别：状态架构 ｜ 严重度：**P0**（控件对用户说谎，正是这个 shell 明文拒绝的失败形状）
- 同根因其它实例：**5 个** `useComposerSettings()` 实例；受影响的偏好 **全部 5 个字段**。S7-003 是同一根因在 reduceMotion 上的表现。
- 双渲染对照：不适用

---

### [S7-003] Reduced motion 开了也不生效，直到消费它的组件重新挂载

- 壳组合：C1（首测）、C2（判别实验）；C3/C4 是 EditorHome，没有 Highlights 轮播，不复现
- 运行环境：3100 fake
- 表面：侧栏 footer > Reduced motion → `home/Highlights.tsx` 功能货架轮播
- 复现：C2 → 点侧栏 `Full motion` 使之变成 `Reduced motion` → 点轮播右箭头
- 现象：开关自己的 label 和勾选态立刻变了（`Reduced motion` / `aria-checked="true"`），但轮播仍然**平滑滚动**。把 Home 卸载再挂载（切 Editor 再切回 Agent，**不刷新页面**）之后，同一个开关值下轮播才变成瞬时跳转。
- 证据：`screenshots/C2-S7-motion-after-remount.png`；`S7-MOTION-STALENESS`（按右箭头后第 2 帧与 900ms 后的 `scrollLeft`）：

  | 采样 | 设置值 | 2 帧后 | 900ms 后 | 判定 |
  |---|---|---|---|---|
  | baseline（motion 开） | reduceMotion=false | **1** | 337 | 动画 |
  | sameMount（刚点完开关） | reduceMotion=**true** | **1** | 337 | **仍在动画 → 设置被忽略** |
  | afterRemount（同一值，Home 重挂载） | reduceMotion=true | **337** | 337 | 瞬时 → 设置被采纳 |

  `1 → 337` 说明在动，`337 → 337` 说明一帧到位。第二行是缺陷本体。独立复核：`S7-REDUCED-MOTION` 在 C1 上同样得到 `twoFrames:1, settled:365`。
- 根因：`src/shell/home/Highlights.tsx:126` 读的是它自己那份 `useComposerSettings()`（`Highlights.tsx:83`）的 state，而开关写的是 `Sidebar.tsx:22` 那份。根因同 S7-002（`useComposerSettings.ts:39-56` 一次性 `useEffect` + 无跨实例广播）。
- **CSS 也没兜住**：`#shell` 上没有任何 `data-reduce-motion` 属性（实测 `shellDataAttributes` 前后完全相同），`--shell-duration` 前后都是 `200ms`。`src/shell` 里 6 处 `@media (prefers-reduced-motion: reduce)`（`tokens.css:94`、`taskList.css:103`、`composer.css:288`、`agent.css:175/289/526`）全部只认**系统**偏好，**没有一条**认这个应用内开关 —— 即使重启让 JS 那 4 个消费点生效，这 6 处动画仍照常播放。
- 类别：状态架构 + 设置未落地 ｜ 严重度：**P1**
- 同根因其它实例：`reduceMotion` 的消费点共 **4 个**（`Highlights.tsx:126`、`Hero.tsx:107`、`AttentionBorder.tsx:106`、`attentionOverlay.ts:268`），其中 3 个受本条影响，第 4 个更糟 —— 见 S7-004。另有 **6 处** CSS 动画完全不受该开关管辖。
- 双渲染对照：不适用

---

### [S7-004] 工作区的注意力边框永远不看 Reduced motion 开关（漏传 prop，不是时序问题）

- 壳组合：C5–C10（工作区可见时）；本轮在 C2 上用 Home 的那份实例做对照实验
- 运行环境：3100 fake（工作区那份在 fake 下无 task 可点亮，属源码级判定 + 对照证据）
- 表面：`App.tsx` 工作区 > `AttentionBorder`（Agent 跑任务时框住文档的那圈流光）
- 现象：应用内共挂载 **2 个** `AttentionBorder`，只有 Home 那个被告知了用户的 Reduced motion 选择；工作区那个用默认值 `false`，**无论怎么改、怎么重启都会一直播放流光**。
- 证据：`screenshots/C2-S7-attention-reduced.png`；`S7-ATTENTION`：
  - `document.querySelectorAll(".shell-attention").length === **2**`（两次采样均为 2）
  - Home 那份（有 prop）：开关前 `moved: true` → 开关 + 重挂载后 `moved: false` —— 证明 `AttentionBorder` / `attentionOverlay` 的机制本身是好的，工作区那份的问题只可能是**没传**
  - 源码计数：`grep -c "reducedMotion=" src/shell` = **1**，而 `<AttentionBorder` 调用点 = **2**
- 根因：`src/shell/App.tsx:118` `<AttentionBorder active={attentionActive} />` —— 缺 `reducedMotion={…}`，落到 `AttentionBorder.tsx:85` 的默认值 `reducedMotion = false`。对照：`src/shell/home/Hero.tsx:103-108` 传了。
- 类别：设置未落地（死线） ｜ 严重度：**P1**（这是产品里最显眼的动画，且发生在用户最可能想静音的时刻）
- 同根因其它实例：**1 个**（`App.tsx:118` 自己）。与 S7-003 叠加后的体验：开关对工作区**永久无效**，对 Home **重启后才有效**。
- 双渲染对照：不适用

---

### [S7-005] CustomModelDialog：4 个输入框只有 173px，同一个表单里的下拉却是 430px

- 壳组合：C1–C4 全部（composer 四组合都在，弹窗 portal 到 body 与组合无关）；实测记录在 C2
- 运行环境：3100 fake
- 表面：composer > 模型按钮 > `Add model…` > `CustomModelDialog`
- 复现：C2 → 点 `GPT-6 Astra` 按钮 → 点 `Add model…`
- 现象：**用户报的那张「大片留白、输入框过窄」截图就是这里**。430px 宽的表单里，4 个文本框各占 173px（右侧 257px 空白，占行宽 **59.8%**），中间夹一个占满 430px 的原生下拉。
- 证据：`screenshots/C2-S7-custom-model-dialog.png`、`C2-S7-custom-model-dialog-filled.png`；`S7-MODEL-DIALOG`：

  | 控件 | 宽 | 高 | 圆角 | 字号 | 边框色 |
  |---|---|---|---|---|---|
  | `.od-dialog__content`（行宽基准） | **430** | 405 | — | 14px | — |
  | `#shell-model-name` | **173** | 32px | **4px** | **13.333px** | `rgba(65,70,75,0.1)` |
  | `#shell-model-id` | **173** | 32px | 4px | 13.333px | 同上 |
  | `#shell-model-provider`（原生 select） | **430** | **38px** | **8px** | **14px** | **`rgba(65,70,75,0.8)`** |
  | `#shell-model-base` | 173 | 32px | 4px | 13.333px | `rgba(65,70,75,0.1)` |
  | `#shell-model-key` | 173 | 32px | 4px | 13.333px | 同上 |

  同一表单里出现 **2 种高度（32/38）、2 种圆角（4/8）、2 种字号（13.33/14）、2 种边框深浅（alpha 0.1 / 0.8，相差 8 倍）、2 种宽度（173/430）**。
- 根因（两条独立）：
  1. `src/renderer/ui/styles/components.css:143-152` `.od-input` **没有 `width`**，落到 `<input>` 的 UA 默认 `size=20` → 173px；`ModelMenu.tsx:218/228/254/264` 也没补宽。字号同理：`.od-input` 不设 `font-size`，吃 UA 的 13.333px。
  2. 唯独下拉是对的，因为它不走 `.od-input` —— `ModelMenu.tsx:238-249` 用裸 `<select>` + `src/shell/composer/composer.css:536-547` `.shell-dialog-select { width:100%; height:38px; border-radius:8px }`，那是 shell 自己按 shell 的口径写的。**两套 CSS 各写各的**。
- 类别：两套设计系统混用 ｜ 严重度：**P1**
- 同根因其它实例：`src/shell` 里 import legacy `Input` 的共 **3 个文件 / 6 个输入框** —— `ModelMenu.tsx:4`（4 个）、`nav/useFolderDialogs.tsx:3`（1 个，New folder 弹窗，同病）、`chrome/FileTabs.tsx:11`（1 个，重命名弹窗，同病）。更广口径见 S5 第 5 条（`src/shell` import `renderer/ui` 共 9 处）。
- 双渲染对照：不适用

---

### [S7-006] 弹窗 portal 到 `document.body`，`#shell` 的令牌桥接被整体绕过

- 壳组合：C1–C4 全部（portal 与组合无关）；实测记录在 C2
- 运行环境：3100 fake
- 表面：任何用 legacy `Modal` 的 shell 弹窗
- 现象：`src/shell/tokens.css:105` 起有一整块「让 `@vo-ui` 原语说 shell 的话」的桥接，作用域是 `#shell`。而 `Modal` 用 `createPortal(…, document.body)`，**挂在 `#shell` 外面**，于是桥接一个字都没生效，弹窗拿的是 legacy 原始令牌。
- 证据：`screenshots/C2-S7-custom-model-dialog.png`；`S7-TOKEN-BRIDGE` 同一时刻对同一批自定义属性求值：

  | 令牌 | `#shell` 内 | `.od-dialog` 内（body 下） | 差 |
  |---|---|---|---|
  | `--od-ink-medium` | `#596773` | `#41464bcc` | 不同色 |
  | `--od-border-subtle` | `#e4e6e9` | `#41464b1a` | 不同色 |
  | `--od-radius-control` | **5px** | **4px** | 1px |
  | `--od-radius-dialog` | **10px** | **8px** | 2px |
  | `--od-control-md` | **36px** | **32px** | 4px |

  以及 `dialogIsInsideShell: false`、`.od-dialog-mask` 的父节点 id 为空（= `document.body`）。
  可见后果：`Save model` 主按钮 `background-color: rgb(0,0,0)` 纯黑，而 shell 自己的发送按钮是 `rgb(65,70,75)` —— 同一屏两个「主按钮」不同色。
  另：`.od-dialog` 自身 `font-family` 计算值是 **`Times`**（衬线），因为它在 `#shell` 外、`.od-dialog` 规则又不设字体；目前靠 `__header`/`__content` 各自兜住，任何加在 `.od-dialog` 直接子节点上的新文本都会掉进衬线里。
- 根因：`src/renderer/ui/components/Modal.tsx:29-43` `createPortal(..., document.body)` × `src/shell/tokens.css:105` 桥接块选择器为 `#shell`。正确做法是 portal 到 `#shell` 内的 layer，或把桥接提到 `:root`。
- 类别：两套设计系统混用 ｜ 严重度：**P1**
- 同根因其它实例：`src/shell` 里用 legacy `Modal` 的 **3 处**（`ModelMenu.tsx:195`、`useFolderDialogs.tsx`、`FileTabs.tsx`）；同样 portal 到 body 的还有 `ToastHost`（`App.tsx:1`）与 `dialog.tsx` 的 confirm。
- 双渲染对照：不适用

---

### [S7-007] 设置表单里用原生 `<select>`，与 shell 自绘菜单是两种控件语言

- 壳组合：C1–C4；实测记录在 C2
- 运行环境：3100 fake
- 表面：`CustomModelDialog` > Provider
- 现象：shell 自己实现了一整套 `Menu` 原语（`Menu.tsx:61` 注释明说「菜单是这个 IA 的承重控件，键盘行为只实现一次」），但设置表单里的 Provider 用的是**原生 `<select>`** —— 展开时由操作系统绘制，shell 的边框/圆角/阴影/字号一条都够不着，Windows 与 macOS 上长相完全不同，且不参与 `Menu` 的 roving focus 约定。
- 证据：`screenshots/C2-S7-custom-model-dialog.png`；`S7-CONTROL-LANGUAGE`：

  | | shell `Menu` | `CustomModelDialog` 的 `<select>` |
  |---|---|---|
  | 元素 | `div[role=menu]` + `button[role=menuitemradio]` | `SELECT`，`appearance: auto` |
  | 面板圆角 | `10px` | （OS 绘制，不可控） |
  | 行高 | `min-height 38px`，实测 49px | 38px |
  | 字号 | **12px** | **14px** |
  | 阴影 | `rgba(34,43,53,0.125) 0 8px 28px` | 无 |
  | 键盘 | Home/End/↑↓ roving + Esc 回焦 | OS 默认 |

- 根因：`src/shell/composer/ModelMenu.tsx:238-249` 直接写 `<select>`。`src/renderer/ui/index.ts:21` **已经导出了 `Select`**，且 `src/shell/home/EditorHome.tsx:4` 就在用它 —— shell 里同时存在三种下拉写法。
- 类别：两套设计系统混用 ｜ 严重度：P2
- 同根因其它实例：`src/shell` 里裸 `<select>` 共 **1 处**（grep 全仓确认）；但「三种下拉并存」的实例数是 3（`Menu` ×7 调用点、legacy `Select` ×1、裸 `<select>` ×1）
- 双渲染对照：不适用

---

### [S7-008] 设置弹窗按 Esc 不关，Tab 能跑出弹窗一路走到窗口关闭按钮

- 壳组合：C1–C4；实测记录在 C2
- 运行环境：3100 fake
- 表面：`CustomModelDialog`（以及全部 3 个 shell legacy 弹窗）
- 复现：C2 → 打开 `Add model…` → 按两次 Esc → 把焦点放到 `Display name` → 连按 Tab
- 现象：
  1. Esc **不关弹窗**（`dialogStillOpen: true`，焦点还在 `INPUT.od-input` 上）；
  2. **没有 focus trap**，Tab 第 7 下焦点跑到 `BODY`，第 8 下落在 **`shell-window-close`**（窗口关闭按钮），第 9 下 `shell-window-minimize`。模态框开着时，只按 Tab 就能摸到「关闭整个应用窗口」。
- 证据：`screenshots/C2-S7-dialog-focus.png`；`S7-TOKEN-BRIDGE` 的 `focusOrder`：

  ```
  shell-model-id → shell-model-provider → shell-model-base → shell-model-key
  → od-button → od-button
  → BODY                   <-- OUTSIDE DIALOG
  → shell-window-close     <-- OUTSIDE DIALOG
  → shell-window-minimize  <-- OUTSIDE DIALOG
  ```

  `afterEscape = { dialogStillOpen: true, activeElement: "INPUT.od-input" }`
- 根因：`src/renderer/ui/components/Modal.tsx` 全文 **没有任何 keydown / focus 逻辑**（`grep -n "Escape" Modal.tsx` 无结果），也没有 `inert` / `aria-hidden` 处理背景。对照刺眼：**同一个设计系统里的命令式路径有** —— `src/renderer/ui/services/dialog.tsx:61-67` 装了 `closeOnEscape`。再对照 shell 自己的 `Menu.tsx:158-163`：Esc 关闭 **并把焦点还给触发器**。三种弹层三套键盘契约。
- 类别：无障碍 / 键盘 ｜ 严重度：**P1**
- 同根因其它实例：**3 个** shell 内的 `Modal` 调用点（`ModelMenu.tsx:195`、`useFolderDialogs.tsx`、`FileTabs.tsx`），三个都成立。
- 双渲染对照：不适用

---

### [S7-009] apiKey 有掩码，但明文会被 React 写进 DOM 的 `value` 属性

- 壳组合：C1–C4；实测记录在 C2
- 运行环境：3100 fake
- 表面：`CustomModelDialog` > API key
- 现象：输入框 `type="password"`，视觉掩码**是对的**（截图里是圆点）。但它是受控 `<input>`，React DOM 会把 value **同步成 HTML 属性**，于是密钥明文出现在序列化 DOM 里：任何 `outerHTML` 快照、崩溃上报、session replay、devtools「Copy element」、无障碍树导出都会带走它。
- 证据：`screenshots/C2-S7-custom-model-dialog-filled.png`；`S7-MODEL-DIALOG`：
  - 打开时（未输入）：`hasValueAttribute: true, valueAttribute: ""` —— 证明属性是 **React 写的**，不是测试工具的副作用
  - 填入 `sk-audit-probe-123456` 之后：`valueAttribute: "sk-audit-probe-123456"`、`outerHTMLContainsSecret: **true**`、`documentHTMLContainsSecret: **true**`
  - `autocomplete: null`、`spellcheck: null` —— 既没有 `autocomplete="off"/"new-password"`，也没关拼写检查
- 根因：`src/shell/composer/ModelMenu.tsx:264-269` 用 legacy `Input`（`type="password"`）当受控组件。`src/renderer/ui/index.ts:17` **已经导出了 `PasswordInput`**，这里没用。
- 类别：安全 / 表单 ｜ 严重度：**P2**（掩码在，纵深防御不在；不是可直接利用的漏洞，但「本窗口不存密钥」这句承诺在 DOM 层面并不成立）
- 同根因其它实例：`src/shell` 里受控 legacy `Input` 共 **6 个**，其中**只有这 1 个是机密**。legacy 侧同形状的还有 `ProviderForm.tsx` 的 apiKey（不在本轮 UI 范围，记在第 3 节 #60）。
- 双渲染对照：不适用

---

### [S7-010] 假开关 `Review changes`：不撒谎，但提示条从顶部盖住标签栏

- 壳组合：C1–C4 全部；实测记录在 C2
- 运行环境：3100 fake
- 表面：侧栏 footer > Review changes
- 现象：按下去**不写状态**（这点是对的）：composer 权限按钮仍是 `Full access`，菜单里该行仍无勾选。但它触发的 legacy toast 从视口顶部 16px 处压下来，盖住 `FileTabs` 标签栏的中段。
- 证据：`screenshots/C2-S7-review-changes-toast.png`；`S7-REVIEW-CHANGES`：
  - toast 文案：`Not built yet / Review changes is not available yet — every run applies its changes directly. Full access is the only mode the agent honours.`
  - `.od-toast-host`：`position: fixed`、`top: 16`、`left: 410`、`width: 460`、**`z-index: 1100`**
  - 对照 `.shell-menu` 的 `z-index: **60**`（`chrome.css:597`）—— toast 盖住一切浮层；标签栏在 y ∈ [0, 46]，toast 从 y=16 开始，**重叠 30px**
  - 按下后状态：`permissionLabel: "Full access"`（没变），菜单行 `checked: null`（没写）
- 根因：`src/shell/chrome/Sidebar.tsx:123-127` 调 `notBuiltYet` → `src/shell/port/reportPortFailure.ts:1` 的 legacy `toast` → `src/renderer/ui/styles/components.css:447-457` `.od-toast-host { position:fixed; top:16px; z-index:1100 }`。shell 没有自己的 toast 层。
- 类别：浮层定位（假开关本身的行为合格） ｜ 严重度：P2
- 同根因其它实例：**5 处** `notBuiltYet` 入口共用这一个 toast 宿主（`Highlights.tsx:211`、`Composer.tsx:449`、`Composer.tsx:685`、`FileTabs.tsx:165`、`Sidebar.tsx:124`），其中 **2 处是设置项**。toast 定位归 S2/S8，**现象已在此记录并交叉**。
- 双渲染对照：不适用

---

### [S7-011] 三处设置入口全部硬编码英文，且与强制更新页的中文同屏

- 壳组合：C1–C4 全部
- 运行环境：3100 fake
- 表面：三处设置入口的 12 个 label + 12 条副标题 + `CustomModelDialog` 的 9 条文案
- 现象：`src/shell` 里 `t("` 调用数 = **0**（PLAN 2.2 已给出，本 session 在自己表面复核）。设置相关英文字串实测 **33 条**。中文系统上同一窗口会出现：英文设置菜单 + 中文文件名（fixture 的「二〇二六年第三季度…」）+ 中文强制更新页（`UpdateGate.tsx:28` 包了 `LocaleProvider`）。
- 证据：`screenshots/C2-S7-footer-menu.png`、`C2-S7-composer-menu.png`、`C2-S7-custom-model-dialog.png`；数值：`grep -c 't("' src/shell` = **0**；本表面英文字串 33 条；legacy 词典中可直接复用的对应条目 5 条（`onboarding.provider.*`，见第 3 节 #57–#61）
- 根因：`src/shell/chrome/Sidebar.tsx:103-143`、`src/shell/composer/Composer.tsx:56-69` 与 `:694-699`、`src/shell/composer/ModelMenu.tsx:134/197-272` 全部内联英文字面量，未接 `src/renderer/i18n`
- 类别：i18n（PLAN 第 9 节第 2 条，工程量而非样式缺陷） ｜ 严重度：P2
- 同根因其它实例：全 shell；全量清单归 S5 第 9 条
- 双渲染对照：不适用

---

### [S7-012] 侧栏与 composer 对同一开关给出不同的 ARIA 语义

- 壳组合：C1–C4 全部；实测记录在 C2
- 运行环境：3100 fake
- 表面：两处 Enter sends 行
- 现象：侧栏那行是 `role="menuitemradio"` + `aria-checked="true"`，composer 那行是 `role="menuitem"` **且完全没有 `aria-checked`**。屏幕阅读器在 composer 菜单里读不出该开关的当前状态。
- 证据：`screenshots/C2-S7-composer-menu.png`；`S7-INVENTORY` 的 `permission` 数组第 4 项 `{ role: "menuitem", checked: null }` vs `footer` 第 2 项 `{ role: "menuitemradio", checked: "true" }`
- 根因：`src/shell/chrome/Menu.tsx:191` —— role 由 `item.checked === undefined` 决定。`Sidebar.tsx:133` 传了 `checked`，`Composer.tsx:694-699` 的 `enter` 项**没传**。
- 类别：无障碍 ｜ 严重度：P2
- 同根因其它实例：`src/shell` 里不传 `checked` 的菜单项共 **6 个**，其中**只有 `Composer.tsx:694` 是布尔开关**，其余是动作项，不传是对的。
- 双渲染对照：不适用

---

### [S7-013] `Custom` 权限档永远无法配置：契约里有字段，全 shell 没有任何 UI 能写它

- 壳组合：C1–C4 全部
- 运行环境：3100 fake（源码级，环境无关）
- 表面：composer 权限菜单 > Custom（「Use your own instructions」）
- 现象：这一档承诺「用你自己的指令」，但 `ShellSettings.customInstructions` 在整个 `src/shell` 里**没有任何写入点**，选它永远等于「没有指令」。目前靠 `available:false` → `notBuiltYet` 挡住了，但菜单文案仍在承诺做不到的事。
- 证据：`grep -rn customInstructions src/shell`（排除测试）共 **3 处命中**，全部是默认值声明或注释：`useComposerSettings.ts:17`（FALLBACK）、`Composer.tsx:43`（注释）、`port/fake/seed.ts:70`（种子）。**写入点 0 个。** 服务端同样：`src/services/settings.ts:25` 明文写着「no screen in this app can write `customInstructions`」，且 `:33` `SUPPORTED_PERMISSIONS = ["full"]` 在读取时把 review/custom 过滤掉。截图：`screenshots/C2-S7-composer-menu.png`
- 根因：`src/shared/uiPort.ts:344` 声明字段，`src/services/settings.ts:38,59,75` 读写持久化，但没有任何界面提供输入 —— 这正是 legacy 设置页被砍掉之后留下的洞（legacy 的对应物是 `ProviderForm` 一整块，见第 3 节 #57–#61）。
- 类别：功能缺失（非样式） ｜ 严重度：P2
- 同根因其它实例：`ShellSettings` 5 个字段里 **1 个（customInstructions）无 UI**，1 个（permission）只有 1/3 档可用。
- 双渲染对照：不适用

---

## 第 3 节 — 覆盖对账：legacy 2130 行设置页（**按 PLAN 第 9 节单独成节，不属于 UI 样式缺陷**）

### 3.0 可达性的硬事实

| 事实 | 数值 / 证据 |
|---|---|
| `grep -rn legacy src/shell` | **0 条命中**（唯一相关的 `tokens.css:12` 只是注释里提到文件名，不是链接） |
| legacy 入口 | `legacy.html`（`vite.config.ts:200` 独立 rollup input） |
| shell 入口 | `index.html` → `src/shell/main.tsx` |
| 文档确认 | `docs/handoff.md:23`：**「旧 UI 移到 /legacy.html，没有任何地方链接过去，只能手敲地址」** |
| 桌面端能否手敲地址 | Wails webview 无地址栏 → **打包后不可达** |

**结论：下表所有标「不可达」的条目，对桌面用户等于永久失去。**

### 3.1 行数复核

| 文件 | 行数 |
|---|---|
| `src/renderer/screens/SettingsScreen.tsx` | 721 |
| `src/renderer/screens/settings/JiraConnectionCard.tsx`（**PLAN 写的 `JiraCard.tsx` 不存在**） | 184 |
| `src/renderer/screens/settings/LiquipediaConnectionCard.tsx`（**同，无 `LiquipediaCard.tsx`**） | 77 |
| `src/renderer/screens/settings/ProxyCard.tsx` | 95 |
| `src/renderer/screens/settings/RedeemCodeCard.tsx` | 65 |
| `src/renderer/components/ProviderForm.tsx` | 124 |
| `src/renderer/styles/settings.css` | 786 |
| `src/renderer/screens/settings/SettingsPrimitives.tsx`（行/分区/开关原语） | 74 |
| **合计** | **2126**，与 PLAN 的「2130 行」相符 |

### 3.2 逐条对账

新壳能写的偏好只有 `ShellSettings` 的 5 个字段（`src/shared/uiPort.ts:339-345`），其中 customInstructions 无 UI。
下表 **99 项**里：**可达 5 项（其中 1 项仅部分可达）、不可达 94 项**。

机械复核：`grep -rniE "checkAppUpdate|appVersion|proxy|jira|liquipedia|redeem|invite|watermark|notification|onboarding|diagnostic|setLocale|credit|imageQuality|outputDir|workspaceDir" src/shell` → **0 条业务命中**（唯一 3 条是 `Highlights` 卡片的装饰性 watermark，无关）。

| # | legacy 分区 | 条目（zh-CN） | 类型 | 落点（file:line） | 新壳 |
|---|---|---|---|---|---|
| 1–7 | 页面骨架 | OFFICEDEX 设置 / 应用设置 / 副标题 / 保存中·已自动保存 / 自动保存 toast / 加载中 / 分区导航 aria | 只读+状态 | `SettingsScreen.tsx:226-237` | **不可达（无设置页）** |
| 8–16 | 二级导航 | 生成 / 通知 / 外观 / 连接设置 / 订阅 / 活动记录 / 高级与支持 / 重置 / 关于 | 导航按钮 ×9 | `SettingsScreen.tsx:211-218,245` | **不可达** |
| 17 | 生成 | 默认文档类型（pptx/docx/xlsx/report/img） | select | `SettingsScreen.tsx:273` → `UpdateSettings` `wails.ts:450` | **不可达** |
| 18 | 生成 | 启用图片 | toggle | `SettingsScreen.tsx:289` | **不可达** |
| 19 | 通知 | 桌面通知 | toggle | `notifications.ts:22`（localStorage `officedex.notifications.enabled`） | **不可达** |
| 20 | 通知 | 测试桌面通知 | button | `SettingsScreen.tsx:155-168` → `SendDesktopNotification` | **不可达** |
| 21 | 外观 | **界面语言（中文 / English）** | select | `i18n/index.tsx:33`（localStorage `officedex.locale`） | **不可达** ⚠️ 与 S7-011 叠加：shell 全英文且语言开关也没了 |
| 22–35 | 连接设置 | **Jira** 全套：地址 / 认证方式 / 用户名 / PAT·密码（带显示隐藏）/ PAT 三步帮助 / Atlassian 文档外链 / 凭证说明 / 已配置标记 / 测试并保存 / 清除连接 / 超时错误 / 探测结果 / 错误横幅 | 14 项 | `JiraConnectionCard.tsx:10-175`，后端 `SaveJiraConnection` `wails.ts:176` | **全部不可达** |
| 36–46 | 连接设置 | **Liquipedia** 全套：数据源地址 / 联系邮箱 / 为什么需要联系方式 / 条款说明 / 条款外链 / 已配置 / 测试并保存 / 清除连接 / 超时 / 探测结果 | 11 项 | `LiquipediaConnectionCard.tsx:10-73` | **全部不可达** |
| 47–50 | 订阅 | **兑换码**：输入（自动大写 / maxLength 64 / Enter 提交）、兑换按钮、成功记录 | 4 项 | `RedeemCodeCard.tsx:18-57` → `WailsApp.Redeem` `wails.ts:439` | **全部不可达** ⚠️ 用户无法充值 |
| 51–52 | 订阅 | **我的邀请码**（显示 + 复制） | 2 项 | `SettingsScreen.tsx:71-95,197-206` → `GetInviteInfo` `wails.ts:433` | **不可达** |
| 53 | 活动记录 | 注入槽（父级传入的 ReactNode） | slot | `SettingsScreen.tsx:385` | **不可达** |
| 54–55 | 高级 | **生成图片水印开关** + 付费/免费说明 | toggle + 说明 | `SettingsScreen.tsx:400-403`，受 `creditStatus.paidEntitlement` 闸门 | **不可达** ⚠️ 付费用户无法关水印 |
| 56–66 | 高级 | **LLM 提供方**：官方/自定义 select、baseUrl、兼容性提示、apiKey、模型名、登录要求提示、浏览器登录、测试连接（官方探测二次确认 Modal）、11 种测试结果文案、清除提供方 | 11 项 | `ProviderForm.tsx:23-124`、`SettingsScreen.tsx:483-576` | **部分可达**：`CustomModelDialog`（`ModelMenu.tsx:136`）覆盖 **provider / baseUrl / apiKey / modelId 四个字段**；**丢失**：官方↔自定义切换语义、登录闸门、**测试连接**、11 种结果文案、清除提供方、二次确认 |
| 67–71 | 高级 | **网络代理**：启用开关、代理地址、校验错误、保存按钮 | 4 项 | `ProxyCard.tsx:32-83` → `settings.proxy` | **全部不可达** ⚠️ 代理影响更新/生成/OfficeCLI 子进程全链路 |
| 72–77 | 高级 | **诊断**：导出诊断日志、测试提供方、复制诊断快照、上报问题、结果与提示 | 6 项 | `DiagnosticsPanel.tsx:67-113` | **全部不可达** ⚠️ 用户无法自助取证 |
| 78–83 | 高级 | **运行时详情（调试）**：运行列表、显示/隐藏历史、取消、重试、列头与标记 | 6 项 | `RuntimeRunsPanel.tsx:59-109` | **全部不可达** |
| 84 | 高级 | **重新显示引导向导** | button + 二次确认 | `SettingsScreen.tsx:140-148` → `onboardingCompletedAt: null` | **不可达** ⚠️ 与 S8 第 2 项互为因果：新壳没有 onboarding，也没有重跑入口 |
| 85 | 重置 | **重置所有设置** | danger button + 二次确认 | `SettingsScreen.tsx:170-191` | **不可达**。另注：该 patch **不清** locale / notifications 两个 localStorage 键，也不清 Jira / Liquipedia / **proxy**（`settings.proxy` 不在 patch 里）——移植前先修 |
| 86–99 | 关于 | 产品名 / 版本号 / 描述 / 官网 / GitHub / GPL-3.0 / 上次检查 / 上次错误 / 下载进度条 / 反馈 / 免责声明 / **检查更新** / **更新到 {version}·重启以安装** / 已是最新 | 14 项 | `SettingsScreen.tsx:594-705` → `CheckAppUpdate` `wails.ts:508` | **全部不可达** ⚠️ 新壳只有**强制**更新（`UpdateGate.tsx:38`）；**可选更新用户永远看不到、也无法主动检查**，连版本号都查不到 |

### 3.3 legacy 侧自带的问题（移植前先决定，别原样搬）

| 项 | 事实 |
|---|---|
| `settings.row.imageQuality.*` | 词典有、`defaults.imageQuality` 被读写，**但没有控件渲染它** |
| `settings.option.docType.gif` | 词典有，select 不用 |
| `settings.row.outputDir.placeholder` / `settings.group.imageWatermark` | 孤儿词条 |
| `settings.effective.*`（6 条）+ `.effective-card`（`settings.css:569-620`） | 整块「生效配置」卡片**未被渲染** |
| `waiting2048Enabled` | 在 `UserSettings` 里，无任何控件 |
| 分区标题 | `od-sr-only` 视觉隐藏（`SettingsPrimitives.tsx:22`），可见标题其实是二级导航 |

### 3.4 给产品的三选一

1. **移植**：至少 #21 / #47–52 / #54 / #67–71 / #84–85 / #97–98 是普通用户会找的（语言、兑换码、水印、代理、重置、检查更新）。i18n 词条**已存在**，成本主要在 UI。
2. **加回退入口**：在侧栏 footer 菜单加一行「Open legacy settings」指向 `legacy.html` —— 最小改动，但会把第 2 节的两套设计系统问题正式变成产品形态。
3. **明确放弃**：Jira / Liquipedia / 运行时调试 / 诊断（#22–46、#72–83，共 **39 项**）可能本来就是内部工具，值得先砍掉再谈移植规模。

---

## 第 4 节 — 自报：四件事各完成到什么程度

### 事项 1：三处设置入口的条目对账 — **完成**
12 个条目全部实测抓取（label / 副标题 / role / aria-checked），重复项、措辞冲突、假开关、状态不同步四类全部标出并给了数值。第 1 节表 + S7-002 / S7-011 / S7-012 / S7-013 四条发现。

### 事项 2：C1 折叠轨下的 footer 设置菜单 — **完成，且结论比预期严重**
C1 必过 ✅，C2/C3/C4 也过了 ✅。实测 `left = −210.5`（C1/C3）/ `−210`（C2/C4），`clippedBy = shell-sidebar`，可见比例 15.8%。**PLAN 预测只有 C1 坏，实测四个组合全坏** —— 因为锚点是 28px 的图标按钮，侧栏展不展开都一样。见 S7-001。

### 事项 3：`CustomModelDialog` UI 审查 — **完成**
圆角（4 vs 8 vs shell 的 5/10）、间距、字体（`.od-dialog` 计算值 `Times`）、按钮样式（纯黑 `rgb(0,0,0)` vs shell `rgb(65,70,75)`）、输入框宽度（173 vs 430，59.8% 留白）、原生 select 与自绘菜单差异 —— 逐项都有数值。
apiKey：**有掩码**（`type=password` 已确认），但**明文进了 DOM `value` 属性**（`documentHTMLContainsSecret: true`），且无 `autocomplete`。
额外查出两条原计划外的：portal 绕过 `#shell` 令牌桥（S7-006）、Esc 不关 + 无 focus trap 能 Tab 到窗口关闭键（S7-008）。

### 事项 4：legacy 2130 行覆盖对账 — **完成**
99 个设置项逐条列出并标注可达性：**可达 5（其中 1 个部分可达）、不可达 94**。行数复核 2126 行，与 PLAN 的 2130 相符。
**顺带订正 PLAN 两处文件名错误**：不存在 `JiraCard.tsx` / `LiquipediaCard.tsx`，实名 `JiraConnectionCard.tsx` / `LiquipediaConnectionCard.tsx`。
可达性用 `grep -rn legacy src/shell`（0 命中）+ `docs/handoff.md:23` 双重坐实。按 PLAN 第 9 节单独成节（第 3 节），未混进 UI 缺陷。

### 收尾：设置改完是否真生效 — **完成，四条结论**
- Reduced motion → Highlights 轮播：**当场无效，重挂载后才生效**。三次 `scrollLeft` 采样判别（1/337 → 1/337 → 337/337），根因定位到 `useComposerSettings.ts` 的 5 个独立 `useState`。见 S7-003。
- Reduced motion → AttentionBorder：**Home 那份重挂载后生效（moved true→false 实测），工作区那份永远无效** —— `App.tsx:118` 根本没传这个 prop。见 S7-004。
- Enter sends 两处显示：**不同步**，同一页面两个菜单给出相反状态。见 S7-002。
- 额外：`src/shell` 里 6 处 `@media (prefers-reduced-motion)` 只认系统偏好，应用内开关对它们**永远无效**，即使重启。

### 没做的，以及为什么

| 没做 | 原因 |
|---|---|
| **C5–C10 六个组合** | 按 PLAN 第 3 节，S7 必过组合是 C1–C4，六个非 home 组合归 S4/S6。三处设置入口在 C5–C10 仍然存在（侧栏 footer 与 composer 都不随 home 变），**S7-001 的根因（`right:0` + `overflow:hidden`）与 home 无关，预期同样复现**，但我没有实测，不下结论。 |
| **3210 dev-real 环境** | PLAN 2.3 规定 dev-real 由 S4 独占。`CustomModelDialog` 在 dev-real 下会连真 `models.addCustom`，属写操作，本 session 只读。 |
| **暗色模式下的弹窗与菜单** | 归 S6 的亮暗维度。但 S7-006 的令牌桥绕过意味着**弹窗大概率整个不跟随暗色**（它拿的是 body 下的 legacy 令牌），建议 S6 专门验一次。 |
| **toast 遮挡的完整测绘** | 归 S2/S8。我只量了 `.od-toast-host` 的 fixed/top16/z1100 与 `.shell-menu` 的 z60 之差，把现象交叉过去。 |
| **Windows 上原生 `<select>` 的实际外观** | 按 PLAN 2.5，本轮在 macOS 上做，Windows 只列假设不下结论。S7-007 已标为跨平台风险。 |
| **legacy 设置项的运行时验证** | 第 3 节是**静态对账**（读源码 + grep），没有真的打开 `legacy.html` 逐个点。可达性结论本身不需要跑（grep 0 命中已足够），但「移植成本」一栏是估计值。 |
| **`customInstructions` 的端到端影响** | 只做到「无写入点」的静态证明，没验证 `permission: "custom"` 在 runtime 的降级路径（那是 `services/agent.ts` 的事，超出 UI 范围）。 |
| **`.od-dialog` 的 `Times` 字体是否真的可见** | 量到了计算值，但当前所有文本都被 `__header` / `__content` / `od-button` 各自的字体兜住，**没有实际渲染成衬线的像素**。按「latent hazard」记录，未当作已发生的缺陷。 |

### 严重度汇总

| 级别 | 条数 | 编号 |
|---|---|---|
| P0 | 2 | S7-001（设置菜单整体不可用）、S7-002（控件显示相反状态） |
| P1 | 5 | S7-003、S7-004、S7-005、S7-006、S7-008 |
| P2 | 6 | S7-007、S7-009、S7-010、S7-011、S7-012、S7-013 |
| 非 UI（第 3 节） | 94 项不可达设置 | 需产品决策 |

### 建议的静态闸门（供 PLAN 第 5 节汇总时采纳）

1. **偏好唯一真相源**：禁止 `useComposerSettings` 被多实例持有 —— 改成 Context + 订阅，并加测试断言「在 A 处 patch 后 B 处立即读到新值」。一次性堵死 S7-002 / S7-003。
2. **浮层必须 portal + 碰撞检测**：断言任意 `<Menu>` 在 10 个组合下 `rect.left >= 0` 且 `clippedBy === null`。堵死 S7-001 及 S2 的同类。
3. **shell 内禁止直接 import `renderer/ui` 的视觉组件**（Modal / Input / Select），或要求 portal 目标为 `#shell` 内节点。堵死 S7-005 / S7-006。
4. **模态框键盘契约测试**：Esc 关闭 + 焦点归还 + focus trap，三条断言。堵死 S7-008。
5. **prop 完整性**：给 `AttentionBorder` 的 `reducedMotion` 去掉默认值改成必填，让编译器发现 `App.tsx:118`（与 `SidebarButton.onClick` 改必填是同一招，见 `Sidebar.tsx:173-182`）。
