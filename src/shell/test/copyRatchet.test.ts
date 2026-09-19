/**
 * Wave 4 gate 5: the shell's untranslated English copy only ever goes down.
 *
 * R18: `src/shell` contains zero `t(` calls. Every label, every empty state,
 * every `aria-label`, every one of the three prompt sentences `QuickPrompts`
 * puts into the composer and sends to a model, is an English literal compiled
 * into the component. The old renderer next door has a 1540-entry dictionary in
 * two languages, and `en.ts` even has a `shell.*` section — twenty entries,
 * both languages, written for this shell and used by none of it.
 *
 * W3-J is the track that fixes it. This is not that. This is the ratchet that
 * keeps the number from going back up while W3-J is in flight and afterwards:
 * a gate that demanded zero would be red for weeks and get deleted, and a gate
 * that demanded nothing would let every new feature add ten more strings.
 *
 * ## The number, and how it was counted
 *
 * S5 reported 227 unique strings / 295 occurrences / 28 files. That number is
 * **not** the baseline here, for two reasons: it predates Waves 1 and 2 (which
 * added copy — error states, the manual-download fallback, the overflow hint),
 * and its counting rule was never written down in a form anything could re-run.
 * So this counts again, by the rule below, and the baseline is what that rule
 * produced on the Wave-1+2 tree.
 *
 * The rule, in full, because a ratchet whose measurement nobody can reproduce
 * is a number that gets edited instead of earned:
 *
 *   Scanned: `src/shell/**` `.ts`/`.tsx`, minus `*.test.*`, `test/`, `dev/` and
 *   `port/fake/`. The last three are fixtures and harnesses — `port/fake`
 *   alone holds ~65 seeded file names and scripted agent lines that no user
 *   ever sees and no translator should ever be handed.
 *
 *   Comments are blanked first. Prose about copy is not copy, and
 *   `deadControls.test.ts` learned the same lesson the same way.
 *
 *   Counted, after that:
 *     1. JSX text runs — the text between `>` and `<`, when it contains no
 *        `;=(){}[]|&` (those mean it is code, not prose) and at least two
 *        letters.
 *     2. String literals in a copy-bearing JSX attribute: `label`,
 *        `placeholder`, `aria-label`, `title`, `alt`, `description`, `hint`,
 *        `message`, `summary`, `heading`, `caption`, `confirmLabel`,
 *        `cancelLabel`, `emptyLabel`.
 *     3. Any literal that is prose-shaped: starts with a capital and contains a
 *        space. This is what catches copy that never appears in JSX at all —
 *        menu `items` arrays, `notBuiltYet("…")`, status lines in a `.ts` file.
 *
 *   Excluded: SVG path data (`M3 3h3.5L3 6.5Z` is rule 3 by accident).
 *
 * ## Known blind spots
 *
 * 1. **It counts strings, not translation.** The day W3-J lands, these strings
 *    become `t("shell.…")` keys and the count collapses; until then the gate
 *    cannot tell a string that is *about* to be translated from one that never
 *    will be. It is a ratchet, not a definition of done.
 * 2. **Rule 3 needs a capital and a space.** `"Pin"`, `"Home"`, `"More"` are
 *    invisible to it unless they sit in JSX text or a listed attribute — which,
 *    in this codebase, they nearly always do, but a single-word label passed to
 *    an unlisted prop is uncounted. The number is a lower bound.
 * 3. **It counts error messages and provider names too** (`"Model ID cannot
 *    contain spaces."`, `"DeepSeek 4.1"`). Some of those should never be
 *    translated. That makes the floor non-zero, which is fine for a ratchet and
 *    would be wrong for a target.
 * 4. **Chinese and other non-ASCII copy is not counted at all.** The shell has
 *    none today; if it acquires some, this gate will not notice.
 * 5. The real fix, as ever, is not a better scanner: it is that `t()` is the
 *    only way to get a string onto the screen, which is a lint rule on an
 *    i18n-aware component API, not a regex.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The high-water mark, measured on this tree by the rule above.
 *
 * Counted 2026-09-20 in a clean worktree, at both `249e317` (the Wave 1 +
 * Wave 2 merge) and `a5a4fab` three commits later, with the same result:
 * **284 occurrences / 249 unique strings / 26 files** (58 files scanned). Not
 * S5's 227/295 — that predates two waves of copy and was never written down as
 * something re-runnable.
 *
 * It is already stale in the right direction: an uncommitted i18n pass in the
 * shared working tree takes the same measurement to **122 / 111 / 10**. Lower
 * both constants in whichever commit lands that. Never raise them.
 */
const BASELINE_OCCURRENCES = 284;
const BASELINE_STRINGS = 249;

const COPY_ATTRIBUTES = [
  "label",
  "placeholder",
  "aria-label",
  "title",
  "alt",
  "description",
  "hint",
  "message",
  "summary",
  "heading",
  "caption",
  "confirmLabel",
  "cancelLabel",
  "emptyLabel",
];

