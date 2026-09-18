/**
 * Drift risk: this file must stay in sync with:
 *   - internal/types/types.go (Go-side definitions)
 *   - src/renderer/generated/wailsjs/go/models.ts (Wails auto-generated)
 * Adding/removing fields requires updating all three.
 */
import type { DesktopVerticalAPI } from "./verticals";
import type { SlidePreview } from "./slidePreviewWire";

export interface ArtifactStageRuntimeInput {
  artifact_stage: {
    version: 1; action: "rewrite" | "redraw"; instruction: string;
    cost_class: "metered" | "heavy"; idempotency_key: string; expected_sha256: string;
    write_mode: "new_artifact";
    target: { artifact_id: string; artifact_path: string; document_type: string };
    scope: { kind: string; block?: unknown; range?: unknown; region?: unknown };
  };
  workspaceId?: string; noProject?: boolean; conversationId?: string; parentTaskId?: string;
}

export type DocumentType = "pptx" | "docx" | "xlsx" | "report" | "img" | "gif";
export type GenerationMode = "fast" | "plan";
export type ImageRatio = "square" | "landscape" | "portrait";

export type SpreadsheetFieldRole =
  | "ignored" | "sku" | "productName" | "sellingPoints" | "description"
  | "referenceImages" | "marketplaceMainPrompt" | "marketplaceMainRatio"
  | "lifestylePrompt" | "lifestyleRatio" | "socialPosterPrompt"
  | "socialPosterRatio" | "generationCount" | "generatedImage" | "generationStatus";
export interface SpreadsheetPlannedColumn {
  column: number;
  role: SpreadsheetFieldRole;
  confidence: number;
  reason: string;
}
export interface SpreadsheetPlanFieldsInput {
  workspaceId?: string;
  noProject?: boolean;
  sheetName: string;
  headers: string[];
  sampleRows: string[][];
  assetKind?: string;
}
export interface SpreadsheetPlanFieldsResult {
  source?: "rules" | "ai" | "fallback";
  summary: string;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  columns: SpreadsheetPlannedColumn[];
}
export type AttachmentSlot = "sourceWorkbook" | "referenceImages";

export type AttachmentBridgeArgKey = "file_path" | "reference_images";

export interface AttachmentSpec {
  slot: AttachmentSlot;
  required: boolean;
  multiple: boolean;
  maxCount: number;
  extensions: string[];
  bridgeArgKey: AttachmentBridgeArgKey;
  label: string;
  description: string;
}

// Mirrors Go types.DocumentTypeCapability field for field (the drift checker
// holds the two together). Every per-type decision in the renderer reads
// this row; adding a document type is adding a row here and a viewer.
export interface DocumentTypeCapability {
  type: DocumentType;
  label: string;
  icon: string;
  attachments: AttachmentSpec[];
  /** Goes through the office generation modes rather than the image pipeline. */
  office: boolean;
  /** Sent as pptx_backend when the caller leaves it unset. */
  defaultPptxBackend?: string;
  imageRatio: boolean;
  frameRate: boolean;
  watermark: boolean;
  /** Extensions (lowercase, no dot) a file of this type carries in the preview. */
  previewExtensions: string[];
}

export const DOCUMENT_TYPE_CAPABILITIES: Record<DocumentType, DocumentTypeCapability> = {
  pptx: { type: "pptx", label: "PPTX", icon: "slideshow", office: true, defaultPptxBackend: "aippt-jssdk-design", imageRatio: false, frameRate: false, watermark: false, previewExtensions: ["pptx"], attachments: [] },
  docx: { type: "docx", label: "DOCX", icon: "description", office: true, imageRatio: false, frameRate: false, watermark: false, previewExtensions: ["docx"], attachments: [] },
  xlsx: { type: "xlsx", label: "XLSX", icon: "table", office: true, imageRatio: false, frameRate: false, watermark: false, previewExtensions: ["xlsx"], attachments: [] },
  report: {
    type: "report",
    label: "Report",
    icon: "article",
    office: true,
    imageRatio: false,
    frameRate: false,
    watermark: false,
    previewExtensions: [],
    attachments: [
      {
        slot: "sourceWorkbook",
        required: true,
        multiple: false,
        maxCount: 1,
        extensions: ["xlsx"],
        bridgeArgKey: "file_path",
        label: "Source workbook",
        description: "Excel workbook used as the data source for the report.",
      },
    ],
  },
  img: {
    type: "img",
    label: "Image",
    icon: "image",
    office: false,
    imageRatio: true,
    frameRate: false,
    watermark: true,
    previewExtensions: ["png", "jpg", "jpeg", "webp", "svg", "bmp"],
    attachments: [
      {
        slot: "referenceImages",
        required: false,
        multiple: true,
        maxCount: 6,
        extensions: ["png", "jpg", "jpeg", "webp", "svg", "bmp"],
        bridgeArgKey: "reference_images",
        label: "Reference images",
        description: "Optional style references blended into the generated image.",
      },
    ],
  },
  gif: {
    type: "gif",
    label: "GIF",
    icon: "gif",
    office: false,
    imageRatio: false,
    frameRate: true,
    watermark: false,
    previewExtensions: ["gif"],
    attachments: [
      {
        slot: "referenceImages",
        required: false,
        multiple: true,
        maxCount: 6,
        extensions: ["png", "jpg", "jpeg", "webp", "svg", "bmp"],
        bridgeArgKey: "reference_images",
        label: "Reference images",
        description: "Optional style references blended into the generated GIF sheet.",
      },
    ],
  },
};

export const DOCUMENT_TYPES: DocumentType[] = ["pptx", "docx", "xlsx", "report", "img", "gif"];

export function getCapability(type: DocumentType): DocumentTypeCapability {
  return DOCUMENT_TYPE_CAPABILITIES[type];
}

/** True for the six generated document types; narrows an unknown string. */
export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(DOCUMENT_TYPE_CAPABILITIES, value);
}

