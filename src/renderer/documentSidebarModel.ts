import type {
  Artifact,
  DesktopTask,
  WorkspaceConversationSummary,
  WorkspaceSummary,
} from "../shared/types";
import type { DocumentRecord, RunRecord } from "../shared/documentProtocol";
import type { DocumentProjection } from "./documentModel";

export interface DocumentSidebarItem {
  documentId: string;
  latestTaskId: string;
  title: string;
  status: DesktopTask["status"];
  documentType: string;
  workspaceId?: string;
  sourceConversationIds: string[];
  runIds?: string[];
  artifact?: Artifact;
  pending?: boolean;
}

export interface PersistedDocumentSidebarSource {
  document: DocumentRecord;
  runs: RunRecord[];
}

export interface ArchivedConversationSidebarItem {
  archiveId: string;
  conversationId: string;
  latestTaskId: string;
  title: string;
  status: DesktopTask["status"];
  workspaceId?: string;
}

export interface LegacyConversationSidebarItem extends WorkspaceConversationSummary {
  workspaceId?: string;
}

export interface DocumentSidebarProjection {
  documents: DocumentSidebarItem[];
  archivedConversations: ArchivedConversationSidebarItem[];
  legacyConversations: LegacyConversationSidebarItem[];
}

/**
 * Adapts the in-memory document migration to the current sidebar without
 * pretending unhydrated summaries are confirmed archives. Once a legacy row
 * is selected, normal history replay upgrades it into either a Document or an
 * ArchivedConversation on the next renderer projection.
 */
export function buildDocumentSidebar(
  projection: DocumentProjection,
  workspaces: WorkspaceSummary[],
  chats: WorkspaceConversationSummary[],
  persistedSources: PersistedDocumentSidebarSource[] = [],
): DocumentSidebarProjection {
  const pendingDocuments: DocumentSidebarItem[] = projection.pendingDocuments.map((document) => ({
    documentId: document.id,
    latestTaskId: document.latestTaskId,
    title: document.title,
    status: document.status,
    documentType: document.documentType ?? "",
    workspaceId: document.workspaceId,
    sourceConversationIds: [document.sourceConversationId],
    runIds: document.taskIds,
    pending: true,
  }));
  const projectedDocuments: DocumentSidebarItem[] = projection.documents.map((document) => ({
    documentId: document.id,
    latestTaskId: document.latestRunId,
    title: document.title,
    status: document.status,
    documentType: document.documentType,
    workspaceId: document.workspaceId,
    sourceConversationIds: document.sourceConversationIds,
    runIds: document.runIds,
    artifact: document.artifact,
  }));
  const projectedByID = new Map(projectedDocuments.map((document) => [document.documentId, document]));
  const persistedDocuments = persistedSources.flatMap(({ document, runs }): DocumentSidebarItem[] => {
    const projected = projectedByID.get(document.id);
    const latestRun = runs.at(-1);
    const latestTaskId = latestRun?.id || document.currentArtifactTaskId || projected?.latestTaskId;
    if (!latestTaskId) return [];
    const status = normaliseRunStatus(latestRun?.status || projected?.status);
    const sourceConversationIds = [...new Set([
      ...runs.map((run) => run.sourceConversationId).filter(Boolean),
      ...(projected?.sourceConversationIds ?? []),
    ])];
    projectedByID.delete(document.id);
    const runIds = runs.map((run) => run.id);
    if (document.currentArtifactTaskId && !runIds.includes(document.currentArtifactTaskId)) {
      runIds.push(document.currentArtifactTaskId);
    }
    return [{
      documentId: document.id,
      latestTaskId,
      title: document.fileName,
      status,
      documentType: document.documentType,
      workspaceId: document.workspaceId || projected?.workspaceId,
      sourceConversationIds,
      runIds,
      artifact: projected?.artifact ?? {
        taskId: document.currentArtifactTaskId || latestTaskId,
        filePath: document.filePath,
        fileName: document.fileName,
        documentType: document.documentType,
      },
    }];
  });
  const documents = [
    ...pendingDocuments,
    ...persistedDocuments,
    ...projectedDocuments.filter((document) => projectedByID.has(document.documentId)),
  ];

  const archivedConversations: ArchivedConversationSidebarItem[] = projection.archivedConversations.map((conversation) => ({
    archiveId: conversation.id,
    conversationId: conversation.sourceConversationId,
    latestTaskId: conversation.taskIds.at(-1) ?? conversation.sourceConversationId,
    title: conversation.title,
    status: conversation.status,
    workspaceId: conversation.workspaceId,
  }));

  const represented = new Set<string>();
  for (const document of projection.documents) {
    for (const conversationId of document.sourceConversationIds) represented.add(conversationId);
  }
  for (const document of persistedDocuments) {
    for (const conversationId of document.sourceConversationIds) represented.add(conversationId);
  }
  for (const document of projection.pendingDocuments) represented.add(document.sourceConversationId);
  for (const conversation of projection.archivedConversations) represented.add(conversation.sourceConversationId);

  const legacyConversations: LegacyConversationSidebarItem[] = [];
  const seenLegacy = new Set<string>();
  const appendLegacy = (conversation: WorkspaceConversationSummary, workspaceId?: string) => {
    if (represented.has(conversation.conversationId) || seenLegacy.has(conversation.conversationId)) return;
    seenLegacy.add(conversation.conversationId);
    legacyConversations.push({ ...conversation, workspaceId });
  };
  for (const workspace of workspaces) {
    for (const conversation of workspace.conversations) appendLegacy(conversation, workspace.id);
  }
  for (const conversation of chats) appendLegacy(conversation);

  return { documents, archivedConversations, legacyConversations };
}

function normaliseRunStatus(value: string | undefined): DesktopTask["status"] {
  switch (value) {
    case "starting":
    case "running":
    case "question":
    case "plan_review":
    case "completed":
    case "failed":
    case "cancelled":
      return value;
    default:
      return "completed";
  }
}
