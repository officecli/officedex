# OfficeDex

## UI/UX 设计基准

**唯一基准是获批的交互原型：`OfficeDex-Final-Light-Preview-2026-09-17.html`**（当前在
`~/Documents/officedex/`，27MB，内嵌全部资源）。任何与它冲突的文档、注释、色值一律以它为准。

原型的令牌已经抠进 `src/shell/tokens.css` —— **日常 UI 工作读那个文件即可**，它是原型的
机器可读投影。注意它记录了一个关键事实：值取自原型的 **computed styles** 而非样式表，
因为原型叠了十三层 CSS、后面的层会静默覆盖前面的，直接读源码会得到永不生效的规则。

关键约束（全部可在原型里核到）：

- 墨色 `--shell-ink #41464b`，壳体 `--shell-chrome #f5f6f8`，强调 `--shell-accent #596f86`
- 字体栈首位 `"PingFang SC"`，正文 12px（`--shell-text`）
- 圆角走令牌 `--shell-radius-*`（5 / 6 / 10 / 14 / 20px），不要另拍常量
- 侧栏 190px / agent 列 320px / 折叠轨 52px —— 与 `state/shellReducer.ts` 的常量同源
- 缓动 `cubic-bezier(.22, 1, .36, 1)`

**不要**在 `src/shell` 里写裸色值或离表字号；需要新语义色（danger/warning/success）时先扩
`tokens.css`，那里目前没有 Status 一节。

> 历史说明：仓库曾有一份 `DESIGN.md` 宣称本产品采用 Notion 设计系统（紫色 `#5645d4`、
> Plus Jakarta Sans 等），另有一版 CLAUDE.md 宣称「Paper & Ink」（`#05101a` / `#006876` /
> `#fcfaf2`）。这两套值在原型里的命中数**都是 0**，均为 legacy，已于 2026-09-19 清除。

## 构建与测试

- `npm run dev` — 启动开发服务器
- `npm run build` — 构建生产版本
- `npx vitest run` — 运行测试
- `npm run lint` — 类型检查