/** Every extension the preview can show: each type's own plus pdf/html. Mirrors Go types.PreviewExtensions. */
export const GENERIC_PREVIEW_EXTENSIONS = ["pdf", "html", "htm"] as const;
export function previewExtensions(): string[] {
  const out = new Set<string>();
  for (const type of DOCUMENT_TYPES) for (const ext of DOCUMENT_TYPE_CAPABILITIES[type].previewExtensions) out.add(ext);
  for (const ext of GENERIC_PREVIEW_EXTENSIONS) out.add(ext);
  return [...out];
}

export function getAttachmentSpec(type: DocumentType, slot: AttachmentSlot): AttachmentSpec | undefined {
  return DOCUMENT_TYPE_CAPABILITIES[type]?.attachments.find((spec) => spec.slot === slot);
}

export function supportsAttachment(type: DocumentType, slot: AttachmentSlot): boolean {
  return getAttachmentSpec(type, slot) !== undefined;
}

/** Events the officecli bridge emits about a task (mirrors Go types.EventTask*). */
export type TaskBridgeEventType =
  | "task.title"
  | "task.started"
  | "task.progress"
  | "task.question"
  | "task.plan"
  | "task.vibe_tree"
  | "task.vibe_ops"
  | "task.vibe_slide"
  | "task.vibe_outline"
  | "task.reslide_tail"
  | "task.output"
  | "task.completed"
  | "task.failed"
  | "task.cancelled";

/** Events the desktop writes into the same history itself; the bridge never sends them. */
export type LocalBridgeEventType = "task.user_input" | "task.answers";

/** Connection-state events the Go bridge client raises about the process. */
export type BridgeStatusEventType =
  | "bridge.reconnecting"
  | "bridge.reconnected"
  | "bridge.unconfigured"
  | "bridge.reconnect_exhausted"
  | "bridge.exited";

/** Agent-runtime events relayed by the bridge (run.*, step.*, client-tool.*, ...). */
export type RuntimeBridgeEventType =
  | "run.created" | "run.started" | "run.retrying" | "run.completed" | "run.failed" | "run.cancelled" | "run.review_ready"
  | "step.started" | "step.progress" | "step.completed" | "step.failed"
  | "input.requested" | "input.submitted"
  | "approval.requested" | "approval.resolved"
  | "client-tool.requested" | "client-tool.completed" | "client-tool.failed" | "client-tool.reassigned"
  | "artifact.created" | "usage.recorded";

export type KnownBridgeEventType = TaskBridgeEventType | LocalBridgeEventType | BridgeStatusEventType | RuntimeBridgeEventType;

/**
 * The known names get completion and exhaustiveness checks; the bridge also
 * announces its event_types at runtime, so an unknown name still decodes
 * instead of being rejected at the type level.
 */
export type BridgeEventType = KnownBridgeEventType | (string & Record<never, never>);

export interface BridgeEvent {
  event_id?: string;
  session_id?: string;
  request_id?: string;
  task_id?: string;
  run_id?: string;
  step_id?: string;
  type: BridgeEventType;
  ts?: string;
  payload?: Record<string, unknown>;
}

export interface TaskHistoryEntry {
  taskId: string;
  createdAt?: string;
  conversationId?: string;
  parentTaskId?: string;
  workspaceId?: string;
  workspacePath?: string;
  events: BridgeEvent[];
}

export interface WorkspaceSummary {
  id: string;
  path: string;
  name: string;
  active: boolean;
  updatedAt?: string;
  lastActiveAt?: string;
}

export interface Artifact {
  taskId?: string;
  fileID?: string;
  filePath: string;
  fileName: string;
  documentType: string;
  previewUrl?: string;
  editUrl?: string;
  syncedAt?: string;
}

export interface LocalTextDocument {
  filePath: string;
  fileName: string;
  text: string;
  truncated: boolean;
}

export interface RecentFile {
  filePath: string;
  fileName: string;
  documentType: string;
  source: "generated" | "local";
  workspaceId?: string;
  taskId?: string;
  conversationId?: string;
  lastOpenedAt: string;
}

/** Which runtime a task ran on; mirrors Go types.RuntimeMode. */
export type RuntimeMode = "custom" | "hosted";

export interface GenerateInput {
  documentType: DocumentType;
  generationMode?: GenerationMode;
  topic: string;
  prompt: string;
  workspaceId?: string;
  noProject?: boolean;
  conversationId?: string;
  parentTaskId?: string;
  promptTemplateId?: string;
  sourceFile?: string;
  referenceImages?: string[];
  imageRatio?: ImageRatio;
  fps?: number;
  imageWatermark?: ImageWatermarkGenerateOptions;
  outputDir?: string;
  publish?: boolean;
  resumeCheckpoint?: string;
  enableImages?: boolean;
  imageQuality?: "standard" | "premium";
  localPreview?: boolean;
  /** Which runtime ran the task ("custom" / "hosted"); Go fills it in for history. */
  runtimeMode?: RuntimeMode;
  /** Which PPTX backend to use; the desktop leaves it unset and Go selects aippt-jssdk-design. */
  pptxBackend?: string;
  pptxWorkflow?: "design" | "animation";
  templateId?: string;
  templateVersion?: number;
  templateAssetDir?: string;
}

// ModifyInput drives the "继续修改" (office.modify) flow: an LLM-driven in-place
// edit of an existing pptx/docx/xlsx artifact. sourceFile is the artifact being
// modified; the result is written as <base>.modified.<ext> next to it.
export interface ModifyInput {
  documentType: DocumentType;
  workspaceId?: string;
  noProject?: boolean;
  conversationId?: string;
  parentTaskId?: string;
  sourceFile: string;
  prompt: string;
  language?: string;
  style?: string;
  outputDir?: string;
}

export interface TaskQuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface TaskQuestionAnswer {
  questionGroupId?: string;
  questionId: string;
  optionId?: string;
  answer: string;
  questionIndex?: number;
}

