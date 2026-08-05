# OfficeDex GenOffice 式 Excel 工作区设计

## 1. 背景与目标

OfficeDex 当前已经提供 GenOffice 式项目首页，但用户从首页点击 XLSX 生成入口后会切换到原有 Dialogue 页面。虽然渲染层已经移除 Ant Design，这条路径的信息架构、侧栏和生成交互仍保持旧形态，与“所有页面采用 GenOffice 交互”的目标不一致。

本阶段先完成 Excel 的完整工作流改造：新建 XLSX、显示生成过程、打开生成结果、打开本地 XLSX、直接编辑与保存、继续使用 AI 修改。整个过程始终位于新的项目壳层和 Excel 工作区内，不再显示旧 Dialogue UI。

本阶段采用 GenOffice Sheets 的工作区交互模型，但继续使用 OfficeDex 的 Wails、OfficeCLI、任务事件、账号和额度能力。不会移植 GenOffice 的 Electron 主进程或 AgentLoop。

## 2. 范围

本阶段覆盖以下 XLSX 生命周期：

- 从项目首页创建新的 XLSX。
- 选择 Workspace 项目或不加入项目。
- 输入生成需求并提交 OfficeCLI 生成任务。
- 在 Excel 工作区内展示规划、执行、完成和失败状态。
- 生成完成后自动打开 XLSX。
- 从最近文件打开生成产物。
- 打开用户选择过的本地 XLSX。
- 直接编辑工作簿并保存回 XLSX。
- 对已生成的 XLSX 提交 AI 继续修改指令。
- 处理未保存修改、加载失败、保存失败、文件缺失和权限错误。

本阶段不改造 PPTX、DOCX、Report、Image、GIF、Tasks、Settings、Login 和账户页面。这些页面后续按同一方向分阶段迁移。

## 3. 技术方案

采用独立的 `SpreadsheetWorkspace`，按 GenOffice 的“文档画布 + AI 助手”方式组织 Excel 工作流，同时复用 OfficeDex 已验证的 `@shimo/sdk-sheet` 编辑器探索成果。

不采用以下方案：

- 不只给现有只读 HTML 表格预览换皮，因为这不能提供 GenOffice 式直接编辑与保存体验。
- 不整体移植 GenOffice Sheets，因为其 Univer、Electron、AgentLoop 和文件层会与 OfficeDex 当前架构重复。

已验证的 XLSX 编辑能力从隔离分支选择性移植，包括 Wails 编辑会话、`office2modoc` 转换、`@shimo/sdk-sheet` 本地运行资源、MODoc 文件/目录包兼容、保存和未保存保护。移植时适配当前分支的 React 19、本地 UI facade 和无 AntD 边界，不直接合并探索分支。

## 4. 信息架构

```text
OfficeDex 项目侧栏
└── SpreadsheetWorkspace
    ├── SpreadsheetTopbar
    │   ├── 返回首页
    │   ├── 项目与文件名
    │   ├── 保存状态
    │   ├── 保存
    │   └── 外部打开与更多操作
    ├── SpreadsheetCanvas
    │   ├── 空白工作簿占位
    │   ├── @shimo/sdk-sheet 编辑器
    │   └── 加载与恢复状态
    └── SpreadsheetAgentPanel
        ├── 首次生成输入
        ├── 快捷提示
        ├── 任务步骤与消息
        ├── 错误重试
        └── 继续修改输入
```

项目侧栏默认保留，在 Excel 工作区中允许收窄或折叠。AI 面板默认展开并允许折叠；折叠后中央工作簿占用剩余空间。

## 5. 组件边界

### 5.1 SpreadsheetWorkspace

负责 Excel 工作区整体布局、当前 XLSX 会话、项目上下文和以下状态转换：

```text
empty -> generating -> loading -> ready -> dirty -> saving -> ready
                     \-> error
```

它不直接解析工作簿，也不包含 OfficeCLI 请求细节。

### 5.2 SpreadsheetTopbar

展示项目、文件名、保存状态和文档操作。支持：

- 返回首页。
- `⌘S` 保存。
- 保存按钮状态。
- 使用系统默认应用打开。
- AI 面板和项目侧栏的显示控制。

### 5.3 SpreadsheetCanvas

封装 `@shimo/sdk-sheet` 生命周期：

- 使用预览授权令牌准备编辑会话。
- 加载 MODoc 内容。
- 监听编辑器变更并上报脏状态。
- 序列化 MODoc 并调用保存接口。
- 切换文件或卸载时关闭编辑会话。
- 初始化失败时提供重试和外部打开。

该组件不负责提交 OfficeCLI 生成和修改任务。

### 5.4 SpreadsheetAgentPanel

负责首次生成和继续修改：

- 编辑和保留提示词。
- 选择项目上下文。
- 提交生成与修改。
- 展示规划、执行、完成和失败事件。
- 生成完成后通知工作区打开新 artifact。
- 失败时保留输入并允许重试。

### 5.5 useSpreadsheetSession

负责连接现有 OfficeDex 数据与副作用边界：

- OfficeCLI `generate` 和 `modify`。
- 任务事件和会话恢复。
- artifact 选择。
- 精确预览授权。
- 最近文件刷新。
- XLSX 编辑器 Prepare、Save 和 Close 接口。

## 6. 数据流

### 6.1 新建 XLSX

