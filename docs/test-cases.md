# OfficeDex 测试用例清单

> 基线：当前仓库 `officedex` 主入口为新 shell（`/`），旧 UI 在 `/legacy.html`，发版包打开的是新 shell。
> 范围：桌面应用（macOS 为主，Windows 对照）的产品验收，不是单元测试清单。
> 配套：`docs/not-implemented.md`（诚实降级与产品缺失）、`docs/office-product-acceptance.md`（多产物血缘）、`docs/interaction-rules.md`（隐式交互规则）、`docs/test-cases-remediation.md`（本清单整改依据）。
> 编号规则：已有 TC-ID 不改号；后续只插 `-b/-c/...` 或追加新号段。

---

## 0. 怎么用这份清单

| 级别 | 含义 | 建议执行时机 |
|---|---|---|
| **P0** | 主路径断了就不能发版 | 每次装机、每次发版、每次签名包 |
| **P1** | 核心能力，失败要修或明确降级 | 功能迭代、回归周 |
| **P2** | 边界、体验、无障碍、尚未实现的诚实提示 | 专项、UI 审计后、发版抽检 |

**通过标准**

- 成功路径：产物落盘、能在画布打开、文件列表能找到、任务状态与界面一致。
- 失败路径：用户能看见原因和下一步，不能静默无反应。
- 未实现能力：必须出现明确提示，不能装成已完成。中文 UI 下提示应为中文（见 TC-NBI-02；当前标题硬编码英文，按缺陷记）。

**推荐环境**

| 项 | 建议 |
|---|---|
| 包 | 签名 + 公证后的 DMG / 开发态 `./scripts/devctl ensure --scope worktree` |
| 账号 | 匿名额度 + 已登录付费各一套 |
| 网络 | 直连 + `127.0.0.1:7890` 代理各一轮 |
| 语言 | **设置 → Appearance 切中文 / English 各一轮**。首启恒为 English，与系统语言无关（`detectLocale()` 固定返回 `"en"`） |
| 机器 | 本机构建机 **不能** 代替「无开发者证书的同架构 Mac」装机 |

**P0 冒烟建议顺序**（约 40–60 分钟，不含完整 PPT 生成）：启动 → 空白文档 → 打开本地文件 → 生成 DOCX → 生成 XLSX → 打开并编辑 → 设置保存 → 检查更新。PPTX 完整生成单独排，通常 3–10 分钟。

凡第 19 节标「旧 UI」的自动 spec，**不能**用来跳过新 shell 手工。

---

## 1. 覆盖矩阵

| 模块 | P0 | P1 | P2 | 说明 |
|---|---|---|---|---|
| 安装启动与更新 | TC-INS | TC-UPD | | 签名包、首次打开、强制更新闸门 |
| Shell 框架 | TC-SHL | TC-SHL-07/08 | TC-SHL-09 | 模式、侧栏、标签、窗口、快捷键、菜单键盘 |
| Agent Home | TC-HOM | TC-HOM-04/06 | | 空态、快捷提示、任务列表、筛选 |
| 文件与文件夹 | TC-FIL | TC-FOL | | 创建 / 打开 / 重命名 / 置顶 / 删除 / 右键 |
| Composer | TC-CMP | | | 发送、附件、@提及、类型、权限、Enter |
| 生成 PPTX | TC-PPT | TC-OUT | TC-STG | 大纲闸门、活画布、失败重试 |
| 生成 DOCX | TC-DOC | TC-PLN | | 计划问答、打开 Writer |
| 生成 XLSX | TC-XLS | TC-SHT | | 活表阶段、编辑落副本 |
| 图片 / Report | | TC-IMG / TC-RPT | | 额度敏感，发版抽检 |
| 在位修改 | TC-EDT | TC-SEL | | 打开文件后继续提要求 |
| 任务交互 | TC-TSK / TC-QST | TC-TSK-04/05 | | 问答、取消、暂停、失败分层、按钮矩阵 |
| 画布编辑器 | TC-CNV | TC-CNV-06/07 | | Word / Excel / PPT 内嵌与语言 |
| 设置 | TC-SET / TC-SET-03b/c | TC-ADV / TC-SET-03d | | 九个分区 + 开文件切语言 |
| 账号额度 | TC-ACC | TC-CRD / TC-ACC-02 | | 登录、兑换、水印 |
| 错误与离线 | TC-ERR-01 | TC-ERR-02 | | 列表失败、中途断网 |
| 连接器 | | TC-CON | | Jira / Liquipedia |
| 未实现诚实提示 | | | TC-NBI | 点了必须说话；中文提示 |
| 打包签名 | TC-PKG | | | codesign / notarize / 换机 |

---

## 2. 安装、启动、更新

### TC-INS-01 首次安装（P0）

**前置：** 无开发者证书的同架构 Mac；干净的 Applications。

1. 双击 DMG，把 OfficeDex 拖进 Applications。
2. 从 Applications 启动，不要从 DMG 直接跑。
3. 观察首次打开对话框。

**期望：** 不弹「无法验证开发者」；窗口出现新 shell（Agent Home）；不报 `mop-convert was not found`。

### TC-INS-02 冷启动到可工作（P0）

1. 启动后等到 Home 可交互。
2. 侧栏有默认文件夹；Composer 可输入。
3. 打开设置 → About，核对版本号与构建信息。
4. 看 Appearance 当前语言。

**期望：** 设置加载完成前不发任务；加载完成后可以发送。强制更新闸门未抬起时，bridge 保持空闲（规则 R-A-01）。**首启语言为 English，与系统语言无关；语言只在设置里改。**

### TC-INS-03 二次启动恢复（P1）

1. 打开一个文档，切到 Editor 模式。
2. 完全退出再打开。

**期望：** 文件仍在库里；未保存脏标记不跨进程保留；不会把用户丢进已完成任务的 document 路由（R-B-04）。

### TC-UPD-01 强制更新闸门（P0）

1. 用 `?forceUpdate=` 各 phase（开发）或构造必须更新的版本。
2. 观察闸门卡片：下载中 / 就绪 / 失败。

**期望：** 闸门期间不能连 bridge、不能发任务；失败态有第二条出路（重试或说明）；更新说明可换行。自动化（新 shell `/`）：`e2e/fix-w1d.spec.ts`。

### TC-UPD-02 检查更新（P1）

1. 设置 → About → Check for updates。

**期望：** 显示「有新版本 / 已是最新 / 上次错误」之一，不卡死。`e2e/shell-settings-real.spec.ts` 覆盖的是**旧 UI**，新 shell 必须手工。

---

## 3. Shell 框架

### TC-SHL-01 Agent / Editor 模式切换（P0）

1. 点品牌打开 Mode 菜单，在 Agent 与 Editor 间切换。
2. 有打开文件时再切一次。

