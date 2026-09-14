                    ---
name: aippt-jssdk-design
description: 唯一 PPT 生成入口：在 template_fidelity、free_composition、hybrid 三种模式间按用户意图和内容关系渐进加载 SSIM 大于 0.95 且执行验证通过的 JSSDK 源码与配方，参数化生成独立 .mjs，由项目 Host 导出可编辑 PPTX；“结合模板机制但最终自由构图”默认走 hybrid。缺少合格来源证据或排版验收失败时阻止生成，禁止使用旧布局 Skill 或通用生成器回退。
---

# 用内容关系选择构图

## 最高优先级：三轨生成契约（必须先判断模式）

这套 Skill 同时服务三种目标，但三者的验收标准不同，不能混成“套模板”或“随机变体”：

| 模式 | Skill 的职责 | JSSDK 源码的职责 | 不合格表现 |
|---|---|---|---|
| `template_fidelity` 模板准确复刻 | 从来源证据提取 family、variant、required geometry、锚点和字体/间距规则 | 按来源的 API、层级、比例和位置参数化，保留可识别结构 | 只保留颜色/标题，把卡片、轨道、圆环、引线或间距改成通用列表 |
| `free_composition` 自由构图 | 用来源机制作为视觉词汇，根据 relation、items、density、history 选构图方向 | 每页独立 drawer，自行决定几何、层级、留白和文字落位 | 把一张模板平移 30 次，或用随机坐标/颜色扰动冒充多样性 |
| `hybrid` 机制融合（默认用于“结合”） | 学习模板的机制和排版逻辑，但不复用整页模板；按内容决定哪些机制值得保留 | 用独立 JSSDK 构图实现自由页面，必要时只复用局部机制 | 先套模板再把内容塞进去，导致标题、正文和主体结构互相挤压 |

**经验结论：** 多样性不是单独由 Skill 处理，也不是单独由代码处理。Skill 负责“选哪种关系和机制”，`generated.mjs` 负责“这一页具体怎么画”，渲染复核负责“画出来是否真的成立”。模板准确则反过来要求源码保留几何证据，不能只通过文字溢出检查来宣称准确。

### A. 模板 JSSDK 学习：先蒸馏，再实现

1. 选中来源后必须读取完整来源 MJS、事实文件、原始报告和哈希；不能只看缩略图或几条建议。
2. 为每页建立 `layout_spec`：画布比例、主体 bounding box、z-order、对齐线、引线/轨道路径、卡片内边距、标题/正文框、字号/行距、颜色角色，以及必须存在的 `required_geometry`。
3. 每个 `required_geometry` 必须在实际运行路径中由 helper 创建，并在执行后从原生对象树中核对；注释、未调用函数和“看起来像”都不算来源使用证据。
4. 新内容只能改变参数（文本、数量、颜色角色和必要的尺寸重算），不能把来源结构压扁成统一的圆点、矩形加文本框。
5. 模板复刻要做来源图与最终 PNG 的同页对照或透明叠加，先修主体位置、比例和间距，再修字体与颜色；SSIM、导出成功、原生形状存在三者都不能替代视觉准确性。

### B. 自由构图：机制借鉴，页面独立

1. 先从内容关系生成 brief，再选机制：parallel、list、timeline、process、organization、pyramid 等；不要先选一个“万能版式”。
2. 每页使用独立的 drawer 或明确的几何分支，记录 `layout`、`source_mechanism` 和 `visual_intent`；同一机制可以复用，但整页几何不能只靠平移或缩放产生差异。
3. 自由构图仍要保留内容关系的可读证据：环形表达中心/外围，分支表达归属，时间轴表达顺序，阶梯表达递进；装饰不能暗示不存在的排名、因果或时间。
4. 自由构图不等于放弃规范：先满足内容容量、文本完整、主体层级和留白，再追求非对称、错位和视觉节奏。
5. 长 deck 可按 3~5 页分块执行以规避 Host 事务限制，但每块必须从空白文稿生成原生对象，最后只能原生插入 slide bundle；禁止用 PNG/PDF/整页图片绕过 JSSDK。

### C. 模板排版准确：把“无溢出”升级为“可验收布局”

`textLayoutCoverage` 是必要条件，不是充分条件。每次生成必须同时完成以下四层检查：

