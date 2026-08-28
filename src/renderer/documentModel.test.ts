import { describe, expect, it } from "vitest";
import type { Artifact, DesktopTask } from "../shared/types";
import type { TaskState } from "./taskState";
import { conversationHasDocument, documentIdForArtifact, findDocumentForTask, getDocumentTasks, projectTaskStateToDocuments } from "./documentModel";

function task(input: Partial<DesktopTask> & Pick<DesktopTask, "id" | "conversationId" | "status">): DesktopTask {
  return {
    events: [],
    ...input,
  };
}

function artifact(taskId: string, filePath: string, documentType = "pptx"): Artifact {
  return {
    taskId,
    filePath,
    fileName: filePath.split("/").pop() || filePath,
    documentType,
  };
}

function state(tasks: DesktopTask[]): TaskState {
  return {
    tasks: Object.fromEntries(tasks.map((item) => [item.id, item])),
    // Renderer task order is newest-first.
    taskOrder: tasks.map((item) => item.id).reverse(),
    artifacts: tasks.flatMap((item) => item.artifact ? [item.artifact] : []),
  };
}

describe("projectTaskStateToDocuments", () => {
  it("turns a one-artifact conversation into one document with its run and activity stream", () => {
    const deck = artifact("run-1", "/workspace/Q3 Review.pptx");
    const source = state([
      task({
        id: "run-1",
        conversationId: "conversation-1",
        status: "completed",
        documentType: "pptx",
        artifact: deck,
        userInput: { prompt: "Create a Q3 review" },
        events: [{ event_id: "event-1", task_id: "run-1", type: "task.completed", ts: "2026-08-27T10:00:00Z", payload: {} }],
      }),
    ]);

    const projection = projectTaskStateToDocuments(source);

    expect(projection.documents).toEqual([
      expect.objectContaining({
        id: documentIdForArtifact(deck.filePath),
        sourceConversationIds: ["conversation-1"],
        title: "Q3 Review.pptx",
        artifact: deck,
        runIds: ["run-1"],
        latestRunId: "run-1",
        activityStreamIds: ["activity:conversation-1"],
      }),
    ]);
    expect(projection.runs).toEqual([
      expect.objectContaining({ id: "run-1", documentId: projection.documents[0].id, activityStreamId: "activity:conversation-1" }),
    ]);
    expect(projection.activityStreams[0]).toMatchObject({
      id: "activity:conversation-1",
      taskIds: ["run-1"],
      activityIds: expect.any(Array),
    });
    expect(projection.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "run-1", kind: "event", event: expect.objectContaining({ event_id: "event-1" }) }),
      expect.objectContaining({ taskId: "run-1", kind: "user_input" }),
    ]));
    expect(projection.archivedConversations).toEqual([]);
    expect(conversationHasDocument(projection, "conversation-1")).toBe(true);
    expect(conversationHasDocument(projection, "missing-conversation")).toBe(false);
  });

  it("splits distinct artifacts into documents that share one activity stream", () => {
    const first = artifact("run-1", "/workspace/launch.pptx");
    const second = artifact("run-2", "/workspace/launch-summary.docx", "docx");
    const projection = projectTaskStateToDocuments(state([
      task({ id: "run-1", conversationId: "conversation-1", status: "completed", artifact: first }),
      task({ id: "run-2", conversationId: "conversation-1", parentTaskId: "run-1", status: "completed", artifact: second }),
    ]));

    expect(projection.documents).toHaveLength(2);
    expect(projection.documents.every((document) => document.activityStreamIds.includes("activity:conversation-1"))).toBe(true);
    expect(projection.activityStreams).toHaveLength(1);
    expect(projection.activityStreams[0].taskIds).toEqual(["run-1", "run-2"]);
    expect(projection.documents.map((document) => document.artifact.filePath)).toEqual([
      "/workspace/launch-summary.docx",
      "/workspace/launch.pptx",
    ]);
  });

  it("keeps repeated writes to the same artifact in one document", () => {
    const original = artifact("run-1", "/workspace/deck.pptx");
    const rewritten = artifact("run-2", "/workspace/deck.pptx");
    const projection = projectTaskStateToDocuments(state([
      task({ id: "run-1", conversationId: "conversation-1", status: "completed", artifact: original }),
      task({ id: "run-2", conversationId: "conversation-1", parentTaskId: "run-1", status: "completed", artifact: rewritten }),
    ]));

    expect(projection.documents).toHaveLength(1);
    expect(projection.documents[0]).toMatchObject({ artifact: rewritten, runIds: ["run-1", "run-2"], latestRunId: "run-2" });
    expect(projection.runs.map((run) => run.documentId)).toEqual([projection.documents[0].id, projection.documents[0].id]);
    expect(findDocumentForTask(projection, "run-2")?.id).toBe(projection.documents[0].id);
    expect(getDocumentTasks(state([
      task({ id: "run-1", conversationId: "conversation-1", status: "completed", artifact: original }),
      task({ id: "run-2", conversationId: "conversation-1", parentTaskId: "run-1", status: "completed", artifact: rewritten }),
    ]), projection.documents[0])).toEqual([
      expect.objectContaining({ id: "run-1" }),
      expect.objectContaining({ id: "run-2" }),
    ]);
  });

  it("merges the same artifact path across legacy conversations", () => {
    const sharedPath = "/workspace/shared-deck.pptx";
    const projection = projectTaskStateToDocuments(state([
      task({ id: "run-1", conversationId: "conversation-1", status: "completed", artifact: artifact("run-1", sharedPath) }),
      task({ id: "run-2", conversationId: "conversation-2", status: "completed", artifact: artifact("run-2", sharedPath) }),
    ]));

    expect(projection.documents).toHaveLength(1);
    expect(projection.documents[0]).toMatchObject({
      id: documentIdForArtifact(sharedPath),
      sourceConversationIds: ["conversation-2", "conversation-1"],
      activityStreamIds: ["activity:conversation-2", "activity:conversation-1"],
      runIds: ["run-1", "run-2"],
      latestRunId: "run-2",
    });
  });

  it("attaches a newer source-only conversation to an existing document", () => {
    const sharedPath = "/workspace/shared-deck.pptx";
    const projection = projectTaskStateToDocuments(state([
      task({ id: "run-original", conversationId: "conversation-original", status: "completed", artifact: artifact("run-original", sharedPath) }),
      task({
        id: "run-rewrite",
        conversationId: "conversation-rewrite",
        status: "running",
        documentType: "pptx",
        userInput: { prompt: "Rewrite for executives", sourceFile: sharedPath },
      }),
    ]));

    expect(projection.documents).toHaveLength(1);
    expect(projection.documents[0]).toMatchObject({
      id: documentIdForArtifact(sharedPath),
      sourceConversationIds: ["conversation-rewrite", "conversation-original"],
      runIds: ["run-original", "run-rewrite"],
      latestRunId: "run-rewrite",
      status: "running",
    });
    expect(projection.pendingDocuments).toEqual([]);
    expect(projection.archivedConversations).toEqual([]);
  });

  it("assigns artifact-less follow-up runs by source file or parent lineage", () => {
    const deck = artifact("run-1", "/workspace/deck.pptx");
    const projection = projectTaskStateToDocuments(state([
      task({ id: "run-1", conversationId: "conversation-1", status: "completed", artifact: deck }),
      task({
        id: "run-2",
        conversationId: "conversation-1",
        parentTaskId: "run-1",
        status: "failed",
        userInput: { prompt: "Make it shorter", sourceFile: "/workspace/deck.pptx" },
      }),
      task({ id: "run-3", conversationId: "conversation-1", parentTaskId: "run-2", status: "cancelled" }),
    ]));

    const documentId = projection.documents[0].id;
    expect(projection.documents[0].runIds).toEqual(["run-1", "run-2", "run-3"]);
    expect(projection.runs.map((run) => [run.id, run.documentId])).toEqual([
      ["run-1", documentId],
      ["run-2", documentId],
      ["run-3", documentId],
    ]);
  });

  it("keeps an ambiguous artifact-less task only in shared activity instead of guessing a document", () => {
    const projection = projectTaskStateToDocuments(state([
      task({ id: "run-1", conversationId: "conversation-1", status: "completed", artifact: artifact("run-1", "/workspace/a.pptx") }),
      task({ id: "run-2", conversationId: "conversation-1", status: "completed", artifact: artifact("run-2", "/workspace/b.docx", "docx") }),
      task({
        id: "run-orphan",
        conversationId: "conversation-1",
        status: "failed",
        userInput: { prompt: "Try something else" },
      }),
    ]));

    expect(projection.runs.map((run) => run.id)).toEqual(["run-1", "run-2"]);
    expect(projection.activityStreams[0].taskIds).toContain("run-orphan");
    expect(projection.activities.some((activity) => activity.taskId === "run-orphan")).toBe(true);
  });

  it("moves conversations without artifacts into the archive projection", () => {
    const projection = projectTaskStateToDocuments(state([
      task({ id: "run-1", conversationId: "conversation-empty", status: "failed", topic: "Research only" }),
      task({ id: "run-2", conversationId: "conversation-empty", parentTaskId: "run-1", status: "cancelled" }),
    ]));

    expect(projection.documents).toEqual([]);
    expect(projection.runs).toEqual([]);
    expect(projection.archivedConversations).toEqual([
      expect.objectContaining({
        id: "archive:conversation-empty",
        sourceConversationId: "conversation-empty",
        title: "Research only",
        taskIds: ["run-1", "run-2"],
        activityStreamId: "activity:conversation-empty",
      }),
    ]);
  });

  it("keeps an active artifact-less run as a pending document instead of archiving it", () => {
    const projection = projectTaskStateToDocuments(state([
      task({
        id: "run-active",
        conversationId: "conversation-active",
        status: "running",
        documentType: "pptx",
        topic: "Weekly standup tips",
      }),
    ]));

    expect(projection.pendingDocuments).toEqual([
      expect.objectContaining({
        id: "pending-document:conversation-active",
        sourceConversationId: "conversation-active",
        latestTaskId: "run-active",
        title: "Weekly standup tips",
        status: "running",
        documentType: "pptx",
      }),
    ]);
    expect(projection.archivedConversations).toEqual([]);
    expect(findDocumentForTask(projection, "run-active")?.id).toBe("pending-document:conversation-active");
    expect(getDocumentTasks(state([
      task({ id: "run-active", conversationId: "conversation-active", status: "running", documentType: "pptx" }),
    ]), projection.pendingDocuments[0]).map((item) => item.id)).toEqual(["run-active"]);
  });

  it("is deterministic and idempotent for the same legacy state", () => {
    const deck = artifact("run-1", "/workspace/deck.pptx");
    const legacy = state([task({ id: "run-1", conversationId: "conversation-1", status: "completed", artifact: deck })]);

    expect(projectTaskStateToDocuments(legacy)).toEqual(projectTaskStateToDocuments(legacy));
    expect(legacy.tasks["run-1"].artifact).toBe(deck);
  });

  it("derives stable activity ids when a legacy event has no event_id", () => {
    const legacy = state([task({
      id: "run-1",
      conversationId: "conversation-1",
      status: "failed",
      events: [{ task_id: "run-1", type: "task.failed", payload: { message: "boom" } }],
    })]);

    const first = projectTaskStateToDocuments(legacy);
    const second = projectTaskStateToDocuments(legacy);
    expect(first.activities[0].id).toBe("run-1:event:0:task.failed");
    expect(first.activities).toEqual(second.activities);
  });
});
