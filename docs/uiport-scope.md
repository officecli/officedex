# UiPort 范围：S0 功能取舍决定与扩展提案

`src/shell/port/types.ts` 的 `UiPort` 是 UI 层的需求规格，服务层直接实现它。但它目前 32 个方法只覆盖了桌面能力的一部分：`DesktopAPI` 有 117 个方法，其中 47 个与 `UiPort` 直接对应，**70 个需要决定去留**。

这份文档是那次评审的结果，以及由此得出的 `UiPort` 扩展提案。**提案部分要 shell 那边确认后才动 `types.ts`** —— 它决定 UI 层还要补哪些界面。

## 一、去留决定

| 簇 | 数量 | 决定 |
|---|---|---|
| pptx 闸门 / 活画布 / 时间轴 / 模板 | 13 | **保留**，进新的 `SlidesPort` |
| Agent Runtime（client tools / 审批 / 重试） | 9 | **保留**，但**不进 UiPort**——它是 `agent.send` 的实现手段，UI 不该看见 |
| 诊断 / 日志 / 反馈 / 登录 | 11 | **保留**，拆进 `AccountPort` 与 `SupportPort` |
| 应用更新 | 7 | **保留**，进新的 `UpdatePort` |
| 计费 / 邀请 / 兑换 | 3 | **保留**，进 `AccountPort` |
| 垂直连接器 Jira / Liquipedia / 目录清洗 / 营销图 | 9 | **延后**。四个独立小产品共用一个工作簿，它们在新 IA 里是什么（agent 的一种 workflow？folder 的属性？独立入口？）需要单独想。本期不接，shell 上线时这四个功能暂不可达 |
| OfficeProduct 工作簿血缘 | 9 | **整簇下线**。本来只接了一半：只写 view、只读 outputs，其余五个零 UI；四个"活"的也只是在写数据、没人读 |
| 图片提示词模板 | 3 | **下线**。Go 侧有实现，渲染层那份 localStorage 版本（`localImageTemplates.ts`）同样无人消费，远端和本地两个目录都不在屏幕上 |
| HTML app builder | 1 | **延后** |
| 其它 | 5 | `artifactStageEdit` **删**（唯一可能的调用者 `ArtifactStageShell` 已删除）；`composeCampaignImage` **删**（Go 侧根本没有这个方法，三个 transport 都抛错）；`copyImageToClipboard` / `setPreviewMode` / `sendDesktopNotification` / `onAuthEvent` **保留**为内部能力 |

下线合计 13 个方法，其中 9 个本来就够不到，删除成本为零。

## 二、UiPort 扩展提案

四个新 Port。命名和粒度按 shell 的既有风格（Promise 接口、`subscribe` 返回 unsubscribe）。

### SlidesPort — 演示文稿特有的交互

放在独立 Port 而不是塞进 `FilePort` / `AgentPort`：这些不是通用能力，是 slides 独有的。通用接口不该为一种文件类型变形。

```ts
export interface SlideOutlineSection {
  id: string;
  title: string;
  detail?: string;
  estimatedSlides?: number;
}

export interface SlideTemplate {
  id: string;
  name: string;
  pageCount: number;
  previewPath?: string;
  status: "imported" | "analyzing" | "ready" | "failed";
}

export interface TimelineNode {
  id: string;
  parentId?: string;
  label: string;
  slide?: number;
  createdAt: string;
}

export interface SlidesPort {
  /** 大纲闸门：运行停在这里等确认。全产品唯一的阻断点。 */
  approveOutline(taskId: string, outline?: SlideOutlineSection[]): Promise<void>;
  /** 跳过联网研究，直接开始画。 */
  skipResearch(taskId: string): Promise<void>;

  /** 活画布三件：把还在画的运行按在下一页边界，放开，或让指令落在那里。 */
  pause(taskId: string): Promise<void>;
  resume(taskId: string): Promise<void>;
  steer(taskId: string, instruction: string): Promise<void>;

  /** 时间轴：这份 deck 被改成现在这样的过程。 */
  timeline(taskId: string): Promise<TimelineNode[]>;
  openTimelineNode(taskId: string, nodeId: string): Promise<void>;
  /** 从某个节点长出一条新分支。 */
  branchFrom(taskId: string, nodeId: string): Promise<void>;

  /** 本地模板。 */
  templates(): Promise<SlideTemplate[]>;
  importTemplate(): Promise<SlideTemplate | null>;
  removeTemplate(id: string): Promise<void>;
  onTemplateProgress(listener: (template: SlideTemplate) => void): () => void;
}
```

