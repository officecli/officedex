import type {
  PresentationEditorContext,
  PresentationEditorSlide,
} from "../shared/presentationInspect";
import { translate } from "../renderer/i18n";

/**
 * What the user pointed at, turned into a boundary the planner cannot step over.
 *
 * The bug this exists for: a user picked one title on one slide, said "make it
 * Japanese", and every text run in a ten-slide deck came back translated. The
 * planner was not disobeying — it was never told there was a selection. It got
 * the whole deck snapshot and one sentence, and "make it Japanese" against a
 * whole deck honestly means the whole deck.
 *
 * Three things follow from that, and all three live here because they are pure
 * and therefore testable without an editor:
 *
 * 1. Work out the scope from the inspect snapshot the editor already returns
 *    (`selectedShapes` / `selectedSlideIds`) plus the quoted chip text.
 * 2. *Narrow the context to it.* Telling the model "only touch s1-shape" while
 *    handing it the ids of the other nine slides leaves the wrong answer one
 *    inference away; withholding them makes a whole-deck script unwriteable in
 *    the first place. Instruction and evidence have to agree.
 * 3. Audit the returned script before it runs, because 1 and 2 are prompt-level
 *    and a prompt is not an enforcement mechanism.
 *
 * None of this needs the Go planner to change: `PlanPptxJS` forwards `prompt`
 * and `context` to the model verbatim, so a scope stated here is a scope the
 * model reads.
 */

/** The scope as the planner sees it — this object is sent as `context.scope`. */
export interface PptxEditScope {
  kind: "selection" | "document";
  /** Selection scopes only: a shape pick is narrower than a slide pick. */
  level?: "shape" | "slide";
  slideIds: string[];
  shapeIds: string[];
  /** The chip's words, when they are what located the target. */
  quotedText?: string;
}

/**
 * Which branch decided the scope.
 *
 * Carried beside the scope rather than inside it because the planner has no use
 * for it and the app log has nothing else: a packaged build has no console, so
 * "why did it edit the whole deck again" is answerable only if the decision
 * left a record of which rule fired.
 */
export type PptxScopeBasis =
  | "no-reference"
  | "selected-shapes"
  | "selected-slides"
  | "quoted-text"
  | "quoted-text-ambiguous"
  | "quoted-text-unmatched"
  | "no-selection";

export interface ResolvedPptxScope {
  scope: PptxEditScope;
  basis: PptxScopeBasis;
}

/** The planner context: the deck as narrowed, plus the boundary it was narrowed to. */
export interface PptxPlannerContext extends PresentationEditorContext {
  scope: PptxEditScope;
}

export interface PptxScopeBreach {
  /** Ids the script names that exist in the deck but not in the scope. */
  ids: string[];
  /** Collection walks — reaching slides and shapes without going through an id. */
  enumerations: string[];
}

/**
 * Text caps the two Office.js readers apply, mirrored here.
 *
 * They are the reason quoted-text matching cannot be plain equality: the
 * snapshot truncates a shape at 400 characters while the chip truncates the
 * selection at 4000, so the same paragraph arrives as two different strings and
 * the shorter one is a prefix of the longer. Kept as constants next to the
 * comparison rather than inlined, because if either source changes its cap this
 * matching silently degrades to "no match" and falls back to the whole deck.
 */
const INSPECT_MAX_TEXT = 400;
const SELECTION_MAX_TEXT = 4000;

const unique = (values: string[]): string[] => [...new Set(values)];

/**
 * The whole deck, with the quote kept when there was one.
 *
 * A document scope reached *through* a reference is not the same state as one
 * reached without: the user did point at something, it just could not be
 * placed. Keeping the words here is what lets the prompt say so and the gate
 * downstream ask about it — without them this path was, line for line, the
 * behaviour that produced the bug.
 */
const documentScope = (basis: PptxScopeBasis, quotedText?: string): ResolvedPptxScope => ({
  scope: { kind: "document", slideIds: [], shapeIds: [], ...(quotedText ? { quotedText } : {}) },
  basis,
});

