# OfficeDex AI PPT：JSSDK 模板学习、自由构图与排版验收

更新时间：2026-09-14  
适用产品：OfficeDex  
合同：`jssdk-progressive/v2`

本文是 OfficeDex AI PPT 设计方法的产品侧记录，解决三个长期问题：加强模板 JSSDK 学习、增强自由构图、提高模板排版准确性。可执行约束位于 [`aippt-jssdk-design` Skill](../skills/aippt-jssdk-design/SKILL.md)，本文负责解释方法、责任边界和验收口径。

当前视觉基准、与外部 AI PPT 样例的差距及下一版路线图见 [`aippt-jssdk-visual-gap-report.md`](aippt-jssdk-visual-gap-report.md)。

## 核心结论

多样性不是 Skill 或生成代码单独完成的：

```text
用户意图
  -> Skill 判断生成模式与内容关系
  -> 来源证据提供可验证的视觉机制
  -> generation-plan 记录每页选择
  -> generated.mjs 实现具体几何与排版
  -> Host 导出、回读和渲染
  -> 程序检查 + 人眼视觉复核
  -> 可编辑 PPTX
```

- Skill 负责选择“用什么关系和视觉机制”。
- `generated.mjs` 负责决定“这一页具体怎么画”。
- 渲染验收负责判断“画出来是否真的成立”。
- `overflow=0` 只能证明文字没有越出自己的文本框，不能证明文本框属于正确组件，也不能证明页面排版准确。

## 三种生成模式

| 模式 | 适用请求 | 生成方式 | 核心验收 |
|---|---|---|---|
| `template_fidelity` | 按样张、模板或原页面准确复刻 | 蒸馏来源几何、锚点、字体和间距，再通过 JSSDK 参数化 | 来源图与最终 PNG 的主体位置、比例、层级和文字框准确 |
| `free_composition` | 自由构图、内容驱动、不要套模板 | Skill 选择视觉机制，每页用独立 drawer 重新构图 | 内容关系清楚，页面构图独立，没有伪多样性 |
| `hybrid` | 学习模板经验，但最终仍要自由构图 | 借鉴局部机制和排版逻辑，不复用整页模板 | 机制可识别，页面不模板化，容量与视觉节奏同时成立 |

用户说“结合模板机制但最终自由构图”时，默认使用 `hybrid`。

## 一、加强模板 JSSDK 学习

### 来源准入

模板不能只凭截图进入生成：

- 读取完整来源 MJS、facts、原始报告和结构树。
- 校验来源及报告 SHA-256。
- 原始 SSIM 必须严格大于 `0.95`。
- JSSDK 已执行，原生对象存在。
- 导出和严格回读通过。
- 完整文字检测和渲染检查通过。

来源通过只代表可以学习，不代表新内容生成后自动准确。

### 每页先建立 layout_spec

模板模式必须先记录下面这些信息，再写生成代码：

```json
{
  "generation_mode": "template_fidelity",
  "family": "timeline",
  "variant": "horizontal-axis",
  "canvas": { "width": 960, "height": 540 },
  "required_geometry": ["axis", "nodes", "labels", "connectors"],
  "anchors": ["title", "subtitle", "main_visual", "footer"],
  "text_slots": ["heading", "body", "caption"],
  "layout_rules": ["alignment", "gap", "padding", "z_order"],
  "capacity": { "items": 4, "density": "medium" }
}
```

`required_geometry` 必须在实际运行路径中由 helper 创建，并从原生对象树中核对。注释、未调用函数或外观近似都不算模板学习证据。

图表页面还必须声明 `visual_role=chart` 和数据来源。OfficeDex 侧先用 `normalizeVibeChart` 统一旧单系列输入，再用 `vibeChartToJssdkMatrix` 生成 `addChart` 所需的首行类别、首列系列名二维矩阵，同时用 `chartGenerationSpec` 记录 `chart_type`、`data_source`、`focal_point` 和 `content_budget`。节点通过结构化 `relation` 进入 `chartGenerationPlanToJson`，没有 relation 时保持 `other`，不从标题文本猜测语义。公共 JSSDK 现在已经提供受控的 `ShapeCollection.addChart` 最小入口（类型、矩阵、标题、图例和 transform），并已有最小导出/回读证据：作者态树为 `graphicFrame -> chartSpace`，PPTX 导出侧使用 converter 的 `chart`/`chartType`/`chartData` 别名，回导落盘时再归一化回编辑器使用的 `chartSpace`/`plotAreaChart`/`dataSource`。

这份证据只证明“原生作者入口和最小 PPTX 闭环已接通”，不代表图表配方已经通过完整类型回归、renderer、视觉抽查、数据语义和页面排版验收。当前图表页仍必须阻止生成或明确标记为待验收，不能用几何拼出假图表冒充可编辑图表。最小闭环的自动化证据位于 `presentation/tests/office-js-chart-authoring.test.mjs` 和 `presentation/tests/mop-converter-client.test.mjs`；扩展回归还覆盖 Office.js 图表、图片、目录编译和隐藏效果路径。

当前 `registry.json` 仍将 `chart` 置于 `blocked`。解除该状态必须晚于作者 API、`chartSpace` 严格回读、renderer、完整类型/数据回归和视觉抽查证据，不能为了让路由“看见图表”而先删掉门禁。

### 参数化边界

