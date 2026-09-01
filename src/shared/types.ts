/**
 * Drift risk: this file must stay in sync with:
 *   - internal/types/types.go (Go-side definitions)
 *   - src/renderer/generated/wailsjs/go/models.ts (Wails auto-generated)
 * Adding/removing fields requires updating all three.
 */
import type { PptistDeckSnapshot, PptistEditOp, PptistSlide } from "./pptistProtocol";

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

// Spreadsheet connector contracts. These are deliberately renderer-facing
// shapes: secrets never cross this boundary, while provider responses retain
// their source metadata for an auditable Sheet writeback.
export type JiraAuthType = "token" | "basic" | "";
export interface JiraConnectionSummary {
  configured: boolean;
  baseUrl: string;
  authType: JiraAuthType;
  username?: string;
}
export interface JiraProbeResult {
  server: { baseUrl: string; version: string; deploymentType?: string; serverTitle?: string };
  user: { name?: string; displayName?: string };
}
export interface JiraSyncResult {
  sheetName: string;
  headers: string[];
  rows: string[][];
  jql: string;
  total: number;
  fetched: number;
  truncated: boolean;
  syncedAt: string;
  querySummary?: string;
}
export type ConfiguredJiraSyncResult =
  | { status: "completed"; result: JiraSyncResult; message?: string }
  | { status: "unsupported" | "failed"; result?: undefined; message?: string };

export interface LiquipediaConnectionSummary {
  configured: boolean;
  baseUrl: string;
  contact?: string;
}
export interface LiquipediaProbeResult {
  siteName: string;
  generator: string;
  language?: string;
  apiUrl: string;
  userAgent: string;
}
export interface LiquipediaSyncResult {
  sheetName: string;
  headers: string[];
  rows: string[][];
  total: number;
  fetched: number;
  truncated: boolean;
  syncedAt: string;
  querySummary?: string;
  attribution: string;
}
export type ConfiguredLiquipediaSyncResult =
  | { status: "completed"; result: LiquipediaSyncResult; message?: string }
  | { status: "unsupported" | "failed"; result?: undefined; message?: string };

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
export interface MarketingCampaignPlanInput {
  sheetId: string; sheetName: string; headers: string[];
  rows: Array<{ rowIndex: number; productName: string; basePrompt: string; referenceImages?: string[] }>;
  campaign: Record<string, unknown> & { selectedChannelIds: string[] };
}
export interface MarketingCampaignPlanResult {
  ruleVersion?: string; channels: string[]; missingChannels: string[];
  jobs: Array<{ rowIndex: number; productName?: string; referenceImages?: string[]; channelId: string; outputTemplateId?: string; ratio?: ImageRatio; outputColumn?: number; prompt: string }>;
}
export interface CampaignImageInput { sourcePath: string; channelId: string; outputTemplateId?: string; campaignName?: string; productName?: string; offer?: string; cta?: string; }
export interface CampaignImageResult { filePath: string; width: number; height: number; }

