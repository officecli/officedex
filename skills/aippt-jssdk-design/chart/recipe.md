# 图表：用结构化关系选择原生 chartSpace

状态：`native_chart_preview`。四个代表 drawer 已能从空白文稿创建可编辑 `graphicFrame -> chartSpace`，并通过 renderer / PPTX 导出 / 严格回读。来源重建 SSIM 尚未达到 `rawSsim > 0.95`，因此不称为 `high_similarity_verified`；当前用于 Skill 预览生成，便于查看原生图表页面效果。

选版输入是结构化 `relation`，不从标题猜图表类型。

## 变体

| 变体 | 关系 | 机制 |
|---|---|---|
| `trend-line-with-takeaway` | `trend` | 左侧大趋势折线图，右侧单一 takeaway |
| `kpi-plus-column` | `comparison`（图表比较，不是双圆对比页） | 左侧 KPI 锚点，右侧簇状柱图 |
| `share-donut-with-callouts` | `distribution` | 中心环图，右侧三条外部证据引线 |
| `dual-panel-chart-analysis` | 多系列分析 | 左右两张原生图，底部一条共用结论 |

## 必须保留

- 图表是主视觉，结论卡围着图表排，不能缩成小矩形再堆文字。
- 只用公共 JSSDK `addChart` 创建原生对象，不用图片、SVG 或矩形冒充图表。
- 数据来自 `chart_matrix` / 结构化 plan；没有数据时停在 `needs_data`。

## 反例

随机改坐标或颜色不是多样性。一套左右栏模板套所有图表页也不是图表构图。