**期望：** 菜单完整可见、不被裁切；切换不卸载已打开文档的编辑器；Home 内容换成对应首页。自动化（新 shell）：`e2e/shell-canvas-real.spec.ts`、`e2e/fix-w1a.spec.ts`。

### TC-SHL-02 侧栏展开 / 收起（P0）

1. 收起侧栏再展开。
2. 收起态下点「New folder」、点某个文件夹。

**期望：** 收起后侧栏卸载（不是缩成一条还占宽）；收起态仍能建文件夹、点文件夹会展开并显示文件。自动化（新 shell）：`e2e/fix-w5.spec.ts`。

### TC-SHL-03 窗口控件（P1）

**macOS 桌面端：** `hasOverlayWindowChrome()` 为真时，系统绘制红绿灯。断言存在 `data-system-drawn="true"` 的占位带，**没有第二套自绘关闭/最小化/全屏按钮**。用系统红绿灯操作窗口。

**Windows / 浏览器预览：** 点自绘按钮。桌面端行为与系统一致；浏览器里降级为 no-op，不能报错。全屏后图标状态跟着变。

### TC-SHL-04 文件标签栏（P0）

1. 打开 ≥3 个文件。
2. 点标签切换；关一个；Home 上用键盘 Tab / 方向键走到标签。
3. 长文件名、标签溢出时用左右箭头。

**期望：** Home 上标签仍可键盘到达（不能只停在关闭按钮上）；关闭按钮有焦点环；溢出时每个关闭按钮都能滚到。自动化（新 shell）：`e2e/fix-w2f.spec.ts`。

### TC-SHL-05 点 Home 回到真正的 Home（P0）

1. 打开文件，再点侧栏 Home。
2. 生成进行中时再点 Home。

**期望：** 画布回到 Agent/Editor Home，不是「当前文件的舞台」；进行中的任务仍在任务列表。规则 R-B-08。

### TC-SHL-06 浮动任务面板（P1）

1. 有任务时把面板从停靠改成浮动，拖到窗口边缘。
2. 再停靠。

**期望：** 拖动手柄可键盘聚焦；不会挡住标签栏或编辑器状态条；回 Home 时不在 hero 上留空白占位。自动化（新 shell）：`e2e/fix-w3h.spec.ts`。

### TC-SHL-07 键盘快捷键（P0）

1. 打开至少一个文件，按 `⌘W`（Windows：`Ctrl+W`）关当前标签。
2. 无打开文件时再按同一组合。
3. 长按该组合。
4. 非拉丁键盘布局下按物理 W 键（`event.code === "KeyW"`）。

**期望：** 有打开文件时关当前标签（走与点 X 相同的未保存确认）；无打开文件时**不要拦截**，落到系统「关窗口」；长按不连关多个标签；非拉丁布局仍生效。`⌘S` / `⌘N` / `⌘,` **当前未实现**，不要写成正向用例（见 `not-implemented.md`）。

### TC-SHL-08 菜单键盘契约（P1）

只测 **Menu 原语**的菜单，不测对话框类模态（对话框由 `e2e/fix-w1c.spec.ts` 覆盖）。逐个抽测：品牌 Mode、模型、@提及、标签 ⋯、文件行。

**期望：** ↑↓ 开合；roving focus 跳过禁用项；Home/End；Escape 关闭并把焦点交回 trigger；Tab 离开即关；点菜单外关闭。

### TC-SHL-09 最小窗口与面板折叠（P2）

1. 把窗口拖到最小。
2. 侧栏展开 / 收起，任务面板停靠 / 浮动。

**期望：** 窗口不小于 `1040×720`；展开侧栏约 190px、折叠轨 52px、agent 列 320px（**宽度不可拖，见 not-implemented.md**）；折叠后画布与悬浮面板不重叠。

---

## 4. Agent Home

### TC-HOM-01 空工作区（P0）

**前置：** 新用户或清空库后。

**期望：** 空态文案旁边就是本屏真有的操作（创建空白文档、打开本地文件）；没有「点了没反应」的按钮。自动化（新 shell）：`e2e/fix-w5.spec.ts`。

### TC-HOM-02 创建空白文档（P0）

1. 分别创建空白 Word / Excel / PowerPoint。

**期望：** 真实 OOXML 包落盘并注册进库；立即在画布打开对应编辑器；离开 Home。不要出现 prototype 种子文件。

### TC-HOM-03 快捷提示填入而不发送（P0）

1. 点一条 Quick Prompt。

**期望：** 文本进入 Composer，**不**自动发送。自动化（新 shell fixture（非 bridge））：`e2e/ui-audit-s3.spec.ts`。

### TC-HOM-04 任务列表七态（P1）

覆盖 `AgentStatus` 全部 7 态：`idle` / `reading` / `writing` / `working` / `paused` / `awaiting-review` / `done`，以及超长标题。

**期望：** 行可点；进行中有相位文案；点色只有 live / waiting / still 三档（**不单独标失败**，失败见 TC-TSK-04）；无任务时整条 band 消失，不是空列表骨架。

### TC-HOM-05 Feature highlights（P2）

1. 轮播、键盘左右、点卡片。

**期望：** 轮播和键盘是真的；点击提示尚未有视频素材（`home-highlights`），不能假装播起来。Reduced motion 打开后轮播不再滑。

### TC-HOM-06 Editor Home 的筛选器（P1）

1. Group by：时间 / 文件夹。
2. 文件类型下拉。
3. Group by 切到 Folder 后，与侧栏树逐行对照。

**期望：** 两个下拉都改列表；按文件夹分组后，组与侧栏树的文件夹一一对应（设计意图）。空态见 TC-FOL-03。

---

## 5. 文件与文件夹

### TC-FIL-01 打开本地文件（P0）

1. Open from disk，选真实 `.docx` / `.xlsx` / `.pptx`。
2. 再打开同一文件一次。
3. 取消选择器。

**期望：** 文件不复制不移动，出现在默认文件夹；重复打开复用同一 document id；取消无 toast、无错误。自动化（新 shell）：`e2e/shell-canvas-real.spec.ts`。

### TC-FIL-02 不支持的类型（P1）

1. 打开 `.png` / `.pdf` 等。

**期望：** 明确不支持，不进坏掉的编辑器。

### TC-FIL-03 重命名 / 副本 / 置顶 / 移出库（P0）

从标签栏 ⋯ 和文件行菜单各做一遍。**⋯ 菜单只有这四项**，没有导出 / 打印 / 版本历史入口。

| 动作 | 期望 |
|---|---|
| 重命名 | 扩展名保留；标签和列表立刻更新 |
| 创建副本 | 新标签打开副本 |
| 置顶 / 取消 | Editor Home 的 Pinned 列表跟着变 |
| 移出库 | 标签关闭，磁盘文件仍在（移出库 ≠ 删磁盘文件） |

### TC-FIL-04 Share（P1）

1. 有打开文件时点 Share。
2. 无打开文件时点 Share。

