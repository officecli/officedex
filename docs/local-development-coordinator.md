# OfficeDex 多 Session 本地开发环境

## 结论

OfficeDex 使用仓库内的 `scripts/devctl` 和 `scripts/devd` 统一管理本地开发实例。多个 AI Session 不再分别启动 Vite、Wails 或端口转发。同一 worktree 复用一个健康实例，不同 worktree 使用独立端口、SQLite、workspace、runtime、OfficeCLI 配置、临时目录和日志。

OfficeDex 是 Wails 桌面应用，不是传统的 Web/API 服务：Go 后端运行在 Wails 进程内，通过 IPC 与 React 前端通信。因此 CLI 中的 `api` 服务表示 Wails/Go 桌面进程；`api_url` 是 devd 提供的本地 runtime 身份与健康端点，不是业务 API。

需要在普通浏览器中测试时，devctl 复用仓库现有 Real E2E HTTP/SSE host：浏览器通过 `/rpc/*` 和 `/events` 调用真实 Go `App`，Go 再启动隔离配置下的真实 `officecli agent-bridge`。该模式不启动 Playwright，适合日常人工测试和浏览器自动化。

## 现状与根因

- `npm run dev` 调用 `wails dev`；Wails 再使用固定 `http://localhost:3100` 的 Vite 开发服务器。
- 默认用户数据位于 `~/Library/Application Support/OfficeDex`，包含 `settings.json`、`officedex.sqlite`、workspace、runtime 和日志。多个实例原本会写入同一目录。
- `officecli` 鉴权和运行配置由子进程读取用户级配置。devctl 为每个实例设置独立的 `OFFICE_CLI_CONFIG`。
- 仓库没有 Docker、Compose、Kubernetes、数据库服务器、对象存储、缓存、浏览器认证 Cookie 或 CSRF Cookie。`devctl infra` 因而明确返回 `not_applicable`，不会虚构依赖。
- 原有流程没有实例 registry、跨进程启动锁、lease、源码 fingerprint、进程归属复核或空闲回收，多个 Session 容易固定端口冲突、复用错误 worktree 或遗留后台进程。

## 架构和状态

```text
AI Session / developer
        |
        v
scripts/devctl
        |
        v  Unix Domain Socket
single detached scripts/devd
        |
        +-- shared / shared-browser (primary Git worktree)
        +-- wt-<path hash> / wt-<path hash>-browser
```

desktop 与 browser 使用不同实例 ID、端口、数据和 OfficeCLI 配置，可以并行运行，不会因为切换测试方式而替换另一 Session 的实例。

默认状态目录：

```text
~/.cache/officedex-dev/
├── devd.pid
├── devd.sock
├── devd.log
├── daemon-version
├── locks/
└── instances/<instance-id>/
    ├── state.json
    ├── web.log
    ├── api.log
    ├── leases/
    ├── data/              # settings, SQLite, workspace, runtime
    ├── officecli/config.json # login/config
    ├── officecli/home/       # UserConfigDir-backed auxiliary auth/license state
    └── tmp/
```

状态 JSON 使用临时文件加 rename 原子更新。启动锁使用原子 `mkdir`，并记录 owner PID、启动时间、实例和 worktree。状态恢复和停止都不会只信任 PID。

## 日常使用

当前 worktree：

```bash
result=$(./scripts/devctl ensure --scope worktree --json)
lease=$(printf '%s' "$result" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8")).lease_id')
```

主 worktree 共享基线：

```bash
./scripts/devctl ensure --scope shared
```

浏览器 + 真实 Go/OfficeCLI bridge（默认打开系统浏览器）：

```bash
./scripts/devctl ensure --scope worktree --browser
```

browser 实例会同时启动本地 learnof/pptx 编辑器；无论是否启用 demo，PPTX 预览都会指向该真实编辑器。

desktop + 本地 learnof/pptx 编辑器：

```bash
./scripts/devctl ensure --scope worktree --with-learnof
```

`--with-learnof` 会在 Wails desktop 实例旁启动 sibling `pptx` checkout，并将其地址注入前端；未加该参数时 desktop 仍使用只读 PPTX 预览。

如果需要用源码开发版 OfficeCLI 验证已登录的 hosted 路径，可显式指定二进制；该选择只作用于当前 browser 实例：

