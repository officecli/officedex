import { useCallback, useEffect, useReducer } from "react";
import type { Artifact, GenerateInput, ModifyInput } from "../../shared/types";
import { officecli } from "../bridge";
import { createSpreadsheetSession, spreadsheetSessionReducer } from "./sessionState";
import type { SpreadsheetEntry } from "./types";

const emptyEntry: SpreadsheetEntry = { kind: "new" };

export function useSpreadsheetSession(entry: SpreadsheetEntry | null) {
  const [session, dispatch] = useReducer(spreadsheetSessionReducer, entry ?? emptyEntry, createSpreadsheetSession);

  useEffect(() => {
    dispatch({ type: "reset", entry: entry ?? emptyEntry });
  }, [entry?.kind, entry?.workspaceId, entry?.kind === "artifact" ? entry.artifact.filePath : undefined, entry?.kind === "artifact" ? entry.grant?.token : undefined, entry?.kind === "artifact" ? entry.conversationId : undefined]);

  const openArtifact = useCallback(async (artifact: Artifact, conversationId?: string) => {
    const grant = await officecli.issuePreviewToken(artifact);
    dispatch({ type: "reset", entry: {
      kind: "artifact",
      artifact,
      grant,
      ...(session.workspaceId ? { workspaceId: session.workspaceId } : {}),
      ...(conversationId ? { conversationId } : {}),
    } });
  }, [session.workspaceId]);

  const startGeneration = useCallback(async (input: GenerateInput) => {
    const result = await officecli.generate(input);
    dispatch({ type: "generation.started", taskId: result.taskId, conversationId: result.taskId });
    return result;
  }, []);

  const startModify = useCallback(async (input: ModifyInput) => {
    const result = await officecli.modify(input);
    dispatch({ type: "generation.started", taskId: result.taskId, conversationId: input.conversationId });
    return result;
  }, []);

  return {
    session,
    openArtifact,
    startGeneration,
    startModify,
    setDirty: useCallback((dirty: boolean) => dispatch({ type: "editor.dirty", dirty }), []),
    setCanvasState: useCallback((state: "loading" | "clean" | "dirty" | "saving" | "saved" | "error") => {
      if (state === "clean" || state === "saved") dispatch({ type: "editor.ready" });
      if (state === "saving") dispatch({ type: "save.started" });
    }, []),
    setError: useCallback((error?: string) => {
      if (error) dispatch({ type: "editor.failed", error });
    }, []),
    reset: useCallback((nextEntry: SpreadsheetEntry = emptyEntry) => dispatch({ type: "reset", entry: nextEntry }), []),
  };
}
