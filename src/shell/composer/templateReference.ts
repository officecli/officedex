import type { PptxTemplateAssetSummary } from "../../shared/pptxTemplates";

/**
 * A PPT template referenced inline as `/Name` — 1.0.12 §五.
 *
 * The reference is text at the caret, not a chip above the input: the words
 * before and after it stay where the user typed them. The draft keeps which
 * template the token means and the version it had when chosen; the message
 * carries that snapshot, so re-learning the template later does not change
 * what an already-sent message asked for.
 */
export interface TemplateReference {
  id: string;
  name: string;
  version: number;
  localAssetDir: string;
}

export const templateReferenceOf = (template: PptxTemplateAssetSummary): TemplateReference => ({
  id: template.id,
  name: template.name,
  version: template.version,
  localAssetDir: template.localAssetDir,
});

export const tokenOf = (reference: Pick<TemplateReference, "name">) => `/${reference.name}`;

/** Where the token stands as a word of its own, or -1 once it has been edited away. */
export function templateTokenIndex(text: string, reference: Pick<TemplateReference, "name">): number {
  const token = tokenOf(reference);
  let from = 0;
  for (;;) {
    const index = text.indexOf(token, from);
    if (index < 0) return -1;
    const before = index === 0 || /\s/.test(text[index - 1]!);
    const after = index + token.length === text.length || /\s/.test(text[index + token.length]!);
    if (before && after) return index;
    from = index + 1;
  }
}

/** The `/query` being typed at the caret, if any: its start and the query. */
export function slashQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|\s)\/([^\n/]{0,60})$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1]!.length - 1, query: match[1]! };
}

/**
 * Puts `/Name` over the `/query` (or the selection) at [start, end), with a
 * space either side where the text has none. An earlier template token is
 * taken out first: a message uses one template.
 */
export function insertTemplateToken(
  text: string,
  start: number,
  end: number,
  reference: TemplateReference,
  previous: TemplateReference | null,
): { text: string; caret: number } {
  if (previous) {
    const at = templateTokenIndex(text, previous);
    if (at >= 0) {
      // The token and the one space that separated it, so no gap is left behind.
      const length = tokenOf(previous).length + (text[at + tokenOf(previous).length] === " " ? 1 : 0);
      const shift = (position: number) => (position <= at ? position : position >= at + length ? position - length : at);
      text = text.slice(0, at) + text.slice(at + length);
      start = shift(start);
      end = shift(end);
    }
  }
  const token = tokenOf(reference);
  const prefix = text.slice(0, start);
  const suffix = text.slice(end);
  const lead = prefix && !/\s$/.test(prefix) ? " " : "";
  const tail = !suffix || !/^\s/.test(suffix) ? " " : "";
  const next = `${prefix}${lead}${token}${tail}${suffix}`;
  return { text: next, caret: prefix.length + lead.length + token.length + tail.length };
}

/** The task without the token: what the presentation is to be about. */
export function promptWithoutTemplate(text: string, reference: TemplateReference | null): string {
  if (!reference) return text.trim();
  const at = templateTokenIndex(text, reference);
  if (at < 0) return text.trim();
  return `${text.slice(0, at)}${text.slice(at + tokenOf(reference).length)}`.replace(/[ \t]{2,}/g, " ").trim();
}
