/**
 * What each embedded editor draws for itself, reported to the shell.
 *
 * The shell's half of this is `shell/editor/canvasSurface.ts`; this is the
 * desktop half, the same way `createDesktopCanvas.tsx` is the desktop half of
 * `canvasContract.ts`. What is here is one fact per editor — how much of the
 * canvas box it has already spent on its own controls — because that is the
 * part only this layer can answer.
 *
 * ── Where the numbers come from ─────────────────────────────────────────────
 *
 * Measured, in `docs/ui-audit-2026-09-19/S4/findings.md`, against a 1440×900
 * window with all three editors live on the real bridge:
 *
 *   workbook   `div.sm-sheet-footer` rect 864–900 → **36px**. The tab strip and
 *              the status bar are one footer; the tab strip is also the only
 *              way to change sheet, which is what made covering it a P1 rather
 *              than an aesthetic complaint (S4-012).
 *   deck       `div.…ppt-shell__statusbar`, text baseline y≈853 against a
 *              canvas ending at 868 → **32px**.
 *   document   Writer's own status bar ("页数 1/1 节 1/1 字数 0"), text baseline
 *              y≈853 against the same canvas → **32px**.
 *
 * They are restated constants rather than live measurements, for the reason
 * `CHROME_RESERVE` in `agent/presenceLayout.ts` is: two of the three are inside
 * an iframe, and a shell that reached through an embed's document to measure a
 * class name would break the first time either runtime renamed one, silently
 * and in the direction that looks fine. A number that is 4px generous costs
 * nothing; a measurement that returns 0 because a selector stopped matching
 * puts the panel back on the tab strip.
 *
 * ── What deliberately does not report ───────────────────────────────────────
 *
 * `DocxStage` and `SheetStage`. They mount `position: absolute; inset: 0` over
 * the whole canvas with no chrome of their own, so "the editor for this file
 * type has a 36px footer" is false while one is on screen, and acting on it
 * would move the shell out of the way of a strip that is not there. They do
 * report `STAGE_CHROME` — zero insets, no status bar — which reserves nothing
 * and is not the same as staying silent: silence is how this channel says "no
 * canvas at all", and the status bar and the attention border both need to tell
 * that apart from a run drawing on it.
 *
 * `PresentationStage` used to be on that list and no longer is: it draws through
 * `PresentationEditorFrame` now, so the deck's 32px status bar is on screen
 * during a run or the bundled recording and it reports `SLIDES_CHROME` while its
 * editor is up. The rule was never "stages are silent" — it is "report the
 * chrome you actually drew".
 */

import { useEffect } from "react";

import { NO_CANVAS_INSETS, publishEditorChrome, type EditorChrome } from "../shell/editor/canvasSurface";

/**
 * A stage: it covers the canvas and draws no chrome of its own.
 *
 * Zero insets, no status bar — and deliberately not *silence*. Silence is what
 * this channel means by "there is no canvas", and the shell has to tell that
 * apart from "a run owns the canvas": while a stage is up there is no active
 * file, so anything describing the canvas from `activeFile` alone reports an
 * empty workspace over a document that is visibly being written.
 *
 * Reserving nothing is still the right answer for the layout half — a stage has
 * no strip for the floating panel to avoid — so this changes what the shell can
 * *know*, not what it keeps clear.
 */
export const STAGE_CHROME: EditorChrome = {
  insets: NO_CANVAS_INSETS,
  ownsStatusBar: false,
};

/** The workbook's footer: sheet tabs, status bar and zoom, in one strip. */
export const SHEET_CHROME: EditorChrome = {
  insets: { top: 0, right: 0, bottom: 36, left: 0 },
  ownsStatusBar: true,
};

/** The deck editor's own status bar ("Slide 1 / 8"). */
export const SLIDES_CHROME: EditorChrome = {
  insets: { top: 0, right: 0, bottom: 32, left: 0 },
  ownsStatusBar: true,
};

/** Writer's own status bar (page, section, word count). */
export const DOC_CHROME: EditorChrome = {
  insets: { top: 0, right: 0, bottom: 32, left: 0 },
  ownsStatusBar: true,
};

/**
 * Publishes `chrome` for as long as the calling editor is mounted.
 *
 * Pass null from a component that sometimes renders an editor and sometimes
 * does not — hooks cannot be called conditionally, and "there is no editor" is
 * a report worth making rather than one worth skipping.
 */
export function useEditorChrome(chrome: EditorChrome | null): void {
  useEffect(() => {
    if (!chrome) return;
    return publishEditorChrome(chrome);
  }, [chrome]);
}