**为什么 `steer` 不是 `agent.send`**：它俩语义不同。`agent.send` 开一次新的往返；`steer` 的指令落在一个**正在进行**的运行的下一页边界。运行结束后同一句话会退化成一次普通修改——那个退化由服务层负责，UI 只管调 `steer`。

### AccountPort — 账号与额度

```ts
export interface Account {
  mode: "anonymous" | "account" | "external";
  email?: string;
}

export interface Credit {
  displayMode: "quota" | "balance";
  used: number;
  total: number;
  planLabel?: string;
  /** 匿名额度用尽是真实的执行前拦截点。 */
  exhausted: boolean;
}

export interface AccountPort {
  current(): Promise<Account>;
  /** 走浏览器交接；解析时表示已开始，不表示已登录。 */
  signIn(): Promise<void>;
  cancelSignIn(): Promise<void>;
  signOut(): Promise<void>;
  credit(): Promise<Credit>;
  redeem(code: string): Promise<{ ok: boolean; message?: string }>;
  invite(): Promise<{ url?: string; remaining?: number }>;
  /** 登录状态在浏览器那边完成时推过来。 */
  subscribe(listener: (account: Account) => void): () => void;
}
```

### UpdatePort — 应用更新

```ts
export interface UpdateStatus {
  currentVersion: string;
  available: boolean;
  /** 强制更新：闸门抬起前应用不做任何事。 */
  mandatory: boolean;
  phase: "idle" | "checking" | "downloading" | "ready" | "failed";
  progress?: number;
}

export interface UpdatePort {
  status(): Promise<UpdateStatus>;
  check(): Promise<UpdateStatus>;
  download(): Promise<void>;
  install(): Promise<void>;
  cancel(): Promise<void>;
  subscribe(listener: (status: UpdateStatus) => void): () => void;
}
```

### SupportPort — 诊断与反馈

```ts
export interface SupportPort {
  exportLogs(): Promise<{ path: string }>;
  canReport(): Promise<boolean>;
  /** taskId 可选：带上它时会附上那次运行的上下文。 */
  report(input: { message: string; taskId?: string }): Promise<{ ok: boolean; ref?: string }>;
  diagnostics(): Promise<Record<string, unknown>>;
}
```

## 三、不进 UiPort 的

同样保留，但属于服务层内部或 canvas adapter，UI 层不该看见：

| 方法 | 归属 |
|---|---|
| `startAgentRun` `getAgentRun` `listAgentRuns` `respondAgentRun` `approveAgentRun` `retryAgentRun` `cancelAgentRun` `completeAgentClientTool` `reassignAgentClientTool` | **service 内部**——`agent.send` 与 `agent.subscribe` 的实现手段 |
| `planPptxJS` | **canvas adapter**（presentation-component 内部用） |
| `readDrawingAsset` `captureTimelineNode` `createLivePptxDraft` | **service 内部**（回放引擎与活草稿） |
| `preparePptxEditor` `savePptxEditor*` `exportPptxEditor` `closePptxEditor` `prepareXlsxEditor` `saveXlsxEditor` `stageXlsxEditorImage` `closeXlsxEditor` | **canvas adapter**——`files.save` 在 Port 上是一个方法，落到哪个编辑器由 adapter 决定 |
| `copyImageToClipboard` `setPreviewMode` `sendDesktopNotification` `onAuthEvent` | **service 内部** |

## 四、评审中发现的四处「建好、测好、从不接入」

这个仓库有一个反复出现的模式，值得单独记下来——因为它们都是本期的现成资产：

| 模块 | 规模 | 状态 |
|---|---|---|
| Go `internal/localstore` schemaV7 文档投影 | 四张表 + 增量维护 + 两套测试 | **没有任何 RPC 暴露**。它是 `files.list` 的天然后端 |
| Go 时间轴读取 API | `ListTimeline` / `OpenTimelineNode` / `ReadTimelineNode` / `ResumeFromTimelineNode` / `TimelineBranchState` / `ReadEditorDocument` 六个 | transports 里**一个都没实现**，只有写入侧的 `captureTimelineNode`。它是 `SlidesPort.timeline` 的后端 |
| 渲染层 `documentModel.ts` | 409 行 + 265 行测试 | 生产代码零消费者（P2 已接上） |
| `ArtifactStageShell` / `FlatArtifactStage` | 1977 行 | 零挂载（P4 已删除） |

前两条意味着 S1 的大部分工作是**暴露已有能力**，不是写新逻辑。

另外：Wails 生成的绑定有 121 个方法，手写的 `DesktopAPI` 声明了 117 个，**20 个 Go 能力从未写进接口**（除去命名差异，主要是上面的时间轴六个和运行时更新四个）。`DesktopAPI` 不是 Go 能力的全集。
