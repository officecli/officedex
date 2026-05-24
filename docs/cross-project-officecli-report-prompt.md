# 跨项目协作请求:OfficeDex 桌面问题上报 — 接收端设计征询

> **致 officecli 维护者**:OfficeDex 桌面端(`officedex` 仓)新增了"用户主动上报问题"功能,需要一个接收端把上报信息落地。本文档说明我们这边已经做了什么、为什么这么做、需要你们决策什么。

---

## 1. 用户需求

用户在桌面端遇到生成任务卡死/失败时,希望有一个一键反馈通道,让服务团队能精确定位"是这一次"出了问题。

- **明确不做的事**:不传任务 zip 包(用户原话:"服务器负载会因此过大")
- **必须做的事**:让支持工程师能拿到一个"指针",据此在你们自己的日志里找到对应的失败上下文

---

## 2. 我们的设计选择(已在 main 落地)

桌面端 commit `a43e716` (merged in `ef98ec1`):desktop 提交一个 **≤4KB JSON payload**,核心字段是 `requestId`(从 hosted 任务 server 派发回来的那个 id)。桌面端**不传**任何重数据。

设计原则:
- **server 已经知道发生了什么**(hosted 模式每次调用都经过你们,失败时你们日志里有完整 error/stack/provider 调用)
- **desktop 端的责任就是传一个用户指认的指针**,server 凭此在自家日志里找上下文
- 失败永不阻塞:HTTP 不可达 → 桌面端降级到"显示 Request ID + 用户手动 Slack/邮件反馈"模式

---

## 3. 桌面端发出的 payload 契约(已实现)

### HTTP 请求

```
POST <配置的 endpoint URL>
Content-Type: application/json
Authorization: Bearer <可选,配置的 token>
User-Agent: OfficeDex/<version> (<os>; <arch>)
X-Client-Bundle-Schema: 1
```

### Body(JSON,≤4KB,9 字段)

```json
{
  "requestId":    "req-abc-123",          // 你们派发的 server-side request id(关键)
  "taskId":       "task-000032",          // desktop 本地任务 ID(可选)
  "runtimeMode":  "hosted",               // "hosted" | "external" — external 模式你们日志没记录,需要不同处理
  "errorCode":    "rate_limit",           // 来自 task.failed payload(可选)
  "errorMessage": "Too many requests",    // 已截断到 500 字节(可选)
  "description":  "用户填的问题描述,10-500 字符",
  "contactEmail": "user@example.com",     // 可选
  "timestamp":    "2026-05-24T08:42:00Z", // RFC3339
  "via":          "http"                  // 为未来 usage-events 通道留的钩子
}
```

### 期望的 server 响应

**成功 (2xx)**:
```json
{ "ticketId": "TKT-12345", "viewUrl": "https://support.example.com/tickets/TKT-12345" }
```
`viewUrl` 可选,`ticketId` 用于 desktop Toast 显示给用户。

**Schema 拒绝 (4xx)**:
```json
{ "error": "unsupported_schema", "minVersion": 2, "maxVersion": 5 }
```
desktop 收到这个会**触发 app update 流程提示用户升级**,不会重试。

**其他 4xx / 5xx**:任何非 2xx 都会让 desktop 降级到 B3 模式(给用户显示 request_id 让 ta 手动反馈)。

---

## 4. 你们需要决策的事

请选一个或多个方案(我们 desktop 这边 0 改动即可对接 任意一种):

### 选项 A:你们部署一个 HTTPS endpoint(推荐,desktop 已就绪)
- 实现一个 50-100 行的 HTTP handler(任何语言),接收上面的 JSON,写一条 log + 创建工单
- 把 endpoint URL 配置到我们 OfficeDex 的 `supportReportEndpoint` settings(或通过 OTA manifest 推送)
- **优点**:与 officecli 完全解耦,你们独立排期
- **缺点**:需要新部署一个 service

### 选项 B:在 officecli 加 `usage-events emit` 子命令
- desktop 不直接走 HTTPS,而是 shell out:
  ```bash
  officecli usage-events emit --kind=user_issue_report --json '<上面的 payload>'
  ```
