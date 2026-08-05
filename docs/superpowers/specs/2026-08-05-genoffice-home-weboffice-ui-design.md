# OfficeDex GenOffice 式首页与 WebOffice UI 全量迁移设计

## 1. 背景

OfficeDex 当前使用 Ant Design，并已存在一个早期 `src/renderer/ui` facade、`UI_KIT` 构建变量和 AntD/WebOffice 双后端切换骨架。现阶段目标不再是渐进式双后端迁移，而是一次性交付以下两项改造：

1. 将应用默认入口改为 GenOffice 式首页 / 项目中心。
2. 从渲染层彻底移除 `antd` 与 `@ant-design/icons`，统一使用 `weboffice-design`、项目内兼容组件和 `lucide-react`。

本设计覆盖 `officedex`，不修改 `officecli-internal` 或其他兄弟仓库。应用现有图标、打包图标和品牌标识保持不变。

## 2. 已确认的产品范围

### 2.1 首期产品入口

新增 GenOffice 式首页作为应用默认入口：

- 左侧为 Workspace 项目栏。
- 右侧顶部展示 OfficeDex 生成入口。
- 右侧主体展示生成产物与用户打开过的本地文件。
- 点击文件后进入现有预览 / 生成工作区。
- 现有生成、修改、任务执行、设置、登录、更新和预览逻辑保持不变。

首页显示以下五类快捷入口：

- PPTX 演示文稿
- DOCX 文档
- XLSX 电子表格
- 研究报告
- 图片

GIF 能力和历史记录继续保留，但首页不展示 GIF 快捷入口。

### 2.2 Workspace 项目栏

项目栏沿用当前 Workspace 模型，并支持：

- “全部文件”入口
- 选中项目后筛选右侧文件
- 新建 Workspace
- 重命名 Workspace
- 移除 Workspace 关联
- 在 Finder 中显示 Workspace

移除 Workspace 只删除 OfficeDex 中的关联关系，不删除磁盘目录或目录内文件。

### 2.3 最近文件

最近文件同时包含：

- OfficeDex 生成产物
- 用户通过文件选择器打开过的本地文件

生成产物默认恢复对应会话或任务，进入现有工作区并打开预览。本地 DOCX、XLSX、PPTX、PDF 和 HTML 默认进入 OfficeDex 内部预览。仅当格式不支持内部预览时，才调用系统默认应用。

## 3. 设计原则

### 3.1 UI 依赖边界

- `src/renderer/ui` 是业务代码唯一允许使用的 UI 入口。
- 业务代码不得直接导入 `weboffice-design`、第三方 UI 组件库或具体后端实现。
- 删除 `UI_KIT`、Vite 双后端 alias、AntD backend 和构建时 UI 后端选择逻辑。
- 删除 `antd` 与 `@ant-design/icons` 依赖。
- 不模拟完整 AntD API，只实现 OfficeDex 当前真实使用的能力。

### 3.2 石墨设计规范

界面遵循全局 Shimo design system：

- 文档优先、安静、紧凑。
- 主文字使用 `#41464B`，弱文字使用其透明度层级。
- 页面主要使用白色、`#F9F9F9` 和 `#F7F7F7` 表面。
- 引导和聚焦场景稀疏使用 `#5DA4E3`。
- 使用 `PingFang SC` 字体体系。
- 控件高度遵循 `24 / 28 / 32 / 40` 节奏。
- 常规控件使用 `4px` 圆角，菜单和 Dialog 使用 `6px` 至 `8px` 圆角。
- 页面层级优先通过表面差异和完整边框表达，只有浮层使用克制阴影。

### 3.3 行为兼容

- 视觉实现以 Shimo 规范为准。
- 业务行为、字段校验、键盘操作、IME 输入、加载状态和错误反馈保持兼容。
- 兼容层 API 以仓库实际调用为边界，不提供未使用的 AntD 行为。

## 4. UI 架构

### 4.1 目录建议

```text
src/renderer/ui/
  index.ts
  components/
    Alert.tsx
    Empty.tsx
    Form.tsx
    Image.tsx
    Popover.tsx
    Progress.tsx
    Result.tsx
    Space.tsx
    Table.tsx
    Tag.tsx
    Timeline.tsx
    Typography.tsx
  services/
    dialog.tsx
    toast.tsx
  icons/
    index.tsx
  styles/
    tokens.css
    components.css
  types/
    index.ts
```

可直接由 `weboffice-design` 提供的组件仍通过 `ui/index.ts` 统一导出。项目本地组件应保持文件职责单一，不建立一个包含所有兼容逻辑的巨型文件。

