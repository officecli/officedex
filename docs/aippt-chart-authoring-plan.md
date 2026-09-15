# OfficeDex AI PPT 图表作者能力计划

更新时间：2026-09-14  
适用产品：OfficeDex  
状态：Phase 1 作者闭环已完成；首批 4 个自由/hybrid chart drawer 已实现并完成 renderer/export/readback smoke；训练集证据索引已接入，正式 Skill 放行仍待来源证据与完整视觉验收

## 目标

让训练集中的图表真正进入 AI PPT 生成链路：Skill 能识别图表任务，OfficeDex 能表达图表数据，公共 JSSDK 能创建原生可编辑图表，Host 能写入/回读/渲染 `chartSpace`，最终自由构图 drawer 能把图表作为主视觉而不是矩形占位。

这条计划与 [`aippt-jssdk-design-method.md`](aippt-jssdk-design-method.md) 和 [`aippt-jssdk-visual-gap-report.md`](aippt-jssdk-visual-gap-report.md) 配套。方法文档定义原则，本计划定义实现顺序和门禁。

## Chart 专项执行计划

### 0. 本轮边界

这次处理的不是“把图表画出来”这一件事，而是打通下面的完整链路：

```text
表格/附件/用户输入
  -> 图表语义规范化
  -> generation-plan 选择 visual_role=chart
  -> hybrid/free drawer 选择图表构图
  -> JSSDK 创建原生 chart
  -> MOP Host 写入 chartSpace
  -> PPTX 导出与严格回读
  -> renderer + 视觉验收
  -> 可编辑 PPTX
```

以下内容明确不做：

- 不用矩形、线段、SVG 或整页 PNG 冒充可编辑图表。
- 不因为 `chart` 已经有底层 API 就直接解除 Skill registry 的 blocked。
- 不一次性承诺股票、三维、组合、双轴等所有训练集类型。
- 不把 illustrative 数据写成没有来源的业务结论。

### 1. 当前基线

已完成：

- JSSDK `ShapeCollection.addChart()` 最小入口。
- MOP Host 和 Memory Host 原生图表写入。
- 基础图表类型、标题、图例、数据矩阵和 transform。
- PPTX 导出、严格回读和 renderer smoke。
- `VibeChart` 多系列模型与旧格式规范化。
- `task.vibe_tree` 保留图表数据。

尚未放行：

- Skill 自动路由到 chart。
- 组合图、堆积图、双轴和数据标签的完整语义。
- 4 张代表页的自由/hybrid 视觉验收。
- TikTok 全稿图表回归。

### 2. P0：冻结图表语义契约

目标：任何上游输入在进入 JSSDK 前，都变成同一个可验证的中立模型。

代码落点：

- `officedex/src/shared/types.ts`
- `officedex/src/shared/chartModel.ts`
- `officedex/src/renderer/taskState.ts`

任务：

- [x] 旧 `categories + values` 兼容转换为 `series[]`。
- [x] 校验 categories 与每个 series 长度一致。
- [x] 拒绝空数组、非有限数值和无法识别的 series。
- [x] 保留 `source.kind/ref` 与 `illustrative` 标记。
- [ ] 明确 `manual`、`table`、`attached_file`、`illustrative` 四种来源的生成文案约束。
- [ ] 增加 `combo`、`stacked`、`secondary axis`、`dataLabels` 的 schema 级校验。

完成条件：

- 同一份图表输入在前端、generation-plan 和生成脚本中都不再需要猜字段。
- 缺失来源或 illustrative 数据会进入证据文件，并在页面上有明确标识。

### 3. P1：接通数据来源和 generation-plan

目标：图表不是孤立对象，要从表格/附件/故事节点进入页面计划。

已完成：

- [x] `VibeChart` 可转换为 JSSDK `addChart` 矩阵，见 `vibeChartToJssdkMatrix`。
- [x] 可生成页面级 `chart_spec`，见 `chartGenerationSpec`。

任务：

- [x] 从 `VibeProjectTreeNode.chart` 生成 `chart_spec` 和 `chart_matrix`，见 `chartGenerationPlanForTree`。
- [x] 节点可携带结构化 `relation`，无需调用方重复维护 relation map；缺失时保持 `other`，不从自然语言猜测。
- [ ] 生成以下字段：