export interface TaskQuestion {
  id: string;
  question: string;
  options: Array<TaskQuestionOption>;
  allowFreeform: boolean;
  questions?: Array<{
    id: string;
    question: string;
    options: Array<TaskQuestionOption>;
    allowFreeform: boolean;
  }>;
  currentIndex?: number;
  answers?: TaskQuestionAnswer[];
}

export type VibeTreeStage = "story_ready" | "outline_ready" | "refined_ready" | "slides_ready" | "rendering" | "completed";

export interface VibeVisualAsset {
  kind: "image" | "chart" | string;
  description: string;
}

export interface VibeSection {
  heading: string;
  detail?: string;
}

export interface VibeMetric {
  label: string;
  value: string;
  note?: string;
}

export type VibeChartType =
  | "column"
  | "bar"
  | "line"
  | "area"
  | "pie"
  | "donut"
  | "radar"
  | "scatter"
  | "combo"
  | string;

export interface VibeChartSeries {
  name: string;
  values: number[];
  color?: string;
  axis?: "primary" | "secondary";
  chartType?: Exclude<VibeChartType, "combo">;
}

export interface VibeChartOptions {
  legendVisible?: boolean;
  legendPosition?: "top" | "bottom" | "left" | "right";
  showValueLabels?: boolean;
  stacked?: boolean;
  yAxisLabel?: string;
  secondaryAxisLabel?: string;
}

export interface VibeChart {
  type?: VibeChartType;
  title?: string;
  /** Legacy single-series form; keep it readable while migrating to `series`. */
  categories?: string[];
  values?: number[];
  series?: VibeChartSeries[];
  options?: VibeChartOptions;
  source?: {
    kind: "attached_file" | "table" | "manual" | "illustrative" | string;
    ref?: string;
  };
  /** When true the values are representative, not sourced, and are labelled as illustrative. */
  illustrative?: boolean;
}

export type VibeSlideLayout =
  | "title"
  | "content"
  | "chart"
  | "dashboard"
  | "toc"
  | "chapter"
  | "gallery"
  | "comparison"
  | "timeline"
  | "closing";

export interface VibeProjectTreeNode {
  id: string;
  parentId?: string;
  kind: "root" | "branch" | "slide_group" | "slide" | string;
  title: string;
  beatType?: string;
  summary?: string;
  status?: string;
  intent?: string;
  materials?: string[];
  slideRange?: string;
  slideNumber?: number;
  outline?: string[];
  visualAssets?: VibeVisualAsset[];
  layout?: VibeSlideLayout | string;
  role?: string;
  sections?: VibeSection[];
  metrics?: VibeMetric[];
  chart?: VibeChart;
  trace?: string[];
}

export interface VibeProjectTree {
  id: string;
  rootId: string;
  title: string;
  direction?: string;
  nodes: VibeProjectTreeNode[];
}

export interface VibeTreeAction {
  id: string;
  label: string;
  description?: string;
}

export interface VibeTreeConfirmation {
  nodeIds: string[];
}

export interface VibeTreeSnapshot {
  stage: VibeTreeStage;
  tree: VibeProjectTree;
  actions: VibeTreeAction[];
  confirmation?: VibeTreeConfirmation;
}

export type StageStatus = "pending" | "active" | "completed" | "failed";

export interface StageState {
  id: string;
  label: string;
  status: StageStatus;
  startedAt?: string;
  completedAt?: string;
}

export interface AgentRunStartInput {
  workflow: string;
  input?: Record<string, unknown>;
  session_id?: string;
  metadata?: Record<string, string>;
}

export interface AgentRun {
  id: string;
  workflow: string;
  status: "created" | "running" | "waiting_input" | "waiting_approval" | "waiting_client_tool" | "review_ready" | "completed" | "failed" | "cancelled";
  session_id?: string;
  request_id?: string;
  input?: Record<string, unknown>;
  metadata?: Record<string, string>;
  result?: unknown;
  last_error?: string;
  current_step?: string;
  created_at: string;
  updated_at: string;
  events?: BridgeEvent[];
}

export interface AgentRunRespondInput { run_id: string; request_id: string; value: unknown }
export interface AgentRunApproveInput { run_id: string; request_id: string; approved: boolean; reason?: string; data?: unknown }
export interface AgentClientToolResultInput { run_id: string; call_id: string; status: "completed" | "failed"; result?: unknown; error?: string }
export interface AgentClientToolReassignInput { run_id: string; call_id: string; to_client_id?: string; reason?: string }

export interface TaskUserInput {
  pptxWorkflow?: "design" | "animation";
  templateId?: string;
  templateVersion?: number;
  templateAssetDir?: string;
  prompt: string;
  generationMode?: GenerationMode;
  promptTemplateId?: string;
  sourceFile?: string;
  referenceImages?: string[];
  imageRatio?: ImageRatio;
  fps?: number;
}

export interface ImagePromptSlot {
  /** Matches a {{key}} marker in promptPreset. Server-validated as ^[a-z0-9_]+$ and unique. */
  key: string;
  label: string;
  defaultValue?: string;
  helpText?: string;
  required?: boolean;
  multiline?: boolean;
}

export interface ImagePromptTemplate {
  id: number;
  ownerUserID?: number;
  visibility?: "platform_public" | "user_private" | string;
  slug: string;
  title: string;
  description: string;
  promptPreset: string;
  thumbnailUrl?: string;
  sortOrder: number;
  enabled: boolean;
  tags?: string[];
  /** When present and non-empty, the renderer shows a guided fill-in form instead of the raw textarea. */
  slots?: ImagePromptSlot[];
}

export interface CreateUserImageTemplateInput {
  sourceTemplateID?: number;
  slug: string;
  title: string;
  description?: string;
  promptPreset?: string;
  tags?: string[];
  slots?: ImagePromptSlot[];
  sortOrder?: number;
}

export interface CreateImageTemplatePublishRequestInput {
  privateTemplateID: number;
  provenanceID?: number;
  requestID?: string;
  submitterNote?: string;
}