### 4.2 直接使用的 WebOffice 组件

以下能力由 `weboffice-design@0.3.2` 提供，但需要通过 facade 收窄属性：

| OfficeDex UI 能力 | WebOffice 实现 | 适配重点 |
| --- | --- | --- |
| Button | `Button` | 类型、尺寸、图标、加载、danger |
| Input | `Input` | value、change、状态、IME |
| InputNumber | `InputNumber` | 数字转换、范围、步长 |
| Select | `Select` | options、value、搜索、禁用 |
| Radio | `Radio` | checked、change、disabled |
| Radio.Group | `RadioGroup` | value、items、模式 |
| Switch | `Switch` | checked、change、disabled |
| Tooltip | `Tooltip` | 内容、方向、显隐控制 |
| Dropdown | `Dropdown` | trigger、open、placement |
| Menu | `Menu` | item 模型、选择、子菜单 |
| Tabs | `Tabs` | items、activeKey、change |
| Spin | `Loading` | 尺寸、状态、容器布局 |
| Modal | `Dialog` | open、footer、关闭语义 |
| message | `Toast` | success、warning、error、loading |
| Alert | `MessageBar` + 本地封装 | tone、关闭、说明文本 |

### 4.3 组件库真正缺失的能力

以下能力未出现在 `weboffice-design@0.3.2` 的公开组件导出中，且 OfficeDex 当前正在使用：

| 缺失能力 | 当前使用场景 | 本地替代 | 行为边界 | 必测内容 |
| --- | --- | --- | --- | --- |
| ConfigProvider | 应用主题、AntD locale | 删除 | 使用项目 i18n 与 WebOffice Token | 中英文切换、主题样式加载 |
| Empty | 空列表和空任务状态 | `ui/Empty` | 图标、标题、说明、操作 | 空态文案和操作按钮 |
| Form | 设置、登录、问题反馈 | `ui/Form` | 字段、校验、提交、错误 | 必填、异步提交、IME、错误定位 |
| Image | 图片展示与预览 | `ui/Image` | 加载、失败、预览 | 错误资源、预览关闭、键盘操作 |
| Input.TextArea | 提示词和问题输入 | `ui/TextArea` | IME、长度、自适应高度 | 中文输入、粘贴、提交快捷键 |
| Input.Password | 密钥和密码输入 | `ui/PasswordInput` | 显隐、自动填充、禁用 | 显隐切换、复制限制、IME |
| Popover | 视口锚定面板、工具浮层 | `ui/Popover` | Portal、定位、碰撞、关闭 | 窗口缩放、滚动、边缘翻转 |
| Progress | 更新、下载、任务进度 | `ui/Progress` | 线性进度、状态色、标签 | 0、进行中、100、异常 |
| Result | 预览失败和完成反馈 | `ui/Result` | 状态、标题、说明、操作 | 成功、错误、无权限 |
| Space | 水平与垂直间距 | `ui/Space` | Flex、gap、wrap、align | 窄窗口换行和对齐 |
| Table | 任务与数据列表 | `ui/Table` | 列、行、空态、行操作 | 列渲染、空态、键盘和溢出 |
| Tag | 运行时和状态标签 | `ui/Tag` | tone、关闭、图标 | 状态色、禁用、关闭 |
| Timeline | 任务步骤与历史 | `ui/Timeline` | 状态、连接线、内容 | 运行、完成、失败、长文本 |
| Typography | 标题和正文语义 | `ui/Typography` | 语义标签、层级、截断 | 标题层级、复制、溢出 |

`Alert` 有 `MessageBar` 可作为视觉基础，但缺少与当前 AntD `Alert` 一致的调用方式，因此归入 facade 适配，不在业务代码中直接使用 `MessageBar`。

### 4.4 存在但 API 不兼容的能力

以下项目不能做机械 import 替换：

| AntD API | WebOffice 对应 | 兼容策略 |
| --- | --- | --- |
| `Modal` | `Dialog` | 统一声明式 Dialog 组件 |
| `Modal.confirm/info` | 无同名静态 API | 项目 Dialog service |
| `message` | `Toast` | 项目 Toast service |
| `Spin` | `Loading` | facade 统一 loading contract |
| `Radio.Group` | `RadioGroup` | 转换 item 与 change 签名 |
| `Dropdown` + `MenuProps` | `Dropdown` + `Menu` | 转换菜单模型和事件 |
| `Select` | `Select` | 转换 options、value 和搜索签名 |
| `InputNumber` | `InputNumber` | 转换 number/null 和边界行为 |
| `Tooltip` | `Tooltip` | 统一 title/content 和显隐属性 |

