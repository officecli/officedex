---
name: aippt-jssdk-video
description: 用 JSSDK 先生成可编辑 PPTX 场景和原生 timing，再导出节奏清晰、可验证的产品视频；适用于 PPTX 宣传片、产品演示和短视频样片。
---

# JSSDK 视频生成

视频的创作源是独立的 `generated.mjs`：从空白演示文稿创建原生文字、形状和必要资源，并在同一次 build 中声明 `runtime.video` 的场景和动画。PPTX/MOP 的 native timing 是动画唯一真源，MP4 只是它的派生输出。

生成前先写清楚受众、一个核心承诺、镜头顺序和每镜头的视觉焦点。产品短片优先 6–8 个 2–5 秒镜头；每个镜头只传达一个变化，采用“前状态 → 变化 → 后状态”，不要把一页静态 PPT 停留五秒再换页。

动效默认使用稳定、可跨端复现的 `FadeIn`、`FloatIn`、`WipeIn`、有限的 `Zoom` 和组级平移。对文字和卡片避免 `Split`、`Circle`、`RandomBars`、`Diamond`、`Strips`、`Bounce` 等容易产生裁切、白闪或几何跳变的效果，除非先用逐帧预览确认。不要给同一视觉元素叠加多种 entrance、motion 和 emphasis；一组对象共享一个入场节奏，重点对象最多再加一次轻微强调。

首帧必须是完整、可读的稳定画面：标题、品牌和背景在时间 0 不得被裁切。所有动画目标都要有稳定名称和 logicalId；动画提交后检查 target 是否存在，缺失时让构建失败。为中文文本留出足够高度，使用 `measureText` 和原生渲染结果双重检查。

默认输出为 16:9、1920×1080、30fps；若当前 Host 只能以 960×540 渲染，保留 clean master 并在导出报告中记录实际分辨率，不把简单放大称为高清。视频至少验证：JSSDK 执行、原生 timing、PPTX 导出/回导、逐帧渲染无错误、无文字溢出、无黑帧/冻结帧、音频响度和最终编码可解码。

视频质量复核时先看 contact sheet，再看首帧、每个镜头切点和末帧。发现首帧裁切、过渡白闪、镜头停滞、动效堆叠或 CTA 阅读时间不足，回到 `generated.mjs` 调整后重新导出。

详细的镜头节奏、验收阈值和项目命令见 [video-quality.md](references/video-quality.md)。PPTX 对象和动画继续遵守 `aippt-jssdk-design` 的 JSSDK 合同。