```bash
OFFICEDEX_DEVCTL_OFFICECLI_BINARY=/absolute/path/to/officecli \
  ./scripts/devctl ensure --scope worktree --browser --no-open
```

由测试工具自行打开页面：

```bash
./scripts/devctl ensure --scope worktree --browser --no-open --json
```

需要验证完整生成流程、但不应依赖登录或真实 Credit 时，显式启用编译期 demo flow：

```bash
OFFICEDEX_DEVCTL_BROWSER_DEMO=1 \
  ./scripts/devctl ensure --scope worktree --browser --no-open --json
```

该模式仍使用真实 Go 应用和浏览器 bridge，但首页生成请求会由编译期 `officedex_demo` 本地流程接管，写出确定性的 PPTX、DOCX、XLSX、PNG 等测试产物，不访问 OfficeCLI、登录或 hosted Credit。精确演示提示词仍保留分阶段 Living Tree 流程，普通提示词则快速完成本地产物。

可以同时固定测试登录态和 Credit。匿名 Credit 必须为非负整数；登录态允许负数，以覆盖 outstanding balance：

```bash
OFFICEDEX_DEVCTL_BROWSER_DEMO=1 \
OFFICEDEX_DEVCTL_BROWSER_DEMO_AUTH=logged_in \
OFFICEDEX_DEVCTL_BROWSER_DEMO_CREDITS=1000 \
  ./scripts/devctl ensure --scope worktree --browser --no-open --json
```

`OFFICEDEX_DEVCTL_BROWSER_DEMO_AUTH` 只接受 `anonymous` 或 `logged_in`，默认是 `anonymous`；Credit 默认是 `0`。登录态和 Credit 都属于实例身份，修改后 devctl 会替换受管 browser bridge 并保留稳定端口。Demo 生成固定记录 `credit_mode=local_demo` 和 `credits_charged=0`，所以这个余额只用于验证 UI 与登录/Credit 分支，不会扣除或写入真实账本。

同一 Demo 实例也可通过 loopback-only 控制接口即时切换，无需重启：

```bash
curl -X POST "$bridge_url/control/demo/session" \
  -H 'content-type: application/json' \
  -d '{"auth":"anonymous","credits":30}'

curl -X POST "$bridge_url/control/demo/session" \
  -H 'content-type: application/json' \
  -d '{"auth":"logged_in","credits":1000}'
```

页面会在下一次身份/Credit 刷新时读取新状态；测试工具也可以直接调用 `/rpc/WhoAmI` 和 `/rpc/GetCreditStatus` 核对。控制接口只存在于 loopback Real E2E host，非 demo 模式返回不可用。

demo 模式是实例身份的一部分，会写入 `state.json` 和 `runtime_url` 的 `demo_mode`。普通 browser 实例与 demo browser 实例不会相互复用；切换模式时 devctl 会验证并替换受管 bridge，同时保留稳定端口。正式构建与默认 browser 模式的鉴权、Credit 和 OfficeCLI 路径不变。

browser 模式返回额外的 `bridge_url`，Vite 通过 `VITE_OFFICEDEX_REAL_E2E_ENDPOINT` 连接它并保留 HMR。所有 Web、runtime 和 bridge 监听地址都限制在 `127.0.0.1`。

端口属于实例而不是某一代进程。实例第一次创建时按 `instance_id` 确定稳定候选端口并写入 `state.json`；源码 fingerprint 变化、服务重启和 daemon 重启都会复用同一组 `web/api/wails/bridge` 端口。因此同一 worktree/mode 的本地 URL 不会因为日常改代码或重启而递增。尚未包含 `OFFICEDEX_E2E_BRIDGE_ADDR` 支持的历史分支会继续使用随机内部 Bridge 端口以保持兼容，但用户访问的 Web/runtime URL 仍保持稳定；`develop/1.0` 已支持固定 Bridge 端口。

当前 browser bridge 是第一阶段开发测试宿主，不是生产 API。它复用 `real_client_e2e_host_test.go`，CORS 仅因服务绑定 loopback 而临时放开；后续正式形态应抽取为非测试包的 `internal/devbridge` 并收紧 Origin。文件选择、系统通知、剪贴板、应用更新安装和其他依赖原生窗口的行为可能被测试宿主记录或模拟，验证这些桌面能力仍需 desktop/Wails 模式。

结束 Session 时释放 lease：

