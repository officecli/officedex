import type { Artifact, BridgeEvent, DesktopTask, TaskUserInput } from "../shared/types";
import type { TaskState } from "./taskState";

export interface ArtifactDocument {
  id: string;
  sourceConversationIds: string[];
  activityStreamIds: string[];
  workspaceId?: string;
  workspacePath?: string;
  title: string;
  documentType: string;
  artifact: Artifact;
  runIds: string[];
  latestRunId: string;
  status: DesktopTask["status"];
  updatedAt?: string;
}

export interface DocumentRun {
  id: string;
  documentId: string;
  activityStreamId: string;
  sourceConversationId: string;
  parentRunId?: string;
  status: DesktopTask["status"];
  documentType?: string;
  artifact?: Artifact;
  sourceFile?: string;
}

interface ActivityBase {
  id: string;
  activityStreamId: string;
  sourceConversationId: string;
  taskId: string;
  ordinal: number;
}

export type DocumentActivity =
  | (ActivityBase & { kind: "event"; event: BridgeEvent })
  | (ActivityBase & { kind: "user_input"; input: TaskUserInput });

export interface DocumentActivityStream {
  id: string;
  sourceConversationId: string;
  taskIds: string[];
  activityIds: string[];
}

export interface ArchivedConversation {
  id: string;
  sourceConversationId: string;
  activityStreamId: string;
  workspaceId?: string;
  workspacePath?: string;
  title: string;
  taskIds: string[];
  status: DesktopTask["status"];
  updatedAt?: string;
}

export interface PendingDocument {
  id: string;
  sourceConversationId: string;
  activityStreamId: string;
  workspaceId?: string;
  workspacePath?: string;
  title: string;
  taskIds: string[];
  latestTaskId: string;
  status: "starting" | "running" | "question" | "plan_review";
  documentType?: string;
  updatedAt?: string;
}

export interface DocumentProjection {
  schemaVersion: 1;
  documents: ArtifactDocument[];
  runs: DocumentRun[];
  activities: DocumentActivity[];
  activityStreams: DocumentActivityStream[];
  pendingDocuments: PendingDocument[];
  archivedConversations: ArchivedConversation[];
}

interface DocumentBuilder {
  id: string;
  path: string;
  artifact: Artifact;
  artifactTaskId: string;
  sourceConversationIds: string[];
  activityStreamIds: string[];
  runIds: Set<string>;
  latestArtifactRank: number;
  latestRunRank: number;
}

function normalizedPath(value: string | undefined): string {
  return value?.trim() ?? "";
}

function activityStreamId(conversationId: string): string {
  return `activity:${conversationId}`;
}

export function documentIdForArtifact(filePath: string): string {
  return `document:${encodeURIComponent(normalizedPath(filePath))}`;
}

function conversationTitle(tasks: DesktopTask[]): string {
  const first = tasks[0];
  return first?.userInput?.prompt.trim() || first?.topic?.trim() || first?.artifact?.fileName || first?.id || "Untitled conversation";
}

function latestTimestamp(tasks: DesktopTask[], artifact?: Artifact): string | undefined {
  let latest = artifact?.syncedAt;
  for (const task of tasks) {
    for (const event of task.events) {
      if (event.ts && (!latest || event.ts > latest)) latest = event.ts;
    }
  }
  return latest;
}

function artifactByTask(state: TaskState): Map<string, Artifact> {
  const result = new Map<string, Artifact>();
  for (const artifact of state.artifacts) {
    if (artifact.taskId) result.set(artifact.taskId, artifact);
  }
  for (const task of Object.values(state.tasks)) {
    if (task.artifact) result.set(task.id, task.artifact);
  }
  return result;
}

function appendUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.push(value);
}

function prependUnique(items: string[], value: string): void {
  if (!items.includes(value)) items.unshift(value);
}

function activitiesForConversation(tasks: DesktopTask[], conversationId: string): { activities: DocumentActivity[]; stream: DocumentActivityStream } {
  const streamId = activityStreamId(conversationId);
  const activities: DocumentActivity[] = [];
  const ids = new Set<string>();
  let ordinal = 0;

  for (const task of tasks) {
    const hasPersistedUserInput = task.events.some((event) => event.type === "task.user_input");
    if (task.userInput && !hasPersistedUserInput) {
      const id = `${task.id}:user-input`;
      ids.add(id);
      activities.push({
        id,
        activityStreamId: streamId,
        sourceConversationId: conversationId,
        taskId: task.id,
        ordinal: ordinal++,
        kind: "user_input",
        input: task.userInput,
      });
    }
    task.events.forEach((event, eventIndex) => {
      const suffix = event.event_id || `event:${eventIndex}:${event.type}`;
      const id = `${task.id}:${suffix}`;
      if (ids.has(id)) return;
      ids.add(id);
      activities.push({
        id,
        activityStreamId: streamId,
        sourceConversationId: conversationId,
        taskId: task.id,
        ordinal: ordinal++,
        kind: "event",
        event,
      });
    });
  }

  return {
    activities,
    stream: {
      id: streamId,
      sourceConversationId: conversationId,
      taskIds: tasks.map((task) => task.id),
      activityIds: activities.map((activity) => activity.id),
    },
  };
}

