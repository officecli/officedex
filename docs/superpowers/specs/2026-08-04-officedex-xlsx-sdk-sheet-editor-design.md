# OfficeDex XLSX 石墨表格编辑器探索设计

## 目标

将 OfficeDex 当前基于 SheetJS HTML 渲染的 XLSX 只读预览替换为与
`lizard-service-ai2` 相同的 `@shimo/sdk-sheet` 表格编辑器，并支持将编辑结果
直接覆盖保存到原 XLSX 文件。

本需求在 `explore/xlsx-sdk-sheet-editor` 探索分支实施。当前阶段仅服务本机
Apple Silicon macOS 开发，不接入正式构建、CI、发布工作流或安装包。

## 已确认约束

- 只替换 XLSX 表格编辑器，不接入 Copilot、会话或 spreadsheet adapter。
- Office 与 MODoc 的互转使用 `office2modoc-ffi` 发布的二进制，不引入其源码。
- 当前固定使用稳定发布 `version-0.1.34-260702-1130`。
- 二进制只保存在 Git 已忽略的本地缓存目录，不提交到仓库。
- 编辑后保存必须覆盖原 XLSX 文件。
- 转换或保存失败时不得破坏原文件。
- 当前探索阶段只支持 `darwin/arm64`，其他平台返回明确的“不支持”错误。

## 方案选择

### 采用：进程内动态加载 FFI 二进制

OfficeDex Go 后端通过带 `darwin && arm64` build tag 的小型 cgo 适配器，在运行时使用
`dlopen`/`dlsym` 动态加载 `liboffice2modoc_ffi.dylib`，不在链接期绑定该 dylib。适配器调用公开 ABI：

- `shimo_import`：XLS/XLSX 转 MODoc
- `shimo_export`：MODoc 转 XLSX

FFI 数据结构在 OfficeDex 的适配层中按已发布头文件重新声明，不复制或提交
`office2modoc-ffi` 源码。动态加载避免在编译期链接本地 dylib，也避免将本地绝对路径
写入产物。`shimo_import` 与 `shimo_export` 均直接返回 `uint8_t` 状态码；本需求不调用
返回 `Result_t *` 的 `calculate_secret`，因此也不解析或释放该结果类型。非 `darwin/arm64`
使用不包含 cgo 调用的 stub，返回明确的平台不支持错误。

### 未采用方案

- 额外编译转换辅助进程：会增加新的可执行程序和源码维护面，不符合“只引二进制工具”。
- 手工预转换和手工导出：无法满足在 OfficeDex 内直接打开、编辑并覆盖保存。
- 将 dylib 提交到 Git 或 Git LFS：当前阶段不需要正式分发，会显著增加仓库体积。

## 本地二进制布局

默认路径：

```text
build/cache/office2modoc/0.1.34/darwin-arm64/liboffice2modoc_ffi.dylib
```

`build/cache/` 已在 `.gitignore` 中，不新增二进制跟踪规则。

运行时查找顺序：

1. `OFFICE2MODOC_FFI_PATH` 指定的绝对文件路径
2. 仓库开发目录下的默认缓存路径

适配层应验证：

- 文件存在且为普通文件
- 当前系统为 `darwin`、架构为 `arm64`
- dylib 可以被加载
- `shimo_import` 与 `shimo_export` 符号存在

不自动联网下载，不把下载动作放进 `npm install`、`prebuild`、Wails build 或发布脚本。

## 组件边界

### Go：`internal/office2modoc`

职责：

- 定位并动态加载本地 FFI 二进制
- 将 Go 参数安全转换为 C ABI 参数
- 调用 XLSX → MODoc 与 MODoc → XLSX
- 在单进程互斥锁内串行执行转换，避免对 FFI 的并发安全作未经验证的假设
- 将 FFI 状态码映射为稳定的 Go 错误
- 管理转换临时目录和文件清理

该包不依赖 React、预览组件或 Wails UI。

### Go：XLSX 编辑会话服务

职责：

- 使用 preview token 通过现有 `preview.Registry` 解析受信任的原始文件路径
- 校验 token 指向 `.xlsx` 文件
- 为一次编辑创建临时会话目录
- 记录打开时原文件的大小、修改时间和内容摘要，作为并发修改基线
- 调用 `office2modoc` 导入并返回 MODoc 内容
- 接收新的 MODoc 内容并导出 XLSX
- 使用同目录临时文件和原子重命名覆盖原文件
- 在预览关闭、preview token 撤销或应用退出时清理临时会话
- 应用启动时清理本组件创建且超过 24 小时的崩溃遗留临时目录；活动会话不按编辑时长过期

对 renderer 暴露三个窄接口：

