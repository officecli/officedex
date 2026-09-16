# OfficeDex AI PPT 图表能力交接文档

更新时间：2026-09-15  
用途：交给下一模型继续开发、复核和放行 OfficeDex 的 AI PPT 图表能力。  
适用范围：`officedex` 产品、`aippt-jssdk-design` Skill、公共 JSSDK、MOP Host、PPTX 导出/回读和 renderer。

## 1. 先记住这条结论

当前已经完成的是“图表原生作者闭环 + 实验 drawer”，还没有完成“训练集来源证据合格 + Skill 正式放行”。

因此下一模型必须遵守：

- 实验 drawer 可以运行、导出、回读和渲染，但 `generationReady=false`。
- `skills/aippt-jssdk-design/registry.json` 中的 `chart` 必须继续保持 `blocked`。
- 训练集 PPTX/PNG 只是候选来源，不能直接称为 `high_similarity_verified`。
- 只有独立 JSSDK 重建、`facts.json`、验证报告、`rawSsim > 0.95`、完整文字检查和人工视觉复核都通过后，才能正式放行。
- 不能用矩形、线段、SVG 或整页 PNG 冒充可编辑图表。
- 不能从标题文本猜测趋势、比较、占比等关系；关系必须来自结构化 plan。
- 多样性来自 `relation + content budget + visual intent + 独立 drawer`，不是随机改坐标/颜色，也不是把一个模板平移多次。

## 2. 生成责任边界

本产品采用 `aippt-jssdk-design` 的三轨契约：

| 模式 | Skill 负责 | JSSDK/生成脚本负责 |
|---|---|---|
| `template_fidelity` | 从来源提取 family、variant、锚点、required geometry 和排版规则 | 保留来源结构，按参数重建可编辑 PPT |
| `free_composition` | 根据内容关系选择机制和视觉意图 | 每页独立 drawer，自由决定几何、留白和层级 |
| `hybrid` | 学习模板机制，但不复用整页模板 | 以独立 JSSDK 页面融合图表、结论、图片或注释 |

用户要求“结合模板机制但最终自由构图”时，默认使用 `hybrid`。模板的价值是提供机制、比例和排版经验，不是提供一张可无限套用的母版。

每次生成至少要同时做四层验收：

1. **文字层**：全文保留、真实字体度量、`checked=textBodies=textLayout.length`、`skipped=[]`。
2. **几何层**：主体 bounding box、对齐线、间距、z-order、文本与图表/卡片边界。
3. **语义层**：标题、结论、编号、图例、引线和数据系列归属正确。
4. **视觉层**：实际 PNG 抽查；模板模式还要和来源图对照，不能只看自动化指标。

## 3. 已实现的代码结构

### OfficeDex 共享模型和 plan

- [`src/shared/types.ts`](../src/shared/types.ts)：`VibeChart`、多 series、来源、图例、数据标签、relation 和 generation plan 类型。
- [`src/shared/chartModel.ts`](../src/shared/chartModel.ts)：图表规范化、旧 `categories + values` 兼容、多 series 校验、JSSDK 数据矩阵转换。
- [`src/shared/chartGenerationPlan.ts`](../src/shared/chartGenerationPlan.ts)：从结构化项目树生成 chart plan，并输出 snake_case JSON。
- [`src/shared/chartRecipeRouting.ts`](../src/shared/chartRecipeRouting.ts)：按 `relation` 和容量选择实验 recipe；不读取标题猜关系。
- [`src/shared/chartRecipeEvidence.ts`](../src/shared/chartRecipeEvidence.ts)：来源证据、SHA-256、状态和正式 generation gate。

### Skill 图表目录