```bash
./scripts/devctl release --lease "$lease"
```

release 不会立即停止进程。worktree 实例在 lease 为 0 且超过空闲 TTL 后由 GC 回收；shared 默认保留。

## 状态、日志和重启

```bash
./scripts/devctl daemon status
./scripts/devctl status
./scripts/devctl status --json
./scripts/devctl logs --instance wt-xxxxxxxxxx --service web
./scripts/devctl logs --instance wt-xxxxxxxxxx --service api
./scripts/devctl restart --instance wt-xxxxxxxxxx --service web
./scripts/devctl reallocate-ports --instance wt-xxxxxxxxxx
./scripts/devctl doctor
./scripts/devctl gc
```

实例首次分配时会避开未知监听者。已经持久化的稳定端口若后来被未知进程占用，devd 会 fail-closed：不 kill 未知进程，也不静默更换 URL。确认需要更换时显式运行 `reallocate-ports`；该命令会安全停止已验证的实例进程、避开整组旧端口并保留现有 lease 和隔离数据。

## E2E fail-closed 检查

`ensure --json` 返回 `runtime_url`、`worktree`、`git_revision` 和 `dirty_fingerprint`。E2E 必须在运行前请求 `runtime_url` 并逐项核对；源码在实例启动后发生变化时，应重新调用 ensure，让 devd 替换旧实例。

推荐使用内置 fail-closed 校验：

```bash
./scripts/devctl ensure --scope worktree --json > /tmp/officedex-instance.json
npm run verify:dev-runtime -- --instance-json /tmp/officedex-instance.json
```

任何针对持久开发实例的 E2E 必须先执行该校验。仓库原有 `test:e2e`
会创建动态端口、有限生命周期且 finally 清理的专用 bridge/Vite 测试夹具，
不复用持久开发实例；它仍不得改用固定端口或省略自身的清理逻辑。

## 安全停止和数据重置

```bash
./scripts/devctl stop --instance wt-xxxxxxxxxx
./scripts/devctl stop --instance shared --force-shared  # 仅限明确维护操作
./scripts/devctl reset --instance wt-xxxxxxxxxx --confirm wt-xxxxxxxxxx
```

stop 前重新验证 PID、PGID、操作系统启动时间、命令、cwd 和监听端口。先向 devd 创建的进程组发送 SIGTERM；超时后只在归属仍匹配时发送 SIGKILL。任何身份不匹配都会拒绝终止。

reset 与 stop 分离，要求实例已经停止、没有有效 lease，并要求 `--confirm` 精确重复实例 ID。它只删除该实例的 data 和 OfficeCLI config，不删除源码、namespace、PVC、远程数据库或 Bucket。

## doctor 与故障排查

- `stale lock`：doctor 报告后，下一次 ensure 只在 owner 不存在或启动身份不匹配时回收。
- `daemon 异常`：运行 `daemon status`；下一次 `daemon ensure` 会使用原子启动锁重启，并从各实例 `state.json` 恢复 registry。
- `端口冲突`：查看 `status --json` 的实际端口。未知监听者不会被自动终止。
- `稳定端口被占用`：先用 `lsof -nP -iTCP:<port> -sTCP:LISTEN` 核对监听者；若决定保留外部监听者，运行 `devctl reallocate-ports --instance <id>`。不要通过普通 ensure 隐式换端口。
- `错误 worktree`：比较 runtime endpoint 和当前 `git rev-parse --show-toplevel`、`git rev-parse HEAD` 及 dirty fingerprint；不匹配时停止 E2E 并重新 ensure。
- `可疑残留进程`：`doctor` 只报告，不修改。需要终止未知进程时先人工核对并取得授权。

## 配置、迁移与回滚

可调参数见 `scripts/devctl.env.example`。不要为不同 worktree 设置不同 `OFFICEDEX_DEVCTL_STATE_DIR`，否则它们无法共享同一个 devd。

迁移方式：将日常 `npm run dev` 替换为 `devctl ensure`，并在 Session 结束钩子中调用 release。原命令没有删除，仍可用于明确的人工单实例调试。

回滚方式：释放 lease，安全停止 devctl 拥有的实例，然后恢复使用原启动命令。删除 `~/.cache/officedex-dev` 属于破坏性清理，必须先确认没有运行实例并人工执行；devctl 不会自动删除整个全局状态目录。