```text
PrepareXlsxEditor(previewToken) -> { sessionId, modocContent }
SaveXlsxEditor({ previewToken, sessionId, modocContent }) -> { filePath }
CloseXlsxEditor({ previewToken, sessionId }) -> void
```

`sessionId` 绑定 preview token 与规范化后的原文件路径，防止前端替换保存目标。

### React：`XlsxViewer`

职责：

- 调用 `PrepareXlsxEditor`
- 动态加载 `@shimo/sdk-sheet`
- 使用 `mode: { type: "standard", role: "editor" }` 创建编辑器
- 将 `modocContent` 作为 SDK 初始化内容
- 监听内容变更，维护 dirty 状态
- 保存时调用 `editor.content.getContent().stringify()` 获取当前 MODoc 内容
- 调用 `SaveXlsxEditor` 并展示保存中、成功或失败状态
- 卸载时调用 `CloseXlsxEditor`，并销毁 SDK 实例和 ResizeObserver

不再使用 SheetJS `sheet_to_html`、手工工作表标签或缩放 HTML 表格的旧实现。

## 数据流

### 打开

1. 用户打开一个已获 preview grant 的 XLSX artifact。
2. `XlsxViewer` 将 opaque preview token 传给 `PrepareXlsxEditor`。
3. Go 后端从 `preview.Registry` 获取已验证的真实文件路径。
4. 后端创建会话临时目录和 MODoc 输出路径。
5. `shimo_import` 以 `file_type = 1` 将 XLSX 转为 MODoc。
6. 后端读取 MODoc 文件内容并返回 renderer。
7. `@shimo/sdk-sheet` 初始化、挂载并进入 editor 模式。

### 编辑

1. 所有编辑发生在 SDK 内部 MODoc 模型中。
2. 内容变化监听只更新 dirty 状态，不自动写回 XLSX。
3. 本阶段不启用多人协作、评论、历史、关注选区、表单、跨表引用等在线能力。

### 保存并覆盖

1. 用户点击保存，或在 XLSX 编辑器获得焦点时按 `Cmd+S`。
2. renderer 调用 `editor.content.getContent()`，再调用 `stringify()` 得到 MODoc 字符串。
3. Go 后端验证 `sessionId`、preview token 和原始路径仍匹配，并重新计算原文件基线；
   若文件已被外部修改、替换或删除，则拒绝覆盖并要求用户重新打开。
4. 后端将 MODoc 字符串写入会话临时文件。
5. `shimo_export` 将临时 MODoc 文件导出为原文件同目录下的临时 `.xlsx`。
6. 后端确认导出文件存在且非空，能够作为 ZIP 打开，并至少包含
   `[Content_Types].xml` 与 `xl/workbook.xml`。
7. 后端复制原文件权限到临时文件，刷新并关闭临时文件后，使用同文件系统的原子
   `rename` 覆盖原 XLSX；随后刷新父目录，降低崩溃时目录项未落盘的风险。
8. 后端更新当前会话的原文件基线；renderer 清除 dirty 状态。

任何步骤失败都删除临时导出文件，并保留原 XLSX 不变。

## FFI 调用约定

导入参数使用：

- `input_office_file_path`：原 XLSX 绝对路径
- `shimo_file_path`：会话临时 MODoc 文件路径
- `temp_path`：会话临时目录
- `file_type`：`1`
- `limit`：固定传
  `{"slideSize":10000,"wordCharCount":100000000,"excelSingleSheetCell":2000000,"excelAllSheetCell":5000000}`，
  不在 renderer 中开放覆盖；后端另外拒绝超过 100 MiB 的输入 XLSX、超过 256 MiB 的
  MODoc 输入或输出，避免无界内存和磁盘占用
- `lang`：`zh-CN`

导出参数使用：

- `output_office_file_path`：同目录临时 XLSX 路径
- `shimo_file_path`：会话临时 MODoc 文件路径
- `temp_path`：会话临时目录
- `file_type`：`1`
- `to_type`：`xlsx`
- `lang`：`zh-CN`

`request_id` 使用每次转换生成的 UUID。`password` 默认为空；遇到密码保护文件时返回
明确错误。本地离线转换不向 renderer 暴露 token、配置路径或任意文件路径参数。

## SDK 静态资源

依赖版本与 `lizard-service-ai2` 对齐：

- `@shimo/sdk-sheet@5.0.14-jsapi.4`
- `@shimo/editor-sdk-core@0.0.1-124-jsapi.51`

当前探索阶段只保证 Vite/Wails 开发模式可加载 SDK 主文件、chunk、CSS 和简体中文语言包。
不把 SDK 资源接入正式安装包的复制和签名流程；正式发布支持留给后续独立设计。

## UI 行为