/**
 * Whitespace is presentation, not identity.
 *
 * A title wrapped across two lines in the editor comes back with a newline from
 * one reader and a space from the other; treating those as different text would
 * fail the match and silently widen the edit to the whole deck — which is the
 * exact bug being fixed.
 */
const normalize = (value: string): string => value.replace(/\s+/g, " ").trim();

function quoteMatchesShapeText(shapeText: string, quote: string): boolean {
  const shape = normalize(shapeText);
  const quoted = normalize(quote);
  if (!shape || !quoted) return false;
  if (shape === quoted) return true;
  // Truncation, from either side: only the side that actually hit its cap is
  // allowed to be the prefix, so "Agenda" does not claim "Agenda for today".
  if (shapeText.length >= INSPECT_MAX_TEXT && quoted.startsWith(shape)) return true;
  if (quote.length >= SELECTION_MAX_TEXT && shape.startsWith(quoted)) return true;
  return false;
}

/**
 * The scope, from the selection the editor reported and the text the chip quoted.
 *
 * Order matters and is the order of decreasing certainty: shapes the editor says
 * are selected, then slides it says are selected, then — only if it reported
 * neither — the quoted words, which are evidence about *what* the user pointed
 * at rather than a statement of it.
 *
 * Every failure to resolve lands on the whole document, unchanged from the
 * behaviour before scoping existed. A wrong narrow scope silently drops half of
 * what the user asked for; a wrong wide scope is the old, visible bug with a
 * guard behind it.
 */
export function resolveEditScope(
  before: PresentationEditorContext,
  input: { preferSelection: boolean; quotedText?: string },
): ResolvedPptxScope {
  const quotedText = input.quotedText?.trim() || undefined;
  if (!input.preferSelection) return documentScope("no-reference");

  const owners = new Map<string, string>();
  const slideIds = new Set<string>();
  for (const slide of before.slides ?? []) {
    slideIds.add(slide.id);
    for (const shape of slide.shapes ?? []) owners.set(shape.id, slide.id);
  }

  // Ids are only trusted when the snapshot also contains them: a selection the
  // inspect pass did not see is one the plan could not address either.
  const selectedShapeIds = unique(
    (before.selectedShapes ?? []).map((shape) => shape.id).filter((id) => owners.has(id)),
  );
  if (selectedShapeIds.length > 0) {
    return {
      scope: {
        kind: "selection",
        level: "shape",
        slideIds: unique(selectedShapeIds.map((id) => owners.get(id)!)),
        shapeIds: selectedShapeIds,
        ...(quotedText ? { quotedText } : {}),
      },
      basis: "selected-shapes",
    };
  }

  const selectedSlideIds = unique((before.selectedSlideIds ?? []).filter((id) => slideIds.has(id)));
  if (selectedSlideIds.length > 0) {
    return {
      scope: {
        kind: "selection",
        level: "slide",
        slideIds: selectedSlideIds,
        shapeIds: [],
        ...(quotedText ? { quotedText } : {}),
      },
      basis: "selected-slides",
    };
  }

  if (quotedText) {
    const located = locateQuote(before, quotedText);
    if (located.shapeIds.length > 0) {
      return {
        scope: {
          kind: "selection",
          level: "shape",
          slideIds: unique(located.shapeIds.map((id) => owners.get(id)!)),
          shapeIds: located.shapeIds,
          quotedText,
        },
        basis: "quoted-text",
      };
    }
    // The quote survives into the document scope: a reference that could not be
    // placed is still the user pointing at something, and both the prompt and
    // the gate downstream have to know that is what happened.
    return documentScope(located.ambiguous ? "quoted-text-ambiguous" : "quoted-text-unmatched", quotedText);
  }

  return documentScope("no-selection", quotedText);
}

