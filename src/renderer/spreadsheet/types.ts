import type { Artifact, PreviewGrant } from "../../shared/types";

export type SpreadsheetEntry =
  | { kind: "new"; workspaceId?: string }
  | { kind: "artifact"; artifact: Artifact; workspaceId?: string; conversationId?: string; grant?: PreviewGrant };

export type SpreadsheetPhase = "empty" | "generating" | "loading" | "ready" | "dirty" | "saving" | "error";

export interface SpreadsheetSessionState {
  phase: SpreadsheetPhase;
  workspaceId?: string;
  conversationId?: string;
  taskId?: string;
  artifact?: Artifact;
  grant?: PreviewGrant;
  dirty: boolean;
  error?: string;
  saveError?: string;
}

export type SpreadsheetSessionAction =
  | { type: "generation.started"; taskId: string; conversationId?: string }
  | { type: "artifact.ready"; taskId?: string; artifact: Artifact; grant: PreviewGrant }
  | { type: "editor.ready" }
  | { type: "editor.failed"; error: string }
  | { type: "editor.dirty"; dirty: boolean }
  | { type: "save.started" }
  | { type: "save.succeeded"; changedDuringSave: boolean }
  | { type: "save.failed"; error: string }
  | { type: "reset"; entry: SpreadsheetEntry };
