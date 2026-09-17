import { useCallback, useRef, useState } from "react";
import type { SpreadsheetEntry } from "../spreadsheet/types";
import type { SpreadsheetAgentTool } from "../spreadsheet/SpreadsheetAgentPanel";
import type { SpreadsheetWorkspaceHandle } from "../spreadsheet/SpreadsheetWorkspace";
import { useSpreadsheetSession } from "../spreadsheet/useSpreadsheetSession";

export interface SpreadsheetSurfaceController {
  readonly session: ReturnType<typeof useSpreadsheetSession>;
  readonly entry: SpreadsheetEntry | null;
  readonly setEntry: (entry: SpreadsheetEntry | null | ((current: SpreadsheetEntry | null) => SpreadsheetEntry | null)) => void;
  readonly workspaceRef: React.RefObject<SpreadsheetWorkspaceHandle | null>;
  readonly preferredTool: SpreadsheetAgentTool;
  readonly setPreferredTool: (tool: SpreadsheetAgentTool) => void;
  readonly catalogAutoScanFile: string | undefined;
  readonly setCatalogAutoScanFile: (filePath: string | undefined) => void;

  /**
   * Runs an action, asking about unsaved workbook edits first. Resolves to
   * whether the action went through: the user can refuse it (R-G-01).
   */
  readonly guard: (action: () => Promise<void>) => Promise<boolean>;
  readonly unsavedDialogOpen: boolean;
  readonly unsavedDialogSaving: boolean;
  readonly resolveUnsaved: (discard: boolean) => Promise<void>;
  readonly cancelUnsaved: () => void;
}

/**
 * The spreadsheet workspace's own state, and the gate in front of it.
 *
 * The gate is the reason this is a controller rather than a few `useState`
 * calls: every path that would leave a dirty workbook has to pass through one
 * place, and the ones that do not are a silent loss of the user's edits.
 *
 * `isSurfaceActive` is injected rather than read here — which surface is on
 * screen is routing's business, and routing is built on top of this gate.
 */
export function useSpreadsheetSurface({ isSurfaceActive }: { isSurfaceActive: () => boolean }): SpreadsheetSurfaceController {
  const [entry, setEntry] = useState<SpreadsheetEntry | null>(null);
  const [preferredTool, setPreferredTool] = useState<SpreadsheetAgentTool>("assistant");
  const [catalogAutoScanFile, setCatalogAutoScanFile] = useState<string>();
  const session = useSpreadsheetSession(entry);
  const workspaceRef = useRef<SpreadsheetWorkspaceHandle>(null);
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [unsavedDialogSaving, setUnsavedDialogSaving] = useState(false);
  const pendingRef = useRef<{ action: () => Promise<void>; resolve: (continued: boolean) => void } | null>(null);

  const guard = useCallback((action: () => Promise<void>): Promise<boolean> => {
    if (!isSurfaceActive() || !session.session.dirty) {
      return action().then(() => true);
    }
    return new Promise<boolean>((resolve) => {
      pendingRef.current?.resolve(false);
      pendingRef.current = { action, resolve };
      setUnsavedDialogOpen(true);
    });
  }, [isSurfaceActive, session.session.dirty]);

  const resolveUnsaved = useCallback(async (discard: boolean) => {
    const pending = pendingRef.current;
    if (!pending) return;
    if (!discard) {
      setUnsavedDialogSaving(true);
      const saved = await workspaceRef.current?.save();
      setUnsavedDialogSaving(false);
      if (!saved) {
        // Keep the pending action alive so the user can retry the save,
        // explicitly discard, or cancel. Clearing it here leaves the dialog
        // open with buttons that can no longer complete the original action
        // (R-G-02).
        return;
      }
    } else if (session.session.artifact) {
      // Dropping edits must also drop the live editor grant. Keeping the same
      // granted entry mounted can leave the Sheet SDK bound to a session that
      // became invalid while the bridge restarted. Re-entering the artifact
      // without a grant unmounts that canvas, so a resumed run can reopen the
      // workbook with a fresh token even when the path is unchanged (R-G-03).
      setEntry({
        kind: "artifact",
        artifact: session.session.artifact,
        ...(session.session.workspaceId ? { workspaceId: session.session.workspaceId } : {}),
        ...(session.session.conversationId ? { conversationId: session.session.conversationId } : {}),
      });
    }
    pendingRef.current = null;
    setUnsavedDialogOpen(false);
    try {
      await pending.action();
      pending.resolve(true);
    } catch (error) {
      pending.resolve(false);
      throw error;
    }
  }, [session.session.artifact, session.session.conversationId, session.session.workspaceId]);

  const cancelUnsaved = useCallback(() => {
    pendingRef.current?.resolve(false);
    pendingRef.current = null;
    setUnsavedDialogOpen(false);
  }, []);

  return {
    session,
    entry,
    setEntry,
    workspaceRef,
    preferredTool,
    setPreferredTool,
    catalogAutoScanFile,
    setCatalogAutoScanFile,
    guard,
    unsavedDialogOpen,
    unsavedDialogSaving,
    resolveUnsaved,
    cancelUnsaved,
  };
}
