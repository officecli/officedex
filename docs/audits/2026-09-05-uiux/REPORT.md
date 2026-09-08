# OfficeDex UI/UX 逐页实测报告

日期：2026-09-05（桌面实例）  
范围：Home、Settings 9 个分区、任务状态页、XLSX 编辑器、DOCX 编辑器、PPTX 生成/预览、App Builder、图片预览。  
方法：在真实 OfficeDex 桌面窗口逐项点击、展开、切换和离开；同时对照源码定位候选根因。用户提供的两张截图仅作为问题线索，未当作操作指令。

## 结论

当前最影响用户信任和完成率的不是单一视觉细节，而是状态、能力和操作结果不一致：任务列表显示“运行中”但打开后已完成/失败；PPTX 已出现 `deck.end` 仍显示 Drawing；PPTX 编辑器不可用时“只读预览”仍回到错误页；免责声明打开后只见遮罩；XLSX 离开确认中的保存/丢弃按钮强调关系倒置。建议先修复状态机与降级路径，再处理响应式和视觉密度。

## 已实测问题

| 优先级 | 页面/触发路径 | 证据 | 问题与影响 | 优化方案 |
|---|---|---|---|---|
| P0 | PPTX 任务 → 打开 → 编辑器不可用 → Show read-only preview | `evidence/pptx-unavailable.png`, `pptx-readonly-failed.png` | 降级入口没有提供可读内容，仍显示同一转换器错误；用户无法完成查看 | 预览能力按文件类型独立；转换器缺失时提供稳定的 PDF/缩略图/系统应用打开，并将“只读预览”按钮隐藏或改为真实可用路径；错误文案本地化 |
| P0 | Home 侧栏运行任务 → 打开任务 | `task-ready-stale-sidebar.png`, `task-failed.png` | 侧栏状态与详情状态不一致，直接破坏可信度 | 由同一任务状态源驱动列表和详情；打开前刷新；状态迁移用 `queued/running/needs_input/succeeded/failed/cancelled`，禁止旧状态残留 |
| P0 | PPTX 生成完成后查看生产页 | `pptx-state-conflict.png` | AX 树有 `deck.end`/Ready，视觉仍显示 Drawing slides、2 images generating；完成态与进行态并存 | 以服务端终态覆盖阶段 UI；收到 `deck.end` 后停止 spinner、清理“generating”、切换主 CTA 为“打开/继续编辑” |
| P0 | Settings → About → Disclaimer | `disclaimer-dialog.png` | 打开后只有遮罩，正文弹窗不可见；信息不可读且疑似焦点被遮罩吞掉 | 检查 portal/z-index/opacity/transform；加入可见标题、正文、关闭按钮、焦点陷阱和 Escape；在 320/375px 验收 |
| P1 | XLSX 修改 → Back | `unsaved-dialog.png` | 三个英文按钮拥挤；Discard 使用高饱和危险色，Save and Continue 视觉不突出；窄窗易换行 | 竖向或两行操作区；Save 作为 primary，Discard 为低强调 danger；补充“将丢失哪些更改”；中文/英文分别测 320/440px |
| P1 | XLSX 编辑器 | `spreadsheet.png`, `sheet-layout-menu.png` | 顶栏同时放文件名、Unsaved、Create Deck、Create App、Save、外部打开、Agent；AI 侧栏常驻占用空间 | 固定 Save 与返回；Create Deck/App 收入“更多”；Agent 可折叠且记忆状态；窄屏优先保留文件名、Save、Agent |
| P1 | DOCX 完成预览 | `docx-editor.png`, `completion-strip.png` | 完成状态条固定在底部，和文档状态/工具栏重复；侧栏与正文争夺空间 | 将完成状态并入顶栏；底部只保留页码/缩放；完成态操作用统一命令区 |
| P1 | PPTX 生成页 | `pptx-state-conflict.png` | 阶段栏、实时操作流、编辑器、命令栏同屏；信息密度高，主操作被推到下方 | 阶段栏固定；操作流折叠；显示“已完成 N/M 页”和跳到最新；主 CTA 固定在底部 |
| P1 | App Builder → 直接点“Generate and preview” | `app-builder.png`, `app-preview-unrequested.png` | 尚未执行生成就出现“first version is ready”；汇总说明行被当成字段；预览统计不可信 | 预览步骤必须有明确 pending/ready 状态；首行说明排除为字段；字段类型和可见字段提供校验；生成前禁用第二步 |
| P1 | Settings → Connection | `settings-connection.png` | Jira/Liquipedia 明确提示运行时不支持，但仍展示完整输入和 Test and save（禁用）；用户不知道何时可用 | 不支持时显示 capability card 和升级/启用路径；隐藏或替换不可用表单；支持时才展示字段与提交 |
| P1 | Settings 全局 | `settings-generation.png`, `settings-subscription.png`, `settings-advanced.png` | 页面统一显示 Auto-saved，但兑换码、代理、连接又需要独立保存，保存语义矛盾 | 将状态拆为“已自动保存”和“待提交”；每个需提交区显示 dirty/saving/saved/error；失败可重试 |
| P2 | Home → Image | `home-image.png` | 输出类型切换后高级参数（比例、产品模板）直接插入输入区，底部工具栏高度和主按钮位置变化 | 高级参数折叠为“选项”；底部保留附件、目录、类型、提交；窄屏两行布局 |
| P2 | Home / Sidebar | `home-draft-cleared.png` | 长文件名大量省略号，状态仅以小圆点表达；重复任务难区分 | 状态使用本地化徽章和 tooltip；列表按进行中/需处理/最近分组；提供搜索和最近打开 |
| P2 | 图片预览 | `png-unsupported.png` | PNG 被判定为不支持预览，且错误标题把扩展名单独拆出；本可直接展示的格式被拒绝 | 内置 PNG/JPEG/WebP 预览；标题使用“无法预览此文件”并显示文件名；系统应用作为次级操作 |

