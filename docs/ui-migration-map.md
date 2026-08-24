# AntD → weboffice-design 迁移对照

组件统一从 `@vo-ui/backend` 引入；切换后端的唯一接缝是 `src/renderer/ui/backend.ts`。
下表的「文件数」是迁移开始时直接 `import ... from "antd"` 的文件数量。

## 有直接等价物（facade 已导出，可直接迁移）

| AntD | 文件数 | weboffice-design | 迁移注意 |
| --- | ---: | --- | --- |
| `Button` | 19 | `Button` | facade 已适配 `type`/`htmlType`/`size`/`danger`，调用点无需改写 |
| `Tooltip` | 7 | `Tooltip` | `title` → `content`，且 `children` 必填 |
| `Modal` | 7 | `Dialog` | `open` 保留；`onCancel` → `onClose`；`type`(`message`/`form`/`functional`) 与 `size` 为必填，footer 用 `DialogFooterAction` 描述 |
| `Spin` | 3 | `Loading` | `size` 取值为 `mini/small/medium/large` |
| `Select` | 3 | `Select` | `onChange` → `onValueChange`，`options` 必填；触发器是 `button[aria-haspopup]` 而非 `combobox` |
| `Switch` | 2 | `Switch` | `onChange` → `onCheckedChange(checked, event)` |
| `Dropdown` | 2 | `Dropdown` | `menu` 直接收 items 数组（不是 `{ items }`）；`open` 为必填受控属性，其余菜单属性走 `menuProps` |
| `Radio` | 1 | `Radio` / `RadioGroup` | `onChange` → `onValueChange` |
| `InputNumber` | 1 | `InputNumber` | — |
| `Input` | 1 | `Input` | `onChange` 直接给 `(value: string, event)`；无障碍名用原生 `aria-label`（`ariaLabel` 不被识别） |
| `Empty` | 1 | `Empty` | `description` → `title`（必填） |
| `Alert` | 1 | `MessageBar` | `message` → `children` |

## 无等价物（需保留 AntD 或自建）

| AntD | 文件数 | 建议 |
| --- | ---: | --- |
| `Tag` | 8 | 自建：本质是 `--od-*` 令牌下的小圆角标签，成本低 |
| `Space` | 5 | 删除，改用 flex + `gap` |
| `Progress` | 5 | 自建或保留 AntD |
| `ConfigProvider` | 3 | AntD 退场后自然消失（主题由 `ui/theme.ts` 接管） |
| `Form` | 2 | 保留 AntD，或改为受控组件 + 自建校验 |
| `Typography` / `Timeline` / `Table` / `Result` / `Image` | 各 1 | 保留 AntD 或按需自建 |

## 建议顺序

1. `Button`（19 个文件，facade 已适配，风险最低）
2. `Tooltip` / `Spin` / `Switch` / `Input` / `InputNumber`（契约差异小）
3. `Modal → Dialog`、`Select`（回调与 footer 结构需改写，逐屏验收）
4. 自建 `Tag`、去掉 `Space`
5. 最后移除 `ConfigProvider` 与 `antd` 依赖

每一步都应跑 `npm run lint && npx vitest run`，并对改动到的界面做一次实际观感确认——
组件外观会从 AntD 换成石墨，测试不会捕捉到视觉回归。

## 已知依赖问题

`weboffice-design@0.18.0` 的产物按 React 18 编译，内联的 jsx-runtime 与 react-dom/client
读取 React 19 已移除的 `__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED`。
`scripts/vite/weboffice-design-react19.ts` 负责把这两个 chunk 换成宿主 React 运行时；
上游发布 React 19 兼容版本后即可删除该插件与 `vite.config.ts` 中的 `optimizeDeps.exclude`。