**期望：** 有系统分享则打开分享表，否则复制本地路径；无文件时说「没有可分享的文件」，不说「功能不存在」。自动化（新 shell）：`e2e/fix-w2f.spec.ts`。协作链接 / 权限 / 邀请成员仍未立项。

### TC-FIL-05 未保存（P1）

1. 在编辑器改内容，切走 / 关标签 / 关窗口。

**期望：** 出现未保存确认；脏点出现在标签上；确认后才走。

### TC-FOL-01 文件夹 CRUD（P0）

1. 新建、重命名、删除文件夹。
2. 删除非空文件夹。

**期望：** 名称冲突在对话框内报错（不是对话框后面一条 toast）；删除后文件进默认文件夹，文件本身不删。

### TC-FOL-02 拖入文件夹（P1）

1. 把文件拖到另一个文件夹。

**期望：** 移动成功；若目标不可见，有提示告诉文件去了哪。Recent **不是**文件夹，不能当拖放目标。

### TC-FOL-03 Editor Home 最近 / 置顶（P1）

1. 在 Recent 与 Pinned 间切换。
2. 空列表四种空态：无文件 / 仅置顶 / 仅类型筛选 / **置顶+类型同时**（独立文案 `shell.list.emptyPinnedAndType`，S3-014 回归点）。

**期望：** 列与表头对齐；长文件名省略且 title 为全名；第四种空态必须点名两个筛选，不能只说「没有置顶」。自动化（新 shell fixture（非 bridge））：`e2e/ui-audit-s3.spec.ts`。

### TC-FOL-04 右键与 F2 行菜单（P1）

1. 文件夹行、文件行右键。
2. 焦点在该行时按 F2。

**期望：** 打开与 ⋯ 相同的动作菜单（文件夹：重命名/删除；文件：打开/置顶/重命名/移出库等，以菜单实际项为准）。

### TC-FOL-05 侧栏分页与键盘展开（P1）

1. 文件夹内文件超过 `SIDEBAR_PAGE`（5）时点「更多」。
2. 文件夹行 `aria-expanded`；ArrowRight 展开并进入、ArrowLeft 收起。

**期望：** 溢出可展开；键盘展开/收起与鼠标一致。

---

## 6. Composer

### TC-CMP-01 发送一条新任务（P0）

1. 在 Home 输入明确指令，选产出类型（Word / Excel / PPT），发送。

**期望：** 任务出现在面板和 Home 列表；发送后草稿清空。进行中且 Composer **非 Home** 时，空 Composer 变成 Stop；**Home 上不变 Stop**（停止入口在任务面板与 Home 任务列表）。这是有意设计，不是缺陷。

### TC-CMP-02 产出类型覆盖启发式（P0）

1. 设置默认类型为 PPTX。
2. 点 Home「Write a document」类快捷提示，或手动选 New document。
3. 发送。

**期望：** 产出是 `.docx`，不是设置默认的 deck。未选手动类型时才走默认 / 启发式。

### TC-CMP-03 Enter 发送（P1）

1. 设置 Appearance → Enter sends 开 / 关。
2. 在 Composer 权限菜单里再切一次（`Enter sends · on/off`），看设置页是否立即同步；反向再切一次。
3. 在 Home 与任务面板各试一次普通 Enter。
4. 中文输入法组字时按 Enter。
5. `⌘/Ctrl+Enter`。

**期望：** 设置页与权限菜单共用同一 store，一处切换另一处立即同步；组字 Enter 不误发；`⌘/Ctrl+Enter` **始终发送**，不受开关影响。自动化（新 shell，两处一致）：`e2e/fix-w2g.spec.ts`。

### TC-CMP-04 @提及（P1）

1. 输入 `@` 选文件或文件夹。
2. 切到 Home 再回来（草稿应还在，chip 不能变成纯文本）。

**期望：** 名称进入 prompt 上下文；runtime 没有结构化 mentions 字段，这是已知边界，不能当成「没带上文件」的产品缺陷，除非 prompt 里名字都没了。

### TC-CMP-05 附件（P1）

1. 桌面端用原生选择器加带路径的附件。
2. 浏览器拖入无路径附件。
3. 超过 10 个或单个超过 20MB。

**期望：** 有路径的附件写入 prompt 上下文；无路径的出现 notice，不假装已读取内容；超限被拦住。

### TC-CMP-06 权限菜单（P1）

1. Full access → 可发送。
2. Review changes / Custom → 提示尚未实现，**不会**把该值发出去。
3. 同一菜单里的 Enter sends 行见 TC-CMP-03。

### TC-CMP-07 模型选择（P1）

1. 切换已配置 provider。
2. 添加自定义模型（name / modelId / provider / baseUrl / 可选 key）。
3. 关掉对话框再打开编辑。
4. 未登录时自定义 endpoint 若要求登录，应跳到账号页。

**期望：** 选中的是当前 provider，后续任务走它。key 字段是 `type="password"`（视觉遮蔽），但**真实值会回填进 DOM 与组件 state**，不是 write-only；后端也不做 redact。桌面端把 key 写入 `settings.llmProvider.apiKey`（设置文件，不是会话内存）。保存为逐次按键即时触发，且 `internal/settings/store.go:218` 对 `LlmProvider` 是**整体替换**：清空 key 字段会覆盖掉已存 key，不会保留。

**待确认 / 按缺陷记：**
- 重开对话框时 key 不应回填明文（当前会回填）。
- 空 key 的保存不应覆盖已存 key（当前会覆盖）。

自动化（新 shell fixture（非 bridge））：`e2e/ui-audit-s2.spec.ts`（几何，不断言存储）。

### TC-CMP-08 麦克风听写（P2）

1. 宿主支持 Web Speech API 时开始 / 再按停止。
2. 打包 webview 无该 API。

**期望：** 有 API 则有可视状态；无 API 则提示，不假装在听。中文 UI 下该提示应为中文，见 TC-NBI-02。

---

## 7. 生成：PowerPoint

### TC-PPT-01 从 Composer 生成并打开（P0）

1. 选 New presentation，短 prompt（3 页级）。
2. 等完成。

**期望：** 任务完成；产物在库中；画布打开真实编辑器（或明确「AI editor unavailable」+ iframe 预览 + Open in app / Show in folder）。不能只断言「iframe 在」。新 shell 自动化：`e2e/shell-pptx-generation-real.spec.ts`（耗时长，额度）。`e2e/generation-real.spec.ts` 是旧 UI，不能替代本条。

### TC-PPT-02 立即 Starting 反馈（P0）

点发送后，在 provider 真正跑起来之前。

**期望：** 立刻进入 Starting，不是空白画布干等。`e2e/pptx-stage-real.spec.ts` 是**旧 UI**且 `OFFICEDEX_E2E_PPTX_STAGE=1`；新 shell **必须手工**。

### TC-PPT-03 大纲闸门（P0）

**前置：** plan 模式（`?planMode=1` 或等价入口）。

