/**
 * Drift risk: this file must stay in sync with:
 *   - internal/types/types.go (Go-side definitions)
 *   - src/renderer/generated/wailsjs/go/models.ts (Wails auto-generated)
 * Adding/removing fields requires updating all three.
 */
export type DocumentType = "pptx" | "docx" | "xlsx" | "report" | "img";

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
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
        bridgeArgKey: "reference_images",
        label: "Reference images",
        description: "Optional style references blended into the generated image.",
      },
    ],
  },
};

export const DOCUMENT_TYPES: DocumentType[] = ["pptx", "docx", "xlsx", "report", "img"];

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
  topic: string;
  prompt: string;
  mode?: "fast" | "best";
  runtimeMode?: "external" | "hosted";
  sourceFile?: string;
  referenceImages?: string[];
  outputDir?: string;
  publish?: boolean;
  enableImages?: boolean;
  imageQuality?: "standard" | "premium";
  localPreview?: boolean;
}

export interface TaskQuestion {
  id: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  allowFreeform: boolean;
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
  sourceFile?: string;
  referenceImages?: string[];
}

export interface DesktopTask {
  id: string;
  status: "starting" | "running" | "question" | "completed" | "failed" | "cancelled";
  documentType?: string;
  topic?: string;
  events: BridgeEvent[];
  question?: TaskQuestion;
  artifact?: Artifact;
  error?: string;
  stages?: StageState[];
  activeStageId?: string;
  userInput?: TaskUserInput;
  creditCharged?: number | null;
  creditMode?: string;
  lastProgressAt?: number;
  stalledSince?: number;
}

export interface PreviewGrant {
  token: string;
  fileName: string;
  documentType: string;
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
  mode: "fast" | "best";
  runtimeMode: "external" | "hosted";
  enableImages: boolean;
  imageQuality: "standard" | "premium";
}

export type LlmProviderType = "openai" | "anthropic" | "azure" | "custom";

export interface LlmProvider {
  type: LlmProviderType;
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface UserSettings {
  version: number;
  defaults: GenerateDefaults;
  outputDir: string | null;
  bridgeBinaryPath: string | null;
  llmProvider: LlmProvider | null;
  onboardingCompletedAt: string | null;
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

export interface ReportCapabilityResult {
  enabled: boolean;
  reason?: string;
}

export type BinaryFileData = ArrayBuffer | Uint8Array;

export interface DesktopAPI {
  initialize(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  generate(input: GenerateInput): Promise<{ taskId: string; sessionId: string; status: string }>;
  respond(input: { taskId: string; questionId?: string; optionId?: string; answer?: string }): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>;
  openPath(filePath: string): Promise<void>;
  showItemInFolder(filePath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openFileDialog(options?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<string | null>;
  openMultiFileDialog(options?: { filters?: Array<{ name: string; extensions: string[] }> }): Promise<string[] | null>;
  savePastedImage(data: Uint8Array, ext: string): Promise<string>;
  previewArtifact(artifact: Artifact): Promise<void>;
  issuePreviewToken(artifact: Artifact): Promise<PreviewGrant>;
  revokePreviewToken(token: string): Promise<void>;
  readArtifactFile(previewToken: string): Promise<{ data: BinaryFileData }>;
  readLocalImage(filePath: string): Promise<{ data: BinaryFileData; mime: string }>;
  renderPreviewHtml(previewToken: string): Promise<{ html: string } | null>;
  setPreviewMode(active: boolean): Promise<void>;
  login(): Promise<{ url: string }>;
  cancelLogin(): Promise<void>;
  whoami(): Promise<WhoAmIResult>;
  logout(): Promise<void>;
  getCreditStatus(): Promise<CreditStatus>;
  redeem(code: string): Promise<RedeemResult>;
  getSettings(): Promise<UserSettings>;
  updateSettings(patch: Partial<UserSettings>): Promise<UserSettings>;
  getDefaultWorkspaceDir(): Promise<string>;
  onAuthEvent(callback: (event: AuthEvent) => void): () => void;
  onBridgeEvent(callback: (event: BridgeEvent) => void): () => void;
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
}
