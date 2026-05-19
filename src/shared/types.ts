export type DocumentType = "pptx" | "docx" | "xlsx" | "report" | "img";

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
  outputDir?: string;
  publish?: boolean;
  enableImages?: boolean;
  imageQuality?: "standard" | "premium";
}

export interface TaskQuestion {
  id: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  allowFreeform: boolean;
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
}

export interface DesktopAPI {
  initialize(): Promise<unknown>;
  getCapabilities(): Promise<unknown>;
  generate(input: GenerateInput): Promise<{ taskId: string; sessionId: string; status: string }>;
  respond(input: { taskId: string; questionId?: string; optionId?: string; answer?: string }): Promise<unknown>;
  cancel(taskId: string): Promise<unknown>;
  openPath(filePath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  onBridgeEvent(callback: (event: BridgeEvent) => void): () => void;
}
