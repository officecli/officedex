import { describe, expect, it } from "vitest";
import type {
  WorkspaceConversationSummary,
  WorkspaceSummary,
} from "../shared/types";
import type { DocumentRecord, RunRecord } from "../shared/documentProtocol";
import type { DocumentProjection } from "./documentModel";
import { buildDocumentSidebar } from "./documentSidebarModel";

const projection: DocumentProjection = {
  schemaVersion: 1,
  documents: [
    {
      id: "document:%2Fworkspace%2Fdeck.pptx",
      sourceConversationIds: ["conversation-doc"],
      activityStreamIds: ["activity:conversation-doc"],
      workspaceId: "ws-1",
      title: "deck.pptx",
      documentType: "pptx",
      artifact: { taskId: "run-doc", filePath: "/workspace/deck.pptx", fileName: "deck.pptx", documentType: "pptx" },
      runIds: ["run-doc"],
      latestRunId: "run-doc",
      status: "completed",
    },
    {
      id: "document:%2Ftmp%2Fnotes.docx",
      sourceConversationIds: ["conversation-notes"],
      activityStreamIds: ["activity:conversation-notes"],
      title: "notes.docx",
      documentType: "docx",
      artifact: { taskId: "run-notes", filePath: "/tmp/notes.docx", fileName: "notes.docx", documentType: "docx" },
      runIds: ["run-notes"],
      latestRunId: "run-notes",
      status: "running",
    },
  ],
  runs: [],
  activities: [],
  activityStreams: [],
  pendingDocuments: [],
  archivedConversations: [
    {
      id: "archive:conversation-archive",
      sourceConversationId: "conversation-archive",
      activityStreamId: "activity:conversation-archive",
      title: "Research only",
      taskIds: ["run-archive"],
      status: "failed",
    },
  ],
};

function conversation(conversationId: string, latestTaskId: string, title: string): WorkspaceConversationSummary {
  return { conversationId, firstTaskId: latestTaskId, latestTaskId, title, status: "completed", documentType: "pptx" };
}

const workspaces: WorkspaceSummary[] = [{
  id: "ws-1",
  path: "/workspace",
  name: "Workspace",
  active: true,
  conversations: [
    conversation("conversation-doc", "run-doc", "Already projected"),
    conversation("conversation-legacy-workspace", "run-legacy-workspace", "Legacy workspace item"),
  ],
}];

describe("buildDocumentSidebar", () => {
  it("exposes projected documents as the primary sidebar items", () => {
    const sidebar = buildDocumentSidebar(projection, workspaces, []);

    expect(sidebar.documents).toEqual([
      expect.objectContaining({ documentId: projection.documents[0].id, latestTaskId: "run-doc", workspaceId: "ws-1" }),
      expect.objectContaining({ documentId: projection.documents[1].id, latestTaskId: "run-notes", workspaceId: undefined }),
    ]);
  });

  it("keeps confirmed archives separate from conversations that have not been hydrated yet", () => {
    const sidebar = buildDocumentSidebar(projection, workspaces, [
      conversation("conversation-archive", "run-archive", "Archive duplicate"),
      conversation("conversation-legacy-chat", "run-legacy-chat", "Legacy chat item"),
    ]);

    expect(sidebar.archivedConversations).toEqual([
      expect.objectContaining({ archiveId: "archive:conversation-archive", conversationId: "conversation-archive", latestTaskId: "run-archive" }),
    ]);
    expect(sidebar.legacyConversations.map((item) => item.conversationId)).toEqual([
      "conversation-legacy-workspace",
      "conversation-legacy-chat",
    ]);
  });

  it("does not repeat a projected or archived conversation as legacy", () => {
    const sidebar = buildDocumentSidebar(projection, workspaces, [
      conversation("conversation-doc", "run-doc", "Projected duplicate"),
      conversation("conversation-archive", "run-archive", "Archive duplicate"),
    ]);

    expect(sidebar.legacyConversations).toEqual([
      expect.objectContaining({ conversationId: "conversation-legacy-workspace" }),
    ]);
  });

  it("uses persisted documents as primary records and keeps projected-only documents as fallback", () => {
    const persisted: DocumentRecord = {
      id: projection.documents[0].id,
      filePath: "/workspace/deck.pptx",
      fileName: "renamed-deck.pptx",
      documentType: "pptx",
      currentArtifactTaskId: "run-doc",
      workspaceId: "ws-1",
      createdAt: "2026-08-20T01:00:00Z",
      updatedAt: "2026-08-27T01:00:00Z",
      migrationSource: "legacy",
    };
    const runs: RunRecord[] = [{
      id: "run-doc-newer",
      documentId: persisted.id,
      activityStreamId: "activity:conversation-newer",
      sourceConversationId: "conversation-newer",
      status: "running",
      createdAt: "2026-08-27T00:00:00Z",
      updatedAt: "2026-08-27T01:00:00Z",
    }];

    const sidebar = buildDocumentSidebar(projection, workspaces, [
      conversation("conversation-newer", "run-doc-newer", "Run duplicate"),
    ], [{ document: persisted, runs }]);

    expect(sidebar.documents).toEqual([
      expect.objectContaining({
        documentId: persisted.id,
        title: "renamed-deck.pptx",
        latestTaskId: "run-doc-newer",
        status: "running",
        runIds: ["run-doc-newer", "run-doc"],
      }),
      expect.objectContaining({ documentId: projection.documents[1].id }),
    ]);
    expect(
      sidebar.legacyConversations.some(
        (conversation) => conversation.conversationId === "conversation-newer",
      ),
    ).toBe(false);
  });

  it("falls back to the artifact task and a safe status when persisted runs are absent", () => {
    const document: DocumentRecord = {
      id: "document:%2Ftmp%2Fapi-only.docx",
      filePath: "/tmp/api-only.docx",
      fileName: "api-only.docx",
      documentType: "docx",
      currentArtifactTaskId: "task-api-only",
      createdAt: "2026-08-27T01:00:00Z",
      updatedAt: "2026-08-27T01:00:00Z",
      migrationSource: "legacy",
    };

    const sidebar = buildDocumentSidebar(projection, workspaces, [], [{ document, runs: [] }]);

    expect(sidebar.documents).toContainEqual(expect.objectContaining({
      documentId: document.id,
      latestTaskId: "task-api-only",
      status: "completed",
      artifact: expect.objectContaining({ filePath: document.filePath }),
    }));
  });
});
