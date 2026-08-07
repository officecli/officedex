import type { Artifact } from "../../shared/types";
import type { SpreadsheetEntry, SpreadsheetSessionAction, SpreadsheetSessionState } from "./types";

function requireXlsxArtifact(artifact: Artifact): void {
  const documentType = artifact.documentType.trim().toLowerCase();
  const extension = artifact.fileName.split(".").pop()?.toLowerCase();
  if (documentType !== "xlsx" && extension !== "xlsx") {
    throw new Error("Spreadsheet workspace requires an XLSX artifact");
  }
}

export function createSpreadsheetSession(entry: SpreadsheetEntry): SpreadsheetSessionState {
  if (entry.kind === "new") {
    return {
      phase: "empty",
      ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
      dirty: false,
    };
  }

  requireXlsxArtifact(entry.artifact);
  return {
    phase: "loading",
    ...(entry.workspaceId ? { workspaceId: entry.workspaceId } : {}),
    ...(entry.conversationId ? { conversationId: entry.conversationId } : {}),
    ...(entry.artifact.taskId ? { taskId: entry.artifact.taskId } : {}),
    artifact: entry.artifact,
    ...(entry.grant ? { grant: entry.grant } : {}),
    dirty: false,
  };
}

export function spreadsheetSessionReducer(
  state: SpreadsheetSessionState,
  action: SpreadsheetSessionAction,
): SpreadsheetSessionState {
  switch (action.type) {
    case "generation.started":
      return {
        ...state,
        phase: "generating",
        taskId: action.taskId,
        ...(action.conversationId ? { conversationId: action.conversationId } : {}),
        error: undefined,
      };
    case "artifact.ready":
      requireXlsxArtifact(action.artifact);
      if (state.taskId && action.taskId && state.taskId !== action.taskId) return state;
      return {
        ...state,
        phase: "loading",
        taskId: action.taskId ?? action.artifact.taskId ?? state.taskId,
        artifact: action.artifact,
        grant: action.grant,
        dirty: false,
        error: undefined,
      };
    case "editor.ready":
      return { ...state, phase: state.dirty ? "dirty" : "ready", error: undefined, saveError: undefined };
    case "editor.failed":
      return { ...state, phase: "error", error: action.error, saveError: undefined };
    case "editor.dirty":
      return { ...state, phase: action.dirty ? "dirty" : "ready", dirty: action.dirty, error: undefined, saveError: undefined };
    case "save.started":
      return { ...state, phase: "saving", error: undefined, saveError: undefined };
    case "save.succeeded":
      return {
        ...state,
        phase: action.changedDuringSave ? "dirty" : "ready",
        dirty: action.changedDuringSave,
        error: undefined,
        saveError: undefined,
      };
    case "save.failed":
      return { ...state, phase: "dirty", dirty: true, error: undefined, saveError: action.error };
    case "reset":
      return createSpreadsheetSession(action.entry);
  }
}
