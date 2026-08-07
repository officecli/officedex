import { describe, expect, it } from "vitest";
import type { Artifact, PreviewGrant } from "../../shared/types";
import { createSpreadsheetSession, spreadsheetSessionReducer } from "./sessionState";

const artifact: Artifact = {
  taskId: "task-xlsx",
  filePath: "/tmp/forecast.xlsx",
  fileName: "forecast.xlsx",
  documentType: "xlsx",
};

const grant: PreviewGrant = {
  token: "preview-xlsx",
  fileName: "forecast.xlsx",
  documentType: "xlsx",
};

describe("spreadsheet session state", () => {
  it("creates an empty XLSX session for the selected workspace", () => {
    expect(createSpreadsheetSession({ kind: "new", workspaceId: "ws-1" })).toEqual({
      phase: "empty",
      workspaceId: "ws-1",
      dirty: false,
    });
  });

  it("loads only the artifact for the active spreadsheet task", () => {
    const generating = spreadsheetSessionReducer(
      createSpreadsheetSession({ kind: "new" }),
      { type: "generation.started", taskId: "task-xlsx", conversationId: "conversation-1" },
    );

    const stale = spreadsheetSessionReducer(generating, {
      type: "artifact.ready",
      taskId: "other-task",
      artifact: { ...artifact, taskId: "other-task" },
      grant,
    });
    expect(stale).toBe(generating);

    expect(spreadsheetSessionReducer(generating, {
      type: "artifact.ready",
      taskId: "task-xlsx",
      artifact,
      grant,
    })).toMatchObject({
      phase: "loading",
      artifact,
      grant,
      taskId: "task-xlsx",
      conversationId: "conversation-1",
    });
  });

  it("tracks editor dirty, saving, saved, and failed states", () => {
    const loading = createSpreadsheetSession({ kind: "artifact", artifact });
    const ready = spreadsheetSessionReducer(loading, { type: "editor.ready" });
    const dirty = spreadsheetSessionReducer(ready, { type: "editor.dirty", dirty: true });
    const saving = spreadsheetSessionReducer(dirty, { type: "save.started" });
    const failed = spreadsheetSessionReducer(saving, { type: "save.failed", error: "disk full" });
    const saved = spreadsheetSessionReducer(failed, { type: "save.succeeded", changedDuringSave: false });

    expect(ready).toMatchObject({ phase: "ready", dirty: false });
    expect(dirty).toMatchObject({ phase: "dirty", dirty: true });
    expect(saving).toMatchObject({ phase: "saving", dirty: true });
    expect(failed).toMatchObject({ phase: "dirty", dirty: true, error: undefined, saveError: "disk full" });
    expect(saved).toMatchObject({ phase: "ready", dirty: false, error: undefined });
  });

  it("keeps editor failures separate from save failures", () => {
    const loading = createSpreadsheetSession({ kind: "artifact", artifact });
    const failed = spreadsheetSessionReducer(loading, { type: "editor.failed", error: "editor unavailable" });

    expect(failed).toMatchObject({ phase: "error", error: "editor unavailable", saveError: undefined });
  });

  it("rejects non-XLSX artifacts", () => {
    expect(() => createSpreadsheetSession({
      kind: "artifact",
      artifact: { ...artifact, fileName: "notes.docx", documentType: "docx" },
    })).toThrow("Spreadsheet workspace requires an XLSX artifact");
  });
});