- [`skills/aippt-jssdk-design/SKILL.md`](../skills/aippt-jssdk-design/SKILL.md)：三轨模式、图表 contract、证据门禁和四层布局验收。
- [`skills/aippt-jssdk-design/chart/evidence-inventory.json`](../skills/aippt-jssdk-design/chart/evidence-inventory.json)：四个候选 recipe 的训练集来源和 digest。
- [`skills/aippt-jssdk-design/chart/validate-evidence-inventory.mjs`](../skills/aippt-jssdk-design/chart/validate-evidence-inventory.mjs)：校验来源路径、状态和 digest。
- [`skills/aippt-jssdk-design/chart/verify-experimental-recipes.mjs`](../skills/aippt-jssdk-design/chart/verify-experimental-recipes.mjs)：批量执行四个实验 drawer，验证原生 chart、渲染、导出和回读。

### 实验 drawer

全部从空白文稿创建原生 `graphicFrame -> chartSpace`，当前均为 `generationReady=false`：

1. [`trend-line-with-takeaway.mjs`](../skills/aippt-jssdk-design/chart/experimental/trend-line-with-takeaway.mjs)：趋势折线图 + 单一 takeaway。
2. [`kpi-plus-column.mjs`](../skills/aippt-jssdk-design/chart/experimental/kpi-plus-column.mjs)：KPI + 比较柱图。
3. [`share-donut-with-callouts.mjs`](../skills/aippt-jssdk-design/chart/experimental/share-donut-with-callouts.mjs)：占比环图 + 外部引线结论。
4. [`dual-panel-chart-analysis.mjs`](../skills/aippt-jssdk-design/chart/experimental/dual-panel-chart-analysis.mjs)：双栏图表分析，当前包含两个原生图表。

### 公共 JSSDK / Host

公共 `ChartAddOptions` 已补齐受控样式参数：

- `smooth`
- `markerVisible`
- `seriesColors`
- `chartFillColor` / `chartLineColor`
- `plotFillColor` / `plotLineColor`
- `categoryGridlinesVisible`
- `seriesLineWidth`

MOP Host、Memory Host 和 `@learnof/chart` factory 已接入。重要 schema 约束：

- `plotAreaChart.attrs.marker` 必须是布尔值。
- series 的 marker 使用对象并可设 `markerSymbol: "none"`。
- `srgbColor` 使用不带 `#` 的十六进制字符串。

相关测试：

- `presentation/tests/office-js-chart-authoring.test.mjs`
- `presentation/tests/office-js-chart-recipe.test.mjs`

## 4. 当前四个 recipe 的路由

| 结构化 relation | 实验 recipe | 当前状态 |
|---|---|---|
| `trend` | `trend-line-with-takeaway` | 已选实验 drawer，正式 gate blocked |
| `comparison` | `kpi-plus-column` | 已选实验 drawer，正式 gate blocked |
| `distribution` | `share-donut-with-callouts` | 已选实验 drawer，正式 gate blocked |
| `other` 且 `series >= 2`、`categories >= 3` | `dual-panel-chart-analysis` | 已选实验 drawer，正式 gate blocked |
| 其他关系/容量 | 无 | 返回 `needs_source_evidence`，不得静默降级成假图表 |

snake_case plan 会包含：

```json
{
  "visual_role": "chart",
  "chart_spec": {},
  "chart_matrix": [],
  "recipe_route": {
    "recipe_id": "trend-line-with-takeaway",
    "generation_ready": false
  },
  "recipe_evidence": {},
  "generation_gate": {
    "status": "blocked",
    "allowed": false
  }
}
```

`generation_gate.allowed` 是正式生成的硬门禁；实验 smoke 通过不等于该字段可以改为 `true`。

## 5. 来源证据现状

`evidence-inventory.json` 当前为：

```text
status = candidate_sources_only
recipes = 4
blocked = 4
admission = rawSsim > 0.95
```

四个候选来源：

- 折线图：`sampleall/chart/基础属性/折线图/`
- 簇状柱形图：`sampleall/chart/基础属性/簇状柱形图/`
- 圆环图：`sampleall/chart/基础属性/圆环圆/`
- 组合图/双轴：`sampleall/chart/基础属性/簇状柱形图&折线图...`

### 已完成的趋势折线候选重建

文件：