/**
 * Where the quoted words are, if they are anywhere findable.
 *
 * Two passes, because the chip and the snapshot do not quote the same unit. A
 * multi-shape selection arrives as the shapes' texts joined with newlines
 * (`PRESENTATION_SELECTION_TEXT_SOURCE`), while the snapshot holds one text per
 * shape — so a whole-quote comparison can only ever match a single-shape
 * selection, and every multi-shape reference fell through to "unmatched" and
 * took the whole deck with it.
 *
 * The line pass is held to the same standard as the whole pass: each line must
 * hit exactly one shape or none at all. One ambiguous line poisons the result
 * rather than being dropped, because a union built from "the lines I could
 * place" is a scope the user never described.
 */
function locateQuote(
  before: PresentationEditorContext,
  quote: string,
): { shapeIds: string[]; ambiguous: boolean } {
  const shapesMatching = (text: string): string[] => {
    const hits: string[] = [];
    for (const slide of before.slides ?? []) {
      for (const shape of slide.shapes ?? []) {
        if (quoteMatchesShapeText(shape.text ?? "", text)) hits.push(shape.id);
      }
    }
    return hits;
  };

  const whole = shapesMatching(quote);
  if (whole.length === 1) return { shapeIds: whole, ambiguous: false };

  const lines = unique(
    quote
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  );
  if (lines.length > 1) {
    const found: string[] = [];
    for (const line of lines) {
      const hits = shapesMatching(line);
      if (hits.length > 1) return { shapeIds: [], ambiguous: true };
      if (hits.length === 1) found.push(hits[0]);
    }
    if (found.length > 0) return { shapeIds: unique(found), ambiguous: false };
  }
  return { shapeIds: [], ambiguous: whole.length > 1 };
}

/**
 * The deck as the planner should see it: only what is in scope.
 *
 * Shape-level keeps the selected shapes' own slides and drops their siblings;
 * slide-level keeps whole slides, because picking a slide is picking what is on
 * it. Field shapes are preserved exactly — the planner's prompt documents
 * `slides[] {id, index, shapes[] {...}}` and a narrowed context that changed
 * that shape would be a second, subtler way to confuse it.
 */
export function buildPlannerContext(
  before: PresentationEditorContext,
  scope: PptxEditScope,
): PptxPlannerContext {
  if (scope.kind === "document") return { ...before, scope };
  const slideIds = new Set(scope.slideIds);
  const shapeIds = new Set(scope.shapeIds);
  const slides: PresentationEditorSlide[] = (before.slides ?? [])
    .filter((slide) => slideIds.has(slide.id))
    .map((slide) => ({
      ...slide,
      shapes:
        scope.level === "shape"
          ? (slide.shapes ?? []).filter((shape) => shapeIds.has(shape.id))
          : slide.shapes,
    }));
  return { ...before, slides, scope };
}

/** How much of the quoted text is worth repeating back at the model. */
const PROMPT_QUOTE_LIMIT = 200;

/**
 * The instruction, with the boundary stated before it.
 *
 * Written in the Go planner's own register (`pptxPlanJSSystemPrompt`) because
 * that is the voice the model is already following, and stated as a refusal
 * rather than a preference: the system prompt's existing line about selection
 * is a suggestion ("use context.selectedShapes first"), and a suggestion is
 * what produced a ten-slide translation from a one-title selection.
 *
 * A document scope returns the instruction untouched — the unscoped path has to
 * stay byte-for-byte what it was, or every deck-wide instruction becomes a new
 * experiment.
 */
