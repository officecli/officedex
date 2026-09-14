# OfficeDex AI PPT 图表作者能力计划

更新时间：2026-09-14  
适用产品：OfficeDex  
状态：Phase 1 最小闭环已完成，导出/渲染门禁待验证

## 目标

让训练集中的图表真正进入 AI PPT 生成链路：Skill 能识别图表任务，OfficeDex 能表达图表数据，公共 JSSDK 能创建原生可编辑图表，Host 能写入/回读/渲染 `chartSpace`，最终自由构图 drawer 能把图表作为主视觉而不是矩形占位。

这条计划与 [`aippt-jssdk-design-method.md`](aippt-jssdk-design-method.md) 和 [`aippt-jssdk-visual-gap-report.md`](aippt-jssdk-visual-gap-report.md) 配套。方法文档定义原则，本计划定义实现顺序和门禁。

## 当前事实

- 训练/回归资产中已有 44 组 `chart-*` fixture，覆盖柱状、条形、折线、面积、饼/环、雷达、散点、组合、双轴及部分股票/三维图表。
- `@learnof/chart` 已有数据模型、布局、SVG 图元、绘制、序列化和编辑会话。
- MOP `ChartController` 已能插入图表、写入数据、调整标题/图例/坐标轴/数据标签和样式。
- 公共 JSSDK `ShapeCollection` 已补上受控的 `addChart` 最小入口；在导出、严格回读和渲染证据完成前，Skill 仍不能把它视为可用图表配方。
- `VibeChart` 当前只能表达单组 `categories + values`，且类型名没有覆盖公共图表内核的完整类型。
- Skill registry 仍把 `chart` 放在 `blocked`；在作者能力和证据完成前不能直接移除。

## 分阶段计划

### Phase 0：契约和样例冻结

状态：完成

- [x] 在产品方法文档中明确 Skill、JSSDK、渲染验收的责任边界。
- [x] 记录 Cheso/外部样例的图表页面家族和视觉差距。
- [x] 确认现有 44 组 chart fixture 和公共图表包是复用基础。
- [x] 明确禁止用原生矩形拼图表冒充可编辑图表。

### Phase 1：公共 JSSDK 原生图表最小闭环

状态：最小闭环完成；严格回读、渲染和视觉验收待完成

目标：一页生成一个原生 `graphicFrame -> chartSpace`，数据可写入，导出后能严格回读并被原生 renderer 识别。

- [x] 增加 `ChartAddOptions` 和 `ShapeCollection.addChart()`。
- [x] 将公共图表内核的 chart block factory 暴露给 MOP Host，避免 Host 重新手写一套 chart XML/MOP 结构。
- [x] MOP Host 支持 `addChart`：位置、大小、类型、矩阵数据、标题和图例。
- [x] Memory Host 支持同一 API，保证 Office.js 兼容层单测可覆盖。
- [x] 为 `column`、`bar`、`line`、`area`、`pie`、`donut`、`radar`、`scatter` 建立最小类型回读断言。
- [x] 增加 JSSDK/MOP 测试：对象类型、数据点、标题、图例和 transform。
- [ ] 补齐导出 PPTX、严格回读和 chart renderer 视觉验收，再解除 registry 的 `chart` blocked。

### Phase 2：OfficeDex 图表语义模型

状态：待开始

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

- [ ] 保留旧 `values` 输入的兼容适配，但内部统一成 `series[]`。
- [ ] 明确真实数据和 illustrative 数据的标记；没有来源时不生成看似精确的业务结论。
- [ ] 增加组合图、堆积图、双轴和数据标签的 schema 校验。
- [ ] 将 `VibeProjectTreeNode.chart` 接入 outline/story → generation-plan 的转换。

### Phase 3：Skill 路由和图表配方

状态：待开始

- [ ] 增加 `data_dashboard`、`chart_analysis`、`chart_comparison`、`chart_trend` 页面家族。
- [ ] `relation=comparison/trend/distribution` 时优先选择图表，而不是默认 `list`/`parallel`。
- [ ] 页面 plan 必须记录 `visual_role=chart`、`chart_type`、`data_source`、`focal_point` 和 `content_budget`。
- [ ] 先补齐 4 个高频 drawer：KPI + 柱图、趋势折线、占比环图、双栏图表分析。
- [ ] 从 44 组 fixture 中挑选覆盖上述家族的来源证据，形成 recipe；不把整页样图当作不可编辑背景。
- [ ] 只有 Phase 1/2 的证据通过后，才从 `registry.json.blocked` 移除 `chart`。

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
- [ ] Skill chart recipe 和受证据约束的路由。
- [ ] TikTok 图表代表页与全稿回归。