- 可以修改文本、条目数量、颜色角色，以及为内容容量进行的尺寸重算。
- 必须保留来源最关键的组件关系、层级、比例和对齐逻辑。
- 不能把圆环、轨道、分叉、票签或特殊轮廓统一改造成矩形加文本框。
- 模板容量不足时，先扩大文本空间、换同家族变体或按语义拆页，不能静默删字或一味缩小字体。

## 二、增强自由构图

### 机制是词汇，不是整页模板

自由构图可以学习以下机制，但要根据内容重新组织：

- `parallel`：并列、对照、平行栏目。
- `list`：清单、标签、编号条目。
- `timeline`：时间、顺序、节奏。
- `process`：阶段、动作链、循环。
- `organization`：中心、归属、分支。
- `pyramid`：层级、递进、优先级。

环形应表达中心与外围，分支应表达归属，时间轴应表达顺序，阶梯应表达递进。装饰不能暗示不存在的排名、因果或时间关系。

### Skill 与代码的责任

Skill 根据 `relation`、`items`、`density`、`visual_intent` 和 `history` 选择机制。生成计划至少记录：

- `generation_mode`
- `family` 与 `variant`
- `layout`
- `source_mechanism`
- `visual_intent`
- `required_geometry`

`generated.mjs` 应为每页提供独立 drawer 或明确的几何分支。同一机制可以跨页复用，但整页不能只靠平移、缩放、换颜色或随机扰动产生差异。

### 自由构图仍有规范

- 先保证全文、容量、层级、留白和阅读顺序，再追求非对称与视觉节奏。
- 相邻页面避免重复同一种主体结构。
- 多页 deck 的多样性按实际几何签名核对，不能只统计函数名或注册表条目。
- 页面数量较多时可以按 3~5 页分块执行，但每块必须从空白文档创建原生对象，最终通过 native slide bundle 组装，不能用 PNG 或 PDF 拼接。

## 三、提高模板排版准确性

排版验收分为四层，四层全部通过才能交付。

### 文字层

- 全文保留。
- 使用真实字体度量 `font_metrics`。
- `textLayoutCoverage.version=2`。
- `checked=textBodies=textLayout.length`。
- `skipped=[]`。
- 检查断行、行距、字号、字重、对齐和内边距。

### 几何层

- 所有文本和形状在画布范围内。
- 主体 bounding box、对齐线、间距和 z-order 正确。
- 检查文本与卡片、标题与轴线、节点与引线、中心文字与圆环之间的遮挡、断裂和错位。
- 模板模式对照来源图，先修主体位置与比例，再修字体和颜色。

### 语义层

- 标题、正文、编号和连接关系属于正确组件。
- 不允许正文跑出卡片、标题压住时间轴、中心文字逐字换行或引线连错节点。
- 即使检测器报告 `overflow=false`，上述情况仍然算 `layout_review_failed`。

### 视觉层

- 打开实际渲染 PNG，不以缩略图或 JSON 数值代替人眼检查。
- 至少检查封面、最密页面、浅色页、深色页、每类主要机制和所有修复页。
- 模板模式必须和来源图同页对照或透明叠加。
- 修复必须回到源码，然后重新执行、导出、严格回读和渲染；不能只手工修改最终 PPTX。

## 已知排版失败模式

以下问题来自真实 30 页回归，后续必须作为固定检查项：

- 卡片高度只按标题估算，正文下坠到卡片外。
- 标题和正文沿时间轴布置，压住轴线或节点。
- 中心节点文本框过窄，中文被逐字换行。
- 连接线穿过文字或未连接到目标组件。
- 文本框本身没有溢出，但已经超出所属卡片或视觉分区。
- 所有机器检查通过，但页面层级、留白和阅读顺序仍然失衡。

## 交付门槛

每次 OfficeDex AI PPT 生成至少交付：

- 独立 `generated.mjs`
- `generation-plan.json`
- `jssdk-evidence.json`
- `render-validation.json`
- 可编辑 PPTX

证据中必须记录生成模式、每页机制、实际 drawer、视觉抽查页、修复轮次和回退原因。模板模式还要记录 `layout_spec` 或 `anchor_spec`。

同时满足以下条件才能标记通过：

- JSSDK 执行通过。
- PPTX 导出和严格回读通过。
- 原生对象存在，不使用整页图片冒充可编辑页面。
- 渲染错误为 0。
- 文字溢出为 0。
- 四层排版验收通过。
- 模板模式完成来源对照；自由模式完成构图多样性检查。

## OfficeDex 内的实现位置

- 核心 Skill：[`skills/aippt-jssdk-design/SKILL.md`](../skills/aippt-jssdk-design/SKILL.md)
- 来源政策：[`skills/aippt-jssdk-design/policy.json`](../skills/aippt-jssdk-design/policy.json)
- 构图注册表：[`skills/aippt-jssdk-design/registry.json`](../skills/aippt-jssdk-design/registry.json)
- 渐进加载协议：[`skills/aippt-jssdk-design/references/progressive-loading.md`](../skills/aippt-jssdk-design/references/progressive-loading.md)
- JSSDK 执行器：[`presentation/tools/execute-jssdk.mjs`](../../presentation/tools/execute-jssdk.mjs)

这份文档是方法说明，Skill 是运行时约束，生成证据是每次任务是否真正遵守方法的事实记录。三者不能互相替代。