- [`trend-line-source-reconstruction.mjs`](../skills/aippt-jssdk-design/chart/evidence/trend-line-source-reconstruction.mjs)
- [`trend-line-source-reconstruction.json`](../skills/aippt-jssdk-design/chart/evidence/trend-line-source-reconstruction.json)
- [`trend-line-source-reconstruction.verification.json`](../skills/aippt-jssdk-design/chart/evidence/trend-line-source-reconstruction.verification.json)
- [`verify-trend-line-source-reconstruction.mjs`](../skills/aippt-jssdk-design/chart/evidence/verify-trend-line-source-reconstruction.mjs)

当前事实：

```text
rawSsim                 = 0.91045485182183
exportComparison.rawSsim = 1
sizeMismatch             = false
pptxExport               = passed
strictReimport           = passed
native chart generated   = 1
native chart reimported  = 1
chart kind               = line
render errors            = 0
textOverflow             = []
visual_review            = pending
```

这说明“原生创建、导出、回读”已经成立，但来源视觉重建还不够接近。当前差距主要来自源图中的 chart frame、图案填充/阴影、绘图区比例以及 renderer 对 PowerPoint 图表默认样式的还原差异。不要把 `exportComparison.rawSsim=1` 误解成来源图复刻通过；它只说明导出后再回读的像素结果一致。

## 6. 当前验证结果

最近一轮已通过：

```text
npm run verify:chart:evidence
chart evidence inventory ok: 4 candidate recipes, 4 blocked for formal generation

OfficeDex 相关 Vitest
57 tests passed

presentation chart authoring + recipe tests
6 tests passed

npm run lint
tsc --noEmit passed

npm run verify:chart:experimental
4/4 experimental recipes passed
native chart preserved, no picture fallback, render errors = 0
```

这些结果证明的是工程闭环和实验能力，不证明来源证据已经达到 Skill 放行标准。

## 7. 下一模型必须按这个顺序继续

### 第一步：先复核状态，不要直接放行

```bash
cd officedex
npm run verify:chart:evidence
npm run verify:chart:experimental
npm run lint
```

同时检查：

- `registry.json` 的 `blocked` 是否仍包含 `chart`。
- 四个 drawer 是否仍声明 `generationReady=false`。
- `generation_gate.allowed` 是否仍为 `false`。
- 不要回退或删除用户已有的 build 产物和未相关改动。

### 第二步：把趋势来源 SSIM 提高到严格大于 0.95

优先顺序：

1. 读取源 PPTX 的原生 `chartSpace` 属性和源 PNG，建立完整 `facts.json`。
2. 对齐 chart frame bounds、plotArea、标题、图例、轴线、系列颜色、线宽、网格和留白。
3. 优先补 renderer/JSSDK 的真实能力；不要用整页位图或手写 OOXML 绕过 JSSDK。
4. 每次改动都重新执行、渲染、导出、严格回读和 PNG 对照。
5. 只有 `rawSsim > 0.95` 且人工视觉复核通过，才把缺口从 inventory 中移除。

### 第三步：为柱图、环图、组合图建立证据三件套

每个 recipe 都必须有：

- 独立的 JSSDK reconstruction `.mjs`
- 结构化 `facts.json`
- verification report，至少包含 native object、render、text coverage、PPTX export、strict reimport、raw SSIM 和视觉复核状态

不能把同一个趋势图报告复制给其他 recipe。来源、源码、事实和报告必须逐项绑定 SHA-256。

### 第四步：完成四张代表页的 hybrid/free 视觉验收

至少覆盖：

1. 轻色 KPI + 柱图
2. 深色趋势折线图
3. 占比环图 + 外部引线
4. 双栏图表分析

检查焦点面积、阅读顺序、标题/图例/刻度、中文长句、主体留白、图表和结论的语义归属。任何“自动检查无溢出但视觉重叠”的页面都标记为 `layout_review_failed`。

### 第五步：再接真实 OfficeCLI/Skill bridge

当前 `chartGenerationPlanToJson` 已能输出可消费 plan，但仍需要接入实际 OfficeCLI/Skill bridge。接入时必须：