export function scopedPrompt(
  instruction: string,
  scope: PptxEditScope,
  context: PresentationEditorContext,
): string {
  const quote = scope.quotedText
    ? scope.quotedText.length > PROMPT_QUOTE_LIMIT
      ? `${scope.quotedText.slice(0, PROMPT_QUOTE_LIMIT)}…`
      : scope.quotedText
    : "";

  if (scope.kind === "document") {
    /*
     * A reference that could not be placed still changes what the instruction
     * means. "Make it Japanese" beside a quotation is about that quotation; the
     * unscoped prompt turned it into a statement about the deck, and the model
     * obliged. There is no boundary to state here — nothing was located — so
     * this says exactly that much and no more, and leaves the planner to ask.
     */
    if (!quote) return instruction;
    return [
      `The user sent this instruction with a quoted passage: "${quote}"`,
      "That passage could not be matched to any shape in this deck, so no scope could be derived from it. Treat the instruction as being about that passage, not about the deck as a whole: find the closest matching shape and change only it. If you cannot tell what it refers to, return confidence \"low\" with a warning rather than editing every slide.",
      "",
      "User instruction:",
      instruction,
    ].join("\n");
  }

  const names = new Map<string, string>();
  for (const slide of context.slides ?? []) {
    for (const shape of slide.shapes ?? []) names.set(shape.id, shape.name || shape.type);
  }
  const shapeList = scope.shapeIds
    .map((id) => (names.has(id) ? `${id} (${names.get(id)})` : id))
    .join(", ");

  return [
    "SCOPE LOCK — the user selected part of this deck, and this edit may only touch that part.",
    `In scope: slide ids [${scope.slideIds.join(", ")}]${
      shapeList ? `; shape ids [${shapeList}]` : "; every shape on those slides"
    }.`,
    ...(quote ? [`The user quoted: "${quote}"`] : []),
    "context.slides has been narrowed to exactly that selection on purpose. The rest of the deck is withheld, not absent — do not assume it is empty and do not ask for it.",
    "- Change only the ids listed above. Do not modify, add, delete, reorder or restyle any other slide, shape, layout or master.",
    "- Do not enumerate context.presentation.slides or slide.shapes, and do not use getItemAt; reach the ids above with slides.getItem(id) and shapes.getItem(id).",
    "- Do not go through slide.layout, slide.slideMaster or context.presentation.slideMasters. Those shapes belong to every slide that uses them, so editing one there is a deck-wide change however narrow it looks.",
    '- If the instruction cannot be carried out inside this scope, return requires_confirmation=true with a warning naming the wider scope it would need. Never widen the scope yourself.',
    '- If the instruction is plainly about the whole deck rather than about the selection, return confidence "low" with a warning instead of guessing.',
    "",
    "User instruction, to be carried out only inside the scope above:",
    instruction,
  ].join("\n");
}

/**
 * Punctuation and keywords after which a `/` can only open a regex.
 *
 * The standard heuristic, and the whole of it: after something that *can end an
 * expression* (an identifier, a literal, `)`, `]`) a slash is division;
 * everywhere else it opens a regex. Getting this wrong in the safe direction
 * costs a garbled token, getting it wrong the other way blinds the scanner.
 */
const EXPRESSION_START = new Set("(,=:[!&|?{};+-*%~^<>".split(""));
const EXPRESSION_KEYWORD =
  /\b(return|typeof|case|in|of|do|else|void|delete|instanceof|new|yield|await|throw)$/;

function startsExpression(code: string): boolean {
  const trimmed = code.replace(/\s+$/, "");
  if (!trimmed) return true;
  return EXPRESSION_START.has(trimmed[trimmed.length - 1]) || EXPRESSION_KEYWORD.test(trimmed);
}

/**
 * Splits a script into its code and its string literals.
 *
 * Deliberately a scanner and not a parser. The two questions the guard asks —
 * "does a string in here name a slide I did not select" and "does this code
 * walk a collection" — need string boundaries and comment boundaries, and
 * nothing else; a real JS parser would be a dependency and several hundred
 * lines to answer them.
 *
 * Known limits, and why they are acceptable:
 * - Template `${...}` expressions are pushed into *both* halves, so an
 *   enumeration hidden in an interpolation is still seen, at the cost of a
 *   false positive when a plain string happens to contain `.slides.items`.
 * - A string used as a property key keeps its text in the code half, because
 *   there it *is* syntax: `presentation["slides"]` is the same access as
 *   `presentation.slides`, and blanking it would hide the walk from the guard
 *   entirely. Elsewhere a string's contents stay out of the code half, so the
 *   plan's own summary cannot trip the collection check.
 * - Regex literals are recognised only well enough not to be mistaken for
 *   strings. The `/` is read as a regex when what precedes it cannot end an
 *   expression, which is the standard heuristic and is wrong only for corners
 *   no generated plan reaches. This is not a nicety: `const q = /"/g;` used to
 *   open a string that swallowed the rest of the script, and everything after
 *   it — including `context.presentation.slides.items` — became invisible to
 *   both checks. A blind guard passes everything.
 *
 * The bias is deliberate: every ambiguity here resolves toward flagging, and a
 * flag is a question to the user, never a silent refusal and never a silent
 * execution. The regex's own text goes into the code half for the same reason.
 */
