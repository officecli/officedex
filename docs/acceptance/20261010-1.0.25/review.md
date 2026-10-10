# 1.0.24 问题复核与 1.0.25 Test 修复

范围：2026-10-10 的 1.0.24 HTML 报告中的 N24-01–04。保持此前验收范围，只修复现有功能。

| 问题 | 本次发现与修复 | 防回归证据 |
| --- | --- | --- |
| N24-01 主画布空白 | 两种编辑器都依赖 iframe 的 requestAnimationFrame 完成绘制。暂停回调可重现 Word Presenting 和 PPT 仅有缩略图的同一表现。为 `wails:` 下的内嵌页面安装 250ms 有界帧时钟，原生帧和超时只执行一次，取消同时清理两者。 | WebKit + 真实 Go 后端，正常/暂停帧 × Word/PPT 四个场景；断言主 SVG 尺寸和正文，不能用缩略图、字数或 iframe 挂载成功代替。调度单测覆盖迟到回调、取消、重入；组件打包测试验证注入。 |
| N24-02 Review 被 Continue 代替 | 旧实现把审阅请求复用成普通确认问题，且默认 Apply。现在传递结构化 Before/After，渲染专用审阅卡，仅接受 review-apply/review-cancel。普通 Continue、文本回复和普通 apply 均不能写回。 | documentEditRun、docxEditRun、AgentRun 累计测试；覆盖普通 apply/Continue 无写入，再显式 Apply 写入。 |
| N24-03 严格内容有额外文字 | 查出 Render 请求将 Prompt 覆盖成 Topic、渲染构建未传 UserPrompt、导出未复核三个缺口；上次主要覆盖 Generate/Resume。本次贯通原始 Prompt，并执行同一导出校验；扩展 per slide、slide N、每一页、无其他可见文字等约束措辞。 | 保存报告 OD24-exact.pptx 为负例；真实转换器的 24 页 Render 正例独立解析每页标题、正文、句号和段落数；错误正文不得返回成品。保持 Generate/Resume 回归。 |
| N24-04 原生 ⌘S 不保存 | 原生事件日志确认：PPT session 先 preventDefault 并同步内部快照，外层快捷键把 defaultPrevented 当成已落盘而直接返回。旧测试没有注册这个先行监听器。本次让当前文档的 Save 仍执行外层导出，并在主窗口的新任务中调用保存；保留 macOS File/Save 菜单作为同一保存入口。 | 新增先行编辑器 preventDefault 的回归测试；原生菜单 accelerator Go 测试、主界面订阅/卸载测试；发布包另做原生键盘备注落盘复测。 |

## 证据边界

本机同一 1.0.24 二进制与报告旧 PPTX 在前台正常显示；帧暂停可确定复现两种空白表现，但尚未取得测试机系统版本及当时窗口状态，不能断言报告机器的唯一触发条件已经确认。完整生成 OD24-exact 的原始指令也未附在报告中；Render 入口丢失约束是代码和测试确认的缺陷，不能据此断言该附件一定经过此入口。上述修复覆盖已证实的缺口，保留这两个环境/输入复测项。

## 发布验证

版本 1.0.25，仅 macOS arm64 Test（beta）。签名、公证、源码提交、累计测试、原生快捷键落盘以及最终资产 SHA-256 记录于本地 `dist-artifacts/test-1.0.25/verification.json`；只有这些检查完成后才发布 Test 清单。
