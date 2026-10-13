# OfficeDex 内置 Skills

## 默认 PPT 生成：svg-design（2026-10-13 起）

桌面端默认 PPT backend 是 `svg-design`，合同 `svg-design/v1`：模型逐页写受约束 SVG，OfficeCLI 逐页质检（svg-lint，出画布 / 超出卡片 / 文字重叠 / 被遮挡 / 数字单位拆行 / 孤字），不合格只回喂该页重写、最多 2 轮，仍不合格的页由自由构图 drawer 兜底。通过的页以 `slide.svg` op 推到桌面，内嵌编辑器用和后端同一个编译器（presentation 的 `packages/svg-slide`，经 `window.__presentationSvgSlide` 暴露）画成原生对象并保存。

- **Skill 不在本目录。** 提示词和合同嵌在 OfficeCLI 二进制里（`officecli-internal/internal/runtime/svg_design_skill/`：`SKILL.md` 是给模型的 SVG 规范，`registry.json` 是合同、重写轮数和软规则）。改它之后重建 OfficeCLI 即可，没有同步脚本，桌面打包也不需要复制 Skill 文件。调试时可用 `OFFICECLI_SVG_DESIGN_SKILL_DIR` 指向一个目录覆盖。
- **编译器随两处走。** 内嵌编辑器 bundle（`public/presentation`，`npm run build:presentation:desktop` 重建）带着它做实时绘制和「重新设计这页」；打包的 presentation runtime（`npm run stage:presentation`）把 `tools/execute-svg.mjs`、`tools/svg-lint.mjs` 及其依赖放进 `build/presentation`，编译器以 `dist-ssr/svg-slide.js` 的形式随 dist-ssr 一起构建和混淆。`build/presentation/runtime.json` 的 `svgDesign` 记录这棵树能不能跑：`staged` 为 false 表示 presentation checkout 太旧，`compiler` 为 false 表示 dist-ssr 没带编译器。
- **打包版没有浏览器，这条路径不需要。** 有 Playwright 的开发环境里，lint 用编辑器的 text-measurement 实测字宽，编译后还会渲染并逐页做 SVG vs MOP 像素比对；打包版自动退到确定性估宽，跳过渲染和比对，照常编译、导出 PPTX、严格回导。`runtime.json` 的 `svgDesign.measurement` 写明是哪一种。
- **能力闸门。** 桥接必须声明 `pptx_svg_design.v1=true`。缺少它的旧 OfficeCLI 会被桌面端直接拒绝并提示更新（`internal/bridge/client.go` 的 `svgDesignUnsupportedMessage`），不会静默换成别的 backend。内嵌编辑器缺编译器时，重放以 `SVG_SLIDE_UNSUPPORTED` 失败，提示重建编辑器 bundle。
- **编辑。** 改字、改色等小改仍走 `pptxEditRun`（模型写 Office.js）。「重新设计这页 / 换个版式」走 SVG 往返（`src/canvas/pptxRedesignRun.ts`）：导出当前页为带 `data-mop-id` 的 SVG → `pptx/plan-js` 的 `svg-redesign` 模式返回改过的 SVG → 编辑器内 lint → 按 id 差异写回。

`mop-skill`、`aippt-jssdk-design` 仍可通过显式 `pptxBackend` 选用；下面的内容描述的是这些旧路径的 Skill。

PPT 静态构图统一由 [aippt-jssdk-design](aippt-jssdk-design/SKILL.md) 提供，合同 `jssdk-progressive/v2`；独立动画入口在其上增加运动编排与验证。用户指定的来源门槛为 **原始 SSIM > 0.95**，同时校验执行、原生结构、零溢出、导出/严格回导和文件哈希；不再要求旧 0.999 验收布尔值通过。

当前 9 个 JSSDK 来源全部纳入，支持并列、列表、时间轴共 9 种变体。来源级别为 `high_similarity_verified`；原始 `exactSolution=false` 保留，衍生配方维持实验状态。其他五个家族仍是草案，不能当作已有来源覆盖。