### 4.5 图标策略

- 删除全部 `@ant-design/icons` 导入。
- 优先复用 `weboffice-design` 的 SVG 图标资源。
- 组件库缺少的通用图标使用项目已安装的 `lucide-react`。
- 业务代码通过统一图标入口导入，避免页面直接混用多个图标源。
- OfficeDex App icon、窗口 icon、安装包 icon 和现有品牌图像保持不变。

## 5. 首页信息架构

### 5.1 页面结构

```text
App
├── ProjectSidebar
│   ├── Brand（现有 OfficeDex icon）
│   ├── Home
│   ├── All Files
│   ├── WorkspaceList
│   ├── Task History
│   ├── Settings
│   └── Account
└── HomeMain
    ├── RuntimeStatus
    ├── Greeting
    ├── CreationTypeGrid
    ├── RecentFileFilters
    └── RecentFileList
```

### 5.2 布局规则

- 左侧栏默认宽度为 `232px`，使用浅灰表面和右侧完整边框。
- 顶栏高度为 `52px`，只保留页面标题和运行时连接状态。
- 主内容以文件和生成入口为主，不增加营销卡片或无关指标。
- 生成入口使用紧凑卡片，五项同级展示。
- 最近文件使用列表 / 表格结构，不使用大尺寸文件卡片墙。
- 所有行操作在 hover、focus 和键盘导航时可见。
- 窄窗口下生成入口换行，文件列表保持名称优先并压缩次要列。

### 5.3 视觉规范

- 常规文字：`#41464B`。
- 次要文字：`#41464B99`。
- 弱边框：`#41464B1A`。
- hover 边框：`#41464B33`。
- 页面表面：`#FFFFFF`。
- 侧栏与弱背景：`#F9F9F9` / `#F7F7F7`。
- 常规圆角：`4px`。
- 卡片、菜单和 Dialog：`6px` 至 `8px`。

## 6. 首页数据模型与后端接口

### 6.1 统一最近文件模型

```ts
export interface RecentFile {
  filePath: string;
  fileName: string;
  documentType: string;
  source: "generated" | "local";
  workspaceId?: string;
  taskId?: string;
  conversationId?: string;
  lastOpenedAt: string;
}
```

### 6.2 存储

新增版本化 `recent_files` 表：

```sql
CREATE TABLE recent_files (
  file_path TEXT PRIMARY KEY,
  file_name TEXT NOT NULL,
  document_type TEXT NOT NULL,
  source TEXT NOT NULL,
  workspace_id TEXT,
  task_id TEXT,
  conversation_id TEXT,
  last_opened_at TEXT NOT NULL
);
```

写入时机：

- 任务产生 Artifact 时，以 `source=generated` upsert。
- 用户从文件选择器打开本地文件时，以 `source=local` upsert。
- 用户再次打开文件时更新 `last_opened_at`。
- 相同路径只保留一条记录。

数据库升级使用现有 `PRAGMA user_version` 迁移机制。迁移失败不得删除或重建现有数据库。

### 6.3 新增接口

渲染层 bridge 增加：

```ts
listRecentFiles(workspaceId?: string): Promise<RecentFile[]>;
removeRecentFile(filePath: string): Promise<void>;
renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary>;
openRecentFile(file: RecentFile): Promise<void>;
```

`openRecentFile` 负责统一更新最近打开时间和后端安全许可。渲染层继续决定进入哪个现有页面状态。

## 7. 用户流程

### 7.1 启动应用

1. 应用完成设置读取和运行时初始化。
2. 默认导航进入 Home。
3. 并行请求 Workspace 与最近文件。
4. Workspace 加载失败不阻断最近文件；最近文件加载失败不阻断项目和设置入口。

### 7.2 新建生成

1. 用户点击首页生成类型。
2. 进入现有新建对话工作区。
3. 预选对应 `documentType`。
4. 保留现有默认参数、设置和生成流程。

首页不展示 GIF，但通过历史会话、现有页面或深层入口继续保留 GIF 能力。

### 7.3 打开生成产物

1. 根据 `conversationId` 或 `taskId` 恢复现有任务。
2. 进入 Dialogue 工作区。
3. 对支持内部预览的 Artifact 请求 preview token。
4. 打开现有 PreviewPanel。
5. 更新最近打开时间。

