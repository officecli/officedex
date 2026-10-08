# OfficeDex

## UI/UX 设计基准

**唯一基准是 OD-UI-1.2 r10**：交互原型 `OfficeDex-Interactive-Prototype-1.2-r10.html` 与规范
`OfficeDex-Interaction-Design-Standard-1.2-r10.html`（当前在 `~/Documents/officedex/交互原型/`）。
任何与它冲突的文档、注释、色值一律以它为准。范围是**浅色主题**；深色、高对比度规范里明确不在本轮验收内。

### 样式从哪来

- `src/shell/styles/workspace-v11.css`、`workspace-v12.css`、`attention.css`、`workspace-structure.css`
  是**生成物**，由 `scripts/port-prototype-styles.mjs` 从原型内嵌样式逐层移植（保留层叠顺序），**不要手改**。
  原型出新版本时重跑：
  `node scripts/port-prototype-styles.mjs "<原型 html 路径>"`。
  生成器遇到没有令牌的色值、不在字号表里的字号会直接报错——先扩 `tokens.css` 再重跑。
- 产品自己加的规则写在 `src/shell/styles/product.css`；`styles/ua-baseline.css` 把浏览器默认值补回来
  （`@shimo/sdk-sheet` 的样式带全局 `* { margin:0; padding:0 }`）。
- 类名与 id 一律 `dx-` 前缀，控件带 `data-act`（与原型同名）。元素选择器用
  `:where([data-ui-scope="officedex"])` 限定，**不会伸进内嵌编辑器**；新的外层区域要带这个属性。
- 令牌在 `src/shell/tokens.css`：`--dx-*` 是设计的，`--shell-*` 留给规范保留原样的界面（图像创作、账号页、
  生成中画布）。一块界面只用一套。

### 结构（与 `state/shellReducer.ts` 的常量同源）

- 没有 Agent / Editor 模式。三栏：侧栏 244px 或隐藏（贴边悬停临时显示）、会话栏 320–520px（默认 360，
  可左右互换、可浮动）、内容区（Home / Local / Projects / Assets / Settings / 图像创作 / 文档）。
- 项目 = 非默认文件夹，会话 = conversation，Assets = 项目内文件，Local / Unfiled = 默认文件夹。
- 标签页记住自己是从会话还是从 Local 打开的（`tabContexts`），激活时恢复那个上下文。
- 菜单、对话框、提示统一走 `src/shell/kit/layers.tsx`（一次只有一个菜单、一个对话框）。
- 没有后端能力的控件保留位置，点击调用 `notBuiltYet`，并在 `docs/not-implemented.md` 登记。

### 对照原型验收

`?shellFixture=1&seed=prototype` 会装入原型自己的示例工作区，其余 URL 参数见 `src/shell/dev/fixture.ts` 文件头。
结构闸门在 `src/shell/test/`：`tokenDiscipline`（色值/字号必须来自令牌）、`layers`（z-index 阶梯与层叠上下文）、
`combinationSelectors`（按工作区状态限定的规则必须有可达状态能命中）、`deadControls`（按钮不许沉默）、
`copyRatchet`、`portalHost`；另有 `node scripts/verify-shell-styles.mjs`（写进 DOM 的类在产物 CSS 里必须有规则）。

> 历史说明：2026-09-17 的 `OfficeDex-Final-Light-Preview` 原型（侧栏 190 / agent 列 320 / 折叠轨 52、
> Agent / Editor 双模式）已被 r10 取代。更早的 `DESIGN.md`（Notion 紫）与「Paper & Ink」两套值均为 legacy。

## 构建与测试

- `npm run start:desktop` — 日常开发入口：先把 presentation / writer / officecli-internal 同步到最新，再起 Wails dev；运行中两者有新 commit 会自动重建，Cmd+R 刷新即可（`npm run dev` 不同步编辑器，会用旧产物）
- `npm run sync:deps` — 只同步 presentation / writer / officecli（改了它们的未提交代码时用）
- `npm run build` — 构建生产版本
- `npx vitest run` — 运行测试
- `npm run lint` — 类型检查
