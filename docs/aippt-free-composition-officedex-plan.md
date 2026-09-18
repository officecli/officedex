# Plan: 把自由构图 drawer 接到 OfficeDex 生成

更新：2026-09-16  
状态：已接入；OfficeDex.app 已放入新的 OfficeCLI 与 drawer 包

## 问题

那份好看的 `TikTok运营实践-自由构图-20页.pptx` 不是 OfficeDex 点生成的。它是：

```text
内容 JSON → Skill 选版 → 每页独立 drawer 重算几何 → JSSDK Host
```

产品里现在是：

```text
LLM 写内容 → LLM 选关系 → LLM 临场写 generated.mjs（还被要求贴来源贝塞尔路径）
```

所以会选出 `ticket-panels`，却画成空票签；图表家族仍 `blocked`，实验 `paintSlide` 也进不了包。drawer **不是模板**：模板是来源样张，机制是构图语法，drawer 是按当前正文重算坐标的绘图函数。

## 目标

OfficeDex 里的 PPTX 生成走同一条自由构图链路：

1. LLM 继续负责语义：标题、小节、关系、可选图表数据。
2. `select-family` 继续按关系/容量选 variant。
3. **禁止 LLM 写几何。** `free-composition/assemble.mjs` 按 variant 调用 drawer，产出独立 `generated.mjs`。
4. 有 drawer 的 variant 优先；没有专名的 variant 映射到最近机制，不回退通用列表。
5. 用户要图表且内容带 `chart` 时，走实验原生 `addChart` drawer。`registry.json` 的 `chart` 家族保持 `blocked`，不宣称来源放行。
6. 自由构图不再要求来源自定义路径逐像素出现在新页上（那是 `template_fidelity` 的门禁）。

## 落地

| 层 | 改什么 |
|---|---|
| Skill | `skills/aippt-jssdk-free-composition/`：theme、painters、assemble、chart 实验 drawer、registry |
| 同步 | `sync-jssdk-design-skill.mjs` 在快照后再 overlay，避免下次同步删掉 drawer |
| OfficeCLI | 选版后跑 assemble；`sourceMode=skill_free_composition_drawers`；排序给 drawer variant 加分 |
| 桌面包 | `stageDesktopSkills` 带上 `free-composition/` |

验收：用结构化内容 assemble 出的稿，封面/流程/票签有正文，不再是 A/B/C/D 空卡片；有 chart 字段的页出现 `chartSpace`。