1. 等到可编辑大纲。
2. 改一页标题、删一页，确认。
3. 等到画完。

**期望：** 运行停在大纲；确认后的 deck 反映编辑后的大纲，而不是确认前的。自动化（新 shell）：`e2e/shell-outline-gate-real.spec.ts`。

### TC-PPT-04 活画布阶段（P1）

观察 research / outline / writing / drawing / polish。

**期望：** 各阶段画布可区分；生成中的注视/标记不与正文重叠到不可读。自动化：`e2e/slides-generating.spec.ts`（独立 harness，不是 `/` 也不是 legacy）。

### TC-PPT-05 暂停 / 继续 / 转向（P1）

仅 pptx 支持 `pausePptx` / `resumePptxLive`。任务面板在 `documentType` 为 docx/xlsx 时**不渲染** Pause。

1. 生成中暂停，再继续。
2. 暂停时发一条「下一页改成…」。

**期望：** 停在页边界；继续后接着画；steer 落在当前运行，不另开一条任务。docx/xlsx 看不到 Pause，不要去点一个不存在的按钮。

### TC-PPT-06 取消（P0）

生成开始后取消（任务面板 Stop，或 Home 任务列表的停止入口；**不要**指望 Home Composer 变成 Stop）。

**期望：** 任务变为 cancelled；不留下半残但显示「完成」的文件。`e2e/generation-real.spec.ts` 是旧 UI；新 shell **必须手工**。

### TC-PPT-07 失败态与重试（P0）

1. 断网或构造失败任务。
2. 看失败舞台和 Retry。

**期望：** 失败原因可见；Retry 可点；不能把失败画成空白成功。`e2e/pptx-stage-real.spec.ts` 是旧 UI；新 shell **必须手工**。分层见 TC-TSK-04。

### TC-PPT-08 关闭图片（P1）

设置 Generation → Enable images 关闭后生成短 deck。

**期望：** 仍能完成；页面不以缺图失败。需 reload 后设置才进提交（已知：renderer 有本地快照）。

### TC-STG-01 关闭图片的 hosted 长路径（P2）

`OFFICEDEX_E2E_RUN_HOSTED_PPTX=1` 才跑完整 hosted 渲染，耗时长、花额度。发版抽 1 条即可。该环境变量挂在旧 UI `generation-real` 上，新 shell 抽检仍走手工。

---

## 8. 生成：Word

### TC-DOC-01 一页 memo（P0）

短 prompt 生成 `.docx`，完成后打开 Writer。

**期望：** 文件在库中；画布是 Writer 而不是「Unable to open」；中英文混排可滚动、工具栏可用。新 shell：`e2e/shell-generation-real.spec.ts`。旧 UI：`e2e/generation-real.spec.ts`（不能单独当作新 shell 已过）。

### TC-PLN-01 计划问答后完成（P0）

plan 模式生成 docx，出现选项时选推荐项（或自由输入），直到完成。

**期望：** 问答卡住时 Composer 回答的是**当前 run**，不另开第二条；完成后产物可开。`e2e/generation-real.spec.ts` 的 plan-option 条是旧 UI；新 shell 用 `e2e/shell-generation-real.spec.ts` 的问答闭环 + 本条手工补 plan 模式。

### TC-DOC-02 选区引用（P1）

1. 打开 docx，在 Writer 里选一段。
2. Composer 出现引用 chip，发送「把这段改成…」。

**期望：** 引用标签来自 Writer 选区；发送时才取一次文本（`resolveSelection`）。没有选区就不带假引用。

---

## 9. 生成：Excel

### TC-XLS-01 预算表（P0）

生成带合计的工作簿，打开 Sheet 编辑器。

**期望：** 表格可见；合计是数字不是共享字符串导致的 SUM=0；预览行号与写入行一致。`e2e/generation-real.spec.ts` 是旧 UI；新 shell **必须手工**。

### TC-SHT-01 写入中的活表阶段（P1）

生成或编辑进行中。

**期望：** 底部出现计划中的表标签，随写入逐个点亮；不是一分钟空白。

### TC-XLS-02 打开后继续改（P0）

1. 打开刚生成的 xlsx。
2. 「把 B2 改成 100，并追加一行合计说明」。
3. 等完成再打开产物。

**期望：** 编辑完成后有 artifact、有 document 行；打开的是改过的那份。当前 runtime 写的是 `X.modified.xlsx`，原件不动，两份都会进列表——这是约定，不是丢文件。

### TC-XLS-03 格式化要求被安静降级（P2）

「把合计行加粗」。

**期望：** 不要当成成功改了样式。今天 runtime 可能报 `ops_applied: 1` 但样式没变。记缺陷时对照 `docs/not-implemented.md` 第六节之二，不要当新 UI bug。

### TC-XLS-04 选区引用（P1）

选 `Sheet1!B2:D10`，发送时 Composer 带地址，内容为 TSV。

---

## 10. 图片、Report、GIF

### TC-IMG-01 文生图（P1）

prompt 如「画一只猫咪」。

**期望：** 图片落盘；失败有原因。花额度，发版抽检。水印与额度联动见 TC-IMG-03。`e2e/generation-real.spec.ts` 是旧 UI。

### TC-RPT-01 从工作簿生成报告（P1）

带上 `sales-report.xlsx`（或任意有数据的表），生成 report。

**期望：** 报告读到源表趋势，不是空报告。`e2e/generation-real.spec.ts` 是旧 UI；新 shell **必须手工**。

### TC-IMG-02 GIF / sprite sheet（P2）

仅 `OFFICEDEX_E2E_RUN_HOSTED_GIF=1`。对 provider 尺寸约束敏感，失败先看是不是 4×4 整除问题。挂在旧 UI `generation-real`。

### TC-IMG-03 图片水印与额度（P2）

1. 免费 / 匿名账号打开 Advanced：水印开关禁用且为开，生成图带水印。
2. 付费账号关掉水印后再生成。

**期望：** 免费强制开；付费可关且产物无水印。与 TC-ADV-01 的开关断言互补，本条看**产物**。

---

## 11. 在位修改与任务交互

### TC-EDT-01 打开 deck 后改内容而不是重生成（P0）

打开已有 pptx，说「把第 2 页标题改成 …」。

**期望：** 走 in-place edit，不新开一份 deck。若 planner 要求确认，先问再 apply。自动化（新 shell）：`e2e/deck-edit-routing-real.spec.ts`。

### TC-EDT-02 Apply / Undo 建议（P1）

任务面板出现 Review and apply。

**期望：** Apply 先写独立副本，确认后替换源文件；Undo 在进程内可恢复。重启后快照失效、源文件被外部改过则不强行恢复。打开中的编辑器可能要重新打开才看到新 bytes。

### TC-QST-01 运行中提问（P0）

任务进入 awaiting-review。