export interface ImageTemplatePublishRequest {
  id: number;
  privateTemplateID: number;
  requesterUserID?: number;
  provenanceID: number;
  status: string;
  submitterNote?: string;
  publicTemplateID?: number;
  createdAt?: string;
  updatedAt?: string;
}

/**
 * The stage a generation failure happened in. The backend reports it from the
 * stage that failed; the renderer must never infer it from message text, which
 * is how a drawing failure used to be presented as a content failure.
 */
export type TaskFailureStage = "plan" | "content" | "render" | "export" | "transport";

/** What a failed run left behind, as counts rather than prose. */
export interface TaskRetainedWork {
  ready_pages: number;
  total_pages?: number;
  failed_pages?: number[];
}

export interface TaskFailure {
  stage: TaskFailureStage;
  /** Machine-readable reason, e.g. `worker_died`. */
  reason: string;
  retryable: boolean;
  /**
   * The re-entry point a retry may use, when one exists. Empty means nothing
   * can be resumed: offer the retained work and a restart instead of a
   * "continue" action that cannot work.
   */
  resume_stage?: string;
  resume_checkpoint?: string;
  retained?: TaskRetainedWork;
}

/** Where the deck a failed run already drew lives, plus its content facts. */
export interface TaskPartialWork {
  drawnPages?: number;
  readyPages?: number;
  totalPages?: number;
  failedPages?: number[];
}

export interface DesktopTask {
  /** Stable renderer identity while an optimistic task receives its server ID. */
  clientTaskId?: string;
  id: string;
  createdAt?: string;
  workspaceId?: string;
  workspacePath?: string;
  /** Internal lineage key for related runs. It is not a user-visible chat identifier. */
  conversationId: string;
  /** The run that this run continues. */
  parentTaskId?: string;
  status: "starting" | "running" | "question" | "plan_review" | "completed" | "failed" | "cancelled";
  /** Renderer-only optimistic lock while an interactive response is being replayed or accepted. */
  interactiveResponsePending?: boolean;
  /** The Respond call returned; wait for a durable post-gate event before releasing the lock. */
  interactiveResponseAccepted?: boolean;
  documentType?: string;
  topic?: string;
  events: BridgeEvent[];
  question?: TaskQuestion;
  plan?: TaskPlan;
  vibeTree?: VibeTreeSnapshot;
  /** Per-slide SlidePreview data streamed from the backend (vibe flow), ordered by index. */
  vibeSlides?: SlidePreview[];
  artifact?: Artifact;
  /**
   * The deck a failed run already drew and saved. It is a task outcome, not a
   * preview: `artifact` means "the finished document", `partialArtifact` means
   * "what exists because the run stopped early". They are separate so no
   * consumer can mistake one for the other, and so opening, exporting and
   * modifying a stopped run all work off the model instead of off whichever
   * preview happened to be on screen.
   */
  partialArtifact?: Artifact;
  /** Structured facts about what a failed run left behind. Never parsed from `error`. */
  failure?: TaskFailure;
  /**
   * Consolidated page facts for the failed-state UI: content readiness from
   * `failure.retained` plus how much actually reached the user's document. Kept
   * on the task so the failed panel reads one object instead of recombining
   * three sources at render time.
   */
  partial?: TaskPartialWork;
  error?: string;
  stages?: StageState[];
  activeStageId?: string;
  userInput?: TaskUserInput;
  creditCharged?: number | null;
  creditMode?: string;
  imageWatermark?: ImageWatermarkTaskMetadata;
  lastStatusCheckAt?: number;
  lastProgressAt?: number;
  stalledSince?: number;
  assembleProgress?: { step: string; status: string; content: string };
  runtimeSnapshot?: TaskRuntimeSnapshot;
  vibeOps?: VibeOp[];
  vibeOutline?: VibeOutline;
}

// Live-drawing ops stream from the bridge as JSON and are replayed into the
// presentation engine unchanged. The renderer reads a handful of fields; the
// rest passes through, typed unknown rather than any so nothing downstream
// can dereference a field the bridge never promised.
export interface VibeImageRef { digest?: string; [key: string]: unknown }
export interface VibeOpShape { kind?: string; imageRef?: VibeImageRef; [key: string]: unknown }
export interface VibeOpFill { imageRef?: VibeImageRef; [key: string]: unknown }
export interface VibeTemplateBinding { assetDir?: string; layoutId?: string; assetRoles?: string[]; [key: string]: unknown }
export interface VibeOp {
  op: string;
  seq: number;
  slide?: number;
  shape?: VibeOpShape;
  fill?: VibeOpFill;
  /** deck.begin: fonts the deck was authored with. */
  fonts?: { latin?: string; cjk?: string };
  /** deck.begin: total slide count. */
  slides?: number;
  /** deck.begin: where the worker staged pictures. */
  assetsDir?: string;
  /** slide.begin: local template clone binding. */
  template?: VibeTemplateBinding;
  [key: string]: unknown;
}
export interface VibeOutlineSlide { slide?: number; headline?: string; form?: string; composition?: string; [key: string]: unknown }
export interface VibeOutline { slides?: VibeOutlineSlide[]; [key: string]: unknown }
export interface TimelineDeck { nodeId: string; filePath: string; fileName: string; }
export interface TimelineNode {
  id: string;
  kind?: string;
  level?: number;
  text?: string;
  [key: string]: unknown;
}

export interface TaskPlan {
  id: string;
  markdown: string;
  revision: number;
  executionPrompt?: string;
}

export interface ImageWatermarkTaskMetadata {
  applied: boolean;
  paidEntitlement: boolean;
  canDisable: boolean;
}

export interface ImageWatermarkGenerateOptions {
  apply: boolean;
  paidEntitlement: boolean;
  canDisable: boolean;
}

export interface TaskRuntimeSnapshot {
  mode: "custom" | "hosted";
  provider?: ProviderSnapshot;
  appliedAt?: string;
}

export interface PreviewGrant {
  token: string;
  fileName: string;
  documentType: string;
}

