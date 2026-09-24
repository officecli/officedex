import { useEffect, useRef, useState } from "react";

import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { translate } from "../renderer/i18n";
import { WriterEditorFrame, type WriterAgentEditor } from "../renderer/word/WriterEditorFrame";
import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type {
  CanvasSelection,
  DocumentEditRequest,
  DocumentEditResult,
} from "../shell/editor/canvasContract";
import { canvasLocaleTag, useCanvasLocale } from "../shell/editor/canvasLocale";
import { createDocxEditRunner } from "./docxEditRun";

export type DocumentEditRunner = (request: DocumentEditRequest) => Promise<DocumentEditResult>;

/**
 * The Word canvas: the embedded Writer editor, in the shell's document slot.
 *
 * Sibling of `PresentationCanvas` and deliberately the same shape — the
 * dispatcher in `createDesktopCanvas.tsx` renders one or the other by file
 * type, and a leaf that needed different handling would push that difference
 * into the branch.
 *
 * `DocxViewer` in the old UI mounts the same frame wrapped in a whole
 * workbench: its own file rail, its own agent panel, its own toolbar. The shell
 * already has all three, so what is reused here is `WriterEditorFrame` alone.
 */

export interface DocxCanvasProps {
  api: DesktopAPI;
  file: FileMeta;
  onDirtyChange: (dirty: boolean) => void;
  /** The caret moved. Carries a label only — the text costs a round trip. */
  onSelectionChange: (selection: CanvasSelection | null) => void;
  /** Reports how to read the selected text, once Writer is up. */
  onResolveSelection: (resolve: (() => Promise<CanvasSelection | null>) | null) => void;
  /**
   * The editor handle, once Writer is up — `{ capture, apply, save }`.
   *
   * The counterpart of `onController` for slides, and what the adapter's
   * `save()` forwards to: only the editor has the bytes, so `files.save` on the
   * port clears the dirty flag and writes nothing on its own.
   */
  onEditor: (editor: WriterAgentEditor | null) => void;
  /**
   * Reports how to rewrite part of this document in place, once Writer is up.
   *
   * Word is the only canvas that has this, so it is reported from here rather
   * than derived in the dispatcher: a deck and a workbook leave the adapter's
   * `editDocument` unusable and their instructions keep going to the
   * generation runtime.
   */
  onEditRunner: (edit: DocumentEditRunner | null) => void;
  /** The editor could not load at all — the caller falls back to a skeleton. */
  onUnavailable: (reason: string) => void;
}

interface Session {
  token: string;
  fileName: string;
  /** Where the file lives, for the edit run's metadata. */
  filePath: string;
}

/** What the chip says, given what Writer is willing to tell us for free. */
function selectionLabel(fileName: string, paragraphs: number | undefined): string {
  if (!paragraphs || paragraphs <= 1) return translate("shell.canvas.selection", { name: fileName });
  return translate("shell.canvas.paragraphs", { name: fileName, count: paragraphs });
}

export function DocxCanvas({
  api,
  file,
  onDirtyChange,
  onSelectionChange,
  onResolveSelection,
  onEditor,
  onEditRunner,
  onUnavailable,
}: DocxCanvasProps) {
  const locale = useCanvasLocale();
  const [session, setSession] = useState<Session | null>(null);
  const editorRef = useRef<WriterAgentEditor | null>(null);
  const labelRef = useRef<string>(file.name);
  /**
   * Whether there is a selection to narrow an edit to, read at the moment an
   * instruction is sent rather than captured when it was written.
   *
   * A ref, not state: the edit runner is handed upward once, when Writer comes
   * up, and a value closed over then would be the selection as it stood at
   * mount — which is none.
   */
  const hasSelectionRef = useRef(false);

  // A preview token is what the embed authenticates with and it is issued per
  // artifact. `FileMeta` carries no path, so the record has to be read first;
  // `getDocument` is the only place that translation happens.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const record = await api.getDocument(file.id);
        const grant = await api.issuePreviewToken({
          filePath: record.filePath,
          fileName: record.fileName,
          documentType: record.documentType,
          ...(record.currentArtifactTaskId ? { taskId: record.currentArtifactTaskId } : {}),
        });
        if (!cancelled) {
          setSession({ token: grant.token, fileName: record.fileName, filePath: record.filePath });
        }
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

  // Nothing to show until the token is in. The host keeps its skeleton visible
  // underneath, so this is a gap of a few hundred milliseconds, not a blank.
  if (!session) return null;

  return (
    <DesktopApiProvider api={api}>
      <WriterEditorFrame
        // A new document is a new editor, not the same one pointed somewhere
        // else. The old UI keys the frame on the token for the same reason.
        key={session.token}
        previewToken={session.token}
        fileName={session.fileName}
        onAgentReady={(editor) => {
          editorRef.current = editor;
          onEditor(editor);
          // `capture("selection")` is the only way to the words, and it is not
          // a read: it tracks a range for a later `apply` and replaces
          // whatever was tracked before. Doing it per caret move would expire
          // the scope an in-flight agent edit is holding, so it is handed back
          // as something to call once, when the message is sent.
          onResolveSelection(
            editor
              ? async () => {
                  const captured = await editor.capture("selection");
                  if (!captured.text.trim()) return null;
                  return { fileId: file.id, label: labelRef.current, text: captured.text };
                }
              : null,
          );
          onEditRunner(
            editor
              ? createDocxEditRunner({
                  api,
                  editor,
                  filePath: session.filePath,
                  hasSelection: () => hasSelectionRef.current,
                  /*
                   * The planner writes its summary in this language, and the
                   * summary is the only part of the result the user reads. The
                   * tag comes from the shell's locale channel: pinning `"en"`
                   * here was the same S4-009 mismatch `PresentationStage` had
                   * to undo, just on the request rather than the chrome.
                   */
                  locale: canvasLocaleTag(locale) ?? undefined,
                })
              : null,
          );
        }}
        onDirtyChange={onDirtyChange}
        onSelectionChange={(summary) => {
          // `WriterSelectionSummary` is free — it arrives on every caret move
          // and carries no text. A caret is not a selection: quoting it would
          // put an empty reference on every message the user types.
          if (summary.empty || summary.collapsed) {
            hasSelectionRef.current = false;
            onSelectionChange(null);
            return;
          }
          hasSelectionRef.current = true;
          labelRef.current = selectionLabel(session.fileName, summary.paragraphs);
          // Anything that gets this far is a range the user dragged out, which
          // is what `CanvasSelection.block` means. The carets are filtered out
          // above.
          onSelectionChange({ fileId: file.id, label: labelRef.current, text: "", block: true });
        }}
        onUnavailable={(error) => {
          // Writer already names missing assets and handshake timeouts. An
          // empty reason is not a start failure.
          if (!error?.trim()) return;
          onUnavailable(translate("shell.canvas.wordUnavailable", { error }));
        }}
      />
    </DesktopApiProvider>
  );
}
