/**
 * No control in this shell may be silent.
 *
 * The shell was designed against a fake port that implements all of `UiPort`,
 * which made it easy to draw a button and never notice it had no handler. An
 * audit found fourteen: Share, Settings, the profile chip, both zoom controls,
 * dictation, every tool in the ribbon, and "Open from this computer". All of
 * them looked alive and did nothing at all when clicked.
 *
 * So the rule, and this is the gate for it: a `<button>` either does something
 * or says why it cannot — `notBuiltYet` counts, because telling the user is
 * doing something. Silence does not.
 *
 * This is a static scan, the same trade-off rpcReachability.test.ts makes. It
 * cannot tell whether a handler does the right thing; it catches the mistake
 * that actually happens, which is a handler that was never written.
 *
 * **Known blind spot.** It sees `<button>` tags, not components that render
 * one. Editor mode's New and Open were `<SidebarButton>` with the `onClick`
 * prop simply left off: the tag inside SidebarButton had a handler, so this
 * scan was satisfied while both controls sat there doing nothing. The fix is
 * not a cleverer scanner — it is that a component wrapping a button declares
 * its handler prop **required**, which moves the check to the compiler. If you
 * add one, do that.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Anything that makes a press do something, including saying it cannot. */
const HANDLERS = [
  "onClick",
  "onPointerDown",
  "onMouseDown",
  "onKeyDown",
  // A submit button is driven by its form.
  'type="submit"',
  // Props forwarded wholesale — the handler arrives from the caller.
  "{...",
];

/**
 * Comments out, before anything is scanned.
 *
 * Prose about buttons is not a button. The first version of this did not strip
 * them and reported a `<button>` written inside a JSDoc block as a dead
 * control — a scanner that fails on its own documentation is one nobody will
 * keep. Replaced with spaces rather than removed so line numbers survive.
 */
function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "))
    .replace(/\/\/[^\n]*/g, (line) => " ".repeat(line.length));
}

/**
 * The opening tag of every `<button>` in `source`.
 *
 * Scans to the `>` that closes the tag while tracking brace depth, because JSX
 * attributes are full of them: an earlier version of this used a regex and
 * stopped at the `>` inside the first `=>`, which made every button with an
 * arrow-function handler look handler-less. Fourteen real findings arrived
 * mixed with eight of those.
 */
function buttonTags(source: string): Array<{ line: number; tag: string }> {
  source = withoutComments(source);
  const out: Array<{ line: number; tag: string }> = [];
  let index = 0;
  while (true) {
    index = source.indexOf("<button", index);
    if (index < 0) return out;
    let cursor = index + "<button".length;
    let depth = 0;
    while (cursor < source.length) {
      const character = source[cursor];
      if (character === "{") depth += 1;
      else if (character === "}") depth -= 1;
      else if (character === ">" && depth === 0 && source[cursor - 1] !== "=") break;
      cursor += 1;
    }
    out.push({
      line: source.slice(0, index).split("\n").length,
      tag: source.slice(index, cursor),
    });
    index = cursor;
  }
}

function shellComponents(directory: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...shellComponents(path));
      continue;
    }
    if (!entry.endsWith(".tsx")) continue;
    if (entry.includes(".test.")) continue;
    out.push(path);
  }
  return out;
}

describe("shell controls", () => {
  it("every button does something, or says it cannot", () => {
    const silent: string[] = [];
    for (const path of shellComponents("src/shell")) {
      const source = readFileSync(path, "utf8");
      for (const { line, tag } of buttonTags(source)) {
        if (HANDLERS.some((handler) => tag.includes(handler))) continue;
        silent.push(`${path}:${line}`);
      }
    }

    expect(silent).toEqual([]);
  });

  // A guard on the scanner: a drift that found no buttons at all would make the
  // assertion above pass while checking nothing.
  it("finds the buttons it is meant to be checking", () => {
    const total = shellComponents("src/shell")
      .flatMap((path) => buttonTags(readFileSync(path, "utf8")))
      .length;
    expect(total).toBeGreaterThan(20);
  });
});