export interface PrepareXlsxEditorResult {
  sessionId: string;
  modocContent: string;
  imageAssets?: Array<{ url: string; dataUrl: string }>;
}

export interface SaveXlsxEditorInput {
  previewToken: string;
  sessionId: string;
  modocContent: string;
  managedSheets?: Array<{ sheetName: string; rows: string[][] }>;
}

export interface SaveXlsxEditorResult {
  filePath: string;
}

export interface StageXlsxEditorImageInput {
  previewToken: string;
  sessionId: string;
  filePath?: string;
  data?: Uint8Array;
  mime?: string;
  sheetName: string;
  row: number;
  column: number;
  statusColumn: number;
}

export interface CloseXlsxEditorInput {
  previewToken: string;
  sessionId: string;
}

export type WhoAmIMode = "logged_in" | "anonymous" | "api_key";

export interface WhoAmIResult {
  mode: WhoAmIMode;
  userId?: string;
  email?: string;
  session?: string;
  expiresAt?: string;
}

export interface CreditStatus {
  mode: WhoAmIMode;
  accessMode: string;
  planName: string;
  paidEntitlement: boolean;
  hostedCreditBalance: number | null;
  anonymousCreditAvailable: number | null;
  anonymousCreditReserved: number | null;
  anonymousCreditBalance: number | null;
  rewardRemaining: number;
  paidKeyPrefix: string;
  paidKeyTotal: number;
  paidKeyUsed: number;
  paidKeyRemaining: number;
  raw: string;
}

export interface RedeemResult {
  code: string;
  credit_amount: number;
  new_balance: number;
  redeemed_at: string;
  expires_at?: string | null;
}

export type AuthEvent =
  | { type: "url"; url: string }
  | { type: "success" }
  | { type: "failure"; message: string }
  | { type: "exit"; code: number | null; signal: NodeJS.Signals | null };

export interface GenerateDefaults {
  documentType: DocumentType;
  enableImages: boolean;
  imageQuality: "standard" | "premium";
}

export type LlmProviderType = "openai" | "anthropic" | "azure" | "custom" | "official";

