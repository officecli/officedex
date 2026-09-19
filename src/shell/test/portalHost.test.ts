/**
 * Wave 4 gate 3: a portalled overlay mounts inside the shell, not on `<body>`.
 *
 * R3, 13 of the audit's findings, was one line repeated four times. `Modal`,
 * the imperative `dialog`, `Popover` and the toast host all did
 * `createPortal(…, document.body)`. The new shell re-points the `--od-*` token
 * bridge on `#shell` (tokens.css) because the old renderer shares that
 * component library and has to stay byte-for-byte unaffected — so an overlay
 * portalled to `document.body` sits outside the only element where the bridge
 * exists, and every bridged token silently falls back to the library default: a
 * pure-black primary button next to the shell's #41464b one, 8px corners
 * against 10px, 32px controls against 36px. The bridge had never applied once
 * since the day it landed, and nothing said so, because a wrong colour is not
 * an exception.
 *
 * W1-C fixed it by routing all four through `renderer/ui/overlayHost.ts`. This
 * is the line that stops the fifth one.
 *
 * Why a static scan and not a rendering test: the failure is invisible at run
 * time. A dialog on `document.body` renders, opens, closes and passes every
 * behavioural assertion anyone would write; it just looks wrong. The thing that
 * is actually checkable is the argument.
 *
 * **Known blind spots.**
 *
 * 1. It reads the literal second argument. `createPortal(node, host)` where
 *    `host` is computed elsewhere is opaque to it — which is exactly what
 *    `overlayHost()` is, and that function's own `document.body` fallback (for
 *    a `Menu` mounted with no shell around it, and for the legacy renderer,
 *    which has no `#shell`) is deliberate and correct. So this gate proves
 *    "nobody named `document.body` at a portal", not "nothing reaches body".
 *    The complement is asserted at run time in `e2e/fix-w1a.spec.ts`
 *    ("the panel is portalled inside #shell") and `e2e/fix-w1c.spec.ts`.
 * 2. It does not check `ReactDOM.createPortal(...)` written through a namespace
 *    import, only the named `createPortal` this repository uses everywhere.
 * 3. The right long-term fix is not a cleverer scan: it is that nothing outside
 *    `renderer/ui` calls `createPortal` at all, and the one exemption below is a
 *    component that should be using `Modal`. If you move it, delete its entry
 *    rather than widening the rule.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Portals that still name `document.body`, each one a finding rather than a
 * pardon.
 *
 * `renderer/spreadsheet/UnsavedChangesDialog.tsx` is reachable from the shell
 * (the sheet canvas raises it on close) and draws its own dialog instead of
 * using `Modal`, so W1-C's fix does not reach it: inside the shell it renders
 * with the library defaults, which is R3's symptom in a component R3's fix did
 * not cover. It belongs to whoever owns `renderer/spreadsheet`; it is listed
 * here so the count cannot grow quietly while it waits.
 */
const KNOWN_BODY_PORTALS = new Set([
  "src/renderer/spreadsheet/UnsavedChangesDialog.tsx",
]);

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (line) => " ".repeat(line.length));
}

function sources(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...sources(path));
      continue;
    }
    if (!/\.tsx?$/.test(entry) || entry.includes(".test.")) continue;
    out.push(path);
  }
  return out;
}

/**
 * The second argument of every `createPortal(` call in `source`.
 *
 * Tracks `()[]{}` depth and takes the **last non-empty** top-level argument.
 * All three qualifiers were learned the hard way. Counting `<` and `>` as
 * brackets too looks right for JSX and is not: every `=>` contributes a lone
 * `>`, depth goes negative, and the scanner then finds two portals in a
 * repository that has six. Splitting at the *first* top-level comma reads the
 * comma in a piece of JSX prose — `<p>Saved, not sent</p>` — as the end of the
 * first argument. And taking the last comma unconditionally finds nothing after
 * it whenever the call is written with a trailing comma, which is this
 * repository's formatting for a multi-line call — so the one component the
 * exemption list exists for looked clean.
 */
export function portalContainers(source: string): Array<{ line: number; argument: string }> {
  const text = withoutComments(source);
  const out: Array<{ line: number; argument: string }> = [];
  let index = 0;
  while (true) {
    index = text.indexOf("createPortal(", index);
    if (index < 0) return out;
    const line = text.slice(0, index).split("\n").length;
    let cursor = index + "createPortal(".length;
    let depth = 0;
    const commas: number[] = [];
    for (; cursor < text.length; cursor += 1) {
      const character = text[cursor];
      if ("([{".includes(character)) depth += 1;
      else if (")]}".includes(character)) {
        if (character === ")" && depth === 0) break;
        depth -= 1;
      } else if (character === "," && depth === 0) commas.push(cursor);
    }
    let end = cursor;
    for (let at = commas.length - 1; at >= 0; at -= 1) {
      const argument = text.slice(commas[at] + 1, end).trim();
      if (argument) {
        out.push({ line, argument });
        break;
      }
      end = commas[at];
    }
    index = cursor;
  }
}

describe("portalled overlays", () => {
  it("mount inside the shell's token scope, not on document.body", () => {
    const offenders: string[] = [];
    for (const path of sources("src")) {
      if (KNOWN_BODY_PORTALS.has(path)) continue;
      for (const { line, argument } of portalContainers(readFileSync(path, "utf8"))) {
        if (/\bdocument\s*\.\s*body\b/.test(argument)) offenders.push(`${path}:${line} -> ${argument}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  // The exemptions are assertions in the other direction: an entry that has
  // been fixed must be deleted, or the list becomes a place where a rule goes
  // to be forgotten.
  it("every known offender is still an offender", () => {
    for (const path of KNOWN_BODY_PORTALS) {
      const containers = portalContainers(readFileSync(path, "utf8"));
      expect(
        containers.some(({ argument }) => /\bdocument\s*\.\s*body\b/.test(argument)),
        `${path} no longer portals to document.body — remove it from KNOWN_BODY_PORTALS`,
      ).toBe(true);
    }
  });

  // A guard on the scanner: if `createPortal` were renamed or re-exported, the
  // assertion above would pass while reading nothing at all.
  it("finds the portals it is meant to be checking", () => {
    const total = sources("src")
      .flatMap((path) => portalContainers(readFileSync(path, "utf8")))
      .length;
    expect(total).toBeGreaterThanOrEqual(5);
  });
});