export function scanSource(source: string): { code: string; literals: string[] } {
  const literals: string[] = [];
  let code = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "/" && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      i += 2;
      while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === "/" && startsExpression(code)) {
      let value = "/";
      let inClass = false;
      i += 1;
      while (i < source.length) {
        const c = source[i];
        if (c === "\\") {
          value += c + (source[i + 1] ?? "");
          i += 2;
          continue;
        }
        if (c === "\n") break; // Unterminated: bail rather than eat the file.
        value += c;
        i += 1;
        if (c === "[") inClass = true;
        else if (c === "]") inClass = false;
        else if (c === "/" && !inClass) break;
      }
      while (i < source.length && /[a-z]/.test(source[i])) {
        value += source[i];
        i += 1;
      }
      code += value;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i += 1;
      let value = "";
      while (i < source.length) {
        const c = source[i];
        if (c === "\\") {
          value += source[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (c === quote) {
          i += 1;
          break;
        }
        value += c;
        i += 1;
      }
      literals.push(value);
      // A property key is syntax, so it stays readable in the code half;
      // anything else leaves only its quotes behind, so neighbouring member
      // chains do not fuse into one another once the contents are gone.
      const isPropertyKey = /\[\s*$/.test(code);
      code +=
        isPropertyKey || quote === "`"
          ? `${quote}${value}${quote}`
          : `${quote}${quote}`;
      continue;
    }
    code += ch;
    i += 1;
  }
  return { code, literals };}

/**
 * Reaching a slide, or a shape, by anything other than an id.
 *
 * `slides` is locked to `getItem(id)`. Everything else — `.load(`, `.items`,
 * `.getItemAt(`, `.add(`, or a bare alias — either enumerates the deck or
 * indexes into it positionally, and a positional index is unverifiable here:
 * the ids it lands on never appear in the script for the id check to catch.
 *
 * `shapes` is only judged under a *shape* pick. Under a slide pick every shape
 * on the selected slide is in scope by definition, so reading that slide's
 * shape collection is an in-scope read, not an escape — an earlier version
 * flagged it on the theory that it could reach an unselected shape, which is
 * wrong: the only shapes it can reach belong to a slide the script already had
 * to obtain, and the lock above means it can only have obtained one by
 * `slides.getItem(id)` with an id that is either in scope or caught by the
 * literal check. Flagging it put a confirmation reading "this reaches content
 * you did not select" in front of "translate this slide" — a false alarm on the
 * most common selection there is (a click on a slide, which is exactly what the
 * reference chip degrades to), and the surest way to teach the user that the
 * confirmation is noise.
 *
 * So the loop is closed by `slides` alone, with `shapes` locked as well once
 * the pick is narrower than a slide.
 *
 * Both spellings of the access are matched — `.slides` and `["slides"]`,
 * optional chaining included — because they are the same member and a guard
 * that only knew the first would be walked straight past.
 *
 * `layout`, `slideMaster` and their collections are out of scope *always*, at
 * any member including `getItem`. They are the hole in the paragraph above:
 * `slide.layout.shapes.getItem("Title 1")` starts from a slide the script is
 * allowed to have and lands on a shape that belongs to every slide sharing that
 * layout — so "the shapes of the selected slide" was never true of them. The id
 * net cannot cover the gap either, since layout and master shape ids never
 * appear in the snapshot at all. There is no in-scope reason for a scoped edit
 * to go there, so entering is the offence, not what it does next.
 *
 * Destructuring is flagged by shape of the statement rather than by member,
 * because `const { slides } = context.presentation` leaves no `.slides` token
 * for this to see, and the loop that follows it walks the entire deck. That one
 * is not a false-positive trade — it is the same escape spelled differently.
 *
 * Not caught, on purpose:
 * - A computed key or an aliased identifier that never names the collection at
 *   the point of use (`const c = "slides"; presentation[c]`). Catching that
 *   means telling a bare identifier apart from any other local variable, which
 *   needs data-flow analysis — and the crude version of it (flag the bare name)
 *   would put a false alarm back in the common case: under a slide pick,
 *   `const shapes = slide.shapes; shapes.load(...)` is perfectly in scope.
 * - Computed ids (`getItem("s" + i)`, `` getItem(`s${n}`) ``). Reaching another
 *   slide that way means inventing an id the narrowed context never supplied,
 *   which the planner's own system prompt forbids outright.
 *
 * That is acceptable because this is the third layer, not the only one. A model
 * writing a whole-deck script writes the documented form,
 * `context.presentation.slides.load(...)` — it is what the planner's own system
 * prompt teaches it — and that form is caught. Behind this, the narrowed context
 * means the ids of the other slides were never handed over, and the literal
 * check catches them if they are named anyway.
 */
const COLLECTION_ACCESS =
  /(?:\??\.\s*(slides|shapes|layouts?|slideMasters?)\b|\??\.?\s*\[\s*["'](slides|shapes|layouts?|slideMasters?)["']\s*\])\s*(?:\??\.\s*([A-Za-z_$][\w$]*))?/g;

/** `const { slides } = …` — the same reach, with no member access to match on. */
const DESTRUCTURED_COLLECTION = /\{[^}]*\b(slides|shapes|layouts?|slideMasters?)\b[^}]*\}\s*=/g;

/** Crossing into a layout or a master is leaving the slide, whatever comes next. */
const SHARED_ART = new Set(["layout", "layouts", "slideMaster", "slideMasters"]);

/** Members that take an id and hand back exactly that one thing. */
const BY_ID = new Set(["getItem", "getItemOrNullObject"]);

function collectionWalks(code: string, level: PptxEditScope["level"]): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(COLLECTION_ACCESS)) {
    const collection = match[1] ?? match[2];
    const member = match[3];
    if (SHARED_ART.has(collection)) {
      found.push(`${collection}.${member ?? "*"}`);
      continue;
    }
    if (collection === "shapes" && level === "slide") continue;
    if (member !== undefined && BY_ID.has(member)) continue;
    found.push(`${collection}.${member ?? "*"}`);
  }
  for (const match of code.matchAll(DESTRUCTURED_COLLECTION)) {
    const collection = match[1];
    if (collection === "shapes" && level === "slide") continue;
    found.push(`{ ${collection} }`);
  }
  return unique(found);
}