## 源码审计候选项（尚未逐项运行时确认）

- `HomeScreen.tsx`/`home.css`：模板横向滚动隐藏滚动条，箭头在窄窗可能裁切；Recent 删除仅 hover 可见，触屏不可发现。
- `ProjectSidebar.tsx`：状态点的 aria-label 可能直接使用内部值（如 `plan_review`），需本地化。
- `src/renderer/ui/backend.ts`：当前固定 beautiful backend；项目约定的 `UI_KIT=antd|weboffice` 构建切换尚未看到运行时证据。
- `main.tsx` 同时加载多组全局 CSS；`shell.css` 与 `home.css` 存在旧规则和后续覆盖规则，需做选择器/z-index/断点审计。
- App Builder/Pubished App 使用绝对定位层叠，需专门检查返回、焦点和刷新生命周期。

## 推荐修复批次

1. **第一批（P0）**：统一任务状态源；修复 PPTX 终态；实现真实只读降级；修复 Disclaimer portal/z-index/焦点。
2. **第二批（P1）**：重做 XLSX 保存确认与工具栏优先级；收敛设置保存语义；修正 App Builder pending/ready 与字段识别。
3. **第三批（P2）**：窄屏响应式、Sidebar 可发现性、图片预览、全局 CSS 清理、UI kit 构建矩阵。

## 验收矩阵

- 视口：1440、1024、760、480、375、320px。
- 每个页面同时测：鼠标、键盘 Tab/Escape、长中英文、空/失败/进行中/完成状态。
- 通过条件：无关键元素越界；状态文案与详情一致；错误操作有可恢复路径；危险操作二次确认；焦点不落在遮罩后；中英文不混杂。

## 当前边界

本轮真实点击在 Mac 锁屏前完成上述证据采集；GIF、DOCX/XLSX 其他窄视口、Login 全流程、全部 App Builder 发布流程尚未完成运行时验收。源码工作区原有大量未提交改动，本报告未修改业务代码。
