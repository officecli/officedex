/**
 * Tells "the editor is not here" apart from "the editor is here and failed".
 *
 * The embedded editors report every way they can fail to come up through one
 * string callback, and the shell used to file all of them under "not built
 * yet": a one-line notice that went away by itself. That is the right answer
 * for a source checkout whose `public/writer/` was never staged — nothing is
 * wrong with the file, and nothing needs doing. It is the wrong answer for a
 * DOCX the converter rejected, which is a fact about the user's file and needs
 * to stay on screen with a way to act on it.
 *
 * The phrases are the leaves' own, verbatim, because the string is the only
 * channel there is. Keep them in step with `WriterEditorFrame`,
 * `PresentationEditorFrame` and `SheetCanvas`.
 */
const RUNTIME_MISSING = [
  // Writer / presentation / sheet build artifacts not staged in this tree.
  /assets are not installed/i,
  /component (?:assets |is )?(?:not|isn't|aren't) (?:installed|staged|available)/i,
  /runtime (?:is )?(?:not|isn't) (?:installed|staged|available|bundled)/i,
  /missing or broken .* runtime/i,
  /not staged/i,
  // The frame loaded but spoke a protocol this host does not know.
  /unsupported .* protocol/i,
  /protocol \S+ is not supported/i,
  // The frame never said hello at all.
  /did not start\. its window loaded but never reported ready/i,
  /never reported ready/i,
];

export function isEditorRuntimeMissing(reason: unknown): boolean {
  const text = reason instanceof Error ? reason.message : String(reason ?? "");
  return RUNTIME_MISSING.some((pattern) => pattern.test(text));
}
