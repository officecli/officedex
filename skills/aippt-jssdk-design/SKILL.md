---
name: aippt-jssdk-design
description: 唯一 PPT 生成入口：按内容关系渐进加载 SSIM 大于 0.95 且执行验证通过的 JSSDK 源码与配方，参数化生成独立 .mjs，由项目 Host 导出可编辑 PPTX。缺少合格来源证据时阻止生成，禁止使用旧布局 Skill 或通用生成器回退。
---

# 用内容关系选择构图

## 必须遵守的来源合同

`policy.json` 的合同为 `jssdk-progressive/v2`。用户指定的 Skill 来源门槛是 **原始 SSIM > 0.95**（等于 0.95 不纳入），同时要求 JSSDK 已执行、原生对象存在、无文字溢出或渲染错误、图像尺寸一致、导出和严格回导通过，源码及原始报告 SHA-256 匹配。

合格来源标为 `high_similarity_verified`，可以立即用于蒸馏和生成。原报告针对 0.999 的 `comparison.passed=false`、`exactSolution=false` 不再阻止纳入；保留这些原始结论，不把来源称为逐像素精确复刻。SSIM 是来源重建证据，新内容是否美观仍需渲染检查。

文字检查须有 `textLayoutCoverage.version=2`、`measurement=font_metrics`，`checked=textBodies=textLayout.length` 且 `skipped=[]`。旧检测器只遍历顶层对象，会漏查组合内文字；旧报告的零溢出不能直接沿用，必须补跑完整检测。验收走实际字体度量的 print 渲染路径，不用缩略图的半字号字宽估算。`generation_ready=false` 的配方保留供修复，不参加选版。

OfficeDex chart plan 还会输出 `recipe_evidence`。其中 `sampleall/chart` 的训练集 PPTX/PNG 只代表候选来源索引；只有同时具备 `facts.json`、验证报告、`rawSsim > 0.95`、原生执行/导出/严格回读和完整视觉复核，状态才可变为 `high_similarity_verified`。因此 `recipe_evidence.status=needs_source_evidence` 时必须停在实验配方，不能生成正式页面。

命中家族后必须加载源码及报告，保留其 API 调用方式、组件关系和构图机制，再按新内容参数化。不能只读几条建议后自由绘制。缺少合格来源时返回 `needs_source_evidence` 并停止该页生成；封面、结尾页、容量冲突也不能绕过。禁止调用已退役的 `aippt-list4-layout`、`presentation-pptx-quality` 或切回 `mop-skill`。

主要产物是本次新写、独立的 `generated.mjs`，导出 `build(PowerPoint, data, runtime)`。参考 PPTX、图片及重建代码只读；从空白文档通过本项目公开 JSSDK 创建原生对象，再用既有 typed MOP converter 导出。不要修改源 PPTX、拼接 OOXML、直接写 MOP 或用整页图片替代可编辑内容。

## 图表专项规则

图表是内容关系驱动的主视觉，不是矩形、线段或 SVG 的装饰占位。`registry.json` 已纳入 `chart` 家族，四个代表 drawer 可按结构化关系做 **Skill 预览生成**。来源重建仍未达到 `rawSsim > 0.95`，因此不得把这些配方称为 `high_similarity_verified`。

### 1. 先规范化数据，再选择构图

OfficeDex 上游必须先将输入规范化为 `VibeChart`：

- 旧 `categories + values` 统一为 `series[]`。
- 每个 series 必须是有限数值，长度必须一致。
- 保留 `source.kind/ref` 和 `illustrative`。
- 节点用结构化 `relation` 表达 `trend`、`comparison`、`distribution` 或 `correlation`；不能从标题文本猜关系。
- 没有足够数据返回 `needs_data`，不能生成看似精确的业务数字。

Skill bridge 消费的 chart plan 使用 snake_case：

