import { useCallback, useEffect, useRef, useState } from "react";

import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { SpreadsheetCanvas, type SpreadsheetCanvasHandle } from "../renderer/spreadsheet/SpreadsheetCanvas";
import type { WorkbookSelectionSnapshot } from "../renderer/spreadsheet/workbookClientTools";
import type { Artifact, DesktopAPI, PreviewGrant } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type { CanvasSelection } from "../shell/editor/canvasContract";

/**
 * The Excel canvas: the embedded workbook editor, in the shell's document slot.
 *
 * Sibling of `PresentationCanvas` and `DocxCanvas`, with two differences that
 * come from the editor rather than from this layer:
 *
 *   - It is an imperative SDK (`@shimo/sdk-sheet`), not an iframe speaking a
 *     protocol. What it hands back is a ref, not a callback argument.
 *   - It wants the whole `Artifact` *and* the `PreviewGrant`. The other two take
 *     the token alone, so this is the only leaf that keeps the record around
 *     after issuing.
 *
 * ── The one trap in here ────────────────────────────────────────────────────
 *
 * `SpreadsheetCanvasHandle.save()` resolves to a **boolean**, not void: false
 * means the workbook was not written — no live session, or the write failed.
 * TypeScript will happily assign `() => Promise<boolean>` to the
 * `() => Promise<void>` the dispatcher holds, so handing the raw handle upward
 * would compile, swallow the false, and let the shell clear the dirty flag on a
 * save that never happened. The user would be told "Saved" over unsaved work.
 *
 * So the handle never leaves this file. What goes up is an adapted save that
 * throws, with whatever `onSaveError` last reported as its reason.
 */

export interface SheetCanvasProps {
  api: DesktopAPI;
  file: FileMeta;
  onDirtyChange: (dirty: boolean) => void;
  /** The selected range changed. Carries a label only — values cost a read. */
  onSelectionChange: (selection: CanvasSelection | null) => void;
  /** Reports how to read the selected cells, once the workbook is up. */
  onResolveSelection: (resolve: (() => Promise<CanvasSelection | null>) | null) => void;
  /**
   * How the open workbook writes itself, or null when none is open.
   *
   * Deliberately a prepared function rather than the editor handle — see the
   * note above. The counterpart of `onController` for slides and `onEditor` for
   * documents, differing only because this editor's own save cannot be handed
   * over as-is without losing its failure signal.
   */
  onSave: (save: (() => Promise<void>) | null) => void;
  /** The editor could not load at all — the caller falls back to a skeleton. */
  onUnavailable: (reason: string) => void;
}

interface Session {
  artifact: Artifact;
  grant: PreviewGrant;
}

/** 0-based column index to a spreadsheet column name: 0 → A, 26 → AA. */
function columnName(index: number): string {
  let name = "";
  for (let value = index; value >= 0; value = Math.floor(value / 26) - 1) {
    name = String.fromCharCode(65 + (value % 26)) + name;
  }
  return name;
}

/** "Sheet1!B2:D10", or "Sheet1!B2" for a single cell. */
function rangeAddress(address: Omit<WorkbookSelectionSnapshot, "values">): string {
  const { row, column, rowCount, columnCount } = address.range;
  const start = `${columnName(column)}${row + 1}`;
  if (rowCount <= 1 && columnCount <= 1) return `${address.sheetName}!${start}`;
  const end = `${columnName(column + columnCount - 1)}${row + rowCount}`;
  return `${address.sheetName}!${start}:${end}`;
}

export function SheetCanvas({
  api,
  file,
  onDirtyChange,
  onSelectionChange,
  onResolveSelection,
  onSave,
  onUnavailable,
}: SheetCanvasProps) {
  const [session, setSession] = useState<Session | null>(null);
  const handleRef = useRef<SpreadsheetCanvasHandle | null>(null);
  /** The last thing the editor said about a failed write, for the thrown error. */
  const saveErrorRef = useRef<string | undefined>(undefined);
  const readSaveError = useCallback(() => saveErrorRef.current, []);
  const labelRef = useRef<string>(file.name);

  // A preview token is what the embed authenticates with and it is issued per
  // artifact. `FileMeta` carries no path, so the record has to be read first;
  // `getDocument` is the only place that translation happens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const record = await api.getDocument(file.id);
        const artifact: Artifact = {
          filePath: record.filePath,
          fileName: record.fileName,
          documentType: record.documentType,
          ...(record.currentArtifactTaskId ? { taskId: record.currentArtifactTaskId } : {}),
        };
        const grant = await api.issuePreviewToken(artifact);
        if (!cancelled) setSession({ artifact, grant });
      } catch (reason) {
        if (!cancelled) {
          onUnavailable(reason instanceof Error ? reason.message : String(reason));
          setSession(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // onUnavailable is stable per adapter; including it would re-issue a token
    // on every render of the host.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, file.id]);

  const attachHandle = useCallback(
    (handle: SpreadsheetCanvasHandle | null) => {
      handleRef.current = handle;
      if (!handle) {
        onSave(null);
        onResolveSelection(null);
        return;
      }
      // The values, when the message is actually going out. `readSelection`
      // pulls the text of every cell in the block, which is a fine thing to do
      // once and a poor thing to do on every arrow key.
      onResolveSelection(async () => {
        try {
          const snapshot = handle.readSelection();
          const text = snapshot.values.map((row) => row.join("\t")).join("\n");
          if (!text.trim()) return null;
          return { fileId: file.id, label: labelRef.current, text };
        } catch {
          // Too large, nothing selected, or the session closed underneath. The
          // label-only reference still goes with the message.
          return null;
        }
      });
      onSave(async () => {
        saveErrorRef.current = undefined;
        const written = await handle.save();
        // The editor reports "nothing to write" as success, so a false here is
        // always a real failure. Throwing is what stops the shell from clearing
        // the dirty flag over work that is still only in memory.
        //
        // Read through a call rather than directly: the editor sets this from
        // its own callback during `save()`, which TypeScript's narrowing cannot
        // see — it would type the field as `never` after the reset above.
        if (!written) {
          const reason = readSaveError();
          throw new Error(reason?.trim() ? reason : "The workbook could not be saved.");
        }
      });
    },
    [onSave, onResolveSelection, readSaveError, file.id],
  );

  // Nothing to show until the token is in. The host keeps its skeleton visible
  // underneath, so this is a gap of a few hundred milliseconds, not a blank.
  if (!session) return null;

  return (
    <DesktopApiProvider api={api}>
      <SpreadsheetCanvas
        // A different workbook is a different session, not the same one pointed
        // somewhere else — the same rule the other two leaves follow.
        key={session.grant.token}
        ref={attachHandle}
        artifact={session.artifact}
        grant={session.grant}
        onDirtyChange={onDirtyChange}
        onSelectionChange={(address) => {
          // A workbook always has an active cell, so "nothing selected" is not
          // a state the user can be in — what matters is whether they picked a
          // block worth quoting. A single cell counts: "what is this formula?"
          // is exactly the kind of question this exists for.
          if (!address) {
            onSelectionChange(null);
            return;
          }
          labelRef.current = `${session.artifact.fileName} · ${rangeAddress(address)}`;
          onSelectionChange({ fileId: file.id, label: labelRef.current, text: "" });
        }}
        onSaveError={(error) => {
          saveErrorRef.current = error;
        }}
        onError={(error) =>
          onUnavailable(
            error?.trim()
              ? `The workbook editor could not start. ${error}`
              : "The workbook editor could not start.",
          )
        }
      />
    </DesktopApiProvider>
  );
}