```json
{
  "visual_role": "chart",
  "chart_type": "line",
  "data_source": { "kind": "table", "ref": "sheet1!A1:C5" },
  "focal_point": { "kind": "chart", "area": "right", "weight": 0.62 },
  "content_budget": {
    "title_chars": 18,
    "categories": 6,
    "series": 2,
    "annotation_lines": 3
  },
  "illustrative": false
}
```

- [ ] 在 plan 中区分 `chart` 主视觉、`chart_supporting` 辅助视觉和 `metric_only` 指标卡。
- [ ] 记录图表来源、单位、时间范围、是否允许推断结论。
- [ ] 没有足够数据时返回 `needs_data`，不能自动生成精确数字。

完成条件：

- 每一张图表页都能从 plan 追溯到数据源和页面意图。
- 生成脚本不直接读取自然语言猜测图表类型。

recipe 输入最小形态：

```json
{
  "visual_role": "chart",
  "chart_spec": {
    "chart_type": "line",
    "data_source": { "kind": "table", "ref": "sheet1!A1:D2" },
    "focal_point": { "kind": "chart", "area": "right", "weight": 0.62 },
    "content_budget": {
      "title_chars": 6,
      "categories": 3,
      "series": 1,
      "annotation_lines": 3
    },
    "illustrative": false
  },
  "chart_matrix": [
    ["", "一月", "二月", "三月"],
    ["播放量", 120, 180, 240]
  ]
}
```

### 4. P2：扩展 JSSDK 原生作者能力

目标：优先覆盖高频、可编辑、能稳定导出的类型。

实施顺序：

1. `column/bar`：比较、排名、分组和堆积。
2. `line/area`：趋势、时间序列和变化。
3. `donut/pie`：占比，限制类别数量和标签密度。
4. `combo` + secondary axis：只有基础三类稳定后再开放。

任务：

- [x] 基础 chart factory 复用 `@learnof/chart`。
- [x] `graphicFrame -> chartSpace` 原生对象树。
- [x] 基础导出/回读/渲染 smoke。
- [ ] 将 `VibeChart.series[]` 转成 JSSDK 矩阵。
- [ ] 支持 `stacked`、`showValueLabels`、axis label 和 series axis。
- [ ] 为 combo/secondary axis 增加独立 export/readback fixture。
- [ ] 对每种类型保存原生结构断言，不只检查 SVG 存在。

完成条件：

- 数据、类别、系列名称、单位、图例、标题和 transform 可从 PPTX 回读。
- renderer 不报错，且图表不是整页图片。

### 5. P3：建立 Skill 图表路由和 recipe

目标：让 Skill 在内容关系正确时主动选择图表，而不是所有页面默认卡片化。

路由规则：

| 内容关系 | 首选图表 | 允许的降级 |
|---|---|---|
| `trend` / 时间序列 | line / area | timeline |
| `comparison` / 排名 | column / bar | parallel |
| `distribution` / 占比 | donut / pie | metric cards |
| `correlation` | scatter | two-column analysis |
| 双指标且量纲不同 | combo + secondary axis | 双栏 KPI |

任务：

- [ ] 增加 `data_dashboard`、`chart_analysis`、`chart_comparison`、`chart_trend` recipe。
- [ ] recipe 必须声明 `visual_role=chart`、`required_geometry`、数据容量和图例规则。
- [ ] 每个 recipe 都要有独立 drawer；不能将已有卡片模板平移改色。
- [ ] source evidence、MJS、facts、report 和 hash 必须完整加载。
- [ ] 没有合格来源证据时返回 `needs_source_evidence`。
- [ ] registry 的 `chart` 继续保持 blocked，直到 P4 完成。

第一批 recipe：

1. `kpi-plus-column`
2. `trend-line-with-takeaway`
3. `share-donut-with-callouts`
4. `dual-panel-chart-analysis`

### 6. P4：自由/hybrid 图表构图和视觉验收

目标：图表成为页面主视觉，不退化成“图表旁边堆几张卡片”。

