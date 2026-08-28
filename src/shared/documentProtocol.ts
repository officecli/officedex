import type { TaskHistoryEntry } from "./types";

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

export interface DocumentListInput {
  workspaceId?: string;
  limit?: number;
  cursor?: string;
}

export interface DocumentPage {
  items: DocumentRecord[];
  nextCursor?: string;
}

export interface DocumentActivityListInput {
  limit?: number;
  cursor?: string;
}

export interface ActivityPage {
  items: ActivityRecord[];
  nextCursor?: string;
}

export interface DocumentAPI {
  listDocuments(input?: DocumentListInput): Promise<DocumentPage>;
  getDocument(documentId: string): Promise<DocumentRecord | null>;
  listDocumentRuns(documentId: string): Promise<RunRecord[]>;
  listDocumentActivity(
    documentId: string,
    input?: DocumentActivityListInput,
  ): Promise<ActivityPage>;
  getTaskHistoryForTask(taskId: string): Promise<TaskHistoryEntry | null>;
}