1. **文字层**：全文保留；使用真实字体度量 `font_metrics`；`checked=textBodies=textLayout.length`、`skipped=[]`；检查断行、行距、字重、内边距和中文长句是否挤压主体。
2. **几何层**：检查每个文本/形状的画布边界、主体 bounding box、对齐线、间距和 z-order；检查文本与卡片边界、标题与轴线、节点与引线、中心文字与圆环是否重叠或断裂。
3. **语义层**：检查标题、正文、编号和连接关系是否仍落在对应组件内；不能出现“正文跑出卡片”“中心文字变成逐字竖排”“时间轴标题压住轴线”等问题，即使检测器报 `overflow=false` 也要返工。
4. **视觉层**：打开实际渲染 PNG，至少覆盖封面、最密页面、最浅/最深页面、每种主要机制和所有修复页；模板模式还要和来源图做对照。发现问题后修改源码并重新执行、导出、回导和渲染，不能只手工改 PPTX。

本轮暴露的典型失败模式已固化为回归清单：卡片高度只按标题估算、正文高度不足；标题/正文沿轴线排布造成重叠；中心节点文本框过窄导致中文逐字换行；机器检查通过但视觉层级已经失衡。以后遇到任一项，必须标记为 `layout_review_failed`，不得因为导出成功而交付。

交付证据应额外记录：`generation_mode`、每页 `layout/source_mechanism/visual_intent`、模板模式的 `anchor_spec` 或自由模式的独立 drawer、视觉抽查页、修复轮次，以及实际回退原因。没有这些记录时，不得把一次成稿提升为通用模板或宣称“已学会模板”。

### D. 图表：数据先于装饰，原生先于拟态

1. 当关系是 `trend`、`comparison`、`distribution`、`ranking` 或 `part-to-whole`，且输入包含可核对数据时，先把页面规划为 `visual_role=chart`；不要把训练集中的图表降级成列表或几何拼图。
2. 图表必须携带 `data_source`（附件、表格或手工输入）和 `focal_point`。没有来源的数据只能标记 `illustrative=true`，并在页面上明确“示意”，不能写成业务事实。
3. 生成源码使用公共 JSSDK 的 `slide.shapes.addChart({ chartType, data, title, legendVisible, legendPosition, ... })`，返回对象必须是 `ShapeType.chart`；禁止用矩形、线段或整页 PNG 冒充可编辑图表。
4. 首版优先使用 `column`、`bar`、`line`、`area`、`pie`、`donut`、`radar`、`scatter`。组合图、堆积、双轴和数据标签必须等对应 schema、回读和渲染证据通过后再进入配方。
5. 图表是自由构图中的主视觉锚点，可以和 KPI、结论卡、注释、图片组合；图表位置、尺寸和图例由内容容量与视觉意图决定，不把图表固定成所有页面的同一右侧卡片。
6. 当前 registry 仍将 `chart` 置于 `blocked`。在 `addChart` API、PPTX 严格回读、原生 renderer 和至少四张代表页视觉抽查完成前，命中图表页必须返回 `needs_capability_review`，不能静默回退到假图表。

## 必须遵守的来源合同

`policy.json` 的合同为 `jssdk-progressive/v2`。用户指定的 Skill 来源门槛是 **原始 SSIM > 0.95**（等于 0.95 不纳入），同时要求 JSSDK 已执行、原生对象存在、无文字溢出或渲染错误、图像尺寸一致、导出和严格回导通过，源码及原始报告 SHA-256 匹配。

合格来源标为 `high_similarity_verified`，可以立即用于蒸馏和生成。原报告针对 0.999 的 `comparison.passed=false`、`exactSolution=false` 不再阻止纳入；保留这些原始结论，不把来源称为逐像素精确复刻。SSIM 是来源重建证据，新内容是否美观仍需渲染检查。

文字检查须有 `textLayoutCoverage.version=2`、`measurement=font_metrics`，`checked=textBodies=textLayout.length` 且 `skipped=[]`。旧检测器只遍历顶层对象，会漏查组合内文字；旧报告的零溢出不能直接沿用，必须补跑完整检测。验收走实际字体度量的 print 渲染路径，不用缩略图的半字号字宽估算。`generation_ready=false` 的配方保留供修复，不参加选版。

命中家族后必须加载源码及报告，保留其 API 调用方式、组件关系和构图机制，再按新内容参数化。不能只读几条建议后自由绘制。缺少合格来源时返回 `needs_source_evidence` 并停止该页生成；封面、结尾页、容量冲突也不能绕过。禁止调用已退役的 `aippt-list4-layout`、`presentation-pptx-quality` 或切回 `mop-skill`。

主要产物是本次新写、独立的 `generated.mjs`，导出 `build(PowerPoint, data, runtime)`。参考 PPTX、图片及重建代码只读；从空白文档通过本项目公开 JSSDK 创建原生对象，再用既有 typed MOP converter 导出。不要修改源 PPTX、拼接 OOXML、直接写 MOP 或用整页图片替代可编辑内容。

## 按需加载

