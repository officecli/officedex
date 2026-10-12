# QA27 / N27-01：原位编辑的暂存副本被当作第二份交付

报告：`OfficeDex-1.0.27-问题走查报告-20261012.html`。报告原件和暂存件的 SHA-256 均为 `baa2001d014e6f7789bee34a1534dbd22f401a1faa2772ac4de7ef51f38e7c18`，正文已正确写回；缺陷是第二份结果/Recent 记录，不是原件未保存。

## 根因与历史遗漏

office.modify 为 Review/Apply 生成不可变暂存文件。worker 的 output/completed 表示提案准备完成，前端 Apply 才表示原件写回成功。此前把同一个 worker 输出同时投影成“修改建议”和“新文件”，Go 又把它写入 artifacts/recent/office_outputs。Review 为取得外部文件预览授权还调用 ImportLocalFile，读取差异也能再添一条文档记录。

这是之前原位编辑修复的交付语义遗漏，不能据此归因于 1.0.27 的重命名修复。原 N23 回归验证写回/Undo，却仍明确断言公开 artifact 是 `.modified.docx`；卡片回归没有断言只显示一份结果。新增断言在修改前触发 10 个失败，证明旧测试未覆盖且部分固化了错误契约。

## 修复

- 公开任务结果在 Apply 成功后指向原件，写回前、拒绝后、Undo 后不交付暂存文件；原始 worker 事件保留作诊断记录。
- 修改任务只显示一张结果卡片：待审阅时进入 Review，已应用时打开原件；Undo 保留。批量编辑也定位原件。
- 暂存文件只获得精确路径的预览授权，不注册为独立文档，不进入 Recent 或 Office outputs。Review 直接使用该授权，不导入暂存件。
- 查询时在分页前排除升级前遗留的暂存记录，重启仍有效，不删除历史数据库记录或磁盘文件。普通用户命名的 `.modified.docx` 不受影响。
- 会话标题及后续追问定位原件，不再沿着暂存文件继续工作。
- 明确要求另存副本时，将提案保存为暂存目录外的独立文件，避免覆盖已有文件，保持原件不变。

## 验证

确定性回归覆盖：报告原始 prompt 的附件路由、异步写回前后结果路径、单张结果卡片及打开目标、Review/拒绝/Undo、重启状态、后续追问、明确另存副本、历史记录分页/重启兼容、精确预览权限。

Go 集成测试使用报告原始 DOCX 并校验哈希。报告只附了应用后的文件，测试将其正文 Gamma approved. 还原为 Gamma pending. 构造编辑前文件；不声称重建了报告编辑前 ZIP 的逐字节哈希。Apply 后逐字节匹配报告附件，Undo 后逐字节匹配测试开始时文件。

真实 WebKit E2E 使用同一构造原件和报告原始 prompt，实际调用 hosted office.modify，验证：原件正文、只调用 Modify、单结果、Undo、重新 Review/Apply、打开原件、没有 modified 标签页、文档列表无暂存件。首次测试误选了隐藏的 Dex 副本，点击 Undo 超时；限定可见任务卡片后完整通过。此脚本显式 opt-in，避免普通回归依赖在线模型。

累积发布门禁继续保留既有 DOCX/PPTX 前台绘制、严格生成、Review、快捷键及三格式改名后保存/重试测试。最终测试计数、源码来源、签名公证、产物哈希及远端 Test 清单记录在 `dist-artifacts/test-1.0.28/verification.json`。Test 对应 beta；不修改 stable 清单。
