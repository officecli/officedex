# `weboffice-design` 组件缺口清单

基线版本：`weboffice-design@0.3.2`。OfficeDex 使用 React 19；该版本组件包的 React 产物内嵌 React 18 runtime，因此项目只复用其 CSS、设计变量与资源，不直接导入其 React 组件。

## 公开组件中缺失的能力

| 能力 | OfficeDex 场景 | 当前替代 |
| --- | --- | --- |
| ConfigProvider | 主题与 locale 注入 | 项目 i18n + WebOffice Token |
| Empty | 首页、任务和文件空态 | `ui/Empty` |
| Form | 设置、登录、问题反馈 | `ui/Form` |
| Image | 图片展示、失败与预览 | `ui/Image` |
| TextArea | 生成、修改和问题输入 | `ui/TextArea` |
| PasswordInput | API Key 与密码输入 | `ui/PasswordInput` |
| Popover | 锚定浮层和视口碰撞 | `ui/Popover` |
| Progress | 下载、更新和任务进度 | `ui/Progress` |
| Result | 完成、失败和无权限页面 | `ui/Result` |
| Space | 水平/垂直间距与换行 | `ui/Space` |
| Table | 任务、文件和数据列表 | `ui/Table` |
| Tag | 状态与运行时标签 | `ui/Tag` |
| Timeline | 任务步骤与历史 | `ui/Timeline` |
| Typography | 标题、正文和截断 | `ui/Typography` |

## 有视觉规范但 API 不能直接替换

| 原调用 | WebOffice 能力 | OfficeDex 适配 |
| --- | --- | --- |
| `Modal` | Dialog | `ui/Modal` 声明式接口 |
| `Modal.confirm/info` | 无同名静态 API | `ui/dialog` service |
| `message` | Toast | `ui/toast` service |
| `Spin` | Loading | `ui/Loading`，并导出 `Spin` 兼容名 |
| `Radio.Group` | RadioGroup | `ui/Radio` / `ui/RadioGroup` |
| `Dropdown` + Menu | Dropdown + Menu | 项目菜单模型与事件转换 |
| `Select` | Select | 项目 options/value/search 契约 |
| `InputNumber` | InputNumber | 项目 number/null、范围和步长契约 |

## Excel 工作区新增依赖

Excel 工作区使用的 `TextArea`、受控三操作对话框、空态、加载态和错误恢复均由项目本地实现。工作簿画布来自 `@shimo/sdk-sheet`，它属于文档编辑 SDK，不是 `weboffice-design` 的缺失基础组件。

每个本地替代组件必须保留独立契约测试；业务代码只从 `src/renderer/ui` 导入，不得重新引入 AntD，也不得把 `antd` package alias 到兼容层。
