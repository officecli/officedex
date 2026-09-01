// Leaf module: turns attached plain-text files into prompt context.
import type { LocalTextDocument } from "../shared/types";

/**
 * Builds the prompt sent to the runtime when the user attached reference text.
 *
 * The documents lead and the request follows, so the request stays adjacent to
 * the instructions the model acts on. Each document is fenced with its file
 * name so the model can attribute figures back to a specific source.
 */
export function buildReferenceTextPrompt(prompt: string, documents: LocalTextDocument[]): string {
  const usable = documents.filter((document) => document.text.trim().length > 0);
  if (usable.length === 0) return prompt;

  const sections = usable.map((document) => {
    const truncationNote = document.truncated ? " (truncated)" : "";
    return `<<<FILE: ${document.fileName}${truncationNote}>>>\n${document.text.trim()}\n<<<END FILE: ${document.fileName}>>>`;
  });

  const label = usable.length === 1 ? "reference document" : `${usable.length} reference documents`;
  return [
    `The user attached ${label}. Use them as the source of truth for this request.`,
    "",
    sections.join("\n\n"),
    "",
    "REFERENCE RULES:",
    "- Base every fact, figure, and name on the attached documents.",
    "- Do not invent data that is absent from them.",
    "- When the documents disagree or leave a gap, say so instead of guessing.",
    "",
    `Request: ${prompt.trim()}`,
  ].join("\n");
}