### 7.4 打开本地文件

1. 用户通过系统文件选择器明确选择文件。
2. 后端只将该精确文件加入预览安全许可，不信任整个父目录。
3. 支持的 DOCX、XLSX、PPTX、PDF 和 HTML 使用内部预览。
4. 不支持内部预览的格式调用系统默认应用。
5. 记录或更新最近文件。

### 7.5 文件失效

- 文件不存在：Toast 提示文件已移动或删除，并提供从最近列表移除的操作。
- 文件无权限：提示权限问题，不自动扩大可信目录。
- 格式不支持：提示将使用系统默认应用。
- 预览失败：保留“系统打开”和“在 Finder 中显示”作为恢复路径。

## 8. 安全边界

- 本地文件必须来自用户明确的文件选择器操作或既有可信 Workspace。
- 用户选择单个文件时只授权精确路径，不把父目录加入可信根。
- 最近文件记录不等于永久预览授权；打开时重新校验路径、存在性和格式。
- 不允许相对路径、空字节路径或越过 Workspace 的路径绕过预览 registry。
- 移除 Workspace 和最近文件记录不删除用户磁盘数据。

## 9. 错误处理

- UI 组件异常不得静默降级成无样式原生控件。
- Dialog、Toast、Popover 使用统一 Portal host。
- Form 保留字段级错误、提交级错误和焦点定位。
- 数据库迁移失败时保留现有任务和 Workspace 数据，并允许用户进入设置和诊断。
- 首页各数据区独立显示加载、空状态和错误状态。
- 所有错误信息进入现有诊断和日志链路，但 UI 不展示敏感路径或凭据。

## 10. 测试与验收

### 10.1 UI facade

- 每个 facade 组件有契约测试。
- 覆盖默认、hover、press、disabled、alert 和 loading 状态。
- 覆盖 Dialog/Toast/Popover Portal 行为。
- 覆盖 Form 校验、IME、Password 显隐和 TextArea 提交快捷键。
- 覆盖 Table、Timeline、Progress、Tag 和 Empty 的关键状态。

### 10.2 首页

- 默认进入 Home。
- Workspace 选择能够筛选最近文件。
- “全部文件”取消筛选。
- 五类生成入口进入正确的新建状态。
- 首页不出现 GIF 快捷入口。
- App icon 与现有资源一致。
- 生成产物和本地文件正确排序、去重和分组。
- 缺失文件能够提示并移除记录。
- 最近文件能够进入现有内部预览 / 生成工作区。

### 10.3 后端与存储

- `recent_files` 数据库升级测试。
- upsert、排序、Workspace 筛选和删除测试。
- Workspace 重命名测试。
- 精确文件许可测试。
- 相对路径、越界路径、空字节和不支持格式测试。

### 10.4 现有业务回归

- 生成与修改任务。
- 登录和账户状态。
- 设置与 Provider 表单。
- 应用更新和强制更新。
- 任务历史和诊断。
- PPTX、DOCX、XLSX、PDF 和 HTML 预览。
- PPTist 编辑与导出流程。

### 10.5 静态边界检查

源码扫描必须确认以下内容为零：

```text
from "antd"
from "antd/*"
@ant-design/icons
.ant-*
UI_KIT
@vo-ui/backend
```

依赖树必须确认 `antd` 和 `@ant-design/icons` 已移除。

### 10.6 完整验证

- `npm test`
- lint
- TypeScript 类型检查
- Vite 构建
- Wails / 桌面构建
- `git diff --check`
- 真实桌面应用：首页 → 项目筛选 → 新建生成 → 最近文件 → 内部预览
- App icon 源文件、构建产物和实际窗口三处核对

## 11. 实施顺序

虽然最终一次性交付，内部实施按以下顺序降低风险：

1. 建立单一 WebOffice facade 和设计 Token。
2. 实现缺失组件及其契约测试。
3. 将现有业务页面迁移到 facade。
4. 迁移图标并清理 AntD 样式选择器。
5. 增加最近文件存储、接口和安全许可。
6. 实现 GenOffice 式首页。
7. 删除 UI 双后端和 AntD 依赖。
8. 完成静态边界、自动化测试、构建和真实桌面验收。

## 12. 非目标

- 不修改 OfficeCLI agent 或生成协议。
- 不重构 OfficeDex 现有生成工作区的信息架构。
- 不制作新的 App icon 或品牌系统。
- 不删除 GIF 能力和历史数据。
- 不模拟完整 AntD API。
- 不删除用户 Workspace 或磁盘文件。
