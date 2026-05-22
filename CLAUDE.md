# OfficeDex

## UI/UX 设计规范

进行任何 UI 相关工作（组件开发、样式修改、页面新增、视觉调整）之前，**必须先阅读项目根目录的 `DESIGN.md`**。该文件包含完整的 Notion 风格设计令牌（色彩、字体、圆角、间距、组件规范），所有 UI 代码必须与其保持一致。

关键约束：
- 主色使用 Notion Purple `#5645d4`，不要用蓝色
- 标题字体用 DM Serif Display（衬线），正文用 Plus Jakarta Sans
- 按钮圆角 8px（矩形，不是药丸形），卡片圆角 12px
- 表面色使用温暖的中性色调，不要使用冷灰

## 构建与测试

- `npm run dev` — 启动开发服务器
- `npm run build` — 构建生产版本
- `npx vitest run` — 运行测试
- `npm run lint` — 类型检查