包内保留入口、索引、配方、变体、原始 JSSDK 和报告。生成时只读命中家族：完整源码参与哈希校验，长装饰路径在模型上下文中显示为明确标注的结构摘要，保留 API 调用、对象尺寸和文本样式。

OfficeDex 禁止旧 backend 和旧关闭开关回退。新桥接必须声明 `pptx_jssdk_progressive.v2=true`；缺少 v2 的旧进程应重启更新。桌面打包 design、animation 和 video 三个 Skill。

新增独立 [动画 PPT](aippt-jssdk-animation/SKILL.md) 入口，合同 `jssdk-animation/v1`。首页选择「幻灯片 → 动画 PPT」，或由明确动画请求自动识别。工作流字段 `pptx_workflow=animation` 贯通桌面、Bridge、任务恢复和原生执行；静态构图仍使用 design 的合格来源。旧 Bridge 未声明 `pptx_jssdk_animation.v1` 时明确要求升级。

首版开放原生淡入、交错出现与自动播放，最多 12 页、120 秒、每页 16 个事件。动画参数导出回导一致、目标存在、文字无溢出和关键时刻播放变化均为交付门禁。PowerPoint 真机兼容、继续修改动画和客户端 MP4 导出尚待验收。

动画 Skill 源码以本目录为准；在相邻 `officecli-internal` 运行 `node scripts/sync-jssdk-animation-skill.mjs` 更新哈希清单和嵌入副本，再重建客户端与 OfficeCLI。原生探针和验证脚本位于 Skill 的 `scripts/`；测试证据和开发包说明见 `../../plans/officedex-animation-ppt-skill/IMPLEMENTATION.md`。新开发包位于 `build/animation-skill/OfficeDex.app`，同目录启动脚本配置本机 presentation checkout。

在相邻 `officecli-internal` 运行 `node scripts/sync-jssdk-design-skill.mjs` 从版本管理的蒸馏目录同步，再重建 OfficeCLI 与 OfficeDex。`availability.json` 分别记录 accepted 与 exact 数量，`snapshot.json` 记录文件哈希；不要修改原报告布尔值来假造精确通过。

本地完整前端构建仍缺少 `writer` checkout，可复用现有 `dist` 重建 Go 应用；DOCX 的 converter/字体缺口与此 PPT Skill 无关。正在运行的旧进程不会自动获得新代码。

此前静态 Skill 开发包位于 `build/skill-095/OfficeDex.app`，同目录 `launch-officedex.command` 会设置本地 presentation runtime 并启动该包。该包签名验证与包内 CLI 的 v2 能力探测通过；47 个 Skill 文件哈希一致。此包依赖本机 checkout，并非独立发布包；动画首版使用上文的 `build/animation-skill/`。

九页固定全文回归（八种变体）通过文字、容量、原生对象、导出回导检查，预览位于相邻 `artifacts/aippt/progressive-skill-095/review.html`。`rail-callouts`、其他五类以及独立模型生成评测仍待补齐。

2026-09-11 路由修复：此前开发包的本地桥接仍会把新版 backend 强制覆盖成旧 MOP；现已改为 `pptx.generate.jssdk.v2`，移除旧生成工作流，内容树/外部 render 使用新版，旧局部重生成明确报错。hosted 只提供模型调用，本次无需云端部署。修复包位于 `build/jssdk-routing-fixed/OfficeDex.app`，用同目录启动脚本启动。包内能力声明必须结合真实 task/invoke 回归验证。

真实 hosted 冒烟测试已通过：task `01a08f02-650e-7dd3-aebb-82f88bc4d52c`，最终 backend 为 `aippt-jssdk-design`；1 页并列内容选择 `parallel/marker-columns`，只加载 1 份源程序，共 10 个合同/配方/证据文件。独立 MJS 执行、渲染、导出和严格回导通过，并查看了 PNG。模型请求曾出现 EOF，自动重试后完成；这不是 10 页或完整审美验收。产物与审计记录位于 `artifacts/aippt/jssdk-routing-fixed/`。