每张页面必须记录：

- `generation_mode`
- `family`
- `layout`
- `source_mechanism`
- `visual_intent`
- `visual_role`
- `focal_point`
- `asset_plan`
- `content_budget`

视觉规则：

- 图表面积必须与 `focal_point.weight` 一致。
- 标题、图表、结论和注释要有明确阅读顺序。
- 图例、刻度、标签不能挤压主体图形。
- 图表旁的结论必须来自数据，不得暗示不存在的因果或排名。
- 图表与图片/插画 hybrid 时，两者都保持原生可编辑。

首批 4 张验收页：

1. 轻色 KPI + 柱状图。
2. 深色趋势折线图。
3. 占比环图 + 外部引线结论。
4. 双栏图表分析页。

每页必须完成：

- [ ] 执行成功。
- [ ] PPTX 导出成功。
- [ ] 严格回读成功。
- [ ] renderer 错误为 0。
- [ ] text layout coverage 完整。
- [ ] `focal_area`、`semantic_ownership`、`whitespace_balance` 通过。
- [ ] PNG 人工抽查通过。

### 7. P5：回归、放行和产品接入

放行顺序：

1. 基础 chart API 回归通过。
2. 4 张代表页视觉验收通过。
3. 44 组 chart fixture 至少覆盖第一批 recipe 的类型和数据语义。
4. TikTok 8～10 张代表页通过。
5. 才允许将 registry 的 `chart` 从 blocked 改为可选 recipe。

持续回归：

- [ ] 保留 chart authoring、MOP、Memory、converter、renderer 测试。
- [ ] 增加组合图/双轴 fixture。
- [ ] 增加 illustrative 数据的标记检查。
- [ ] 增加图表重生成和数据更新后的回读测试。
- [ ] 记录每次 recipe 的视觉修复轮次和失败原因。

## Chart Definition of Done

只有全部条件满足，chart 才能从实验能力变成 Skill 可选能力：

- `VibeChart` 语义完整并可追溯数据源。
- JSSDK 创建的是原生 `chartSpace`，不是绘图占位。
- PPTX 导出和严格回读通过。
- 基础类型、组合/堆积/双轴的能力边界有明确记录。
- 至少 4 张 hybrid/free 页面通过人工视觉验收。
- 文字、几何、语义、视觉四层检查全部通过。
- registry recipe 有来源证据、源码、facts、report 和 hash。
- 失败时有 `needs_data`、`needs_source_evidence` 或 `layout_review_failed`，不会静默降级为假图表。

## 产物清单

- `officedex/src/shared/chartModel.ts`
- `officedex/src/shared/types.ts`
- `officedex/docs/aippt-chart-authoring-plan.md`
- `generation-plan.json`
- `jssdk-evidence.json`
- `render-validation.json`
- 图表代表页 `generated.mjs`
- 原生 PPTX、严格回读包和渲染 PNG/SVG

## 当前事实

- 训练/回归资产中已有 44 组 `chart-*` fixture，覆盖柱状、条形、折线、面积、饼/环、雷达、散点、组合、双轴及部分股票/三维图表。
- `@learnof/chart` 已有数据模型、布局、SVG 图元、绘制、序列化和编辑会话。
- MOP `ChartController` 已能插入图表、写入数据、调整标题/图例/坐标轴/数据标签和样式。
- 公共 JSSDK `ShapeCollection` 已补上受控的 `addChart` 最小入口，并已有导出、严格回读和 renderer smoke 证据；完整视觉抽查完成前，Skill 仍不能把它视为正式图表配方。
- `VibeChart` 已扩展为多 series、来源、图例/数据标签语义，并提供旧 `categories + values` 到 `series[]` 的规范化入口。
- Skill registry 仍把 `chart` 放在 `blocked`；在作者能力和证据完成前不能直接移除。

## 分阶段计划

### Phase 0：契约和样例冻结

状态：完成

- [x] 在产品方法文档中明确 Skill、JSSDK、渲染验收的责任边界。
- [x] 记录 Cheso/外部样例的图表页面家族和视觉差距。
- [x] 确认现有 44 组 chart fixture 和公共图表包是复用基础。
- [x] 明确禁止用原生矩形拼图表冒充可编辑图表。

