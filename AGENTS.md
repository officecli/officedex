# AGENTS.md

## Local Network

- 网络较慢时使用 `127.0.0.1:7890` 代理重试。
- `docker`、`npm`、`brew` 默认先走代理。

## Local Development

- 2026-10-10 用户明确废弃历史 devctl；开发、E2E 和发版不再依赖该入口。

- 使用 `npm run dev` 启动桌面开发模式；使用 `npm run dev:browser` 启动浏览器渲染器。
- 真实 E2E 使用 `npm run test:e2e`，脚本会自行管理临时 bridge host 和 Vite 进程。
- 禁止使用 `killall`、`pkill` 或按端口模糊结束未知进程；只清理由当前测试脚本创建且已确认归属的进程。

## 验收与发版引擎来源

- 2026-10-12：本机旧 `bridgeBinaryPath` 覆盖曾使 1.0.28 应用调用 9 月 20 日的旧 OfficeCLI。最终包验收必须清除该覆盖，使用应用包内引擎；不要把开发路径或某一版本路径写死回设置。
- 每次最终包验收开始前、发布 Release / 更新清单前，触发一次引擎操作并运行 `scripts/verify-running-engine.mjs`，核对目标应用 PID、实际 OfficeCLI 子进程路径、构建版本和 SHA-256。没有运行中的引擎或路径不一致不得视为通过。详见 CONTRIBUTING.md。
- 保留核验 JSON，连同源码 revision、应用/ZIP 来源和 E2E 使用的引擎路径记录。应用版本号、磁盘上的新二进制或单独执行 `officecli version` 都不能代替运行进程核验。

## UI/UX

- 修改 UI 前先阅读 `src/shell/tokens.css`（获批交互原型 `OfficeDex-Final-Light-Preview-2026-09-17.html` 的令牌投影）和上级目录的 UI 迁移约定。