/**
 * Pure compatibility projection from the persisted Conversation/Task truth
 * into Document/Run/Activity. Old tables remain the source during rollout;
 * stable path-derived IDs make repeated migration idempotent.
 */
export function projectTaskStateToDocuments(state: TaskState): DocumentProjection {
  const runs: DocumentRun[] = [];
  const activities: DocumentActivity[] = [];
  const activityStreams: DocumentActivityStream[] = [];
  const pendingDocuments: PendingDocument[] = [];
  const archivedConversations: ArchivedConversation[] = [];
  const documentBuilders = new Map<string, DocumentBuilder>();
  const taskRank = new Map(state.taskOrder.map((taskId, index) => [taskId, index]));
  const artifacts = artifactByTask(state);
  const seenConversations = new Set<string>();
  const conversationIds: string[] = [];

  for (const taskId of state.taskOrder) {
    const conversationId = state.tasks[taskId]?.conversationId;
    if (!conversationId || seenConversations.has(conversationId)) continue;
    seenConversations.add(conversationId);
    conversationIds.push(conversationId);
  }

  // Seed every artifact before classifying conversations. A newer conversation
  // may contain only a sourceFile rewrite of a document produced by an older
  // conversation, which still has to resolve even though it is processed first.
  for (const taskId of state.taskOrder) {
    const task = state.tasks[taskId];
    const artifact = artifacts.get(taskId);
    const path = normalizedPath(artifact?.filePath);
    if (!task || !artifact || !path) continue;
    const documentId = documentIdForArtifact(path);
    const rank = taskRank.get(taskId) ?? Number.MAX_SAFE_INTEGER;
    const streamId = activityStreamId(task.conversationId);
    const existing = documentBuilders.get(documentId);
    if (existing) {
      appendUnique(existing.sourceConversationIds, task.conversationId);
      appendUnique(existing.activityStreamIds, streamId);
      if (rank < existing.latestArtifactRank) {
        existing.artifact = artifact;
        existing.artifactTaskId = taskId;
        existing.latestArtifactRank = rank;
      }
      existing.latestRunRank = Math.min(existing.latestRunRank, rank);
    } else {
      documentBuilders.set(documentId, {
        id: documentId,
        path,
        artifact,
        artifactTaskId: taskId,
        sourceConversationIds: [task.conversationId],
        activityStreamIds: [streamId],
        runIds: new Set(),
        latestArtifactRank: rank,
        latestRunRank: rank,
      });
    }
  }

  for (const conversationId of conversationIds) {
    const conversationTasks = state.taskOrder
      .map((taskId) => state.tasks[taskId])
      .filter((task): task is DesktopTask => Boolean(task) && task.conversationId === conversationId)
      .reverse();
    if (conversationTasks.length === 0) continue;

    const { activities: conversationActivities, stream } = activitiesForConversation(conversationTasks, conversationId);
    activities.push(...conversationActivities);
    activityStreams.push(stream);

    const documentIdsByPath = new Map<string, string>();
    const taskDocumentIds = new Map<string, string>();
    for (const task of conversationTasks) {
      const artifact = artifacts.get(task.id);
      const path = normalizedPath(artifact?.filePath);
      if (!artifact || !path) continue;
      const documentId = documentIdForArtifact(path);
      const rank = taskRank.get(task.id) ?? Number.MAX_SAFE_INTEGER;
      const existing = documentBuilders.get(documentId)!;
      appendUnique(existing.sourceConversationIds, conversationId);
      appendUnique(existing.activityStreamIds, stream.id);
      if (rank < existing.latestArtifactRank) {
        existing.artifact = artifact;
        existing.artifactTaskId = task.id;
        existing.latestArtifactRank = rank;
      }
      documentIdsByPath.set(path, documentId);
      taskDocumentIds.set(task.id, documentId);
    }

    const associatedDocumentIds = new Set(documentIdsByPath.values());
    // Explicit source file and parent lineage may associate a conversation
    // that has no artifact of its own with an existing global document.
    for (const task of conversationTasks) {
      if (taskDocumentIds.has(task.id)) continue;
      const sourcePath = normalizedPath(task.userInput?.sourceFile);
      const sourceDocumentId = sourcePath ? documentIdForArtifact(sourcePath) : undefined;
      const sourceDocument = sourceDocumentId && documentBuilders.has(sourceDocumentId) ? sourceDocumentId : undefined;
      const parentDocument = task.parentTaskId ? taskDocumentIds.get(task.parentTaskId) : undefined;
      const documentId = sourceDocument || parentDocument;
      if (!documentId) continue;
      taskDocumentIds.set(task.id, documentId);
      associatedDocumentIds.add(documentId);
    }
    if (associatedDocumentIds.size === 1) {
      const onlyDocument = [...associatedDocumentIds][0];
      for (const task of conversationTasks) {
        if (!taskDocumentIds.has(task.id)) taskDocumentIds.set(task.id, onlyDocument);
      }
    }

    if (associatedDocumentIds.size === 0) {
      const latestTask = conversationTasks.at(-1)!;
      if (latestTask.status === "starting" || latestTask.status === "running" || latestTask.status === "question" || latestTask.status === "plan_review") {
        pendingDocuments.push({
          id: `pending-document:${conversationId}`,
          sourceConversationId: conversationId,
          activityStreamId: stream.id,
          workspaceId: latestTask.workspaceId,
          workspacePath: latestTask.workspacePath,
          title: conversationTitle(conversationTasks),
          taskIds: conversationTasks.map((task) => task.id),
          latestTaskId: latestTask.id,
          status: latestTask.status,
          documentType: latestTask.documentType,
          updatedAt: latestTimestamp(conversationTasks),
        });
        continue;
      }
      archivedConversations.push({
        id: `archive:${conversationId}`,
        sourceConversationId: conversationId,
        activityStreamId: stream.id,
        workspaceId: latestTask.workspaceId,
        workspacePath: latestTask.workspacePath,
        title: conversationTitle(conversationTasks),
        taskIds: conversationTasks.map((task) => task.id),
        status: latestTask.status,
        updatedAt: latestTimestamp(conversationTasks),
      });
      continue;
    }

    for (const task of conversationTasks) {
      const documentId = taskDocumentIds.get(task.id);
      if (!documentId) continue;
      const builder = documentBuilders.get(documentId);
      if (!builder) continue;
      const rank = taskRank.get(task.id) ?? Number.MAX_SAFE_INTEGER;
      if (rank < builder.latestRunRank) {
        prependUnique(builder.sourceConversationIds, conversationId);
        prependUnique(builder.activityStreamIds, stream.id);
      } else {
        appendUnique(builder.sourceConversationIds, conversationId);
        appendUnique(builder.activityStreamIds, stream.id);
      }
      builder.latestRunRank = Math.min(builder.latestRunRank, rank);
      builder.runIds.add(task.id);
      runs.push({
        id: task.id,
        documentId,
        activityStreamId: stream.id,
        sourceConversationId: conversationId,
        parentRunId: task.parentTaskId,
        status: task.status,
        documentType: task.documentType || task.artifact?.documentType,
        artifact: artifacts.get(task.id),
        sourceFile: task.userInput?.sourceFile,
      });
    }
  }

  const documents = [...documentBuilders.values()]
    .filter((builder) => builder.runIds.size > 0)
    .sort((left, right) => left.latestRunRank - right.latestRunRank)
    .map((builder): ArtifactDocument => {
      const runIds = [...builder.runIds].sort((left, right) => (taskRank.get(right) ?? 0) - (taskRank.get(left) ?? 0));
      const latestRunId = runIds.at(-1) ?? builder.artifactTaskId;
      const latestRun = state.tasks[latestRunId] ?? state.tasks[builder.artifactTaskId];
      const documentTasks = runIds.map((taskId) => state.tasks[taskId]).filter(Boolean);
      return {
        id: builder.id,
        sourceConversationIds: builder.sourceConversationIds,
        activityStreamIds: builder.activityStreamIds,
        workspaceId: latestRun?.workspaceId,
        workspacePath: latestRun?.workspacePath,
        title: builder.artifact.fileName,
        documentType: builder.artifact.documentType,
        artifact: builder.artifact,
        runIds,
        latestRunId,
        status: latestRun?.status ?? "completed",
        updatedAt: latestTimestamp(documentTasks, builder.artifact),
      };
    });

  return { schemaVersion: 1, documents, runs, activities, activityStreams, pendingDocuments, archivedConversations };
}

export function findDocumentForTask(projection: DocumentProjection, taskId: string | undefined): ArtifactDocument | PendingDocument | undefined {
  if (!taskId) return undefined;
  const run = projection.runs.find((candidate) => candidate.id === taskId);
  if (run) return projection.documents.find((document) => document.id === run.documentId);
  return projection.pendingDocuments.find((document) => document.taskIds.includes(taskId));
}

export function getDocumentTasks(state: TaskState, document: ArtifactDocument | PendingDocument | undefined): DesktopTask[] {
  if (!document) return [];
  const taskIds = "runIds" in document ? document.runIds : document.taskIds;
  return taskIds.map((taskId) => state.tasks[taskId]).filter((task): task is DesktopTask => Boolean(task));
}

export function conversationHasDocument(projection: DocumentProjection, conversationId: string): boolean {
  return projection.documents.some((document) => document.sourceConversationIds.includes(conversationId))
    || projection.pendingDocuments.some((document) => document.sourceConversationId === conversationId);
}
