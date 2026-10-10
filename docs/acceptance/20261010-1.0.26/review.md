# QA24 补充材料复核与 1.0.26 Test

范围：补充的 `OfficeDex-1.0.24-问题走查报告-20261010.html`。该报告测试的是 1.0.24，不是对 1.0.25 的复测。继续修复现有功能，不新增五种文档格式。

## 发现与修复

1. Writer 的预计算字体资源已从 JSON 升为二进制 BIN，Go 字体路由仍只接受 64 位哈希加 `.json`。补充日志中的 `ca23608c…bin` 等请求被拒绝。允许内容寻址的 `.bin`，保留旧 `.json`；路径穿越、非哈希文件名和额外扩展名仍被拒绝。
2. 完整 macOS 构建更新了 Writer 前端，却没有同步它的字体资源。1.0.25 包内有 194 个旧 JSON、0 个 BIN，而同批 Writer 产物有 199 个 BIN。只修路由仍会 404。现在 Writer 重建和缓存命中都同步字体；打包前逐文件比较资源与本批 Writer 产物的内容指纹，不一致即阻止打包。
3. 原渲染 E2E 走 Vite 的独立字体中间件，未验证真实 Go 路由。现在字体、DOCX 导入/导出均走生产 Go handler；使用补充报告原始 DOCX，检测资源失败，要求实际成功加载 BIN，并检查主画布正文、缩放、切换回来和关闭重开。macOS 构建在生成最新前端后强制运行该 WebKit 门禁。

## 原始 office.generate 路径

补充材料证实原任务只走 office.generate，没有 office.render。此前 Render 修复是有效的独立缺陷，但不能作为这次原任务的完整验证证据。

新增脱敏原始请求 fixture（仅移除测试机绝对输出目录）：fast、hosted、mop-skill、design、images=true、文件名和完整 prompt 均保留。测试经过 task/invoke → office.generate workflow → 参数解析/提示准备 → progressive generation → 真实 MOP 转换器 → 本地 PPTX 文件。仅远端模型返回受控数据；不是线上模型质量验证。独立解析导出文件：恰好 24 页，每页恰好 `Page N` 和 `Office item N is filed.` 两个文本节点，句号保留，无文件名和重复正文。

另补 Service.Generate 同措辞测试，报告旧失败成品使用原始 prompt 做拒绝回归，保留 Generate/Render/Resume、Review 和原生 Save 历史门禁。原始 Generate 请求在 1.0.25 修复后的内容校验代码上通过，本次没有以重复修改生成代码代替验证。

## 为什么此前漏检

- 只校验字体目录存在，未校验它与编辑器是同一批产物；SDK 数据格式升级后，旧资源仍被当作可用。
- 字体单测只覆盖旧 JSON，浏览器路径与安装包资源路径不一致。
- 缺少原始 prompt 和真实 DOCX 时使用了替代样本；测试通过不足以证明原报告闭环。
- editor.ready、字数和缩略图不是主画布已绘制的证据。

现在这些差异分别由二进制资源测试、逐文件打包检查、生产 handler 的 WebKit 测试、原始请求完整入口测试覆盖。

## 证据与限制

原始 DOCX SHA-256：6b538ca1a37b360e19a5c0422d30eab6edd71eb1053c3122339ebf3601764473。
测试机：macOS 26.6.2、Apple M5 Pro；补充复测明确处于前台。

修复前 Go 单测和真实 Go 路由 E2E 均复现 BIN 404。只放开路由仍失败；同步字体资源后通过。此前本机 1.0.25 原生前台可以显示原 DOCX/PPT，但 Word 退化成后备字体；因此不把字体缺陷宣称为测试机持续空白的唯一原因，也不把旧报告当作新包仍失败。保留上一版有界帧时钟修复，并执行新包原生前台检查。

累计测试、签名、公证、资源一致性、新包原生检查、发布源提交、资产哈希和远端渠道验证记录于本地 `dist-artifacts/test-1.0.26/verification.json`。只有发布前全部必需检查通过才更新 macOS ARM Test（beta）清单。