- officecli 用自己的 hosted 通道上行到你们的服务端
- **优点**:复用已有认证、不需要 desktop 配 endpoint
- **缺点**:officecli 需要发新版本;hosted 模式下才能用

### 选项 C:扩展 officecli 现有 usage-events 流(如果有的话)
- 我们查证 officecli 当前没有暴露 usage-events surface(`officecli config status` 无相关字段)
- 如果你们内部其实有,告诉我们,我们 desktop 可以适配你们的协议

### 选项 D:暂时不接收
- desktop 端 capability 探测保持 false,UI 自动降级到 B3 模式(用户点按钮 → 复制 request_id → 自己发 Slack)
- **这是目前的默认状态**,即代码已 merge 但没有 endpoint 时的行为
- 等你们想清楚再实施 A/B/C

---

## 5. 我们对你们的硬依赖(merge gate 2,**最关键**)

无论上面选 A/B/C/D,你们需要确认:

> **`request_id` 在你们 server 日志里能按字段索引检索,且历史日志保留至少 N 天(N 由你们定,建议 ≥7)**

这是**整个机制能成立的前提**。如果运维侧 Kibana / ELK / 自家日志系统**没有**按 request_id 建索引,desktop 把指针发过来你们也查不到 → desktop 上报 = 无效。

**请提供一张截图证明:** 在你们日志系统里输入一个真实的历史 request_id,能 hit 到对应失败任务的完整 backend 记录。这是 PR 描述里我们要贴的 evidence。

---

## 6. 已知 edge case(供你们设计参考)

| 场景 | desktop 行为 | 你们的处理建议 |
|---|---|---|
| `runtimeMode=external`(用户本地 LLM,不经过你们) | payload 仍发出,带 `runtimeMode: "external"` | server 端可路由到不同处理(如直接回复 "请走 desktop Settings 导出 zip 手动反馈") |
| user prompt 含敏感数据 | 不传,只传用户填的 description | 无需处理 |
| 同一 task 多次重试 | desktop 取最新一条 `task.failed` 的 request_id | 你们如果按 request_id 聚合,可能需要支持"多 request_id 对应同一用户反馈"的视图 |
| 用户连续点提交 | 每次都发(无客户端去重) | 你们可按 `requestId + timestamp` 做幂等(同 5 秒内同 requestId 视为 dup) |
| 网络断 / 5xx | desktop Toast 失败,降级到 B3 显示 request_id 让用户手贴 | 你们日志会留下 request_id,被动可达 |

---

## 7. 我们 desktop 这边已经提供的工具

- **`docs/issue-reporting.md`**(officedex 仓):完整的 Phase A/B/Pivot 设计与失败模式表
- **`internal/report/submit.go`**:`httpSubmitter` 实现,可作为 server endpoint 形状的真实参考
- **`internal/report/capability.go`**:capability 三层探测(协议 flag / endpoint / 通道),你们如果用选项 C 可对接 `GetCapabilities` 返回 `report.submit: true`
- **B3 降级路径**:capability=false 时 desktop 自动给用户"复制 request_id"按钮,不会变成 broken state

---

## 8. 我们希望你们的回复(最少 3 行)

1. **选择哪个方案?** (A / B / C / D)
2. **request_id 可检索性确认**(Kibana 截图或等价证据)
3. **预期 ready 时间**(用于我们规划:是否需要先发版让用户看到 B3 模式,还是等你们就绪一次性切到完整模式)

---

## 9. 联系方式

- **OfficeDex 仓**:[officedex](https://github.com/officecli/officedex) main 分支已 merge,搜 `internal/report/` 看实现
- **决策记录**:`docs/issue-reporting.md` § 7-8(架构 / 失败模式)
- **联系人**:[填你这边的负责人]

---

## 10. 附录:为什么不用 sentry-style 自动崩溃上报?

- 我们这次的需求是**用户主动指认**(ta 说"这一次有问题"),而非被动崩溃捕获
- 自动崩溃上报是独立的 feature,与本上报正交;你们如果也有这方面需求可以另起对话
- 当前 desktop 没接 sentry 类客户端,留作未来 follow-up