1. 用户在首页点击“电子表格”。
2. App 创建 XLSX 草稿并进入 `SpreadsheetWorkspace`，不设置 `activeNav="dialogue"`。
3. 用户在 AI 面板输入需求并选择项目上下文。
4. `useSpreadsheetSession` 调用现有 OfficeCLI `generate`。
5. 任务事件持续更新 AI 面板。
6. 完成事件产生 XLSX artifact。
7. App 获取精确预览授权并把 artifact 交给 `SpreadsheetCanvas`。
8. 后端通过 `office2modoc` 转换，编辑器加载 MODoc 内容。
9. 焦点进入工作簿。

### 6.2 打开已有 XLSX

本地文件和最近生成产物统一进入 `SpreadsheetWorkspace`。生成产物恢复关联会话和任务历史；本地文件建立独立编辑会话。两者都通过精确授权、Prepare 和 MODoc 加载进入中央编辑器。

### 6.3 保存

1. 单元格修改触发脏状态。
2. 顶栏显示“未保存”。
3. 用户点击保存或按 `⌘S`。
4. 编辑器序列化当前 MODoc。
5. Wails 后端更新 MODoc payload，并通过 `office2modoc` 导出到绑定的 XLSX。
6. 成功后清除脏状态并更新最近打开时间。
7. 保存期间发生的新编辑继续保持脏状态，不被错误标记为已保存。

### 6.4 AI 继续修改

1. 用户在右侧输入修改指令。
2. 如果当前存在未保存编辑，先要求保存或明确放弃修改。
3. 保存完成后调用现有 OfficeCLI `modify`，源文件使用当前 XLSX。
4. AI 面板展示修改任务事件。
5. 新 artifact 完成后关闭旧编辑会话并安全载入新结果。

## 7. 交互规则

- 新建阶段中央区域显示稳定的空白工作簿占位，生成输入位于右侧 AI 面板。
- 生成期间中央区域不跳转，旧 Dialogue、旧侧栏和通用 composer 均不出现。
- 生成完成后自动打开工作簿。
- 保存状态至少包含：未打开、已保存、未保存、保存中、保存失败。
- 返回首页、切换文件和关闭 App 时，如果有未保存修改，必须显示保存保护。
- 保存失败保留脏状态和当前编辑器内容。
- AI 继续修改不会静默覆盖用户尚未保存的单元格编辑。
- 编辑器运行资源全部随 App 本地打包，不使用远程 CDN。
- App icon 保持不变。
- GIF 能力、其他文档类型和现有数据保持不变。

## 8. 错误处理

| 场景 | 行为 |
| --- | --- |
| OfficeCLI 生成失败 | 保留提示词和项目上下文，AI 面板显示错误与重试 |
| XLSX artifact 缺失 | 显示文件已移动或删除，并允许从最近文件移除 |
| 文件权限不足 | 显示权限错误，允许重试或使用系统应用打开 |
| `office2modoc` 转换失败 | 中央区域显示转换错误，允许重试和外部打开 |
| SDK 初始化失败 | 销毁不完整会话后重新初始化 |
| 保存失败 | 保留脏状态，不关闭编辑器，不覆盖原文件 |
| 切换文件时有未保存修改 | 提供保存、放弃、取消三个明确操作 |
| 保存过程中再次修改 | 当前保存完成后仍保持未保存状态 |
| AI 修改时有未保存修改 | 保存或放弃前不提交修改请求 |

## 9. 后端与安全边界

- XLSX 编辑器只能读取由预览授权系统明确授权的文件。
- Prepare、Save 和 Close 必须校验 preview token 与 editor session 的绑定关系。
- MODoc 内容限制大小，避免无界 IPC 传输。
- 导出使用同目录临时文件和原子替换，失败时保留原 XLSX。
- 同时支持 `workbook.modoc` 普通文件和 `workbook.modoc/content` 目录包。
- 关闭会话时清理临时 MODoc 和会话状态。
- 不改变 OfficeCLI agent 或生成协议。

## 10. 测试与验收

### 10.1 自动化测试

- 首页点击“电子表格”进入 Excel 工作区，不出现旧 Dialogue UI。
- XLSX 类型、项目归属和提示词正确传给 OfficeCLI。
- 生成事件只更新 AI 面板。
- 完成事件自动载入生成 XLSX。
- 本地 XLSX和最近生成 XLSX 使用同一工作区。
- 单元格修改触发未保存状态。
- 保存成功、保存失败和保存中再次修改的状态正确。
- 返回首页、切换文件和关闭时触发未保存保护。
- AI 继续修改前正确处理未保存内容。
- 新 artifact 安全关闭旧会话并重新载入。
- MODoc 文件和目录包均可 Prepare、Save、Close。
- SDK 初始化失败、权限失败、文件缺失和转换失败都有恢复入口。
- Excel 工作区不依赖 AntD 或远程 CDN。

### 10.2 桌面验收

1. 首页进入新建 Excel，输入提示词并生成，确认过程中不出现旧 UI。
2. 生成完成后自动打开工作簿。
3. 修改单元格并按 `⌘S`，退出后重新打开，确认修改保留。
4. 从 AI 面板继续修改，确认新结果重新载入。
5. 从首页打开本地 XLSX，编辑并保存。
6. 未保存时返回首页，确认保存保护。
7. 收窄项目侧栏、折叠 AI 面板并调整窗口大小。
8. 运行 lint、Vitest、脚本测试、两种 Go 测试、生产构建和 Wails App 构建。
9. 校验 App 签名、版本、ARM64 架构和 icon 哈希。
10. 打出带分支标识的 ZIP 测试包。

## 11. 后续迁移

Excel 验证通过后，按同一工作区原则依次迁移 PPTX、DOCX、Report、Image/GIF，再迁移 Tasks、Settings 和账户页面。每种文档类型共享项目壳层，但拥有与其内容形态匹配的画布和 AI 面板。