- 使用结构化 `relation`，不从标题猜图表类型。
- 读取 `recipe_route`、`recipe_evidence` 和 `generation_gate`。
- gate blocked 时返回明确状态（如 `needs_source_evidence`），不能悄悄生成假图表。
- 生成物保持独立 `.mjs`，由 Host 从空白文稿创建原生对象。

### 第六步：最后才考虑解除 registry blocked

放行顺序不可逆转：

1. 基础 JSSDK chart authoring 回归。
2. 四个代表 drawer 的执行、导出、回读、渲染和人工视觉验收。
3. 训练集 fixture 覆盖和来源证据完整。
4. TikTok 8～10 张代表页回归。
5. 才能把 `registry.json` 中的 `chart` 从 blocked 改为可选 recipe。

## 8. 明确不要做的事情

- 不要把实验 drawer 改名成正式 recipe 来规避证据门禁。
- 不要把 `rawSsim=0.91` 四舍五入成 `0.95`。
- 不要因为 PPTX 能打开，就认为排版准确。
- 不要只做 `textLayoutCoverage`；它是必要条件，不是视觉验收。
- 不要用随机坐标、随机颜色制造“多样性”。
- 不要把所有页面压成卡片列表、统一左右栏或同一张模板。
- 不要把图表转成图片放进 PPT。
- 不要直接修改训练集源 PPTX，也不要拼接 OOXML。
- 不要调用已经退役的 `aippt-list4-layout`、`presentation-pptx-quality` 或回退到 `mop-skill`。

## 9. 交接时可直接粘贴给下一模型的任务提示

```text
你正在继续 OfficeDex 的 AI PPT 图表能力开发。

先读：
1. officedex/skills/aippt-jssdk-design/SKILL.md
2. officedex/docs/aippt-jssdk-design-method.md
3. officedex/docs/aippt-chart-authoring-plan.md
4. officedex/docs/aippt-chart-handoff-for-next-model.md

当前事实：
- 公共 JSSDK、MOP Host、Memory Host 已有原生 addChart。
- 四个实验 drawer 已通过执行、renderer、PPTX 导出和严格回读 smoke。
- 四个 drawer 都必须保持 generationReady=false。
- registry.json 的 chart 必须保持 blocked。
- 趋势来源候选 rawSsim=0.91045485182183，低于严格门槛 rawSsim > 0.95。
- 当前首要任务是补齐来源重建证据和视觉验收，不是直接放行 chart。

执行要求：
- 使用结构化 relation 路由，不从标题文本猜关系。
- 使用独立 JSSDK generated.mjs，从空白文稿创建原生 chartSpace。
- 不用整页图片、SVG、矩形拼图或手写 OOXML 代替图表。
- 每次修改后执行 evidence validator、experimental verification、相关测试、lint 和 git diff --check。
- 只有来源 MJS、facts、verification report、SHA-256、rawSsim > 0.95、完整文字覆盖和人工视觉复核全部成立后，才允许讨论解除 registry blocked。
```

## 10. 关键文档索引

- [`aippt-jssdk-design-method.md`](aippt-jssdk-design-method.md)：整体方法、模板/自由/hybrid 和排版验收。
- [`aippt-jssdk-visual-gap-report.md`](aippt-jssdk-visual-gap-report.md)：与参考 AI PPT 的视觉差距和修复方向。
- [`aippt-chart-authoring-plan.md`](aippt-chart-authoring-plan.md)：图表实现阶段、API 和 Definition of Done。
- [`src/shared/chartGenerationPlan.ts`](../src/shared/chartGenerationPlan.ts)：结构化 plan → snake_case JSON。
- [`src/shared/chartRecipeEvidence.ts`](../src/shared/chartRecipeEvidence.ts)：来源证据与 generation gate。
- [`skills/aippt-jssdk-design/chart/evidence-inventory.json`](../skills/aippt-jssdk-design/chart/evidence-inventory.json)：候选来源清单。

