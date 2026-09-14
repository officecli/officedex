# 渐进加载与路由状态

OfficeDex 机器入口是包内 `registry.json`；维护源在 workspace 的 `plans/aippt-jssdk-skill-strategy/distilled-skills/`。必须执行 `policy.json` 的SSIM > 0.95 的来源合同。入口做语义判断，路由器执行关系、容量和证据校验。

| 关系 | 选择依据 |
|---|---|
| parallel | 同层级、同权重、无先后 |
| list | 同类信息扫描；没有排名、日期、层级 |
| process | 明确步骤、方向或因果 |
| timeline | 日期/阶段先后；顺序与时间比例区别处理 |
| comparison | 有共享比较维度 |
| matrix | 真实横纵两个维度 |
| organization | 父子、汇报或归属 |
| pyramid | 层级、递进或基础与上层 |

`items` 为正整数或条目数组，`density` 为 `short / medium / long`；先综合最长标题、最长正文估计，再测量确认。`orientation` 可为 `auto / horizontal / vertical / grid`。默认只加载一个家族；需要第二个家族时记录具体缺口。

| status | 后续动作 |
|---|---|
| selected | 加载当前配方、来源 MJS 及报告；仍须新内容容量和视觉检查 |
| needs_source_evidence | 停止生成；补充SSIM > 0.95、执行和导出回导通过且哈希一致的源码与报告后重试 |
| needs_reflow | 保留当前语义重排、换方向或拆页；页数固定则说明具体冲突 |
| needs_semantics | 重新确认关系；无匹配的封面/原创设计需先建立有合格来源的配方 |
| needs_recipe | 家族只有通用草案；补齐有合格来源的变体后才能生成 |
| needs_capability_review | 图表/公式/动画尚未收录可用配方；查当前本地 API 与证据再决定 |

命中 blocked 清单不会静默近似。清单是本地旧证据快照；新增能力可在验证后更新，不能把缺少蒸馏配方说成整个 SDK 不支持。

`source_evidence` 只返回所选机制的少量事实及JSSDK 源码/报告路径；选中后必须读，默认不读取全量候选。OfficeDex 将原始源码和报告分别打包为 `<family>/evidence/<id>.mjs` 和 `<id>.verification.json`。事实中的路径保留溯源意义，哈希绑定包内字节。`exact_reference=false` 可以进入生成上下文：是否纳入由原始 SSIM > 0.95 和执行/结构/渲染/导出回导检查决定，不依赖旧 0.999 验收布尔值。纳入后保留原始报告；来源合格仍不等于衍生配方已通过新内容审美评价。

将 dispatcher 输出保存为 `generation-plan.json`。生成时追加实际几何参数、文字测量结果、字体及回退信息，并让执行和渲染报告引用它。短、中、长固定输入、重复生成的程序以及审阅报告用于评估；测试中只允许改变排版，不能改变输入文字来换取通过。

## 整份 PPT 的构图选择

L0 读取 registry.visual_catalog 中的变体摘要，给出内容需要的 visual_intent；L1 仅加载命中家族的候选说明；L2 只读取最终来源。容量相容的候选按视觉意图匹配、已用次数与相邻重复排序，generation-plan 保留候选及所选 visual_signature/preserve。相同约束只有一种合格布局时允许重复并保留事实，不伪造内容关系。

多样性验收同时检查所选变体分布和实际 PNG。变体 ID 不同但画面都被简化成三栏，仍是视觉失败。复杂轮廓的省略视图不能作为删去该组件的理由，使用原生几何展开脚本取得完整路径。
