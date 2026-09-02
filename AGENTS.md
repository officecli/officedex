# AGENTS.md

## Local Network

- 网络较慢时使用 `127.0.0.1:7890` 代理重试。
- `docker`、`npm`、`brew` 默认先走代理。

## Local Development

- 使用 `npm run dev` 启动桌面开发模式；使用 `npm run dev:browser` 启动浏览器渲染器。
- 真实 E2E 使用 `npm run test:e2e`，脚本会自行管理临时 bridge host 和 Vite 进程。
- 禁止使用 `killall`、`pkill` 或按端口模糊结束未知进程；只清理由当前测试脚本创建且已确认归属的进程。

## UI/UX

- 修改 UI 前先阅读 `DESIGN.md` 和上级目录的 UI 迁移约定。
