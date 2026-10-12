import { useEffect, useRef, useState } from "react";

import { DesktopApiProvider } from "../renderer/services/desktopApi";
import { translate } from "../renderer/i18n";
import { isEditorRuntimeMissing } from "../shared/editorRuntime";
import { describeFailure, type FileFailure } from "../shared/fileFailure";
import { WriterEditorFrame, type WriterAgentEditor } from "../renderer/word/WriterEditorFrame";
import type { DesktopAPI } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type {
  CanvasSelection,
  CanvasToolbarProfile,
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
  /**
   * Which toolbar Writer lays out: `compact` for a document opened beside a
   * conversation, `full` otherwise. Decided by the adapter when the file is
   * first shown and fixed for the life of this editor; see `createDesktopCanvas`.
   */
  toolbarProfile?: CanvasToolbarProfile;
  onDirtyChange: (dirty: boolean) => void;
  /**
   * The caret moved. Reported twice for a range: at once with the label alone
   * (the push carries no text), then again with the words once Writer has
   * answered a read for them. A caret reports null.
   */
  onSelectionChange: (selection: CanvasSelection | null) => void;
  /** Reports how to read the selected text afresh, once Writer is up. */
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
  /**
   * The Writer runtime is not in this build — the caller falls back to a
   * skeleton and says the editor is not there. A document that *is* here and
   * cannot be opened is not this; see `onFileFailure`.
   */
  onUnavailable: (reason: string) => void;
  /**
   * This file could not be opened, or a save Writer ran on its own did not
   * reach the disk; `null` when it has since loaded or saved. The raw text
   * from the converter or the host travels as `detail`, never as the message —
   * it quotes HTTP statuses and scratch paths.
   */
  onFileFailure: (fileId: string, failure: FileFailure | null) => void;
}

interface Session {
  token: string;
  fileName: string;
  /** Where the file lives, for the edit run's metadata. */
  filePath: string;
}

/**
 * How long a range has to hold still before its words are read.
 *
 * Writer pushes a summary on every caret move, so a drag is a burst of them;
 * reading the words for each would be a burst of round trips into the embed
 * for text that is about to change. One read, once the selection settles.
 */
const SELECTION_TEXT_SETTLE_MS = 150;

/** What the chip says, given what Writer is willing to tell us for free. */
function selectionLabel(fileName: string, paragraphs: number | undefined): string {
  if (!paragraphs || paragraphs <= 1) return translate("shell.canvas.selection", { name: fileName });
  return translate("shell.canvas.paragraphs", { name: fileName, count: paragraphs });
}

export function DocxCanvas({
  api,
  file,
  toolbarProfile,
  onDirtyChange,
  onSelectionChange,
  onResolveSelection,
  onEditor,
  onEditRunner,
  onUnavailable,
  onFileFailure,
}: DocxCanvasProps) {
  const locale = useCanvasLocale();
  const [session, setSession] = useState<Session | null>(null);
  const editorRef = useRef<WriterAgentEditor | null>(null);
  const labelRef = useRef<string>(file.name);
  // The name the file has now. The editor session keeps the name it was opened
  // under, and a rename does not restart it, so labels read it from here (UX28-10).
  const nameRef = useRef(file.name);
  nameRef.current = file.name;
  /**
   * Whether there is a selection to narrow an edit to, read at the moment an
   * instruction is sent rather than captured when it was written.
   *
   * A ref, not state: the edit runner is handed upward once, when Writer comes
   * up, and a value closed over then would be the selection as it stood at
   * mount — which is none.
   */
  const hasSelectionRef = useRef(false);
  /**
   * Which selection the pending text read belongs to. Bumped on every push,
   * so a read that comes back after the user has moved on — to a caret, or to
   * a different range — is dropped rather than quoted under the wrong label.
   */
  const selectionSerialRef = useRef(0);
  const selectionReadTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      clearTimeout(selectionReadTimerRef.current);
    },
    [],
  );

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
          // No token means no editor for this file, which is a fact about the
          // file (it is gone, or the host refused it), not about the runtime.
          onFileFailure(file.id, describeFailure("open", reason));
          setSession(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // onFileFailure is stable per adapter; including it would re-issue a token
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
        sourcePath={session.filePath}
        fileName={session.fileName}
        toolbarProfile={toolbarProfile}
        onAgentReady={(editor) => {
          editorRef.current = editor;
          onEditor(editor);
          // `readSelection()` is a read and only a read: it tracks nothing, so
          // the scope an in-flight agent edit is holding from `capture` stays
          // put. The words are still fetched afresh when the message goes
          // out, because the chip may be showing a selection that has since
          // changed — the push that would have updated it carries no text.
          onResolveSelection(
            editor
              ? async () => {
                  const selection = await editor.readSelection();
                  if (!selection.text.trim()) return null;
                  return { fileId: file.id, label: labelRef.current, text: selection.text };
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
        // Loading clears an open failure; only a successful write clears a save failure.
        onReady={() => { if (file.failure?.kind !== "save") onFileFailure(file.id, null); }}
        onSaved={({ saveAsCopy }) => {
          if (!saveAsCopy) onFileFailure(file.id, null);
        }}
        onSaveFailed={(error) => onFileFailure(file.id, describeFailure("save", error))}
        onSelectionChange={(summary) => {
          const serial = (selectionSerialRef.current += 1);
          clearTimeout(selectionReadTimerRef.current);
          // `WriterSelectionSummary` is free — it arrives on every caret move
          // and carries no text. A caret is not a selection: quoting it would
          // put an empty reference on every message the user types.
          if (summary.empty || summary.collapsed) {
            hasSelectionRef.current = false;
            onSelectionChange(null);
            return;
          }
          hasSelectionRef.current = true;
          const label = selectionLabel(nameRef.current, summary.paragraphs);
          labelRef.current = label;
          // Anything that gets this far is a range the user dragged out, which
          // is what `CanvasSelection.block` means. The carets are filtered out
          // above. The label goes up now so the chip appears at once; the
          // words follow from one read, once the range has settled.
          onSelectionChange({ fileId: file.id, label, text: "", block: true });
          const editor = editorRef.current;
          if (!editor) return;
          selectionReadTimerRef.current = setTimeout(() => {
            void editor.readSelection().then(
              (selection) => {
                if (selectionSerialRef.current !== serial || !selection.text.trim()) return;
                onSelectionChange({ fileId: file.id, label, text: selection.text, block: true });
              },
              () => {
                // The label-only chip stands; the words are fetched again at send.
              },
            );
          }, SELECTION_TEXT_SETTLE_MS);
        }}
        onUnavailable={(error) => {
          // Writer already names missing assets and handshake timeouts. An
          // empty reason is not a start failure.
          if (!error?.trim()) return;
          // The runtime is missing: a gap, said once, nothing to retry. Anything
          // else Writer reports here is the embed refusing *this* document —
          // "DOCX import failed with HTTP 400: {…}" — and that belongs to the
          // file, in words, with the converter's text kept for Details.
          if (isEditorRuntimeMissing(error)) {
            onUnavailable(translate("shell.canvas.wordUnavailable", { error }));
            return;
          }
          onFileFailure(file.id, describeFailure("open", error));
          setSession(null);
        }}
      />
    </DesktopApiProvider>
  );
}
