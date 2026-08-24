# OfficeDex

## UI/UX 设计规范

OfficeDex 的设计令牌以石墨设计系统 **`weboffice-design`** 为唯一来源。进行任何 UI 工作前请遵循下列约束（`DESIGN.md` 已废弃，是早期 Notion 竞品分析，勿用）。

**组件**：一律从 `@vo-ui/backend` 引入，不要直接 `import ... from "antd"`。
后端切换的唯一接缝是 `src/renderer/ui/backend.ts`。

**令牌**：不要写死颜色/圆角/字号，使用 `src/renderer/ui/design-tokens.css` 暴露的 `--od-*`
（其值来自 `weboffice-design/theme` 在运行时注入的 `--ui-*`，深浅色已内置）。

关键取值（供参考，代码里用变量而非字面量）：
- 主文字 `#41464B`，强调/引导色 `#5DA4E3`，分隔线 `rgba(65,70,75,0.1)`
- 页面底 `#FFFFFF`，次级面 `#F9F9F9` / `#F7F7F7`
- 圆角 2/4/6/8/12/16px（控件 4px，卡片 6px，浮层 8px）
- 字体 PingFang SC，字号 10/12/13/14/16/20/24px
- 控件高度 24/28/32/40px

**已知依赖问题**：`weboffice-design@0.18.0` 的产物按 React 18 编译，直接在 React 19 下加载会崩溃；
`scripts/vite/weboffice-design-react19.ts` 这个 vite 插件负责把它内联的 jsx-runtime / react-dom-client
替换为宿主 React。上游发布兼容版本后即可删除该插件。

## 构建与测试

- `npm run dev` — 启动开发服务器
- `npm run build` — 构建生产版本
- `npx vitest run` — 运行测试
- `npm run lint` — 类型检查
