/**
 * A small CSS reader, shared by the two token gates next to this file.
 *
 * It exists because both gates need the same three things and `grep` gives you
 * only the first: the declaration, the selector it sits on, and the comments
 * attached to its rule block. Without the selector a whitelist can only be
 * keyed by line number, and a line number moves every time somebody edits the
 * file above it — `composer.css` moved sixty-seven lines during the session
 * that wrote these gates, which would have turned both of them red on a change
 * that touched nothing they check. Without the comments there is nowhere to
 * write a local exemption.
 *
 * It is not a CSS parser. It knows blocks, declarations, strings and comments,
 * and nothing else — no specificity, no cascade, no `@supports` evaluation. Any
 * question of the form "which rule wins" is outside it by construction; see the
 * blind-spot notes in the gates that use it.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export interface CssComment {
  /** 1-based line the `/*` sits on. */
  start: number;
  /** 1-based line the closing delimiter sits on. */
  end: number;
  text: string;
}

export interface CssDeclaration {
  file: string;
  /** 1-based line of the `;` (or `}`) that terminates the declaration. */
  line: number;
  /** The innermost selector, whitespace collapsed. `""` at file top level. */
  selector: string;
  /** Enclosing at-rules, outermost first: `["@media (...)"]`. */
  atRules: string[];
  property: string;
  value: string;
  /** `property: value`, whitespace collapsed. */
  text: string;
  /** Comments inside this declaration's rule block, plus the one above it. */
  notes: string[];
}

/** Every stylesheet under `directory`, sorted, so failures list in a stable order. */
export function cssFiles(directory = "src/shell"): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      out.push(...cssFiles(path));
      continue;
    }
    if (entry.endsWith(".css")) out.push(path);
  }
  return out;
}

function collectComments(source: string): CssComment[] {
  const out: CssComment[] = [];
  const pattern = /\/\*[\s\S]*?\*\//g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const start = source.slice(0, match.index).split("\n").length;
    out.push({
      start,
      end: start + match[0].split("\n").length - 1,
      text: match[0],
    });
  }
  return out;
}

/** Blank out comments while keeping every byte's line number intact. */
function blankComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, (block) => block.replace(/[^\n]/g, " "));
}

const collapse = (text: string) => text.replace(/\s+/g, " ").trim();

interface Frame {
  raw: string;
  openLine: number;
  declarations: CssDeclaration[];
}

/**
 * Every declaration in `file`.
 *
 * Walks characters rather than matching a regex per line because a selector,
 * a value and a comment may all span lines, and because a `{` inside a quoted
 * string (`content: "{"`) would otherwise open a block that never closes and
 * swallow the rest of the file. Quotes are skipped whole for that reason.
 */
export function parseCss(file: string, source = readFileSync(file, "utf8")): CssDeclaration[] {
  const comments = collectComments(source);
  const text = blankComments(source);
  const stack: Frame[] = [];
  const all: CssDeclaration[] = [];
  let buffer = "";
  let line = 1;

  const flush = (at: number) => {
    const raw = collapse(buffer);
    buffer = "";
    const colon = raw.indexOf(":");
    if (colon < 0) return;
    const property = raw.slice(0, colon).trim().toLowerCase();
    const value = raw.slice(colon + 1).trim();
    if (!property || !value || property.startsWith("@") || /[{}]/.test(property)) return;
    const frame = stack[stack.length - 1];
    const declaration: CssDeclaration = {
      file,
      line: at,
      selector: [...stack].reverse().find((entry) => !entry.raw.startsWith("@"))?.raw ?? "",
      atRules: stack.filter((entry) => entry.raw.startsWith("@")).map((entry) => entry.raw),
      property,
      value,
      text: `${property}: ${value}`,
      notes: [],
    };
    all.push(declaration);
    frame?.declarations.push(declaration);
  };

  for (let cursor = 0; cursor < text.length; cursor += 1) {
    const character = text[cursor];
    if (character === "\n") {
      line += 1;
      buffer += character;
      continue;
    }
    if (character === '"' || character === "'") {
      const quote = character;
      let end = cursor + 1;
      while (end < text.length && text[end] !== quote) {
        if (text[end] === "\\") end += 1;
        if (text[end] === "\n") line += 1;
        end += 1;
      }
      buffer += text.slice(cursor, end + 1);
      cursor = end;
      continue;
    }
    if (character === "{") {
      stack.push({ raw: collapse(buffer), openLine: line, declarations: [] });
      buffer = "";
      continue;
    }
    if (character === "}") {
      // A block's last declaration may legally omit its semicolon.
      flush(line);
      const frame = stack.pop();
      if (frame) {
        for (const declaration of frame.declarations) {
          declaration.notes = comments
            .filter(
              (comment) =>
                // Inside the block…
                (comment.start >= frame.openLine && comment.end <= line) ||
                // …or immediately above it. Four lines of slack because the
                // selector list itself may wrap before the `{` we recorded.
                (comment.end < frame.openLine && comment.end >= frame.openLine - 4),
            )
            .map((comment) => comment.text);
        }
      }
      buffer = "";
      continue;
    }
    if (character === ";") {
      flush(line);
      continue;
    }
    buffer += character;
  }
  return all;
}

/** Every declaration in every stylesheet under `directory`. */
export function parseShellCss(directory = "src/shell"): CssDeclaration[] {
  return cssFiles(directory).flatMap((file) => parseCss(file));
}

/**
 * Whether a declaration opens a stacking context on the element it applies to.
 *
 * Only the properties this shell actually uses, and only at the values that
 * really do it. `opacity: 1`, `transform: none`, `filter: none` and
 * `will-change: auto` appear in these stylesheets and open nothing — the
 * spec is explicit, so excluding them is correctness rather than a heuristic,
 * and it takes the inventory a gate has to account for from thirty-one down to
 * nineteen. `position` + `z-index` is deliberately absent: that pair is the
 * subject of the ladder gate, not an ambient hazard to it.
 */
export function opensStackingContext(declaration: CssDeclaration): boolean {
  const { property, value } = declaration;
  switch (property) {
    case "opacity":
      return Number.parseFloat(value) < 1;
    case "transform":
    case "filter":
    case "backdrop-filter":
    case "perspective":
      return value !== "none";
    case "will-change":
      return value !== "auto";
    case "mix-blend-mode":
      return value !== "normal";
    case "isolation":
      return value === "isolate";
    case "contain":
      return /\b(layout|paint|strict|content)\b/.test(value);
    case "container-type":
      // css-contain-3: any container-type but `normal` applies layout
      // containment, and layout containment opens a stacking context.
      return value !== "normal";
    default:
      return false;
  }
}