export interface LlmProvider {
  type: LlmProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ProxySettings {
  enabled: boolean;
  url: string;
}

export interface ImageWatermarkSettings {
  showWatermark: boolean;
  preferenceSource: "system" | "user";
}

export interface ProviderTestInput {
  useProviderOverride?: boolean;
  llmProvider?: LlmProvider | null;
  useProxyOverride?: boolean;
  proxy?: ProxySettings | null;
  allowPaidOfficialProbe?: boolean;
}

export interface UserSettings {
  version: number;
  defaults: GenerateDefaults;
  workspaceDir: string | null;
  /** Deprecated legacy alias; new code should use workspaceDir. */
  outputDir: string | null;
  llmProvider: LlmProvider | null;
  onboardingCompletedAt: string | null;
  proxy: ProxySettings | null;
  imageWatermark: ImageWatermarkSettings;
  waiting2048Enabled: boolean;
  /** Explicit officecli binary; null uses the bundled one. */
  bridgeBinaryPath?: string | null;
  supportReportEndpoint?: string | null;
  supportReportToken?: string | null;
}

export interface AppUpdateAsset {
  url: string;
  sha256: string;
  size: number;
}

export interface AppUpdateRelease {
  version: string;
  notes: string;
  minSupportedVersion: string;
  mandatory: boolean;
  publishedAt?: string;
  assets: Record<string, AppUpdateAsset>;
}

export interface AppUpdateErrorEntry {
  timestamp: string;
  manifestUrl: string;
  message: string;
  latencyMs: number;
}

export interface AppUpdateStatus {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  mandatory: boolean;
  downloading: boolean;
  downloadedPath: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  notes?: string;
  lastErrors?: AppUpdateErrorEntry[];
}

export interface AppUpdateCheckResult {
  release: AppUpdateRelease | null;
  status: AppUpdateStatus;
}

export type AppUpdateEvent =
  | { type: "status"; status?: AppUpdateStatus; release?: AppUpdateRelease }
  | { type: "progress"; bytesDone?: number; bytesTotal?: number }
  | { type: "downloaded"; downloadedPath: string }
  | { type: "installed"; message?: string }
  | { type: "error"; message: string };

export interface BundleManifestItem {
  path: string;
  sizeBytes: number;
  preview?: string;
  sectionId: string;
}

export interface BundleManifest {
  schemaVersion: number;
  bundleId: string;
  items: BundleManifestItem[];
  truncated: boolean;
  excludedReasons?: string[];
}

export interface ExportLogsResult {
  path: string;
  manifest: BundleManifest;
}

export interface ExportLogsInput {
  taskId?: string;
  includeSettings: boolean;
  includeEvents: boolean;
  includeLogs: boolean;
  includeRecent: boolean;
}

export interface SubmitReportInput {
  taskId?: string;
  description: string;
  contactEmail?: string;
}

export interface SubmitReportResult {
  ticketId?: string;
  requestId?: string;
  uploaded: boolean;
  fallbackReason?: string;
  viewUrl?: string;
}

export interface PeekReportContextResult {
  requestId: string;
  errorCode: string;
  errorMessage: string;
  runtimeMode?: RuntimeMode;
}

export interface LoginInput {
  inviteCode?: string;
}

export interface InviteInfo {
  invite_code: string;
}

export interface ReportCapabilityResult {
  enabled: boolean;
  reason?: string;
}

export type BinaryFileData = ArrayBuffer | Uint8Array;

export interface SavePptxOptions {
  targetFilePath?: string;
}

export interface SaveDocxOptions {
  previewToken: string;
  expectedSHA256?: string;
  saveAsCopy?: boolean;
}

export interface SaveDocxResult {
  filePath: string;
  sha256: string;
}

export interface PlanPptxJSTurn {
  role: "user" | "assistant";
  content: string;
}

/** Request for the presentation editor AI planner (`PlanPptxJS`). */
export interface PlanPptxJSInput {
  prompt: string;
  /** Inspect result from the embedded editor: slides, selectedSlideIds, selectedShapes. */
  context: unknown;
  history?: PlanPptxJSTurn[];
}

export interface PlanPptxJSConfirmation {
  title?: string;
  message?: string;
  target?: string;
  changes?: string[];
  preserved?: string[];
}

/** PowerPoint.run plan produced by OfficeCLI; executed only inside the editor's Worker. */
export interface PlanPptxJSResult {
  summary: string;
  source: string;
  confidence?: "high" | "medium" | "low";
  requires_confirmation?: boolean;
  confirmation?: PlanPptxJSConfirmation | null;
  warnings?: string[];
}

/** One resource embedded in a deck opened by the presentation editor. */
export interface PptxEditorAsset {
  path: string;
  contentType: string;
  data: Uint8Array;
}

export interface PreparePptxEditorResult {
  sessionId: string;
  fileId: string;
  title: string;
  sourceFileName: string;
  /** Decoded at the bridge boundary; the Go side sends base64. */
  content: Uint8Array;
  documentRevision: number;
  assets?: PptxEditorAsset[];
}

export interface SavePptxEditorSnapshotInput {
  previewToken: string;
  sessionId: string;
  content: Uint8Array;
  baseRevision: number;
  revision: number;
}

export interface SavePptxEditorAssetInput {
  previewToken: string;
  sessionId: string;
  relativePath: string;
  contentType?: string;
  data: Uint8Array;
}

export interface SavePptxEditorVideoInput {
  previewToken: string;
  sessionId: string;
  revision: number;
  fileName: string;
  content: Uint8Array;
}

export interface ExportPptxEditorInput {
  previewToken: string;
  sessionId: string;
  revision: number;
}

export interface ClosePptxEditorInput {
  previewToken: string;
  sessionId: string;
}

export interface PptxEditorSaveResult {
  filePath: string;
  revision: number;
}

export interface PptxEditorSaveAssetResult {
  resourceUri: string;
  digest: string;
  resourceSize: number;
  contentType: string;
  extension: string;
}

export interface PptxEditorVideoSaveResult {
  filePath: string;
  fileName: string;
}

export interface DrawingAsset {
  digest: string;
  contentType: string;
  base64: string;
}

export interface CaptureTimelineNodeInput {
  taskId: string;
  previewToken: string;
  sessionId: string;
  kind: string;
  seq: number;
  slide: number;
  slides: number;
  label: string;
  shape?: string;
  /** Base64 document the editor encoded itself; empty reads the session snapshot. */
  content?: string;
  withAssets?: boolean;
  artifactPath?: string;
}

export interface TimelineCapturedNode {
  id: string;
  parentId?: string;
  kind: string;
  seq?: number;
  shape?: string;
  slide?: number;
  slides?: number;
  label: string;
  createdAt: string;
}

export interface CreateWorkbookFromSheetInput {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: string[][];
  workspaceId?: string;
}

export interface PptxTaskStatus { task_id: string; status: string; updated_at?: string; last_error?: string; }

export interface PptxTemplateProgress {
  id: string;
  name: string;
  sourceFileName: string;
  localAssetDir: string;
  status: "uploaded" | "imported" | "assets_extracted" | "analyzing" | "ready" | "failed";
  stage: "copy" | "convert" | "extract" | "analyze" | "skill" | "ready" | "imported" | "failed";
  step: number;
  steps: number;
  error?: string;
}

/* ─── Document projection ───────────────────────────────────────────────────
 *
 * The Document/Run/Activity model the desktop maintains on every write
 * (localstore schemaV7). A run that produced a file is that file's row, so the
 * artifact path is the identity. This is what `UiPort.files` is built on — see
 * docs/uiport-scope.md.
 *
 * Field names mirror the Go json tags exactly; verify-bridge-types.mjs compares
 * them against the generated bindings.
 */

export interface DocumentRecord {
  id: string;
  filePath: string;
  fileName: string;
  documentType: string;
  currentArtifactTaskId?: string;
  workspaceId?: string;
  createdAt: string;
  updatedAt: string;
  migrationSource: string;
  pinned: boolean;
}

export interface RunRecord {
  id: string;
  documentId?: string;
  activityStreamId: string;
  sourceConversationId: string;
  parentRunId?: string;
  status: string;
  documentType?: string;
  sourceFile?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ActivityRecord {
  id: string;
  activityStreamId: string;
  sourceConversationId: string;
  taskId: string;
  ordinal: number;
  kind: string;
  eventId?: string;
  eventType: string;
  payloadJson: string;
  createdAt: string;
}

/**
 * A real directory documents are filed into.
 *
 * Exactly one folder is the default — where work lands when the user has not
 * chosen anywhere else. It is synthesised from the per-user workspace
 * directory rather than stored, so the old IA's "no project" and the new one's
 * "default folder" are the same place on disk.
 */
export interface FolderRecord {
  id: string;
  name: string;
  /** Absolute path on disk. The UI shows it; it never parses it. */
  path: string;
  isDefault?: boolean;
}

export interface DocumentListInput {
  /** Blank means every workspace, not "the ones filed nowhere". */
  workspaceId?: string;
  limit?: number;
  cursor?: string;
}

export interface DocumentPage {
  items: DocumentRecord[];
  nextCursor?: string;
}

export interface DocumentActivityListInput {
  documentId: string;
  limit?: number;
  cursor?: string;
}

export interface ActivityPage {
  items: ActivityRecord[];
  nextCursor?: string;
}

export interface DesktopAPI extends DesktopVerticalAPI {
  /**
   * The document projection. Maintained on every write since it landed and
   * unreadable until now — these four are the missing half.
   */
  listDocuments(input: DocumentListInput): Promise<DocumentPage>;
  /** Refuses rather than returning a blank record when the id is unknown. */
  getDocument(documentId: string): Promise<DocumentRecord>;
  listDocumentRuns(documentId: string): Promise<RunRecord[]>;
  listDocumentActivities(input: DocumentActivityListInput): Promise<ActivityPage>;
  /** Pinning is a filter on the one file list, not a move to another place. */
  setDocumentPinned(documentId: string, pinned: boolean): Promise<void>;

