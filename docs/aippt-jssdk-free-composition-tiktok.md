# OfficeDex 自由构图：用 Skill + JSSDK 生成带原生图表的 TikTok 运营稿

更新时间：2026-09-15  
适用产品：OfficeDex  
Skill：[`aippt-jssdk-design`](../skills/aippt-jssdk-design/SKILL.md)  
合同：`jssdk-progressive/v2`  
模式：`free_composition`

本文记录一套已经跑通的生成方案：用户要一份 **TikTok 运营介绍 PPT**，必须走 OfficeDex Skill 选版，必须用项目公开 JSSDK 从空白文档创建原生对象，必须自由构图，而且必须有可编辑的原生 chart。

可执行入口：

```bash
cd officedex
npm run generate:aippt:tiktok-ops
```

产物写到 `build/aippt-tiktok-ops-20-free/`，其中 PPTX 为 `TikTok运营实践-自由构图-20页.pptx`。

## 为什么要单独记这套方案

OfficeDex AI PPT 有三种模式：`template_fidelity`、`free_composition`、`hybrid`。用户说「自由发挥」时，默认是 `free_composition`：

- Skill 先按内容关系选视觉机制，不套整页模板。
- `generated.mjs` 按所选机制重新构图，每页独立。
- 图表页必须创建 `graphicFrame -> chartSpace`，不能用图片、SVG 路径或 OOXML 拼接冒充图表。
- 来源证据只提供可学习的机制；新稿是否成立，仍要导出、回读和渲染检查。

这和「图表能力测试稿」不是同一件事。测试稿用来验收 `addChart`；运营稿用来交付一份能讲清楚 TikTok 账号工作的 PPT。

## 生成链路

```text
briefs.json
  -> Skill select-family.mjs
  -> generation-plan.json（每页 family / variant / source_evidence）
  -> examples/tiktok-ops-20-free/generated.mjs
  -> JSSDK Host（MopEditorPowerPointHost）
  -> generated.mop
  -> 原生渲染 PNG
  -> typed converter 导出 PPTX
  -> 严格回读 chartSpace
```

责任边界：

| 环节 | 负责什么 | 不负责什么 |
|---|---|---|
| Skill `select-family.mjs` | 按 relation、items、density、visual_intent 选家族和变体 | 不写具体坐标，不理解自然语言标题 |
| 来源证据 | 提供已验证机制和 JSSDK API 用法 | 不等于新内容已经好看 |
| `generated.mjs` | 用 JSSDK 画出这一页 | 不直接写 MOP，不改源 PPTX |
| Host / converter | 执行、导出、回读 | 不替生成代码补图表 |
| 渲染检查 | 确认原生对象和文字是否成立 | `overflow=0` 不能代替构图检查 |

## 20 页内容关系

`examples/tiktok-ops-20-free/briefs.json` 是 Skill 的结构化输入。当前选版结果：

| 页 | relation | 变体 | 主视觉 |
|---|---|---|---|
| 1 | parallel | marker-columns | 封面三列 |
| 2 | parallel | editorial-grid | 分区说明 |
| 3 | list | numbered-rows | 主页检查清单 |
| 4 | parallel | ring-labels | 三条内容主线 |
| 5 | process | linked-stages | 生产流程 |
| 6 | list | label-columns | 前 3 秒钩子 |
| 7 | timeline | horizontal-axis | 从成片到上线 |
| 8 | trend | trend-line-with-takeaway | **原生折线图** |
| 9 | chart | kpi-plus-column | **KPI + 原生簇状柱** |
| 10 | distribution | share-donut-with-callouts | **原生圆环 + 引线** |
| 11 | chart | dual-panel-chart-analysis | **左右两张原生图** |
| 12 | organization | branch-left | 团队分叉 |
| 13 | pyramid | separated-tiers | 判断层次 |
| 14 | parallel | ticket-panels | 评论三类 |
| 15 | list | rail-callouts | 每周复盘 |
| 16 | list | hexagon-columns | 四个坑 |
| 17 | timeline | horizontal-axis | 四周计划 |
| 18 | process | linked-stages | 每周闭环 |
| 19 | parallel | icon-blocks | 下一轮三件事 |
| 20 | parallel | open-ring-callouts | 结尾 |

最近一次选版：20 页全部 `status=selected`，18 种构图，相邻重复 0。图表页走 `admission=native_chart_preview`，可以预览生成；这不等于来源已标成 `high_similarity_verified`。

## 图表规则

图表页调用 Skill 实验 drawer 的 `paintSlide`，内部使用 `slide.shapes.addChart`：

- 趋势：`chartType: "line"`
- 对比：`chartType: "column"`
- 结构：`chartType: "donut"`
- 分析：左右各一张原生图

验收时至少确认：

1. 生成树里有 `chartSpace`。
2. 导出 PPTX 含 `ppt/charts/chart*.xml`。
3. 严格回读后 `chartSpace` 数量不变。
4. 渲染无错误。
5. 数字若为示意，页面上必须写明，不能伪装成后台真实结果。

当前示例验收：5 个原生 `chartSpace`（双栏分析占 2 个），回读后仍是 5 个。

## 目录

```text
skills/aippt-jssdk-design/
  scripts/select-family.mjs
  scripts/generate-free-deck.mjs
  examples/tiktok-ops-20-free/
    briefs.json
    content.json
    generated.mjs
  chart/experimental/
    trend-line-with-takeaway.mjs
    kpi-plus-column.mjs
    share-donut-with-callouts.mjs
    dual-panel-chart-analysis.mjs
```

生成脚本会：

1. 调用 `select-family.mjs` 写入 `build/aippt-tiktok-ops-20-free/generation-plan.json`。
2. 用 presentation 仓库的 JSSDK Host 执行 `generated.mjs`。
3. 渲染 20 页 PNG。
4. 导出 PPTX 并严格回读。
5. 写出 `jssdk-evidence.json`。

不要把 `build/` 里的 PPTX、MOP 或 PNG 提交进 git。

## 约束

- 禁止旧布局 Skill、通用生成器回退、整页图片或手工 OOXML。
- 禁止从标题猜图表类型；图表路由只看结构化 `relation` 和容量。
- 非图表页必须保留所选机制的可识别轮廓：编号列、环形标签、分叉线、六边形、票签等，不能全部压成圆点加文本框。
- 图表页的结论区必须依附原生图，不能把柱图、环图改成普通列表。

## 和模板学习的关系

自由构图仍然要读来源证据，但用法不同：

- 模板模式：尽量复原来源几何。
- 自由构图：只保留机制（主视觉是什么、组件如何对齐、结论放在哪），坐标按新内容重算。

因此同一份 TikTok 内容，20 页不应长得像同一套三栏列表。选版多样性是必要条件，最终 PNG 上构图是否真的不同，才是验收。