/**
 * The `slides` walks in a plan, judged without a scope.
 *
 * For the case where there is no scope to judge against: the user quoted
 * something, it could not be placed, and the edit fell back to the whole deck.
 * That fallback is the pre-fix behaviour exactly, so the one question worth
 * asking is whether the plan is about to rewrite the deck — `getItem("s3")` is
 * a pinpoint edit and interrupting it would be noise, while `slides.load` under
 * a quote nobody could place is the original bug happening again.
 */
export function enumeratesWholeDeck(source: string): string[] {
  const { code } = scanSource(source);
  return collectionWalks(code, undefined).filter(
    (entry) => entry.startsWith("slides.") || entry === "{ slides }",
  );
}

/**
 * Word-ish containment, so `"s1"` is a hit inside `"slide s1"` but not `"s10"`.
 *
 * Containment is only offered to ids of four characters or more. A deck whose
 * shape ids are short numbers ("257") otherwise collides with ordinary prose —
 * "Revenue was $257" would be read as naming a shape — and the cost of that is
 * a confirmation on an edit that never left its scope. An exact match is always
 * a hit, whatever the length, which is the form an id takes in the only place
 * that matters: `getItem("s2")`.
 */
const CONTAINMENT_MIN_ID = 4;

function mentionsId(literal: string, id: string): boolean {
  if (literal === id) return true;
  if (id.length < CONTAINMENT_MIN_ID) return false;
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^A-Za-z0-9_-])${escaped}([^A-Za-z0-9_-]|$)`).test(literal);
}

/**
 * Does this plan stay inside the scope it was given?
 *
 * Defence in depth, and the only layer that is not a prompt. Two nets, because
 * there are two ways out of a scope: name something else by id, or never use an
 * id at all and walk the deck. A script can only reach a slide it was not given
 * through one of them.
 *
 * Only known ids count. An id the snapshot never contained cannot be checked
 * against the deck, and the Go planner already refuses invented ids; flagging
 * every unfamiliar string would make the guard fire on summaries and labels.
 */
export function auditPlanScope(
  source: string,
  before: PresentationEditorContext,
  scope: PptxEditScope,
): PptxScopeBreach | null {
  if (scope.kind !== "selection") return null;
  const { code, literals } = scanSource(source);
  const allowed = new Set([...scope.slideIds, ...scope.shapeIds]);
  const known: string[] = [];
  for (const slide of before.slides ?? []) {
    known.push(slide.id);
    for (const shape of slide.shapes ?? []) known.push(shape.id);
  }
  const ids = unique(
    known.filter((id) => !allowed.has(id) && literals.some((literal) => mentionsId(literal, id))),
  );
  const enumerations = collectionWalks(code, scope.level);
  if (ids.length === 0 && enumerations.length === 0) return null;
  return { ids, enumerations };
}

/** "1 slide" / "3 slides", in the reader's language. `noun` is a key stem: shape, slide or id. */
const count = (n: number, noun: "shape" | "slide" | "id"): string =>
  translate(`shell.edit.scope.${noun}${n === 1 ? "One" : "Many"}`, { count: n });

/**
 * The question to put to the user, in numbers they can check against what they did.
 *
 * "The planner was not confident" is not what happened and would teach the user
 * to click through. What happened is that they selected one thing and the plan
 * covers more, so that is the sentence — with the ids and the walk named, since
 * the whole failure mode is a change that looked local and was not.
 */
export function describeScopeBreach(breach: PptxScopeBreach, scope: PptxEditScope): string {
  const picked =
    scope.level === "shape"
      ? translate("shell.edit.scope.shapesOnSlides", {
          shapes: count(scope.shapeIds.length, "shape"),
          slides: count(scope.slideIds.length, "slide"),
        })
      : count(scope.slideIds.length, "slide");
  const reaches: string[] = [];
  if (breach.ids.length > 0) {
    reaches.push(
      translate("shell.edit.scope.namesOutside", {
        ids: count(breach.ids.length, "id"),
        list: breach.ids.slice(0, 5).join(", "),
      }),
    );
  }
  if (breach.enumerations.length > 0) {
    reaches.push(
      translate("shell.edit.scope.reachesUngiven", { list: breach.enumerations.slice(0, 3).join(", ") }),
    );
  }
  return translate("shell.edit.scope.breach", {
    reaches: reaches.join(translate("shell.edit.scope.and")),
    picked,
  });
}

/**
 * The question for the other dangerous outcome: a quote nobody could place.
 *
 * The scope could not be derived, so the edit fell back to the whole deck —
 * which is the pre-fix behaviour, and the pre-fix bug, reached through a door
 * marked "no match". The user is the only one who can say whether that is what
 * they meant, and they can only answer if the app admits both halves: the quote
 * was not found, and the plan covers everything.
 */
export function describeUnlocatedQuote(scope: PptxEditScope, slideCount: number): string {
  const quoted = scope.quotedText ?? "";
  const shown = quoted.length > 80 ? `${quoted.slice(0, 80)}…` : quoted;
  return translate("shell.edit.scope.unlocated", { quote: shown, slides: count(slideCount, "slide") });
}