  /** Folders, the default one first. */
  listFolders(): Promise<FolderRecord[]>;
  /** Takes a name; where the directory goes is the desktop's business. */
  createFolder(name: string): Promise<FolderRecord>;
  /** Renames the label. The directory on disk keeps its name. */
  renameFolder(folderId: string, name: string): Promise<FolderRecord>;
  /** Unregisters it. Files are neither deleted nor moved. */
  removeFolder(folderId: string): Promise<void>;
  /** The directory a folder id stands for. Blank resolves to the default. */
  folderPath(folderId: string): Promise<string>;

  getPptxTaskStatus?: (taskId: string) => Promise<PptxTaskStatus>;
  skipPptxResearch?: (taskId: string) => Promise<void>;
  /**
   * Steering a run that is drawing right now. Distinct from modify(): the
   * instruction lands at the deck's next page boundary instead of starting a
   * second task against the finished file. All three stay optional so an older
   * desktop runtime degrades to the modify path rather than failing outright.
   */
  intervenePptx?: (taskId: string, text: string) => Promise<{ effectiveFrom?: number }>;
  pausePptx?: (taskId: string) => Promise<void>;
  resumePptxLive?: (taskId: string) => Promise<void>;
  saveOfficeProductProject?(input: { id: string; name: string; createdAt?: string; updatedAt?: string }): Promise<void>;
  saveOfficeProductSource?(input: { id: string; workbookId: string; name: string; kind: string; location?: string; lastImportedAt?: string; lastError?: string }): Promise<void>;
  saveOfficeProductView?(input: { id: string; workbookId: string; sheetName: string; layer: string; range?: string; fingerprint: string; updatedAt?: string }): Promise<void>;
  saveOfficeProductOutput?(input: { id: string; projectId: string; outputType: string; title: string; filePath?: string; version: number; status: string; workbookId?: string; viewIds?: string[]; sourceIds?: string[]; workbookFingerprint?: string; lineageCapturedAt?: string; manuallyEdited?: boolean; updatedAt?: string }): Promise<void>;
  listOfficeProductOutputs?(projectId?: string, workbookId?: string): Promise<Array<{ id: string; projectId: string; outputType: string; title: string; filePath?: string; version: number; status: string; workbookId?: string; viewIds?: string[]; sourceIds?: string[]; workbookFingerprint?: string; lineageCapturedAt?: string; manuallyEdited: boolean; updatedAt: string }>>;
  listOfficeProductSources?(workbookId?: string): Promise<Array<{ id: string; workbookId: string; name: string; kind: string; location?: string; lastImportedAt?: string; lastError?: string }>>;
  listOfficeProductViews?(workbookId?: string): Promise<Array<{ id: string; workbookId: string; sheetName: string; layer: string; range?: string; fingerprint: string; updatedAt: string }>>;
  saveOfficeProductRefreshPlan?(input: { id: string; outputId: string; strategy: string; status: string; changedViews?: string[]; preserveManualEdits: boolean; requiresApproval: boolean; attempts: number; error?: string; updatedAt?: string }): Promise<void>;
  listOfficeProductRefreshPlans?(outputId?: string): Promise<Array<{ id: string; outputId: string; strategy: string; status: string; changedViews?: string[]; preserveManualEdits: boolean; requiresApproval: boolean; attempts: number; error?: string; updatedAt: string }>>;
  writeHtmlAppFiles?(input: { root: string; files: Record<string, Uint8Array> }): Promise<string[]>;
  initialize(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  listImageTemplates(): Promise<ImagePromptTemplate[]>;
  createImageTemplate(input: CreateUserImageTemplateInput): Promise<ImagePromptTemplate>;
  createImageTemplatePublishRequest(input: CreateImageTemplatePublishRequestInput): Promise<ImageTemplatePublishRequest>;
  generate(input: GenerateInput): Promise<{ taskId: string; sessionId: string; status: string }>;
  planSpreadsheetFields(input: SpreadsheetPlanFieldsInput & { headerRowIndex: number }): Promise<SpreadsheetPlanFieldsResult>;
  modify(input: ModifyInput): Promise<{ taskId: string; sessionId: string; status: string }>;
  artifactStageEdit?(input: ArtifactStageRuntimeInput): Promise<{ taskId: string; sessionId: string; status: string }>;
  startAgentRun(input: AgentRunStartInput): Promise<AgentRun>;
  getAgentRun(runId: string): Promise<AgentRun>;
  listAgentRuns(limit?: number): Promise<AgentRun[]>;
  respondAgentRun(input: AgentRunRespondInput): Promise<void>;
  approveAgentRun(input: AgentRunApproveInput): Promise<void>;
  retryAgentRun(runId: string): Promise<AgentRun>;
  cancelAgentRun(runId: string): Promise<void>;
  completeAgentClientTool(input: AgentClientToolResultInput): Promise<void>;
  reassignAgentClientTool(input: AgentClientToolReassignInput): Promise<void>;
  respond(input: { taskId: string; questionId?: string; optionId?: string; answer?: string; answers?: TaskQuestionAnswer[] }): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>;
  openPath(filePath: string): Promise<void>;
  showItemInFolder(filePath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openFileDialog(options?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  openDirectoryDialog(): Promise<string | null>;
  openMultiFileDialog(options?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<string[] | null>;
  readPptxTemplateSource?(assetDir: string): Promise<{ data: Uint8Array; sha256: string }>;
  deletePptxTemplate?(assetDir: string): Promise<void>;
  onPptxTemplateProgress?(callback: (event: PptxTemplateProgress) => void): () => void;
  importPptxTemplate?(input: { sourcePath: string; name?: string }): Promise<{
    id: string;
    name: string;
    sourceFileName: string;
    sourceSha256: string;
    localAssetDir: string;
    status: "imported" | "assets_extracted" | "ready";
    version: number;
    createdAt: string;
    updatedAt: string;
    pageCount: number;
    assetCounts: { logo: number; icons: number; images: number; decorative: number };
    warnings: string[];
  }>;
  savePastedImage(data: Uint8Array, ext: string): Promise<string>;
  savePptx(data: Uint8Array, fileName: string, options?: SavePptxOptions): Promise<string>;
  saveDocx(data: Uint8Array, fileName: string, options: SaveDocxOptions): Promise<SaveDocxResult>;
  planPptxJS(input: PlanPptxJSInput): Promise<PlanPptxJSResult>;
  previewArtifact(artifact: Artifact): Promise<void>;
  issuePreviewToken(artifact: Artifact): Promise<PreviewGrant>;
  revokePreviewToken(token: string): Promise<void>;
  createLivePptxDraft(taskId: string): Promise<{ filePath: string; fileName: string }>;
  readDrawingAsset(assetsDir: string, digest: string): Promise<DrawingAsset>;
  captureTimelineNode(input: CaptureTimelineNodeInput): Promise<TimelineCapturedNode>;
  createWorkbookFromSheet(input: CreateWorkbookFromSheetInput): Promise<Artifact>;
  preparePptxEditor(previewToken: string): Promise<PreparePptxEditorResult>;
  savePptxEditorSnapshot(input: SavePptxEditorSnapshotInput): Promise<PptxEditorSaveResult>;
  savePptxEditorAsset(input: SavePptxEditorAssetInput): Promise<PptxEditorSaveAssetResult>;
  savePptxEditorVideo(input: SavePptxEditorVideoInput): Promise<PptxEditorVideoSaveResult>;
  exportPptxEditor(input: ExportPptxEditorInput): Promise<PptxEditorSaveResult>;
  closePptxEditor(input: ClosePptxEditorInput): Promise<void>;
  prepareXlsxEditor(previewToken: string): Promise<PrepareXlsxEditorResult>;
  saveXlsxEditor(input: SaveXlsxEditorInput): Promise<SaveXlsxEditorResult>;
  stageXlsxEditorImage(input: StageXlsxEditorImageInput): Promise<{ url: string }>;
  closeXlsxEditor(input: CloseXlsxEditorInput): Promise<void>;
  readArtifactFile(previewToken: string): Promise<{ data: BinaryFileData; sha256?: string }>;
  readLocalImage(filePath: string): Promise<{ data: BinaryFileData; mime: string }>;
  readLocalTextDocuments(filePaths: string[]): Promise<LocalTextDocument[]>;
  copyImageToClipboard(filePath: string): Promise<void>;
  setPreviewMode(active: boolean): Promise<void>;
  login(input?: LoginInput): Promise<{ url: string }>;
  cancelLogin(): Promise<void>;
  whoami(): Promise<WhoAmIResult>;
  logout(): Promise<void>;
  getCreditStatus(): Promise<CreditStatus>;
  getInviteInfo(): Promise<InviteInfo>;
  sendDesktopNotification?(input: { title: string; body: string }): Promise<void>;
  redeem(code: string): Promise<RedeemResult>;
  getSettings(): Promise<UserSettings>;
  updateSettings(patch: Partial<UserSettings>): Promise<UserSettings>;
  getDefaultWorkspaceDir(): Promise<string>;
  listWorkspaces(): Promise<WorkspaceSummary[]>;
  listRecentFiles(workspaceId?: string): Promise<RecentFile[]>;
  removeRecentFile(filePath: string): Promise<void>;
  deleteDocument(taskId: string): Promise<void>;
  renameWorkspace(workspaceId: string, name: string): Promise<WorkspaceSummary>;
  openRecentFile(file: RecentFile): Promise<Artifact>;
  addWorkspace(path: string): Promise<WorkspaceSummary>;
  selectWorkspace(workspaceId: string): Promise<WorkspaceSummary>;
  removeWorkspace(workspaceId: string): Promise<void>;
  onAuthEvent(callback: (event: AuthEvent) => void): () => void;
  onBridgeEvent(callback: (event: BridgeEvent) => void): () => void;
  onFileDrop(callback: (paths: string[]) => void): () => void;
  getAppVersion(): Promise<string>;
  getAppUpdateStatus(): Promise<AppUpdateStatus>;
  checkAppUpdate(): Promise<AppUpdateCheckResult>;
  downloadAppUpdate(): Promise<string>;
  installAppUpdate(): Promise<void>;
  cancelAppUpdate(): Promise<void>;
  onAppUpdateEvent(callback: (event: AppUpdateEvent) => void): () => void;
  exportLogs(input?: ExportLogsInput): Promise<ExportLogsResult>;
  submitReport(input: SubmitReportInput): Promise<SubmitReportResult>;
  getReportCapability(): Promise<ReportCapabilityResult>;
  peekReportContext(taskId: string): Promise<PeekReportContextResult>;
  getTaskHistory(limit?: number): Promise<TaskHistoryEntry[]>;
  getBridgeRuntimeSnapshot(): Promise<BridgeRuntimeSnapshot>;
  recordRendererLog(input: RendererLogInput): Promise<void>;
  testProvider(input?: ProviderTestInput): Promise<ProviderTestResult>;
}

export interface RendererLogInput {
  source: string;
  event: string;
  atMs?: number;
  details?: Record<string, unknown>;
}

export interface ProviderSnapshot {
  type: "openai" | "anthropic" | "azure" | "custom";
  baseUrlHost: string;
  model: string;
  apiKeyMasked: string;
  apiKeyLength: number;
}

export interface BridgeRuntimeSnapshot {
  runtimeMode: "custom" | "hosted";
  provider?: ProviderSnapshot | null;
  binaryPath: string;
  resolvedAt?: string;
  envApplied: boolean;
  proxyHost?: string;
}

export interface ProviderTestResult {
  ok: boolean;
  httpStatus: number;
  latencyMs: number;
  url: string;
  error?: string;
  responseMessage?: string;
  unavailable?: boolean;
  probeType?: "http" | "officialPaid";
}