- 原有预览头部和外部打开入口保留。
- XLSX 内容区域改为占满可用空间的石墨表格编辑器。
- 工具栏展示保存按钮和状态：`未保存`、`保存中`、`已保存`、`保存失败`。
- 保存进行中禁止重复保存。
- `Cmd+S` 仅在 XLSX 编辑器聚焦时拦截浏览器默认行为；其他预览不受影响。
- 关闭存在未保存修改的 XLSX 预览时显示确认提示；若当前预览宿主没有可取消的关闭
  生命周期钩子，则首版至少覆盖切换 artifact、关闭预览面板与应用窗口关闭三条路径，
  并在实现计划中标明实际接入点。
- 加载或转换失败时复用现有错误态，并提供重试和外部打开。
- 不保留旧 HTML 表格缩放按钮；编辑器自行管理视图缩放和工作表切换。

## 错误处理

需要区分并呈现：

- 本地 FFI 二进制不存在
- 当前平台或架构不受探索分支支持
- dylib 加载或符号解析失败
- FFI 返回无效格式、密码保护或单元格数量超限
- MODoc 文件未生成、为空或无法读取
- SDK 初始化、挂载或内容解析失败
- 导出 XLSX 失败
- 原文件在编辑期间被删除或替换
- 原文件在编辑期间被外部修改
- 原子覆盖失败

错误日志可以记录版本、平台、状态码、请求 ID 和阶段，但不得记录工作簿内容。

## 安全与数据完整性

- 文件访问继续受 preview token 和 trusted roots 限制。
- renderer 不能提交任意保存路径。
- 转换只使用规范化后的已授权 artifact 路径。
- 保存前重新验证 token 与会话绑定。
- 使用私有临时目录，权限不宽于当前用户。
- 原文件只在完整导出并通过最小结构检查后被替换。
- 会话保存采用乐观并发控制，不静默覆盖打开后被其他程序修改的工作簿。
- 临时 MODoc 与 XLSX 文件在会话结束后删除。

## 测试策略

### Go 单元测试

- FFI 路径解析与环境变量覆盖
- 平台不支持、文件缺失、符号缺失错误
- preview token 与 session 绑定校验
- 原文件基线未变、被修改、被替换和被删除四种情况
- 临时目录生命周期
- 关闭会话和启动时清理崩溃遗留目录
- FFI 返回状态码在成功和失败路径都被正确映射，且转换调用被串行化
- FFI 状态码映射
- 导出失败时原文件保持不变
- 成功保存使用原子替换并保留权限
- 导出文件缺少 XLSX 必需 ZIP 条目时拒绝替换

FFI 调用边界通过可替换的小接口测试，单元测试不依赖真实 dylib。

### Go 集成测试

在本机存在指定 dylib 时启用 opt-in 测试：

1. 使用真实 XLSX fixture 导入 MODoc。
2. 验证 MODoc 非空且 SDK 可接受。
3. 将 MODoc 导出为 XLSX。
4. 验证导出的 ZIP/XLSX 结构和关键单元格。

未设置本地二进制时集成测试明确跳过，不影响通用测试套件。

### React 测试

- 准备成功后创建并挂载 SDK
- 内容变化后进入 dirty 状态
- 保存调用 `getContent().stringify()` 并传递 preview token/sessionId
- 保存成功、失败和重复点击状态
- 未保存关闭确认
- SDK 销毁和观察器清理
- 转换失败时展示现有错误态

### 手工验证

- 使用 OfficeCLI 生成的多工作表 XLSX 打开、编辑、保存、关闭后重新打开
- 核对值、公式、样式、合并单元格、行列尺寸和多工作表保真度
- 用 Excel 或 Numbers 打开覆盖后的文件
- 验证保存失败不会损坏原文件
- 验证日志不包含工作簿内容

## 非目标

- 不接入 Copilot 或 AI 表格工具。
- 不支持在线协作和石墨云文件。
- 不接入 Windows、Intel macOS 或 Linux 本地开发。
- 不修改正式构建、CI、发布、签名或公证流程。
- 不提交 `office2modoc-ffi` 源码、头文件或二进制。
- 不自动更新 `office2modoc-ffi` 版本。
- 不在本阶段移除项目其他位置对 `xlsx` npm 包的使用。

## 完成标准

- 当前 arm64 Mac 开发环境可从本地缓存加载固定版本 dylib。
- OfficeDex 的 XLSX 预览显示石墨表格编辑器而非 HTML table。
- 可编辑现有 XLSX，并通过保存操作原子覆盖原文件。
- 保存后重新打开能够看到修改结果。
- 失败路径保留原文件并给出可理解错误。
- focused tests、TypeScript typecheck、Go tests 和开发模式浏览器验证完成。
