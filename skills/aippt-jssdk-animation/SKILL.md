---
name: aippt-jssdk-animation
description: 在 OfficeDex 中通过项目 JSSDK 生成可编辑动画 PPT，适用于标题淡入、卡片或列表交错出现及自动放映；支持原生动画验证，MP4 为可选派生产物。
---

# 动画 PPT

主产物是可编辑 PPTX；独立 `generated.mjs` 同时创建对象与原生动画。桌面请求使用 `pptx_workflow=animation`，由 Host 执行，动画唯一真源为 PPTX/MOP native timing。

静态构图继续加载 aippt-jssdk-design 已选中的源码和证据，保留全文与对象关系。动画入口补充运动编排，不能绕过静态来源门槛或退回通用布局。

首版读取 [原生动画合同](references/native-animation.md) 和 `registry.json`，按需要选择 [层级淡入](references/fade-sequence.md) 或 [交错出现](references/stagger.md)。在同一次 build 中完成对象创建、context.sync、commitNativeTiming，并返回 finalize。使用稳定且每页唯一的对象名称。

先确定每页的信息顺序和阅读时间。无时长要求时每页默认 5 秒；标题和背景在首帧保持稳定，正文/卡片按语义先后出现，最后保留至少 1 秒阅读时间。首版最多 12 页、120 秒、每页 16 个淡入事件；超出容量返回具体缺口，保留用户输入，不静默删页。

首版支持原生 FadeIn 与错开的 withPrevious 延时；复杂粒子、虚化、路径、逐词效果和任意外部文档的动画修改尚未进入稳定配方。明确效果与当前能力冲突时说明缺口，不把整页截图、外部视频或重复轮廓帧伪装成已支持的原生运动。

生成后运行 [校验脚本](scripts/validate-animation.mjs)。它检查导出和严格回导的动画目标、顺序、参数、自动播放、静态文字布局，以及动作前后原生帧确有变化。失败时依据具体诊断修复同一份源码，最多三次；保存失败证据，不交付伪装成功的静态 PPT。

交付 PPTX、源码、场景 manifest 与 animation-validation.json。当前完成的是项目内验证，未做 PowerPoint 真机检查前不得声称跨端完全一致。导出视频时使用 aippt-jssdk-video；仅请求 PPTX 时不强制编码视频。后续新增配方须保存最小实测样例与版本证据，再更新 registry。
