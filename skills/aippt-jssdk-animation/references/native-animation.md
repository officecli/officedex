# 原生动画合同 v1

独立模块导出 `async function build(PowerPoint, data, runtime)`。已有静态构图代码不变；创建对象时为需要动画的 shape 设置 `.name`，在提交动画前完成 `await context.sync()`。

```js
const video = runtime.video.createProject({
  width: 960, height: 540, fps: 30,
  sourceOfTruth: "native-pptx-timing",
  timebaseProfile: "presentation-v1", autoAdvance: true,
});
await PowerPoint.run(async context => {
  // 在这里从空白文档创建静态构图；每页所有动画目标都必须存在。
  // 示例只有一页；多页的 startMs 必须连续累加，并与实际页序一致。
  await context.sync();
  const scene = video.scene({id:"scene-1",slideIndex:1,startMs:0,durationMs:5000});
  scene.animate("body", {effect:"Entrance_FadeIn",start:"withPrevious",delayMs:300,durationMs:600});
  await video.commitNativeTiming(context);
  await context.sync();
});
return video.finalize({requireNativeTiming:true});
```

上例是动画调用摘录，不是可直接执行的静态模板。尺寸取实际文档大小；不要另写 manifest 动画关键帧驱动播放。首版只用 FadeIn、withPrevious、一次播放、无 rewind、无点击触发和自定义路径；所有 delayMs 均为页内绝对延时。动画结束至少早于换页 1000ms。每页至少一个可见内容对象需要动画，其余背景与标题可保持静态。

执行后校验：`node <skill>/scripts/validate-animation.mjs <presentation-root> <run-dir>`。运行目录包含 generated.mop、generated.pptx、reimported.mop、video-manifest.json 和 execution.json。校验只读取这些产物，通过原生渲染获得预览，绝不修改源包。
