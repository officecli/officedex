# 当前项目原生执行

本机 workspace 为 `/Users/agent/askuy/code/vibeofficing`，其他机器由实际工作目录确定。先读 `presentation/AGENTS.md`、`presentation/packages/presentation-office-js/README.md`；执行用 `presentation/tools/execute-jssdk.mjs`。

入口示意，只规定 API 接线，不规定整页布局。它是 `generated.mjs` 的起点；不要先编辑 PPTX 再补写 JSSDK：

```js
export async function build(PowerPoint, _data, { measureText }) {
  await PowerPoint.run(async context => {
    const count = context.presentation.slides.getCount();
    await context.sync();
    if (count.value !== 0) throw new Error("Requires an empty presentation");
    context.presentation.pageSetup.slideWidth = 960;
    context.presentation.pageSetup.slideHeight = 540;
    context.presentation.slides.add();
    await context.sync();
    const slide = context.presentation.slides.getItemAt(0);
    slide.background.fill.setSolidFill({ color: "#FFFFFF" });
    // 为本次内容创建原生形状与文字。
    await context.sync();
  });
}
```

所有形状和连接线的 width、height 必须非负；用合法起点及 rotation 表达方向，不能把负向端点差直接当作宽高，否则 PPTX 导出会失败。

几何位置和字号单位均为 pt。`slide.shapes.addTextBox(text, {left,top,width,height})` 创建文字；`addGeometricShape("Rectangle"|"Ellipse", bounds)` 创建基本形状。`shape.fill.setSolidColor("#RRGGBB")` / `fill.clear()` 设置填充；`shape.lineFormat.visible = false` 隐藏轮廓，显式边线使用 `color`、`weight` 等当前已支持字段。

文字框显式设置四边 margin、`verticalAlignment`、`wordWrap`、`autoSizeSetting`。自由排版可使用 `AutoSizeNone`，先给足空间再检查实际渲染；不要依赖静默自动缩字。通过 `textFrame.textRange.font` 设置 `size/name/eastAsianName/language/bold/color/spacing`；通过 `paragraphFormat` 设置 `horizontalAlignment/lineSpacingMultiple/spaceBeforePoints/spaceAfterPoints`。`name` 控制西文字体、`eastAsianName` 控制中文，记录实际字体可用性。本机可优先考虑已有 PingFang SC/Arial，而不声称其他机器具有相同字体。

`measureText(requests)` 是当前浏览器 Canvas 预检。请求字段与示例见 `presentation/tools/lib/jssdk-native-runtime.mjs`；它不能替代最终文字布局检查。完整 `textRange.text` 的换行建立真实段落。原生文档直接注入 MOP block、复用整页参考 PNG、用其他 PPT 库代替 JSSDK 都不能证明本次公开 SDK 创作能力。

在 workspace 根目录执行生成的 `generated.mjs`。执行器会在验证目录中派生 MOP、PNG 和 PPTX；这些不是 Skill 的创作输入：

```bash
node presentation/tools/execute-jssdk.mjs <本次程序.mjs> <新输出目录>
```

执行器输出 `generated.mop`、`generated.pptx`、`reimported.mop`、`native/slide-0001.png` 和 `execution.json`。从 `execution.json` 检查 `render.errors`、每个 `textLayout[].overflow` 和字体探针，并打开 PNG 检查视觉。默认参数以当前执行器实现为准；需要覆盖时使用 `MOP_RUNTIME_ENTRY`、`MOP_WASM_ENTRY`、`MOP_CONVERT_BIN` 和 `MOP_BROWSER_EXECUTABLE`。

本机已有浏览器：`/Users/agent/Library/Caches/ms-playwright/chromium_headless_shell-1228/chrome-headless-shell-mac-arm64/chrome-headless-shell`。路径可能随安装变化；先检查存在性再用，不需要为了复用历史版本而伪造浏览器缓存。

## 本轮长中文验证得到的实现边界

2026-09-10 的 `unseen-v2` 中，Canvas 认为长中文正文可换行，原生 Host 在 `wordWrap=true` 下仍出现横向溢出；不要继续缩小字号。`unseen-v3` 按实际字体测量字符宽度，在新的 JSSDK 文本中插入显式换行，逐字保留内容后重新检查。断行处避免让句号、逗号成为行首；中英文混排还需保留单词边界。此工作绕开当前 Host 的换行差异，不代表已经修复渲染引擎。

`addTextBox` 后显式 `shape.fill.clear()`、`shape.lineFormat.visible=false`，避免新框继承主题填充/轮廓；字号、中文字体、margin 和段间距都显式设置。正文区域放不下时扩大或重排，不能拿不一致的预检宽高作为通过依据。源形状有自动缩字时，只借鉴其构图，容量不能未经验证照搬。

## 保留来源复杂轮廓

源码视图列出原始 `sN` 形状 ID。使用 `slide.shapes.addCustomGeometry({...jssdkSourceGeometry("source-id", "sN"), left, top, width, height})` 复用形状路径，按来源保留填充、描边与组件层叠；helper 只提供几何，不会猜内容或替换布局。

OfficeCLI 验证所选证据后自动将完整路径嵌入成稿。直接编写时保存 draft.mjs，执行 `node scripts/expand-source-geometry.mjs draft.mjs generation-plan.json generated.mjs [catalog-root]`，再执行 Host。只允许计划中已验证来源，未知 ID 和哈希不匹配会失败。最终 generated.mjs 自带几何数据，不依赖样张文件，不修改原始 PPTX。

选中计划 required_geometry 中的主体轮廓会自动进入经过校验的 helper 目录，允许封装函数通过参数传入这些 ID。其他可选轮廓需要显式字面量引用。未选来源和未知形状会报错；逐页原生路径校验仍要求主体组件实际生成。