export interface ShopifyCatalogCleanupInput {
  sheetId: string; sheetName: string; rows: string[][]; selectionStartRow: number;
  intent?: "create" | "update" | "mixed";
  confirmedMapping?: Array<{ column: number; header: string; role: string; confidence: number; reason: string }>;
}
export interface ShopifyCatalogCleanupResult {
  sheetId: string; sheetName: string; headerRowIndex: number; firstRowIndex: number;
  existingColumnCount: number; headers: string[]; sourceRows: string[][];
  intent: "create" | "update" | "mixed"; creditEstimate: number;
  mapping: Array<{ column: number; header: string; role: string; confidence: number; reason: string }>;
  rows: Array<{ rowIndex: number; status: string; issues: string[]; findings: Array<{ code: string; severity: string; message: string }>; cleanupActions: Array<{ code: string; field: string; before: string; after: string; safety: string; message: string }>; values: Record<string, string> }>;
  batchFindings: Array<{ code: string; severity: string; message: string }>;
  resultColumns: Record<string, number>; ruleVersion: string; taxonomyVersion: string;
  shopifyCsv: string; findingsCsv: string;
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

export interface DocumentTypeCapability {
  type: DocumentType;
  label: string;
  icon: string;
  attachments: AttachmentSpec[];
}

export const DOCUMENT_TYPE_CAPABILITIES: Record<DocumentType, DocumentTypeCapability> = {
  pptx: { type: "pptx", label: "PPTX", icon: "slideshow", attachments: [] },
  docx: { type: "docx", label: "DOCX", icon: "description", attachments: [] },
  xlsx: { type: "xlsx", label: "XLSX", icon: "table", attachments: [] },
  report: {
    type: "report",
    label: "Report",
    icon: "article",
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

export function getAttachmentSpec(type: DocumentType, slot: AttachmentSlot): AttachmentSpec | undefined {
  return DOCUMENT_TYPE_CAPABILITIES[type]?.attachments.find((spec) => spec.slot === slot);
}

export function supportsAttachment(type: DocumentType, slot: AttachmentSlot): boolean {
  return getAttachmentSpec(type, slot) !== undefined;
}

export interface BridgeEvent {
  event_id?: string;
  session_id?: string;
  request_id?: string;
  task_id?: string;
  run_id?: string;
  step_id?: string;
  type: string;
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
  enableImages?: boolean;
  imageQuality?: "standard" | "premium";
  localPreview?: boolean;
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

export interface VibeChart {
  type?: "bar" | "pie" | "line" | string;
  title?: string;
  categories?: string[];
  values?: number[];
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

export interface DesktopTask {
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
  /** Per-slide PptistSlide data streamed from the backend (vibe flow), ordered by index. */
  vibeSlides?: PptistSlide[];
  artifact?: Artifact;
  error?: string;
  stages?: StageState[];
  activeStageId?: string;
  userInput?: TaskUserInput;
  creditCharged?: number | null;
  creditMode?: string;
  imageWatermark?: ImageWatermarkTaskMetadata;
  lastProgressAt?: number;
  stalledSince?: number;
  assembleProgress?: { step: string; status: string; content: string };
  runtimeSnapshot?: TaskRuntimeSnapshot;
  vibeOps?: VibeOp[];
  vibeOutline?: VibeOutline;
}

export type VibeOpShape = Record<string, any>;
export interface VibeOp { [key: string]: any; op: string; seq: number; slide?: number; shape?: VibeOpShape; }
export interface VibeOutline { [key: string]: any; }
export interface TimelineDeck { nodeId: string; filePath: string; fileName: string; }
export interface TimelineNode { [key: string]: any; id: string; }

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
}

export interface PeekReportContextResult {
  requestId: string;
  errorCode: string;
  errorMessage: string;
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

export interface ModifyPptistDeckInput {
  prompt: string;
  snapshot: PptistDeckSnapshot;
  selectedSlideId?: string;
  selectedElementIds?: string[];
  history?: Array<{ role: "user" | "assistant"; content: string }>;
  pptxDataBase64?: string;
}

export interface ModifyPptistDeckResult {
  summary: string;
  ops: PptistEditOp[];
  confidence?: "high" | "medium" | "low";
  requiresConfirmation?: boolean;
  confirmation?: {
    title?: string;
    message?: string;
    target?: string;
    changes?: string[];
    preserved?: string[];
  };
  warnings?: string[];
}

export interface PlanPptxJSTurn {
  role: "user" | "assistant";
  content: string;
}

/** Request for the learnof/pptx AI planner (`PlanPptxJS`). */
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

export interface DesktopAPI {
  [key: string]: any;
  initialize(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  listImageTemplates(): Promise<ImagePromptTemplate[]>;
  createImageTemplate(input: CreateUserImageTemplateInput): Promise<ImagePromptTemplate>;
  createImageTemplatePublishRequest(input: CreateImageTemplatePublishRequestInput): Promise<ImageTemplatePublishRequest>;
  generate(input: GenerateInput): Promise<{ taskId: string; sessionId: string; status: string }>;
  getJiraConnection(): Promise<JiraConnectionSummary>;
  saveJiraConnection(input: { baseUrl: string; auth: { type: JiraAuthType; username?: string; secret: string } }): Promise<JiraProbeResult>;
  clearJiraConnection(): Promise<void>;
  getLiquipediaConnection(): Promise<LiquipediaConnectionSummary>;
  saveLiquipediaConnection(input: { baseUrl: string; contact: string }): Promise<LiquipediaProbeResult>;
  clearLiquipediaConnection(): Promise<void>;
  planSpreadsheetFields(input: SpreadsheetPlanFieldsInput & { headerRowIndex: number }): Promise<SpreadsheetPlanFieldsResult>;
  planShopifyCatalogCampaign(input: MarketingCampaignPlanInput): Promise<MarketingCampaignPlanResult>;
  composeCampaignImage(input: CampaignImageInput): Promise<CampaignImageResult>;
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
  savePastedImage(data: Uint8Array, ext: string): Promise<string>;
  savePptx(data: Uint8Array, fileName: string, options?: SavePptxOptions): Promise<string>;
  saveDocx(data: Uint8Array, fileName: string, options: SaveDocxOptions): Promise<SaveDocxResult>;
  modifyPptistDeck(input: ModifyPptistDeckInput): Promise<ModifyPptistDeckResult>;
  planPptxJS(input: PlanPptxJSInput): Promise<PlanPptxJSResult>;
  previewArtifact(artifact: Artifact): Promise<void>;
  issuePreviewToken(artifact: Artifact): Promise<PreviewGrant>;
  revokePreviewToken(token: string): Promise<void>;
  createLivePptxDraft(taskId: string): Promise<{ filePath: string; fileName: string }>;
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
