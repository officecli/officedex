import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { DesktopTask, TaskHistoryEntry } from "../shared/types";
import { findModifySourceTask, findRecoverableTaskHistoryEntry, hydrateTaskHistory, readStoredAppRoute, sortSidebarDocuments, writeStoredAppRoute } from "./App";
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

  it("routes XLSX artifacts to the editable spreadsheet workspace", () => {
    const source = readFileSync("src/renderer/App.tsx", "utf8");
    const branchStart = source.indexOf("if (isXlsxArtifact(artifact))");
    const legacyPreviewStart = source.indexOf("if (previewGrant) {\n      await officecli.revokePreviewToken", branchStart);

    expect(branchStart).toBeGreaterThanOrEqual(0);
    expect(legacyPreviewStart).toBeGreaterThan(branchStart);
    const spreadsheetBranch = source.slice(branchStart, legacyPreviewStart);
    expect(spreadsheetBranch).toContain('setSpreadsheetEntry({');
    expect(spreadsheetBranch).toContain('setActiveNav("spreadsheet")');
    expect(spreadsheetBranch).toContain("runSpreadsheetAction");
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

  it("recovers a workbook PPT task when the generate RPC loses its response", () => {
    const entries: TaskHistoryEntry[] = [{
      taskId: "ppt-recovered",
      createdAt: "2026-09-01T12:00:01.000Z",
      conversationId: "ppt-recovered",
      parentTaskId: "workbook-task",
      events: [{
        task_id: "ppt-recovered",
        type: "task.started",
        payload: { document_type: "pptx", source_file: "/tmp/workbook.xlsx" },
      }],
    }];

    expect(findRecoverableTaskHistoryEntry(entries, {
      documentType: "pptx",
      sourceFile: "/tmp/workbook.xlsx",
      parentTaskId: "workbook-task",
      createdAfter: Date.parse("2026-09-01T11:59:00.000Z"),
    })?.taskId).toBe("ppt-recovered");
  });

  it("retries bridge initialization after a stopped bridge emits bridge.exited", () => {
    const source = readFileSync("src/renderer/App.tsx", "utf8");
    const branchStart = source.indexOf('if (event.type === "bridge.exited")');
    const branchEnd = source.indexOf("// Native OfficeCLI Runtime tasks survive", branchStart);

    expect(branchStart).toBeGreaterThanOrEqual(0);
    expect(branchEnd).toBeGreaterThan(branchStart);
    const branch = source.slice(branchStart, branchEnd);
    expect(branch).toContain("bridgeRecoveryPendingRef");
    expect(branch).toContain("setConnectAttempt");
  });

  it("does not recover an unrelated task from the same history page", () => {
    const entries: TaskHistoryEntry[] = [{
      taskId: "other-task",
      createdAt: "2026-09-01T12:00:01.000Z",
      parentTaskId: "other-parent",
      events: [{ task_id: "other-task", type: "task.started", payload: { document_type: "pptx", source_file: "/tmp/other.xlsx" } }],
    }];
    expect(findRecoverableTaskHistoryEntry(entries, {
      documentType: "pptx",
      sourceFile: "/tmp/workbook.xlsx",
      parentTaskId: "workbook-task",
      createdAfter: Date.parse("2026-09-01T11:59:00.000Z"),
    })).toBeUndefined();
  });
});