```json
{
  "visual_role": "chart",
  "relation": "trend",
  "chart_spec": {
    "chart_type": "line",
    "data_source": { "kind": "table", "ref": "sheet1!A1:D2" },
    "focal_point": { "kind": "chart", "area": "right", "weight": 0.62 },
    "content_budget": {
      "title_chars": 18,
      "categories": 6,
      "series": 2,
      "annotation_lines": 3
    },
    "illustrative": false
  },
  "chart_matrix": [
    ["", "一月", "二月", "三月"],
    ["播放量", 120, 180, 240]
  ],
  "recipe_route": {
    "status": "selected_experimental",
    "recipe_id": "trend-line-with-takeaway",
    "module_path": "skills/aippt-jssdk-design/chart/experimental/trend-line-with-takeaway.mjs",
    "generation_ready": true,
    "reason": "structured relation=trend selects the native line trend drawer"
  },
  "recipe_evidence": {
    "status": "needs_source_evidence",
    "source_kind": "training_fixture",
    "source_paths": ["sampleall/chart/基础属性/折线图/折线图.pptx"],
    "source_digests": ["sha256:<source-file-digest>"],
    "missing": ["facts.json", "verification report", "rawSsim > 0.95", "visual review"],
    "reason": "Training assets are indexed but not yet admitted as Skill evidence."
  },
  "generation_gate": {
    "status": "preview_allowed",
    "allowed": true,
    "reason": "Native chart Skill preview is enabled; source SSIM is not yet admitted as high_similarity_verified."
  }
}
```

生成代码使用 `chart_matrix` 调用公共 JSSDK：

```ts
slide.shapes.addChart({
  chartType: chart_spec.chart_type,
  data: chart_matrix,
  title,
  legendVisible,
  legendPosition,
  left,
  top,
  width,
  height,
});
```

`generation_gate.status=preview_allowed` 时可以生成原生图表预览页，供查看构图效果；这不等于来源已通过 `rawSsim > 0.95` 的正式纳入。`recipe_route.status=needs_source_evidence` 且没有可用 drawer 时仍须停止该页。路由由结构化 `relation` 和规范化容量决定，不读取标题文本猜图表类型。

### 2. 按关系路由图表类型

| relation | 首选图表 | 允许降级 |
|---|---|---|
| `trend` | `line` / `area` | `timeline` |
| `comparison` | `column` / `bar` | `parallel` |
| `distribution` | `donut` / `pie` | KPI cards |
| `correlation` | `scatter` | 双栏分析 |

降级必须写入 generation plan 的 `fallback_reason`，不能静默把图表改成普通卡片。

### 3. 图表页面必须自由构图

图表 recipe 只能复用局部机制，不能套整页模板。每页必须记录：

- `visual_role=chart`
- `focal_point`
- `source_mechanism`
- `required_geometry`
- `content_budget`
- `data_source`

第一批允许准备的 recipe：

- `kpi-plus-column`
- `trend-line-with-takeaway`
- `share-donut-with-callouts`
- `dual-panel-chart-analysis`

当前源码位于 `chart/experimental/`，并由 `chart` 家族选版。四个 drawer 均已通过 native authoring、renderer、PPTX export 和 strict reimport smoke，可作为 Skill 预览生成；来源 SSIM 未达标前不写入 `high_similarity_verified`。

图表必须成为页面主视觉，结论卡、注释、引线和图片围绕图表重新布局；不能把图表缩成一个小矩形再堆满文字。

### 4. 正式纳入门禁

`chart` 已从 `blocked` 进入 Skill 预览。把配方标为 `high_similarity_verified` 前，仍须同时满足：

1. JSSDK 原生树为 `graphicFrame -> chartSpace`。
2. PPTX 导出、严格回读、renderer 无错误。
3. 至少覆盖基础柱图、折线、环图和双栏分析 4 张代表页。
4. 文字、几何、语义、视觉四层验收通过。
5. 代表页 PNG 人工抽查通过，记录 `focal_area`、`semantic_ownership` 和 `whitespace_balance`。
6. source evidence、MJS、facts、report、hash 齐全。

任何缺口必须返回 `needs_data`、`needs_source_evidence` 或 `layout_review_failed`，不得使用假图表或整页图片绕过。

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