**期望：** 问题卡片在任务面板，不是普通气泡；点选项或自由输入后卡片消失、同一任务继续。Home 上另开 Composer 不得把这条任务丢在等待里。

### TC-TSK-01 终态通知与额度刷新（P1）

完成 / 运行失败（error 事件）/ 取消。

**期望：** 系统通知标题带任务名（通知开关打开时）；额度刷新。通知关着时不弹。规则 R-A-07 / R-A-08。`AgentStatus` 没有 `failed`，终态通知来自任务事件，不是列表上的第五种点色。

### TC-TSK-02 后台任务不抢导航（P1）

看着 A 文件时，B 任务从别处完成。

**期望：** 不强制切走；B 出现在列表，用户自己点。规则 R-B-03b。

### TC-TSK-03 Stop / Finish（P1）

Stop 结束当前 run（任务面板 / 非 Home Composer）；Finish 结束任务但保留已应用的改动。

**期望：** 状态与文件一致；已写到磁盘的不回滚，除非走 Undo。Home Composer 不变 Stop，见 TC-CMP-01。

### TC-TSK-04 运行失败与产物失败（P1）

两种失败不在同一层，不要当成 `AgentStatus.failed`（该值不存在）：

| 层 | 信号 | 界面 |
|---|---|---|
| 运行失败 | `AgentEvent.kind === "error"` | toast「The run stopped」+ 描述（中文 UI 见 TC-NBI-02）；任务状态不会变成一个叫 failed 的枚举 |
| 产物 / 页失败 | outline 页 `state === "failed"` | 任务面板页标记为失败；Home 任务行点色仍是 still / live / waiting，**不单独标红失败** |

**期望：** 两层都能看见原因；不能把页失败画成整次运行成功，也不能因为 Home 点色没变就判定「失败没呈现」。

### TC-TSK-05 任务面板按钮可用性矩阵（P1）

| 控件 | idle | reading/writing/working | paused | awaiting-review | done | 备注 |
|---|---|---|---|---|---|---|
| Pause | 禁用 | 可用 | — | 可用 | 禁用 | **仅非 docx/xlsx** 渲染 |
| Resume | — | — | 可用 | — | — | 同上 |
| Finish | 可用 | 可用 | 可用 | 可用 | 禁用 | |
| Stop（Composer） | 无 | 非 Home 且空输入时变为 Stop | 同左 | 同左 | 无 | Home **永不** Stop |
| Apply / Undo | 有 suggestion 才出现；Undo 仅 `undoable` | | | | | |
| Retry | 不在任务面板 | | | | | 失败页 / Advanced Runtime 表 |

docx/xlsx 运行中看不到 Pause，这是实现而不是漏画。

---

## 12. 画布编辑器

### TC-CNV-01 Word 画布（P0）

打开 docx：工具栏、输入、保存、滚动。切到 English 后再看工具栏。

**期望：** 不是原始 i18n key（`toolbar.start`）。英文下 Writer **顶层选项卡与状态栏为真英文**（内置 11 条：`toolbar.start/insert/page/reference/review/view/help` + 4 个 statusbar）；其余命令显示为 key 的人性化形式（如 `Toolbar Font Bold`）——这是已知降级，不是 shell 回归。保存后 dirty 清除。

### TC-CNV-02 Excel 画布（P0）

打开 xlsx：网格铺满画布底部；短窗口是更少行，不是表变矮。骨架与空工作区要能区分。切成 English 后**表格 UI 应整体变英文**（sdk-sheet 有完整 `en-US`，不要用 Writer 的降级标准去套）。自动化（新 shell）：`e2e/fix-w5.spec.ts`（铺满，不断言语言）。语言即时性见 TC-CNV-06。

### TC-CNV-03 PPT 画布可写（P0）

打开空白或生成的 pptx，确认编辑权限。

**期望：** 不是「Editing is not permitted」除非任务就是只读预览。诊断入口（新 shell）：`e2e/editor-write-permission-real.spec.ts`。断言不要写死某一种错误文案。

### TC-CNV-04 三种类型的选区都能进 Composer（P1）

docx 选段落、xlsx 选单元格、pptx 从编辑器切回 Agent（窗口重新获得焦点）。

**期望：** 引用 chip 出现且类型对应。pptx 没有选区事件，靠失焦/回焦，工作时零轮询。

### TC-CNV-05 注意力光边（P2）

Agent 正在写时画布有注意力边；Reduced motion 打开则服从。没有段落级坐标时框整块画布，不要报错。

### TC-CNV-06 xlsx 打开时切语言（P1）

1. 打开 xlsx，设置里中文 ↔ English。
2. 观察表格 UI 是否立刻变。
3. 关掉标签再打开。

**期望（产品应达到）：** 要么即时切换，要么明确提示「关闭重开后生效」，不能静默不变。

**当前：** Sheet SDK 只在创建时定语言，`SheetCanvas` 无 locale 依赖。关掉重开才生效。是否约定 **待确认**；若定为约定，缺提示仍按缺陷记。

### TC-CNV-07 English 下三编辑器可读性矩阵（P1）

同一份 English 设置下打开三种文件：

| 编辑器 | 期望 |
|---|---|
| Excel | 工具栏/菜单整体英文（全量词典） |
| Writer | 顶层 11 条真英文，其余允许 humanized key（见 TC-CNV-01） |
| PPT | 按实测记录：整体英文 / 部分 key / 中英混排。不要套 Writer 的降级标准 |

---

## 13. 设置（九个分区）

齿轮打开**整页**设置，关掉回到原处，不拆掉打开的编辑器。`e2e/shell-settings-real.spec.ts` 覆盖的是**旧设置页**，新 shell 下列各条均需手工（几何类 fixture 除外）。

### TC-SET-01 Generation（P0）

默认文档类型：pptx / docx / xlsx / report / img；Enable images 开关。改完见 Auto-saved。没有「图片质量」控件（历史上就没画过，不要当缺失）。

### TC-SET-02 Notifications（P0）

开关存在 localStorage，不走后端。打开后 Test desktop notification 能弹出；关闭则测试按钮不可用。

### TC-SET-03 Appearance（P0）

中文 / English；Reduced motion；Enter sends。Reduced motion 必须在**同一挂载**里作用到轮播和注意力边，刷新前后一致。首启为 English，与系统无关。自动化（新 shell）：`e2e/fix-w2g.spec.ts`（motion / Enter）；中文渲染：`e2e/fix-w3j.spec.ts`。

### TC-SET-03b 打开文件时切换语言（P0）

docx / xlsx / pptx **各开一个文件，各切一次**中文 ↔ English。

| 类型 | 期望 |
|---|---|
| docx | iframe 随 locale 重载；shell 与 Writer 语言一致（Writer 英文降级见 TC-CNV-01） |
| pptx | iframe 随 locale 重载；shell 与 PPT 语言一致（PPT 实测见 TC-CNV-07） |
| xlsx | **不即时更新**，需关掉重开（见 TC-CNV-06） |