### Phase 1：公共 JSSDK 原生图表最小闭环

状态：作者、导出、严格回读和 renderer smoke 完成；视觉抽查待完成

目标：一页生成一个原生 `graphicFrame -> chartSpace`，数据可写入，导出后能严格回读并被原生 renderer 识别。

- [x] 增加 `ChartAddOptions` 和 `ShapeCollection.addChart()`。
- [x] 将公共图表内核的 chart block factory 暴露给 MOP Host，避免 Host 重新手写一套 chart XML/MOP 结构。
- [x] MOP Host 支持 `addChart`：位置、大小、类型、矩阵数据、标题和图例。
- [x] Memory Host 支持同一 API，保证 Office.js 兼容层单测可覆盖。
- [x] 为 `column`、`bar`、`line`、`area`、`pie`、`donut`、`radar`、`scatter` 建立最小类型回读断言。
- [x] 增加 JSSDK/MOP 测试：对象类型、数据点、标题、图例和 transform。
- [x] 补齐基础 column 图表的 PPTX 导出、严格回读和 chart renderer smoke。
- [ ] 完成至少 4 张图表代表页的人工视觉验收，再解除 registry 的 `chart` blocked。

### Phase 2：OfficeDex 图表语义模型

状态：第一步完成，组合/双轴和 generation-plan 接入待完成

将 `VibeChart` 从单系列简化模型扩展为可承接训练集的中立模型：

```ts
interface VibeChart {
  type: "column" | "bar" | "line" | "area" | "pie" | "donut" | "radar" | "scatter" | "combo";
  title?: string;
  categories?: string[];
  series: Array<{
    name: string;
    values: number[];
    color?: string;
    axis?: "primary" | "secondary";
  }>;
  options?: {
    stacked?: boolean;
    markers?: boolean;
    smooth?: boolean;
    legend?: "none" | "top" | "bottom" | "left" | "right";
    dataLabels?: "none" | "value" | "percent";
  };
  source?: { kind: "attached_file" | "table" | "manual" | "illustrative"; ref?: string };
}
```

- [x] 保留旧 `values` 输入的兼容适配，但内部统一成 `series[]`。
- [x] 校验类别与各 series 的长度一致，拒绝非有限数值。
- [x] 规范化 `legend`、`dataLabels`、`source` 和 `illustrative` 语义。
- [ ] 明确真实数据和 illustrative 数据的标记；没有来源时不生成看似精确的业务结论。
- [ ] 增加组合图、堆积图、双轴和数据标签的完整 schema 校验。
- [x] 提供 outline/story → generation-plan 的共享适配器和 snake_case JSON 边界，见 `chartGenerationPlanToJson`。
- [ ] 将该共享适配器接入实际 OfficeCLI/Skill bridge；当前仍由外部运行时消费 plan。

### Phase 3：Skill 路由和图表配方

状态：首批实验配方已落地；仍不进入正式 registry 路由