/** `M3 3h3.5L3 6.5ZM9 9H5.5Z` and friends: geometry, not language. */
const SVG_PATH = /^[MmLlHhVvCcSsQqTtAaZz0-9\s.,+-]+$/;

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/(^|[^:])\/\/[^\n]*/g, (line, lead: string) => lead + " ".repeat(line.length - lead.length));
}

export function copySources(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      if (entry === "test" || entry === "dev" || entry === "fake") continue;
      out.push(...copySources(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) continue;
    out.push(path);
  }
  return out;
}

export interface Occurrence {
  path: string;
  line: number;
  text: string;
  rule: string;
}

export function visibleCopy(path: string, source: string): Occurrence[] {
  const text = withoutComments(source);
  const lineOf = (index: number) => text.slice(0, index).split("\n").length;
  const found: Occurrence[] = [];
  const add = (index: number, raw: string, rule: string) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value || !/[A-Za-z]{2}/.test(value)) return;
    if (SVG_PATH.test(value.replace(/\$\{[^}]*\}/g, " "))) return;
    found.push({ path, line: lineOf(index), text: value, rule });
  };

  // 1. JSX text. The `(?<!=)` matters: without it `() => Promise<void>` reads
  //    as the text " Promise" between a `>` and a `<`.
  for (const match of text.matchAll(/(?<!=)>([^<>{}();=[\]|&]*[A-Za-z][^<>{}();=[\]|&]*)</g)) {
    add(match.index!, match[1], "jsx-text");
  }

  // 2. Copy-bearing attributes.
  for (const attribute of COPY_ATTRIBUTES) {
    const pattern = new RegExp(`\\b${attribute}=(?:\\{)?["'\`]([^"'\`]+)["'\`]\\}?`, "g");
    for (const match of text.matchAll(pattern)) add(match.index!, match[1], `attr:${attribute}`);
  }

  // 3. Prose-shaped literals anywhere else.
  for (const match of text.matchAll(/["'`]([A-Z][^"'`\n]*\s[^"'`\n]*)["'`]/g)) {
    add(match.index!, match[1], "prose");
  }

  // One line saying one thing is one occurrence, however many rules saw it.
  const seen = new Set<string>();
  return found.filter((occurrence) => {
    const key = `${occurrence.line}:${occurrence.text}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

describe("shell copy", () => {
  const occurrences = copySources("src/shell").flatMap((path) =>
    visibleCopy(path, readFileSync(path, "utf8")),
  );
  const strings = new Set(occurrences.map((occurrence) => occurrence.text));

  it("has no more untranslated occurrences than the baseline", () => {
    const worst = [...occurrences.reduce((counts, occurrence) => {
      counts.set(occurrence.path, (counts.get(occurrence.path) ?? 0) + 1);
      return counts;
    }, new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path, count]) => `${count} ${path}`)
      .join("\n");
    expect(
      occurrences.length,
      `untranslated copy grew to ${occurrences.length} (baseline ${BASELINE_OCCURRENCES}).\n` +
        `Route new user-visible text through i18n rather than raising the baseline.\nWorst files:\n${worst}`,
    ).toBeLessThanOrEqual(BASELINE_OCCURRENCES);
  });

  it("has no more untranslated unique strings than the baseline", () => {
    expect(strings.size).toBeLessThanOrEqual(BASELINE_STRINGS);
  });

  /*
   * The other side of the ratchet: a scanner that has quietly stopped finding
   * anything satisfies `toBeLessThanOrEqual` perfectly, and that failure looks
   * exactly like success at i18n.
   *
   * Fenced against a fixture rather than against a floor on the real count.
   * The obvious version — `expect(count).toBeGreaterThan(BASELINE - 40)` —
   * cannot survive its own success: a translation wave is indistinguishable
   * from a broken regex when all you look at is the total going down, and one
   * is in flight right now (an uncommitted i18n pass already takes this tree
   * from 284 occurrences to 122). A fixture asks the question the floor was
   * trying to ask — "do the three rules still fire?" — without an opinion about
   * how much of the shell is translated.
   */
  it("still recognises copy at all", () => {
    const found = visibleCopy(
      "fixture.tsx",
      [
        "// Not copy: a comment saying Open the file.",
        "/** Neither is Save before closing? in a doc block. */",
        'const items = [{ label: "Rename folder", onSelect: rename }];',
        'const plain = "Open from this computer";',
        "export function Probe() {",
        '  return <button aria-label="Close window" className="shell-x">Show less</button>;',
        "}",
        "const arrow = (): Promise<void> => save();",
        'const glyph = "M3 3h3.5L3 6.5Z";',
      ].join("\n"),
    );
    const text = found.map((occurrence) => occurrence.text).sort();
    expect(text).toEqual([
      "Close window",
      "Open from this computer",
      "Rename folder",
      "Show less",
    ]);
  });
});