断言 shell chrome 与编辑器语言一致，不能只看设置页标签。

### TC-SET-03c 有未保存编辑时切换语言（P0）

1. 打开 docx，改几个字不保存。
2. Appearance 切语言。
3. pptx 再做一遍。

**期望：** 未保存编辑必须被保住，或先出未保存确认，**不能静默丢弃**。

**当前：** `WriterEditorFrame` / `PresentationEditorFrame` 的 iframe `src` 依赖 `[locale]`，切语言会重载且无 dirty 闸门。**按缺陷记。**

### TC-SET-03d 切语言后重启（P1）

1. 设为中文，完全退出再打开。
2. 再切回 English 重启。

**期望：** 语言保持；`<html lang>` 与 UI 一致。`e2e/fix-w3h.spec.ts` 只覆盖同挂载内切换，不覆盖重启。

### TC-SET-04 Connection（P1）

Jira：填 URL + token/basic，Test and save，15s 超时。Liquipedia：同样。清除连接。未配置时工作簿侧不应假装已连。

> 新 IA 里垂直连接器曾被标为延后；设置页已搬过来。连上之后「用 Jira 数据刷新工作簿」仍可能不在主路径，测连接本身与测数据刷新要分开记结果。

**凭据字段断言（与 TC-CMP-07 的 Provider 行为对照）：** secret 输入框**不得**回填已存 secret；空 secret 保存时应**保留**已存 secret 而不是清空。实现依据：`src/shell/settings/ConnectionSection.tsx:58`（secret 为独立 state，不从存储播种）、`:104-115`（空值的语义）。Provider 目前与此相反，见 TC-CMP-07。

### TC-SET-05 Subscription（P1）

兑换码自动大写、Enter 提交；空码报错；成功刷新余额。邀请码仅登录可见，可复制。

### TC-SET-06 Activity（P1）

有运行记录可点回对应文件夹；空态有说明。读取失败不得渲染成空态，见 TC-ERR-01。

### TC-ADV-01 Advanced（P0）

| 项 | 期望 |
|---|---|
| 图片水印 | 免费强制开且开关禁用；付费可关 |
| LLM Provider | **官方探测先出花费确认框**（会消耗额度）；自定义探测不弹该框。结果走 `formatProviderTestResult`（通过 HTTP / 通过 bridge / 网络错误 / 鉴权失败 / 未找到 / 上游失败 / 不可用 / 官方付费探测成败等，不要只断言三种）。未登录自定义 endpoint 跳账号页 |
| Proxy | 保存后下一发请求走代理 |
| Diagnostics | Export diagnostic logs → Exported |
| Runtime runs | 表能打开；**逐行 Cancel**（运行中）、**Retry**（failed/cancelled）、**历史显示切换**、**翻页 pageSize 8** 均可用。不是「打开不崩」就过 |
| Re-run onboarding | 再次出现引导，可跳过 |

### TC-SET-07 Reset（P1）

确认框在设置页之上；取消不改数据；确认后回到干净工作区。

### TC-SET-08 About（P0）

版本、检查更新、相关链接。版本与 DMG 文件名一致。

---

## 14. 账号与额度

### TC-ACC-01 登录（P0）

1. 打开账号页（全页遮罩，背后工作区不可见）。
2. 浏览器交接 → 回来。
3. 取消进行中的登录。
4. 登出。

**期望：** 成功以 `whoami` 为准，不是「浏览器已打开」；取消不把状态做成已登录；关掉账号页回到原处。凭证从不出现在这个页面。

### TC-ACC-02 账号页次要动作（P1）

awaiting 态：复制登录链接、在浏览器打开、Check status。failure 态：Try again。任意态：返回。

**期望：** 复制成功有反馈；打开用系统浏览器；Check status 以 `whoami` 刷新；Try again 重新走登录；返回关闭整页。

### TC-CRD-01 额度用尽（P0）

匿名额度用尽后发任务。

**期望：** 执行前拦截，说明要登录/充值；不能先跑再在中途失败成不明错误。

### TC-CRD-02 成功 / 失败 / 取消对余额（P1）

各跑一条短任务。对照 `docs/office-product-acceptance.md`：估算已有，真实扣费/退款仍需手工核对。

---

## 14b. 错误与离线

### TC-ERR-01 列表读取失败必须有错误态（P0）

构造 `folders.list` / `files.list` / `agent.list` 失败（断 bridge、权限、磁盘）。

**期望：** 用户能看见失败原因和下一步，不能与空工作区长得一样。

**当前：** `ShellContext.load` 不捕获；`useAgentTasks` 只打日志，band 消失；Settings Activity 失败会渲染成「没有运行记录」。**按缺陷记。**

### TC-ERR-02 生成中途断网（P1）

任务 running 时断网。

**期望：** 有可见的失败原因，且能取消或重试。当前只有逐动作 toast（`useAgentTask` 的 error/notice），无统一离线表面——若只有一条即消失的 toast、任务看起来仍在跑，按缺陷记。

---

## 15. 未实现能力的诚实提示（P2，但发版必抽）

点下列**实际存在的**控件必须出 notice，不能没反应：

| 位置 | feature | 今天真实能力 |
|---|---|---|
| 权限 Review / Custom | `composer.permission.*` | 只提示，默认仍是 full |
| Highlights 卡片 | `home-highlights` | 货架在，播放器不在 |
| 标签 ⋯ | `file-more-actions` | **仅**重命名 / 副本 / 置顶 / 移出库。导出、打印、版本历史**在新 shell 未提供入口**，不要去点不存在的项 |
| Pause | `agent.pause` | 仅非 docx/xlsx 渲染；pptx 才有 runtime |

闸门：`src/shell/test/deadControls.test.ts` 禁止无 handler 的 button。手工抽检是为了抓住「有 handler 但 handler 吞错」。

### TC-NBI-02 中文下未实现提示必须中文（P1）

把 Appearance 切到中文，再点 Review changes、Highlights 卡片、无 Speech API 时的麦克风。

**期望：** notice 标题与正文为中文。

**当前：** `reportPortFailure` / `notBuiltYet` 标题硬编码 `"Not built yet"`，`useAgentTask` 的 notice/error 标题为 `"Not built yet"` / `"The run stopped"`，Composer 听写与权限文案为英文。**按缺陷记。**

---

## 16. 打包、签名、换机（发版门禁）

对 `dist-artifacts/OfficeDex-<version>-darwin-<arch>.dmg` 与 `build/bin/OfficeDex.app`：