- [ ] 增加 `data_dashboard`、`chart_analysis`、`chart_comparison`、`chart_trend` 页面家族。
- [ ] `relation=comparison/trend/distribution` 时优先选择图表，而不是默认 `list`/`parallel`。
- [ ] 页面 plan 必须记录 `visual_role=chart`、`chart_type`、`data_source`、`focal_point` 和 `content_budget`。
- [x] 已补齐 4 个实验 drawer：KPI + 柱图、趋势折线、占比环图、双栏图表分析。
- [x] 四个 drawer 都从空白文稿创建原生图表，并通过统一执行、渲染、PPTX 导出和严格回读测试，见 `presentation/tests/office-js-chart-recipe.test.mjs`。
- [x] 四个 drawer 都完成首轮 PNG 视觉抽查；已修复文本框主题填充污染、环图中心标签偏移等问题。
- [x] 已增加结构化 plan → 实验 drawer 路由桥，见 `src/shared/chartRecipeRouting.ts`；路由只读取 `relation` 和规范化容量，不从标题文本猜图表关系。
- [x] snake_case plan 已输出 `recipe_route`（`recipe_id`、`module_path`、`generation_ready=false`、阻断原因），供 OfficeCLI/Skill bridge 消费。
- [x] 已输出 `recipe_evidence`（训练集来源路径、证据状态、缺口和原因），见 `src/shared/chartRecipeEvidence.ts`；训练集素材只作为候选引用，不会伪装成 `high_similarity_verified`。
- [x] 已输出 `generation_gate`（`allowed=false/status=blocked/reason`），正式 Skill 生成必须读取该门禁；实验 drawer 通过 smoke 不等于可进入正式 registry。
- [x] 已将四个候选来源固化到 `skills/aippt-jssdk-design/chart/evidence-inventory.json`，作为后续 facts/report/SSIM/视觉复核的统一入口。
- [x] 已为每个候选来源绑定按 `source_paths` 对齐的 `source_digests`，PPTX、预览 PNG 和组合图双来源都具备 SHA-256 身份绑定。
- [x] 已为趋势折线图建立第一份独立 reconstruction、facts 和 verification report；当前 rawSsim=0.9105，低于 `0.95`，因此仍明确保持 `needs_source_evidence`，没有误放行。
- [x] 已增加 `skills/aippt-jssdk-design/chart/validate-evidence-inventory.mjs`，用于校验候选来源路径存在、状态仍为 `needs_source_evidence`，防止训练集候选被误当作可正式生成配方。
- [x] 已增加 `skills/aippt-jssdk-design/chart/verify-experimental-recipes.mjs` 和 `npm run verify:chart:experimental`，可生成四个实验 recipe 的持久化 MOP/SVG/PPTX/回导报告；该报告只证明实验 drawer 可编辑、可渲染、可回导，不作为 registry 放行证据。
- [ ] 从 44 组 fixture 中挑选覆盖上述家族的来源证据，形成 recipe；不把整页样图当作不可编辑背景。
- [ ] 只有 Phase 1/2 的证据通过后，才从 `registry.json.blocked` 移除 `chart`。

当前实验 drawer（均为 `generation_ready=false`）：

- `skills/aippt-jssdk-design/chart/experimental/trend-line-with-takeaway.mjs`
- `skills/aippt-jssdk-design/chart/experimental/kpi-plus-column.mjs`
- `skills/aippt-jssdk-design/chart/experimental/share-donut-with-callouts.mjs`
- `skills/aippt-jssdk-design/chart/experimental/dual-panel-chart-analysis.mjs`

当前四个配方的训练集候选已登记，但 `recipe_evidence.status=needs_source_evidence` 且 `generation_gate.allowed=false`。下一步必须为每个候选补齐独立 JSSDK reconstruction、`facts.json`、验证报告、`rawSsim > 0.95`、完整文字覆盖和人工视觉复核，之后才能进入 registry。每次调整候选来源后先运行：

```bash
node skills/aippt-jssdk-design/chart/validate-evidence-inventory.mjs
npm run verify:chart:evidence
npm run verify:chart:experimental
```

历史 `plans/aippt-jssdk-skill-strategy/batches/chart/progress.json` 中的 blocker 是公开 Chart JSSDK 缺失；当前 `addChart`、导出、严格回读和 renderer smoke 已完成，因此旧 blocker 已过期。新的 blocker 是每个 chart 来源还没有独立 reconstruction、SSIM 报告、facts 摘要和四层视觉验收，不能把训练集 PPTX/PNG 直接升格为 `high_similarity_verified`。

### Phase 4：图表视觉系统和自由构图

状态：待开始

- [ ] 把图表作为主视觉锚点，支持图表与结论卡、图片、注释、标记线的组合。
- [ ] 建立家族级字体、网格、颜色、轴线、图例、标签和留白 token。
- [ ] 根据内容密度自动决定横向/纵向、图例位置、标签是否显示和是否拆页。
- [ ] 支持图表与图片/插画的 hybrid 页面，但保持图表数据和文本原生可编辑。
- [ ] 先重做 TikTok 8～10 张代表页，再扩展到全稿。

### Phase 5：产品体验和持续回归

状态：待开始

