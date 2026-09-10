# 视频质量参考

## 推荐节奏

15 秒样片可采用 4 个镜头：0–2.5 秒钩子，2.5–6 秒输入，6–10.5 秒变化，10.5–15 秒结果与 CTA。30 秒片采用 6–8 个镜头；每镜头至少保留 0.8 秒稳定阅读区间，CTA 至少 2 秒。

## 预览检查

- 从 MP4 抽取 12–20 张图组成 contact sheet。
- 单独检查时间戳 0、首个动效结束、每个切点前后 2 帧和最后一帧。
- 首帧不允许标题、卡片或 logo 只显示一部分。
- 切点不允许黑帧、白闪、旧镜头残影或对象突然改变位置。
- 任一镜头连续 1.5 秒没有信息变化时，缩短镜头或加入明确的状态变化。

## 工程检查

```bash
node presentation/tools/execute-jssdk.mjs <generated.mjs> <run-dir>
node presentation/tools/export-jssdk-video.mjs <run-dir>/generated.mop <run-dir>/video --manifest <run-dir>/video-manifest.json
ffprobe -v error -show_entries format=duration:stream=width,height,r_frame_rate,codec_name <run-dir>/video/*.mp4
```

保留 `generated.mjs`、`execution.json`、`video-manifest.json`、`export-report.json` 和 clean master。manifest 只记录场景和导出参数，不另存一份会覆盖 PPTX timing 的动画关键帧。