| ID | 检查 | 期望 |
|---|---|---|
| TC-PKG-01 | `codesign --verify --deep --strict` | valid + Designated Requirement |
| TC-PKG-02 | `spctl --assess` | `Notarized Developer ID`（只有 Developer ID 说明公证没生效） |
| TC-PKG-03 | `stapler validate` app + dmg | The validate action worked |
| TC-PKG-04 | 内嵌 node entitlements | allow-jit + allow-unsigned-executable-memory；无 Homebrew 依赖 |
| TC-PKG-05 | presentation 树里无第二份 node | `find` 无输出 |
| TC-PKG-06 | 只读 bundle Vite SSR | cacheDir 在 `/var/folders`，bundle 内无 `.vite` 写入，事后 codesign 仍过 |
| TC-PKG-07 | 架构 | officedex / officecli / mop-convert / node 均为目标 arch |
| TC-PKG-08 | 换机装机 | 见 TC-INS-01，并生成一次短 PPT |

一次性脚本：officedex-signed-build skill 的 `references/verify.sh`。

Windows：安装、生成、打开三件套、路径含空格与中文、杀软误报。作为 P1 对照，不在 mac 发版门禁里。

Finder 拖入 / 双击打开 / 文件关联：**不是验收用例**，见 `not-implemented.md`。

---

## 17. 兼容与契约（工程门禁，产品验收可抽）

| ID | 内容 | 命令 / 文件 | 入口 |
|---|---|---|---|
| TC-ENG-01 | 能力清单含 `office.modify`、pptx/docx/xlsx | `OFFICEDEX_E2E_COMPAT=1` → `e2e/compatibility-real.spec.ts` | 旧 UI |
| TC-ENG-02 | 画布 runtime 契约 | `e2e/canvas-runtime-contract-real.spec.ts` | 旧 UI |
| TC-ENG-03 | 产物预览、OS 打开、失败上报 | `e2e/artifacts-preview-real.spec.ts` | 旧 UI |
| TC-ENG-04 | Overlay 不被裁切（1280×720） | `e2e/gates.spec.ts` | 新 shell fixture（非 bridge） |
| TC-ENG-05 | 无死按钮 | `src/shell/test/deadControls.test.ts` | 单测 |
| TC-ENG-06 | 文案中英 ratchet | `src/shell/test/copyRatchet.test.ts` | 单测 |

---

## 18. P0 发版冒烟清单（可直接打勾）

环境：签名 DMG · 有额度账号 · **设置里中文 / English 各看一轮关键面**（不要用「系统语言」当变量）

- [ ] TC-INS-01 安装启动无 Gatekeeper 拦截
- [ ] TC-INS-02 Home 可交互，版本正确，**首启为 English**
- [ ] TC-SHL-01 模式切换
- [ ] TC-SHL-02 侧栏收起/展开
- [ ] TC-SHL-04 多标签切换/关闭
- [ ] TC-SHL-07 ⌘W / Ctrl+W
- [ ] TC-HOM-01 空态按钮可用
- [ ] TC-HOM-02 三种空白文档都能打开编辑器
- [ ] TC-FIL-01 打开本地 docx/xlsx/pptx
- [ ] TC-FIL-03 重命名、副本、置顶、移出库
- [ ] TC-FOL-01 文件夹新建/重命名/删除
- [ ] TC-CMP-01 发送任务有即时反馈（Home Composer **不变** Stop）
- [ ] TC-CMP-02 指定 Word 不会变成 PPT
- [ ] TC-PPT-02 Starting 立即出现（新 shell 手工）
- [ ] TC-PPT-01 完整生成并打开（可与下面错开）
- [ ] TC-PPT-06 取消生成（新 shell 手工）
- [ ] TC-PPT-07 失败可见可重试（新 shell 手工）
- [ ] TC-DOC-01 生成 Word 并打开
- [ ] TC-XLS-01 生成 Excel 并打开（新 shell 手工）
- [ ] TC-XLS-02 打开后再改，产物能打开
- [ ] TC-EDT-01 打开的 PPT 是改而不是重生
- [ ] TC-QST-01 问答不另开任务
- [ ] TC-ERR-01 列表失败不是空工作区（当前会失败，按缺陷记）
- [ ] TC-SET-03b 打开三件套时切语言
- [ ] TC-SET-03c 未保存时切语言不丢编辑（当前会失败，按缺陷记）
- [ ] TC-CNV-01/02/03 三件套画布可操作
- [ ] TC-SET-01/02/03 生成、通知、外观可保存
- [ ] TC-ADV-01 Provider **花费确认** + 导出诊断日志 + Runtime 表动作
- [ ] TC-ACC-01 登录/登出
- [ ] TC-CRD-01 额度用尽有拦截
- [ ] TC-UPD-01 强制更新闸门（开发态）
- [ ] TC-UPD-02 检查更新（新 shell 手工）
- [ ] TC-PKG-01～08 签名公证换机

---

## 19. 自动化对照（避免重复手工）

手工 P0 仍要跑装机和额度相关。**下表 spec 分两类入口。**

> **新 shell（`page.goto("/")`）** 且走真实 bridge 的，目前只有：`shell-canvas-real`、`shell-generation-real`、`shell-pptx-generation-real`、`shell-outline-gate-real`、`deck-edit-routing-real` 五个（另加诊断向的 `editor-write-permission-real`）。经 `preparePage()` 打开 `/legacy.html` 的 **不是发版界面**。凡 TC 只挂「旧 UI」的，新 shell 上必须手工补测。走 `legacy.html` 的 spec **禁止**标为覆盖新 shell。

**覆盖强度：** 「端到端」= 断言了产物或关键结果；「不崩 / 几何」= 只证明打开或布局。`shell-settings-real` 是单条巨型测试且旧 UI，不能当成九个分区都测过。

