/**
 * Drift risk: this file must stay in sync with:
 *   - internal/types/types.go (Go-side definitions)
 *   - src/renderer/generated/wailsjs/go/models.ts (Wails auto-generated)
 * Adding/removing fields requires updating all three.
 */
import type { PptistDeckSnapshot, PptistEditOp, PptistSlide } from "./pptistProtocol";

export type DocumentType = "pptx" | "docx" | "xlsx" | "report" | "img" | "gif";
export type GenerationMode = "fast" | "plan";
export type ImageRatio = "square" | "landscape" | "portrait";

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
  type: string;
  ts?: string;
  payload?: Record<string, unknown>;
}

export interface TaskHistoryEntry {
  taskId: string;
  conversationId?: string;
  parentTaskId?: string;
  workspaceId?: string;
  workspacePath?: string;
  events: BridgeEvent[];
}

export interface WorkspaceConversationSummary {
  conversationId: string;
  firstTaskId: string;
  latestTaskId: string;
  title: string;
  status: DesktopTask["status"];
  documentType?: string;
  updatedAt?: string;
}

export interface WorkspaceSummary {
  id: string;
  path: string;
  name: string;
  active: boolean;
  updatedAt?: string;
  lastActiveAt?: string;
  conversations: WorkspaceConversationSummary[];
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
  workspaceId?: string;
  workspacePath?: string;
  /** Groups related tasks into a single conversation view. First task uses its own id as conversationId. */
  conversationId: string;
  /** The task that this task is a continuation of (for conversation ordering). */
  parentTaskId?: string;
  status: "starting" | "running" | "question" | "plan_review" | "completed" | "failed" | "cancelled";
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
}

export interface SaveXlsxEditorInput {
  previewToken: string;
  sessionId: string;
  modocContent: string;
}

export interface SaveXlsxEditorResult {
  filePath: string;
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

export interface DesktopAPI {
  initialize(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  listImageTemplates(): Promise<ImagePromptTemplate[]>;
  createImageTemplate(input: CreateUserImageTemplateInput): Promise<ImagePromptTemplate>;
  createImageTemplatePublishRequest(input: CreateImageTemplatePublishRequestInput): Promise<ImageTemplatePublishRequest>;
  generate(input: GenerateInput): Promise<{ taskId: string; sessionId: string; status: string }>;
  modify(input: ModifyInput): Promise<{ taskId: string; sessionId: string; status: string }>;
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
  exportVibeTreePptx(tree: VibeProjectTree, fileName: string): Promise<string>;
  modifyPptistDeck(input: ModifyPptistDeckInput): Promise<ModifyPptistDeckResult>;
  previewArtifact(artifact: Artifact): Promise<void>;
  issuePreviewToken(artifact: Artifact): Promise<PreviewGrant>;
  revokePreviewToken(token: string): Promise<void>;
  prepareXlsxEditor(previewToken: string): Promise<PrepareXlsxEditorResult>;
  saveXlsxEditor(input: SaveXlsxEditorInput): Promise<SaveXlsxEditorResult>;
  closeXlsxEditor(input: CloseXlsxEditorInput): Promise<void>;
  readArtifactFile(previewToken: string): Promise<{ data: BinaryFileData }>;
  readLocalImage(filePath: string): Promise<{ data: BinaryFileData; mime: string }>;
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
  listChats(): Promise<WorkspaceConversationSummary[]>;
  deleteConversation(conversationId: string): Promise<void>;
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
