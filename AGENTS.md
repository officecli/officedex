# AGENTS.md

## Local Network

- 网络较慢时使用 `127.0.0.1:7890` 代理重试。
- `docker`、`npm`、`brew` 默认先走代理。

## Local Development Coordinator

- AI Agent 不得直接启动长期运行的 `npm run dev`、`npm run dev:browser`、`wails dev` 或端口转发。使用 `./scripts/devctl ensure --scope worktree`；需要主 worktree 共享基线时使用 `--scope shared`。
- 需要浏览器测试真实 Go/OfficeCLI 链路时使用 `./scripts/devctl ensure --scope worktree --browser`。自动化要自行打开 URL 时加 `--no-open`；browser 与 desktop 是独立实例和独立数据目录，不得互相替换。
- 复用 devctl 返回的健康实例，并保存其 `lease_id`。Session 结束调用 `./scripts/devctl release --lease <id>`，不得直接 stop。
- 普通 Session 不得停止 `shared`。`stop --force-shared` 只用于用户明确授权的维护操作。
- 禁止 `killall`、`pkill`、`kill $(lsof -t -i:<port>)`。未知端口占用只能报告或换端口，不能自动结束进程。
- 同一实例的 Web/API/Wails/Bridge 端口必须跨源码变化和重启保持稳定。稳定端口被未知进程占用时 fail-closed；只有用户接受 URL 变化时才运行 `devctl reallocate-ports --instance <id>`。
- 只能停止 registry 中且通过 PID、PGID、启动时间、命令、cwd 与监听端口联合校验的进程组。
- E2E 前读取 `runtime_url`，核对 instance ID、worktree、Git revision 和 dirty fingerprint；任一不匹配必须终止测试。
- `doctor` 默认只读。终止未知进程和 `reset` 删除数据必须先取得用户明确授权。
- `npm run dev` 等原命令保留为 devd 内部命令或明确的人工单实例调试入口。

## UI/UX

- 修改 UI 前先阅读 `DESIGN.md` 和上级目录的 UI 迁移约定。
