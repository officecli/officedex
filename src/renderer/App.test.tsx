import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DesktopTask } from "../shared/types";
import { findModifySourceTask, hydrateTaskHistory, readStoredAppRoute, sortSidebarDocuments, writeStoredAppRoute } from "./App";
import { createInitialTaskState } from "./taskState";

describe("OfficeDex document routing", () => {
  it("sorts sidebar documents by immutable creation time descending", () => {
    const sorted = sortSidebarDocuments([
      { id: "older", title: "Older", documentType: "pptx", createdAt: "2026-08-01T00:00:00Z" },
      { id: "newer", title: "Newer", documentType: "pptx", createdAt: "2026-08-02T00:00:00Z" },
      { id: "same-b", title: "Same B", documentType: "pptx", createdAt: "2026-08-02T00:00:00Z" },
    ]);
    expect(sorted.map((item) => item.id)).toEqual(["newer", "same-b", "older"]);
  });

  it("persists the active document route across a page reload", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeStoredAppRoute({ nav: "document", taskId: "task-running" }, storage);

    expect(readStoredAppRoute(storage)).toEqual({ nav: "document", taskId: "task-running" });
  });

  it("falls back to home for an invalid persisted route", () => {
    expect(readStoredAppRoute({ getItem: () => JSON.stringify({ nav: "legacy-chat", taskId: "task-1" }) })).toEqual({ nav: "home" });
  });

  it("keeps a persisted running task active when restoring document history", () => {
    const state = hydrateTaskHistory(createInitialTaskState(), [{
      taskId: "task-running",
      createdAt: "2026-08-29T00:00:00Z",
      conversationId: "task-running",
      events: [{
        event_id: "progress-1",
        task_id: "task-running",
        type: "task.progress",
        payload: { status: "running", step: "plan_prepare", document_type: "pptx" },
      }],
    }]);

    expect(state.tasks["task-running"].status).toBe("running");
    expect(state.tasks["task-running"].createdAt).toBe("2026-08-29T00:00:00Z");
    expect(state.taskOrder).toContain("task-running");
  });

  it("has no renderer route or bridge call for legacy chat", () => {
    const source = readFileSync("src/renderer/App.tsx", "utf8");
    expect(source).not.toContain("DialogueScreen");
    expect(source).not.toContain('activeNav === "dialogue"');
    expect(source).not.toContain('setActiveNav("dialogue")');
    expect(source).not.toContain("listChats(");
    expect(source).not.toContain("deleteConversation(");
    expect(source).toContain('activeNav === "document"');
    expect(source).toContain("<DocumentWorkspace");
  });

  it("uses the latest completed artifact as a document edit source", () => {
    const tasks: DesktopTask[] = [
      {
        id: "run-original",
        conversationId: "internal-lineage",
        status: "completed",
        documentType: "docx",
        events: [],
        artifact: { taskId: "run-original", filePath: "/tmp/report.docx", fileName: "report.docx", documentType: "docx" },
      },
      {
        id: "run-active",
        conversationId: "internal-lineage",
        parentTaskId: "run-original",
        status: "running",
        documentType: "docx",
        events: [],
        userInput: { prompt: "Shorten the conclusion", sourceFile: "/tmp/report.docx" },
      },
    ];
    expect(findModifySourceTask(tasks, "docx")?.id).toBe("run-original");
  });
});
