import { HardDrive } from "lucide-react";

import { useT } from "../../renderer/i18n";
import { useCanvasSurface } from "../editor/canvasSurface";
import { useShell } from "../state/ShellContext";

/**
 * The two things the shell actually knows about the open document: where it
 * lives, and whether it is saved.
 *
 * It used to say more. `detailFor` returned "Page 1 of 1 · 739 words" for every
 * document, "Slide 3 of 6" for every deck and "Sheet 1 of 1 · B6" for every
 * workbook — invented, fixed, and indistinguishable from fact. A status bar is
 * read as a report on *your* file, so a 40-page draft claiming one page is not
 * a placeholder, it is a wrong answer delivered confidently.
 *
 * The page count, the word count and the cursor position all belong to the
 * embedded editor, and `canvasContract.ts` has no way to ask for them. When it
 * does, they come back here as real numbers. Until then this says less, which
 * is the honest amount.
 *
 * The zoom control went with them for the same reason: it read 100% whatever
 * the editor was showing, and changing it did nothing.
 */
export function StatusBar() {
  const t = useT();
  const { activeFile } = useShell();

  /*
   * A document being written is not "no file open".
   *
   * A run that has not finished has no library entry to be the active file —
   * deliberately, the live draft is scratch in `workspaceDir/live/` and never
   * reaches `documents` — so `activeFile` is null for the whole minute or more
   * a deck is being drawn right there on the canvas. This bar said "No file
   * open" the entire time, under a visibly half-drawn deck. Its own rule, at
   * the top of this file, is to say less rather than say wrong; that was
   * saying wrong.
   *
   * The canvas already announces itself: a mounted editor publishes its chrome
   * (`canvasSurface.ts`), and the live stage publishes too. That is the shell's
   * own boundary, a plain synchronous store, so reading it here costs nothing
   * and subscribes nothing twice — which is what ruled out the two earlier
   * attempts (`useTaskStore` is not mounted at this entry at all and crashed
   * the shell; `useAgentTask` is already live in AgentPresence and would
   * duplicate its port reads).
   *
   * Only the empty branch changes: an open file still reports itself, so this
   * can only replace a statement that was wrong with one that is not. Type
   * agnostic on purpose — whichever stage owns the canvas, the fact being
   * stated is the same.
   */
  const { chrome } = useCanvasSurface();
  const canvasBusy = !activeFile && chrome !== null;

  return (
    <div className="shell-statusbar shell-region">
      <div className="shell-statusbar-facts">
        {/* `title` because the bar is the narrowest thing on screen and a file
            name is the longest: a 66-character name gets an ellipsis from
            chrome.css, and this is how the rest of it is still recoverable. */}
        <span title={activeFile ? activeFile.name : undefined}>
          {activeFile
            ? activeFile.name
            : canvasBusy
              ? t("shell.status.beingWritten")
              : t("shell.status.noFile")}
        </span>
      </div>

      <div className="shell-statusbar-end">
        <span className="shell-device">
          <HardDrive size={13} strokeWidth={1.7} aria-hidden="true" />
          {t("shell.status.onThisComputer")}
        </span>
        {activeFile ? (
          <span>{t(activeFile.dirty ? "workbench.state.dirty" : "shell.status.saved")}</span>
        ) : null}
      </div>
    </div>
  );
}