当前渐进式目录已经包含新一轮来源证据和 38 个可用实验配方。目录不是把所有样张压成一个模板：路由先按关系、项目数和密度选家族，再只加载命中的来源源码、结构树和报告。`generation_ready=false`、待语义审查、待复验或存在编译缺口的来源，即使已经完成结构提取，也不能进入生成。

Host 编译器覆盖形状目录中的 159 种原生预设，并保留 `setHiddenEffects` 的关闭效果。文字验收必须走组合树完整遍历和实际字体度量；大批量来源的失败、超时和底层资源限制进入独立恢复队列，不能通过降低 SSIM 或跳过文字检查解决。

先识别受众、主要信息、必须保留的全文、品牌与页数约束；再判断关系和每项文字量。路由输入是模型归纳的结构化 brief，脚本本身不理解自然语言。

```bash
node scripts/select-family.mjs \
  '{"relation":"timeline","items":5,"density":"medium"}' --out generation-plan.json
```

- L0：入口、来源合同和路由索引。OfficeDex 包使用同目录 `registry.json`，不依赖用户目录；本地安装版可用 `AIPPT_WORKSPACE` 指定源仓库。
- L1：只读结果 `load_paths` 中的当前家族配方及变体；不预加载全部候选池。可用家族、变体和容量以 registry.json 为准；visual_catalog 是轻量候选摘要，不是全部源码。
- L2：选中后必须读取 `source_evidence` 的事实、来源 MJS 和报告，校验哈希与验收状态。只加载当前变体的少量源码，图片按视觉核对需要加载。
- 包内可用 `node scripts/read-source.mjs <所选 facts.json>` 读取验证后的源码视图：保留 API、对象尺寸与样式，省略冗长装饰路径/导引公式表。视图明确标为不可执行的源码摘录；原始完整 MJS 和报告仍参与哈希校验，不把摘要当作整页模板。
- L3：生成后检查执行、渲染和回导报告，失败时回读对应规则。

遇到未知关系、容量冲突、草案家族或能力待查状态，按 [加载协议](references/progressive-loading.md) 处理。只有 `status=selected` 且来源证据校验通过才能生成；其他状态都要先解决缺口，不能自由排版或统一套列表。

## 编写与验证

读取 [原生 SDK 合同](references/native-sdk.md) 获取本地 Host、字体、文字测量和执行方法。先查本地实现再用未验证 API；能力清单只是证据快照，缺配方不等于 SDK 永久不支持。

整份 PPT 用 `select-family.mjs` 输入 brief 数组选版；先满足内容关系和容量，再比较视觉意图、全稿使用次数与相邻重复。单页可传 `visual_intent` 标签与已选 `history`，或明确指定已验证 `variant`。只有一个合适构图时允许重复，不歪曲语义凑多样性。

保留所选来源的可识别 UI：票签的层叠轮廓、圆环的主体与引线、图标色块、六边形编号、分叉关系等。不能把不同来源都压成同一种圆点加文本框。统一字体与配色不等于所有页统一分区。

选版中的 required_geometry 是必须保留的主体组件；每一项都必须通过 helper 创建到指定页。运行时逐页比较实际原生路径，注释或未调用函数不能充当来源使用证据。

复杂原生轮廓可以使用 `jssdkSourceGeometry("所选来源ID", "sN")`；其完整路径从哈希验证后的来源展开到最终独立 MJS。OfficeCLI 自动展开；直接编写时用 [原生 SDK 合同](references/native-sdk.md) 中的展开脚本。不得自行实现占位 helper 或省略轮廓。

用所选机制重新计算分区、对齐、留白、字号和颜色角色。它们是构图起点，不是固定坐标模板。可融合少量相关机制；不要用随机坐标/颜色扰动冒充变体，也不要让装饰暗示不存在的权重、排名、时间或因果。

保留全文；文字容量不够时先增加文本空间、换同家族变体或按语义拆页，遵守用户页数约束。测量使用实际框、字体、内边距和行距；最终以原生渲染为准。中文长文的显式换行只改变断行，不得删字、缩写或静默缩字。

执行新 MJS 并打开 PNG 检查视觉。检查文字完整性、溢出、遮挡、画布边界和原生结构；导出和回导文本另行检查。修复后再次执行。高 SSIM、导出成功、原生形状存在各有范围，不能等同审美或 Office 真机编辑验收。

交付 `generated.mjs`、`generation-plan.json`、`jssdk-evidence.json`、`render-validation.json`；PNG、PPTX 和回导结果为派生产物。记录 family、variant、参数、来源证据、输入摘要及实际回退。未经新内容与视觉评测的配方保持实验状态；不将单次成稿自动升级为通用规则，不声称完成模型训练。