- [ ] 在 OfficeDex 中展示“资料/表格 → 图表建议 → 4 张试稿 → 全量生成”。
- [ ] 支持逐页图表重生成、复制页对比、数据更新后刷新图表。
- [ ] 将 chart data、模板 recipe、证据和最终 PPTX 放入项目文件树。
- [ ] CI 保留 chart fixture、JSSDK、PPTX 导出、严格回读和渲染门禁。

## Phase 1 API 草案

公共 JSSDK 初版只解决创建和首屏可编辑，不在第一步把所有 Chart Design 属性暴露给生成器：

```ts
const chart = slide.shapes.addChart({
  chartType: "column",
  data: [
    ["", "一月", "二月", "三月"],
    ["播放量", 120, 180, 240],
    ["互动量", 42, 66, 91],
  ],
  title: "内容表现趋势",
  legendVisible: true,
  legendPosition: "bottom",
  left: 420,
  top: 120,
  width: 460,
  height: 280,
});
```

初版门禁：

- `chartType` 必须是公共内核支持的类型。
- `data` 必须是有限行列矩阵；空数据不能静默生成假图表。
- 返回对象必须是 `ShapeType.chart`，MOP 树必须是 `graphicFrame -> chartSpace`。
- 导出 PPTX 后 chart type、series、categories、values、title、legend 和 transform 可回读。
- 页面渲染中必须出现 chart SVG，不得退化为一张整页图片。

## 验收矩阵

| 层级 | Phase 1 验收 |
|---|---|
| API | Office.js 兼容层可调用 `addChart`，参数错误有明确异常 |
| 结构 | `graphicFrame -> chartSpace -> plotArea/chartSeries/chartAxis` 结构完整 |
| 数据 | 多系列、类别、数值、标题和图例位置写入正确 |
| 导出 | PPTX 导出、严格回读和原生 chart 识别通过 |
| 渲染 | chart renderer 无错误，坐标轴/图例/数据标签实际可见 |
| 视觉 | 至少 4 张图表试稿通过人工检查，主视觉、层级和留白成立 |
| 回归 | 既有 chart fixture 不回归，已有文本/形状/图片/表格测试不受影响 |

## 风险和取舍

- 不在 JSSDK 中复制第二套 SVG 图表引擎；复用 `@learnof/chart` 的 block/layout/renderer。
- 不先删除 `chart` blocked；没有作者证据时，放开路由只会让生成器失败或静默画假图表。
- 不把所有训练图表一次性做成所有可编辑属性；先完成高频类型和数据闭环，再扩展组合图、双轴和股票图。
- 不用 illustrative 数据冒充业务事实；数据来源要随图表进入 generation-plan 和证据。

## 当前执行结果

- [x] 报告确认“训练集有图表，生成器没有图表”的三段断点：Skill blocked、语义模型过窄、JSSDK 入口缺失（已补上最小 `addChart`）。
- [x] 计划和 API 草案已写入 OfficeDex docs。
- [x] 公共 JSSDK `addChart` 最小实现。
- [x] MOP/Memory Host 测试。
- [x] `VibeChart` 多序列 schema 第一版。
- [x] `normalizeVibeChart` 兼容规范化和非法数据拒绝，见 `src/shared/chartModel.ts`。
- [x] `task.vibe_tree` 解析保留并规范化节点上的 chart 数据，避免进入生成树前丢失。
- [x] `relation` 从 `task.vibe_tree` 节点保留到 chart generation-plan。
- [x] 产品 Skill 已写入 chart 数据门禁、关系路由、recipe contract 和 blocked 放行条件。
- [x] 基础图表导出、严格回读和 renderer smoke，见 `presentation/tests/office-js-chart-authoring.test.mjs`。
- [x] 首批 4 个 chart recipe drawer 及统一闭环测试，见 `presentation/tests/office-js-chart-recipe.test.mjs`。
- [x] 实验 recipe 路由桥及 4 个单元测试，见 `src/shared/chartRecipeRouting.test.ts`。
- [ ] Skill chart recipe 的来源证据、完整四层布局验收和正式路由。
- [ ] TikTok 图表代表页与全稿回归。
