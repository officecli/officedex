# Presentation 嵌入协议收敛方案

状态：**宿主侧已去重，线级收敛待 presentation 仓配合**（2026-09-04）

## 现状

桌面端与嵌入的 presentation 编辑器之间有两套 postMessage 协议，跑在同一个 fegit presentation bundle 上，由 URL 参数 `officedexEmbed=1&channel=` 选择（`presentation-component/src/protocol-mode.ts`）：

| | `presentation:*` | `officedex:pptx-*`（`officedex-pptx-embed/1`） |
|---|---|---|
| 定义 | `src/shared/presentationProtocol.ts`（版本常量 1） | `src/shared/presentationPptxProtocol.ts`，与 presentation 仓 `officedex-embed-protocol.ts` 手工同步 |
| 编辑器侧实现 | officedex 自己的 `presentation-component/src/officedex-host-bridge.ts`（562 行，打进 bundle） | presentation 仓 `packages/presentation-app/src/bootstrap/officedex-embed-protocol.ts` |
| 宿主侧 | `PresentationEditorFrame.tsx`（生成舞台 + 时间轴） | `PresentationPptxEmbedClient.ts` + `PresentationPptxWorkbench.tsx`（预览与 AI 编辑工作台） |
| 独有能力 | `swap-document`（时间轴步进不重启运行时）、`save-snapshot`/`save-asset`（宿主落盘）、`execute-script` 带 `awaitSnapshotMs` | `inspect`、`export` 直接返回字节、`editor-error` 阶段信息、`sessionMode=preview` 只读 |

两套协议的能力集不同，任何一侧都不是另一侧的超集，所以不能通过"删掉一套"完成收敛。

## 本轮已做（不需要 presentation 仓改动）

- 两个宿主客户端共用一份请求/应答账本 `src/shared/embedRequests.ts`（`PendingRequests`：id 生成、超时、按 id 结算、关闭时统一拒绝）。此前 `PresentationEditorFrame` 有两张 Map 且关闭时只清理脚本请求不清理 swap 请求；`PresentationPptxEmbedClient` 有自己的 Map 与 `:error` 双注册。现在两处都只剩"期待哪种回复类型"的判断。
- 事件名与桥接方法名进入常量与联合类型（`BridgeEventType`），渲染层 `any` 逃逸归零。

## 线级收敛的目标形态

一套协议 `officedex-presentation-embed/2`，消息集合为两套的并集，在 presentation 仓的 `officedex-embed-protocol.ts` 中实现，officedex 删除自己的 `officedex-host-bridge.ts`：

```
host → editor:  load(content, assets, revision, persist, activeSlide)
                swap-document(...)            ← 来自 presentation:*
                execute-script(source, awaitSnapshotMs)
                inspect
                export
editor → host:  ready / editor-ready / editor-error(phase)
                loaded / load-error
                dirty-changed(revision)
                save-snapshot / save-asset    ← 来自 presentation:*（宿主落盘）
                script-result(snapshotSaved)
                swap-result(documentRevision)
                inspect-result / export-result
```

约束：

1. 信封统一为 `{ protocol, channel, requestId, type, ... }`；`channel` 为随机串，`protocol` 为版本字符串，两者共同作为身份校验（WKWebView 下 `event.source` 不稳定）。
2. `PRESENTATION_EMBED_PROTOCOL_VERSION` 只保留一处，握手 `ready` 携带版本，宿主拒绝不匹配版本。
3. officedex 侧 `presentationProtocol.ts` 与 `presentationPptxProtocol.ts` 合并为一个文件，由 presentation 仓的定义生成或以契约测试比对（同 Go↔TS 漂移检查的做法）。
4. `PresentationEditorFrame` 与 `PresentationPptxEmbedClient` 合并为一个客户端；Workbench 与生成舞台只是它的两个消费者。

## 依赖与顺序

1. presentation 仓：在 `officedex-embed-protocol.ts` 增加 `swap-document`、`save-snapshot`、`save-asset`、`awaitSnapshotMs`、`ready` 带版本。这是唯一的跨仓前置。
2. officedex：切换 `PresentationEditorFrame` 到统一客户端，删除 `officedex-host-bridge.ts` 与 `protocol-mode.ts` 的 URL 分流。
3. 删除 `presentationProtocol.ts`，`presentationPptxProtocol.ts` 升版为 `/2`。

在第 1 步完成前，`presentation:*` 必须保留：生成舞台的时间轴步进与宿主落盘只有它提供。
