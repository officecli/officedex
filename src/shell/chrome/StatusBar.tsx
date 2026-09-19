import { HardDrive } from "lucide-react";

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
  const { activeFile } = useShell();

  return (
    <div className="shell-statusbar shell-region">
      <div className="shell-statusbar-facts">
        <span>{activeFile ? activeFile.name : "No file open"}</span>
      </div>

      <div className="shell-statusbar-end">
        <span className="shell-device">
          <HardDrive size={13} strokeWidth={1.7} aria-hidden="true" />
          On this computer
        </span>
        {activeFile ? (
          <span>{activeFile.dirty ? "Unsaved changes" : "All changes saved"}</span>
        ) : null}
      </div>
    </div>
  );
}