| 自动 spec | 入口 | 覆盖强度 | 覆盖的用例 |
|---|---|---|---|
| `e2e/shell-canvas-real.spec.ts` | 新 shell `/` | 端到端 | TC-FIL-01, TC-SHL-01 |
| `e2e/shell-generation-real.spec.ts` | 新 shell `/` | 端到端 | TC-CMP-01, TC-QST-01, TC-DOC-01 |
| `e2e/shell-pptx-generation-real.spec.ts` | 新 shell `/` | 端到端 | TC-PPT-01 |
| `e2e/shell-outline-gate-real.spec.ts` | 新 shell `/?planMode=1` | 端到端 | TC-PPT-03 |
| `e2e/deck-edit-routing-real.spec.ts` | 新 shell `/` | 端到端 | TC-EDT-01 |
| `e2e/editor-write-permission-real.spec.ts` | 新 shell `/` | 诊断 | TC-CNV-03 |
| `e2e/generation-real.spec.ts` | **旧 UI** `/legacy.html` | 端到端 | TC-PPT-01/06, TC-DOC-01, TC-PLN-01, TC-XLS-01, TC-RPT-01, TC-IMG-01（**新 shell 仍须手工**） |
| `e2e/shell-settings-real.spec.ts` | **旧 UI** `/legacy.html` | 巨型冒烟 | 旧设置页；**不覆盖**新 shell 整页设置 |
| `e2e/pptx-stage-real.spec.ts` | **旧 UI** `/legacy.html` | 端到端（不花额度） | TC-PPT-02/07（**新 shell 须手工**） |
| `e2e/artifacts-preview-real.spec.ts` | **旧 UI** `/legacy.html` | 端到端 | 预览 / 系统打开 / 失败上报（**新 shell 须手工**） |
| `e2e/canvas-runtime-contract-real.spec.ts` | **旧 UI** `/legacy.html` | 契约 | TC-ENG-02 |
| `e2e/compatibility-real.spec.ts` | **旧 UI** `/legacy.html` | 契约 | TC-ENG-01 |
| `e2e/tiktok-ops-ui-generation.spec.ts` | **旧 UI** `/legacy.html` | 专项 | 不挂本清单 P0 |
| `e2e/fix-w1a.spec.ts` | 新 shell fixture（非 bridge） | 几何 | TC-SHL-01 菜单不被裁切 |
| `e2e/fix-w1b.spec.ts` | 新 shell fixture（非 bridge） | 几何 | 审计修复回归 |
| `e2e/fix-w1c.spec.ts` | 新 shell fixture（非 bridge） | 键盘 | 对话框模态（非 TC-SHL-08） |
| `e2e/fix-w1d.spec.ts` | 新 shell `/?forceUpdate=` | 端到端 | TC-UPD-01 |
| `e2e/fix-w2e.spec.ts` | 新 shell fixture（非 bridge） | 几何 | 截断 / 省略号 |
| `e2e/fix-w2f.spec.ts` | 新 shell fixture（非 bridge） | 键盘/几何 | TC-SHL-04, TC-FIL-04 |
| `e2e/fix-w2g.spec.ts` | 新 shell fixture（非 bridge） | 端到端 | TC-CMP-03, TC-SET-03 |
| `e2e/fix-w3h.spec.ts` | 新 shell fixture（非 bridge） | 几何 | TC-SHL-06；同挂载切语言 |
| `e2e/fix-w3i.spec.ts` | 新 shell fixture（非 bridge） | 层叠 | z-index 回归 |
| `e2e/fix-w3j.spec.ts` | 新 shell fixture（非 bridge） | 端到端 | TC-SET-03：zh-CN 六区中文 + en-US 逐字节 + 中文长文案不溢出 |
| `e2e/fix-w5.spec.ts` | 新 shell fixture（非 bridge） | 几何 | TC-SHL-02, TC-HOM-01, TC-CNV-02 |
| `e2e/gates.spec.ts` | 新 shell fixture（非 bridge） | 几何门禁 | TC-ENG-04 |
| `e2e/ui-audit.spec.ts` | 新 shell fixture（非 bridge） | 冒烟 | 审计 harness |
| `e2e/ui-audit-s1.spec.ts` | 新 shell fixture（非 bridge） | 几何 | chrome |
| `e2e/ui-audit-s2.spec.ts` | 新 shell fixture（非 bridge） | 几何 | overlay；TC-CMP-07 几何 |
| `e2e/ui-audit-s3.spec.ts` | 新 shell fixture（非 bridge） | 几何 | TC-HOM-03, TC-FOL-03 |
| `e2e/ui-audit-s4.spec.ts` | 新 shell fixture（非 bridge） | 审计 | 多为 skip，不能当覆盖 |
| `e2e/ui-audit-s6.spec.ts` | 新 shell fixture（非 bridge） | 视口 | 窄窗 |
| `e2e/ui-audit-s7.spec.ts` 及 `s7-attention` / `s7-motion` / `s7-probe` | 新 shell fixture（非 bridge） | 审计 | motion / attention |
| `e2e/ui-audit-s8.spec.ts` | 新 shell fixture（非 bridge） | 审计 | 更新页等 |
| `e2e/slides-generating.spec.ts` | harness HTML | 视觉 | TC-PPT-04 |

真实生成会花额度。默认 `npm run test:e2e` 走 managed bridge；hosted PPTX/GIF 需显式环境变量。

---

## 20. 记缺陷时不要误报的已知边界

来自 `docs/not-implemented.md` 与验收矩阵，先对照再开「测试故障」：

1. Review / Custom 权限只提示，所有 run 都是直接写。
2. xlsx 格式化类编辑会被安静忽略。
3. xlsx 编辑产物是旁边的 `*.modified.xlsx`。
4. Apply 后已打开的编辑器可能要重新打开才显示新 bytes。
5. Undo 不跨重启，源文件被外部修改后不强行恢复。
6. 暂停/继续目前基本是 pptx 的；docx/xlsx 任务面板不渲染 Pause。
7. 无路径附件、结构化 mentions、段落级草稿高亮：notice 或安静降级。
8. Highlights 没有视频。
9. 协作分享未立项。版本历史、导出、打印在**新 shell 无入口**（不是点了没反应）。
10. 英文下 Writer 顶层选项卡与状态栏为真英文（11 条），其余为 humanized key（如 `Toolbar Font Bold`），不是「整栏仍是中文」。Excel 有完整英文，不要和 Writer 混为一谈。
11. Jira/Liquipedia 连接页在，用连接器驱动工作簿刷新不是当前主路径。
12. HTML App / 图片模板目录 / OfficeProduct 血缘刷新：代码或旧 UI 有残留，新 shell 不作为发版必过。
13. Home Composer 进行中不变 Stop，停止走任务面板 / 任务列表。
14. 首启语言恒英文，与系统语言无关。
15. macOS 不画自绘窗口按钮。
16. `AgentStatus` 没有 `failed`；Home 任务点色不单独标失败。
17. 无 Finder 拖入 / 文件关联 / 应用菜单栏 / 深链；无 `⌘S`/`⌘N`/`⌘,`；侧栏与 agent 列宽度不可拖；无多选 / 面包屑 / 文本搜索。这些**不要测成缺失按钮**。

下列是清单里已写成期望、当前实现不满足、**应当开缺陷**的：

- TC-SET-03c 切语言静默丢掉未保存编辑
- TC-ERR-01 列表读取失败与空工作区不可区分
- TC-NBI-02 中文 UI 下未实现提示仍是英文标题
- TC-CNV-06 若产品要求即时切换或至少有提示

---

## 21. 维护

- 新能力进 shell：**先在本清单加 TC，再挂 spec**。
- spec 若走 `legacy.html`，禁止在第 19 节标为覆盖新 shell。
- 从「未实现」变成已实现：改第 15 节和第 20 节，把诚实提示用例改成正向用例。
- 交互规则变了：先改 `docs/interaction-rules.md`，再改本清单里引用 R-* 的条目。
- 本清单描述的是**产品应测什么**；`e2e/` 描述的是**已经自动测了什么**。两者不一致时，以当前代码和 `not-implemented.md` 为准，然后回写本文件。
- 「期望」栏写的行为必须能在代码里找到依据；找不到就写成「待确认」或「按缺陷记」，不要凭旧版 UI 的印象写。
