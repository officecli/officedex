import { describe, expect, it, vi } from "vitest";

import type { DesktopAPI, PlanPptxJSResult } from "../shared/types";
import type { PresentationEditorContext } from "../shared/presentationInspect";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { createPptxEditRunner } from "./pptxEditRun";
import {
  auditPlanScope,
  describeScopeBreach,
  enumeratesWholeDeck,
  resolveEditScope,
  scanSource,
  type PptxPlannerContext,
} from "./pptxEditScope";

/**
 * Editing the open deck in place.
 *
 * The bug this exists to prevent is a routing one, and it cannot be seen from
 * here: the shell sent deck instructions to the generation runtime, which
 * re-authored the whole deck instead of changing slide 3. What is tested here
 * is the other half — that once an instruction *is* routed here, it goes to the
 * deck's own planner, runs inside the editor, and lands the reader on the slide
 * that changed.
 */

function slide(id: string, index: number, title: string) {
  return {
    id,
    index,
    shapes: [
      {
        id: `${id}-shape`,
        name: "Title",
        type: "TextBox",
        left: 10,
        top: 10,
        width: 100,
        height: 40,
        text: title,
      },
    ],
  };
}

const beforeDeck: PresentationEditorContext = {
  slides: [slide("s1", 0, "Why We Win"), slide("s2", 1, "Agenda"), slide("s3", 2, "Next Steps")],
  selectedSlideIds: ["s1"],
  selectedShapes: [],
};

/** The same deck with slide three's title changed. */
const afterDeck: PresentationEditorContext = {
  slides: [slide("s1", 0, "Why We Win"), slide("s2", 1, "Agenda"), slide("s3", 2, "Hello World")],
  selectedSlideIds: ["s1"],
  selectedShapes: [],
};

function plan(overrides: Partial<PlanPptxJSResult> = {}): PlanPptxJSResult {
  return {
    summary: "Renamed slide 3 to Hello World.",
    source: "return await PowerPoint.run(async (context) => { await context.sync(); });",
    confidence: "high",
    ...overrides,
  };
}

interface Harness {
  readonly runner: ReturnType<typeof createPptxEditRunner>;
  readonly executed: string[];
  readonly planned: { prompt: string; context: PptxPlannerContext }[];
  readonly inspects: number;
  readonly saves: number;
}

function harness(options: {
  plan?: PlanPptxJSResult;
  decks?: PresentationEditorContext[];
  planRejects?: Error;
  saveRejects?: Error;
}): Harness {
  const executed: string[] = [];
  const planned: { prompt: string; context: PptxPlannerContext }[] = [];
  const decks = options.decks ?? [beforeDeck, afterDeck];
  let inspects = 0;
  let saves = 0;
  const controller = {
    executeScript: async (source: string) => {
      executed.push(source);
      return { result: undefined, snapshotSaved: false };
    },
    inspect: async () => {
      const deck = decks[Math.min(inspects, decks.length - 1)];
      inspects += 1;
      return deck;
    },
    save: async () => {
      saves += 1;
      if (options.saveRejects) throw options.saveRejects;
      return { filePath: "/tmp/deck.pptx", revision: 1 };
    },
    session: () => ({ previewToken: "token", sessionId: "session" }),
    swapDocument: async () => 1,
  } as unknown as PresentationEditorController;

  const api = {
    planPptxJS: async (input: { prompt: string; context: PptxPlannerContext }) => {
      planned.push(input);
      if (options.planRejects) throw options.planRejects;
      return options.plan ?? plan();
    },
  } as unknown as DesktopAPI;

  return {
    runner: createPptxEditRunner({ api, controller, filePath: "/tmp/deck.pptx" }),
    executed,
    planned,
    get inspects() {
      return inspects;
    },
    get saves() {
      return saves;
    },
  };
}

const request = (overrides: Partial<Parameters<ReturnType<typeof createPptxEditRunner>>[0]> = {}) => ({
  instruction: "Change slide 3's title to Hello World",
  preferSelection: false,
  ...overrides,
});

describe("editing the open deck in place", () => {
  it("applies the planned script and reports the slides it changed", async () => {
    const h = harness({});
    const result = await h.runner(request());

    expect(h.executed[0]).toContain("PowerPoint.run");
    expect(result.applied).toBe(1);
    expect(result.summary).toContain("Hello World");
    expect(result.saveError).toBeNull();
    expect(h.saves).toBe(1);
  });

  /*
   * The point of the whole path: the reader ends up on the slide that changed.
   *
   * "Change the second slide's title" while sitting on the fifth otherwise
   * happens off-screen and reads as nothing having happened. That is the
   * behaviour asked for explicitly — same as legacy.
   */
  it("moves the editor to the slide the edit landed on", async () => {
    const h = harness({});
    await h.runner(request());

    const select = h.executed.find((source) => source.includes("setSelectedSlides"));
    expect(select, "no slide was focused after the edit").toBeDefined();
    expect(select).toContain('"s3"');
  });

  it("does not move the reader when the view is already on the changed slide", async () => {
    const h = harness({
      decks: [
        { ...beforeDeck, selectedSlideIds: ["s3"] },
        { ...afterDeck, selectedSlideIds: ["s3"] },
      ],
    });
    await h.runner(request());
    expect(h.executed.some((source) => source.includes("setSelectedSlides"))).toBe(false);
  });

  /*
   * Nothing changed is an answer, not a failure — and it must not be written.
   *
   * Saving here would push an unchanged deck through a PPTX export for no
   * reason, and a failure in that export would be reported as a failure of the
   * edit.
   */
  it("reports no change without saving when nothing moved", async () => {
    const h = harness({ decks: [beforeDeck, beforeDeck] });
    const result = await h.runner(request());

    expect(result.applied).toBe(0);
    expect(h.saves).toBe(0);
  });

  /*
   * A plan the planner flagged is asked about: applied on a yes, and on a no it
   * is an answer rather than a failure.
   *
   * This used to be an outright refusal, which was a dead end — the panel
   * showed the planner's caution as a sentence with nothing to press, so an
   * explicit instruction ended in a message the user could not act on. It still
   * must not apply unasked: that is the one outcome worse than asking.
   */
  it("asks before applying a confirmation-seeking plan, and applies on a yes", async () => {
    const asked: { text: string }[] = [];
    const h = harness({
      plan: plan({
        requires_confirmation: true,
        confirmation: { message: "This changes a dozen text runs. Continue?" },
      }),
    });
    const result = await h.runner(
      request({
        onConfirm: async (question) => {
          asked.push(question);
          return true;
        },
      }),
    );

    expect(asked).toHaveLength(1);
    expect(asked[0]?.text).toContain("dozen text runs");
    expect(result.applied).toBe(1);
    expect(h.executed.length).toBeGreaterThan(0);
  });

  it("changes nothing when the user declines", async () => {
    const h = harness({
      plan: plan({ confidence: "low", summary: "Which slide did you mean?" }),
    });
    const result = await h.runner(request({ onConfirm: async () => false }));

    expect(result.applied).toBe(0);
    expect(result.summary).toMatch(/cancel/i);
    expect(h.executed).toHaveLength(0);
    expect(h.saves).toBe(0);
  });

  it("refuses a flagged plan when there is nowhere to ask", async () => {
    // The old behaviour, kept for a caller that cannot put the question up:
    // better to refuse than to apply something the planner wanted checked.
    const h = harness({
      plan: plan({
        requires_confirmation: true,
        confirmation: { message: "This deletes a slide. Confirm." },
      }),
    });
    await expect(h.runner(request())).rejects.toThrow(/deletes a slide/i);
    expect(h.executed).toHaveLength(0);
  });

  it("rejects a plan with no script", async () => {
    const h = harness({ plan: plan({ source: "   " }) });
    await expect(h.runner(request())).rejects.toThrow(/could not run/i);
    expect(h.executed).toHaveLength(0);
  });

  /*
   * The change has landed but the file did not take it, and those are two
   * different states. Collapsing them into a failure would tell the user
   * nothing changed while the deck on screen visibly had.
   */
  it("reports a save failure as data, not as a failed edit", async () => {
    const h = harness({ saveRejects: new Error("disk is full") });
    const result = await h.runner(request());

    expect(result.applied).toBe(1);
    expect(result.saveError).toBe("disk is full");
  });

  it("stops before executing when the instruction is abandoned", async () => {
    const h = harness({});
    const controller = new AbortController();
    controller.abort();
    await expect(h.runner(request({ signal: controller.signal }))).rejects.toThrow(/stopped/i);
    expect(h.executed).toHaveLength(0);
    expect(h.saves).toBe(0);
  });

  it("refuses an empty instruction", async () => {
    const h = harness({});
    await expect(h.runner(request({ instruction: "  " }))).rejects.toThrow(/no instruction/i);
    expect(h.inspects).toBe(0);
  });
});

describe("the planner call", () => {
  it("is handed the deck as the planner should see it", async () => {
    const seen: unknown[] = [];
    const controller = {
      executeScript: async () => ({ result: undefined, snapshotSaved: false }),
      inspect: async () => beforeDeck,
      save: async () => ({ filePath: "/tmp/deck.pptx", revision: 1 }),
      session: () => ({ previewToken: "t", sessionId: "s" }),
      swapDocument: async () => 1,
    } as unknown as PresentationEditorController;
    const api = {
      planPptxJS: async (input: { prompt: string; context: unknown }) => {
        seen.push(input);
        return plan();
      },
    } as unknown as DesktopAPI;

    const runner = createPptxEditRunner({ api, controller });
    await runner(request({ instruction: "Rename slide 3" }));

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ prompt: "Rename slide 3", context: beforeDeck });
  });

  it("surfaces a planner failure instead of applying nothing quietly", async () => {
    const h = harness({ planRejects: new Error("model unavailable") });
    await expect(h.runner(request())).rejects.toThrow(/model unavailable/);
    expect(h.executed).toHaveLength(0);
  });
});

/*
 * The reported bug, and the whole reason `pptxEditScope` exists.
 *
 * A user selected one title on one slide and said "make it Japanese". Every
 * text run in a ten-slide deck came back translated, because the selection was
 * never sent: the planner got the whole deck plus one sentence, and against a
 * whole deck that sentence means the whole deck.
 *
 * What is pinned below is the fix in both halves — the planner is told the
 * boundary *and* handed only what is inside it, so a whole-deck script is not
 * merely discouraged but unwriteable from the ids it was given.
 */

function textShape(id: string, name: string, text: string) {
  return { id, name, type: "TextBox", left: 10, top: 10, width: 100, height: 40, text };
}

const scopedDeck: PresentationEditorContext = {
  slides: [
    {
      id: "s1",
      index: 0,
      shapes: [
        textShape("s1-title", "Title", "Why We Win"),
        textShape("s1-body", "Body", "Because we ship"),
      ],
    },
    { id: "s2", index: 1, shapes: [textShape("s2-title", "Title", "Agenda")] },
    { id: "s3", index: 2, shapes: [textShape("s3-title", "Title", "Next Steps")] },
  ],
  selectedSlideIds: [],
  selectedShapes: [],
};

const picked = (overrides: Partial<PresentationEditorContext>): PresentationEditorContext => ({
  ...scopedDeck,
  ...overrides,
});

/** The same deck after the selected title was translated. */
const scopedAfter = (deck: PresentationEditorContext): PresentationEditorContext => ({
  ...deck,
  slides: deck.slides.map((slide) =>
    slide.id === "s1"
      ? { ...slide, shapes: slide.shapes.map((shape) => ({ ...shape, text: "私たちが勝つ理由" })) }
      : slide,
  ),
});

/** What a "translate the whole deck" plan looks like, by id and by walk. */
const wholeDeckByIds = plan({
  summary: "Translated all 3 slides.",
  source:
    'return await PowerPoint.run(async (context) => {\n' +
    '  for (const id of ["s1", "s2", "s3"]) {\n' +
    '    context.presentation.slides.getItem(id).shapes.getItem(id + "-title").textFrame.textRange.text = "日本語";\n' +
    "  }\n" +
    "  await context.sync();\n" +
    "});",
});

const wholeDeckByWalk = plan({
  summary: "Translated every slide.",
  source:
    "return await PowerPoint.run(async (context) => {\n" +
    '  const slides = context.presentation.slides.load("items/id");\n' +
    "  await context.sync();\n" +
    "  for (const slide of slides.items) slide.shapes.load(\"items/id\");\n" +
    "  await context.sync();\n" +
    "});",
});

describe("the selection is the scope", () => {
  it("narrows the planner to the selected shape", async () => {
    const deck = picked({
      selectedSlideIds: ["s1"],
      selectedShapes: [{ id: "s1-title", name: "Title", type: "TextBox" }],
    });
    const h = harness({ decks: [deck, scopedAfter(deck)] });
    const result = await h.runner(
      request({
        instruction: "Change it to Japanese",
        preferSelection: true,
        selection: { label: "deck.pptx · Title", text: "Why We Win" },
      }),
    );

    const { prompt, context } = h.planned[0];
    expect(context.scope).toMatchObject({
      kind: "selection",
      level: "shape",
      slideIds: ["s1"],
      shapeIds: ["s1-title"],
    });
    // The other slides are not merely discouraged — they are not in the deck
    // the planner was handed, ids and all.
    expect(context.slides.map((slide) => slide.id)).toEqual(["s1"]);
    expect(context.slides[0].shapes.map((shape) => shape.id)).toEqual(["s1-title"]);
    expect(context.slides[0]).toMatchObject({ id: "s1", index: 0 });
    expect(context.slides[0].shapes[0]).toMatchObject({
      id: "s1-title",
      name: "Title",
      type: "TextBox",
      left: 10,
      top: 10,
      width: 100,
      height: 40,
      text: "Why We Win",
    });
    expect(prompt).toContain("SCOPE LOCK");
    expect(prompt).toContain("Do not modify, add, delete, reorder or restyle");
    expect(prompt).toContain("Change it to Japanese");
    expect(result.scope).toBe("selection");
  });

  it("scopes to the selected slide when no shape was picked", async () => {
    const deck = picked({ selectedSlideIds: ["s2"], selectedShapes: [] });
    const h = harness({ decks: [deck, deck] });
    await h.runner(request({ preferSelection: true, selection: { text: "" } }));

    const { context } = h.planned[0];
    expect(context.scope).toMatchObject({ kind: "selection", level: "slide", slideIds: ["s2"] });
    // A slide pick is a pick of everything on it, so its shapes all survive.
    expect(context.slides.map((slide) => slide.id)).toEqual(["s2"]);
    expect(context.slides[0].shapes).toHaveLength(1);
  });

  it("finds the shape from the quoted text when the editor reports no selection", async () => {
    const h = harness({ decks: [scopedDeck, scopedDeck] });
    await h.runner(
      request({ preferSelection: true, selection: { text: "  Because we ship \n" } }),
    );

    expect(h.planned[0].context.scope).toMatchObject({
      kind: "selection",
      level: "shape",
      slideIds: ["s1"],
      shapeIds: ["s1-body"],
      quotedText: "Because we ship",
    });
  });

  it("keeps the whole deck when the quote fits more than one shape", async () => {
    const twins = picked({
      slides: [
        { id: "s1", index: 0, shapes: [textShape("s1-title", "Title", "Agenda")] },
        { id: "s2", index: 1, shapes: [textShape("s2-title", "Title", "Agenda")] },
      ],
    });
    const h = harness({ decks: [twins, twins] });
    await h.runner(request({ preferSelection: true, selection: { text: "Agenda" } }));

    expect(h.planned[0].context.scope).toMatchObject({ kind: "document" });
    expect(h.planned[0].context.slides).toHaveLength(2);
  });

  it("keeps the whole deck when the quote fits nothing", async () => {
    const h = harness({ decks: [scopedDeck, scopedDeck] });
    await h.runner(request({ preferSelection: true, selection: { text: "Quarterly revenue" } }));

    expect(h.planned[0].context.scope).toMatchObject({ kind: "document" });
    expect(h.planned[0].context.slides).toHaveLength(3);
  });

  /*
   * No regression for the unscoped path: without a reference the planner sees
   * exactly what it saw before scoping existed — the whole deck, and the bare
   * instruction with nothing prepended.
   */
  it("hands over the whole deck and the bare instruction without a reference", async () => {
    const h = harness({ decks: [scopedDeck, scopedDeck] });
    await h.runner(request({ instruction: "Rename slide 3", preferSelection: false }));

    const { prompt, context } = h.planned[0];
    expect(prompt).toBe("Rename slide 3");
    expect(context.slides).toEqual(scopedDeck.slides);
    expect(context.scope).toMatchObject({ kind: "document" });
  });
});

describe("a plan that leaves the scope", () => {
  const selected = picked({
    selectedSlideIds: ["s1"],
    selectedShapes: [{ id: "s1-title", name: "Title", type: "TextBox" }],
  });

  const scopedRequest = (
    overrides: Partial<Parameters<ReturnType<typeof createPptxEditRunner>>[0]> = {},
  ) =>
    request({
      instruction: "Change it to Japanese",
      preferSelection: true,
      selection: { label: "deck.pptx · Title", text: "Why We Win" },
      ...overrides,
    });

  for (const [shape, whole] of [
    ["by naming other slides", wholeDeckByIds],
    ["by walking the deck", wholeDeckByWalk],
  ] as const) {
    it(`asks before applying a plan that reaches past the selection ${shape}`, async () => {
      const asked: { text: string }[] = [];
      const h = harness({ plan: whole, decks: [selected, scopedAfter(selected)] });
      const result = await h.runner(
        scopedRequest({
          onConfirm: async (question) => {
            asked.push(question);
            return false;
          },
        }),
      );

      expect(asked).toHaveLength(1);
      expect(asked[0].text).toMatch(/reaches past your selection/i);
      expect(h.executed).toHaveLength(0);
      expect(result.applied).toBe(0);
      expect(h.saves).toBe(0);
    });
  }

  it("applies the same plan once the user says yes", async () => {
    const h = harness({ plan: wholeDeckByIds, decks: [selected, scopedAfter(selected)] });
    const result = await h.runner(scopedRequest({ onConfirm: async () => true }));

    expect(h.executed[0]).toContain("PowerPoint.run");
    expect(result.applied).toBe(1);
    // It was approved, but it landed where the selection was, so saying so is
    // the true thing.
    expect(result.scope).toBe("selection");
  });

  /*
   * And when the approved plan really does change the rest of the deck, the
   * result says *document* — whatever the request asked for.
   *
   * The card's wording comes from this field, so reporting the requested scope
   * here would read "10 changes made to what you selected" on the exact path
   * this file exists to fix: a whole-deck plan the user was warned about and
   * waved through. Worse than the original bug, because it is a claim rather
   * than a silence.
   */
  it("reports the scope the edit landed in, not the one it was given", async () => {
    const spread: PresentationEditorContext = {
      ...selected,
      slides: selected.slides.map((slide) =>
        slide.id === "s1" || slide.id === "s2"
          ? { ...slide, shapes: slide.shapes.map((shape) => ({ ...shape, text: "日本語" })) }
          : slide,
      ),
    };
    const h = harness({ plan: wholeDeckByIds, decks: [selected, spread] });
    const result = await h.runner(scopedRequest({ onConfirm: async () => true }));

    expect(result.applied).toBe(2);
    expect(result.scope).toBe("document");
  });

  it("refuses outright when there is nowhere to put the question", async () => {
    const h = harness({ plan: wholeDeckByWalk, decks: [selected, scopedAfter(selected)] });
    await expect(h.runner(scopedRequest())).rejects.toThrow(/reaches past your selection/i);
    expect(h.executed).toHaveLength(0);
  });

  it("leaves an unscoped run alone", async () => {
    // The same whole-deck plan is not a breach when the whole deck was the
    // scope; only the selection case has something to be past.
    const h = harness({ plan: wholeDeckByWalk, decks: [scopedDeck, scopedAfter(scopedDeck)] });
    const result = await h.runner(request({ preferSelection: false }));

    expect(h.executed[0]).toContain("PowerPoint.run");
    expect(result.applied).toBe(1);
    expect(result.scope).toBe("document");
  });
});

/*
 * The guard's rules, tested where they live.
 *
 * These are the only part of the fix that is not a prompt, so they are worth
 * pinning directly rather than through a runner: what counts as a string, what
 * counts as reaching a collection, and which of those a scoped plan is allowed.
 */
describe("the out-of-scope guard", () => {
  const shapeScope = {
    kind: "selection" as const,
    level: "shape" as const,
    slideIds: ["s1"],
    shapeIds: ["s1-title"],
  };

  it("passes a plan that touches only what it was given", () => {
    const source =
      'return await PowerPoint.run(async (context) => {\n' +
      '  const slide = context.presentation.slides.getItem("s1");\n' +
      '  slide.shapes.getItem("s1-title").textFrame.textRange.text = "私たちが勝つ理由";\n' +
      "  await context.sync();\n" +
      "});";
    expect(auditPlanScope(source, scopedDeck, shapeScope)).toBeNull();
  });

  it("catches an id from the deck that was not selected", () => {
    const breach = auditPlanScope('x = "s2-title";', scopedDeck, shapeScope);
    expect(breach?.ids).toEqual(["s2-title"]);
  });

  it("does not mistake a longer id for a shorter one", () => {
    // "s1" is in scope and "s1-title" is the selected shape; neither makes
    // "s1-body" a hit, and a substring match would have claimed all three.
    const breach = auditPlanScope('x = "s1-title";', scopedDeck, shapeScope);
    expect(breach).toBeNull();
  });

  it("catches reaching a collection without an id", () => {
    expect(auditPlanScope("s.slides.items.length;", scopedDeck, shapeScope)?.enumerations).toEqual([
      "slides.items",
    ]);
    expect(auditPlanScope("slide.shapes.load('items/id');", scopedDeck, shapeScope)?.enumerations)
      .toEqual(["shapes.load"]);
    // Positional access is the quiet one: it lands on ids that never appear in
    // the script for the id check to see.
    expect(auditPlanScope("p.slides.getItemAt(4);", scopedDeck, shapeScope)?.enumerations).toEqual([
      "slides.getItemAt",
    ]);
  });

  /*
   * A slide pick is a pick of everything on that slide, so reading its shape
   * collection is an in-scope read. Flagging it would put "this reaches content
   * you did not select" in front of "translate this slide" — a false alarm on
   * the most common selection there is, and the surest way to teach the user
   * that the confirmation is noise.
   */
  it("judges shapes against what was picked", () => {
    const slideScope = { kind: "selection" as const, level: "slide" as const, slideIds: ["s1"], shapeIds: [] };
    expect(auditPlanScope('slide.shapes.addTextBox("hi", {});', scopedDeck, slideScope)).toBeNull();
    expect(auditPlanScope("slide.shapes.items[0];", scopedDeck, slideScope)).toBeNull();
    expect(auditPlanScope("slide.shapes.load('items/id');", scopedDeck, slideScope)).toBeNull();
    expect(auditPlanScope("const shapes = slide.shapes;", scopedDeck, slideScope)).toBeNull();
    // Under a shape pick a sibling is as out of scope as another slide.
    expect(
      auditPlanScope('slide.shapes.addTextBox("hi", {});', scopedDeck, shapeScope)?.enumerations,
    ).toEqual(["shapes.addTextBox"]);
    expect(auditPlanScope("slide.shapes.items[0];", scopedDeck, shapeScope)?.enumerations).toEqual([
      "shapes.items",
    ]);
    // Reaching another slide is the way out whatever was picked, so `slides`
    // stays locked under a slide pick too.
    expect(auditPlanScope('p.slides.load("items/id");', scopedDeck, slideScope)?.enumerations).toEqual(
      ["slides.load"],
    );
  });

  /*
   * `presentation["slides"]` is the same access as `presentation.slides`, and a
   * guard that only knew the dotted spelling would be walked straight past.
   */
  it("reads the bracket spelling of a collection too", () => {
    expect(
      auditPlanScope('context.presentation["slides"].load("items/id");', scopedDeck, shapeScope)
        ?.enumerations,
    ).toEqual(["slides.load"]);
    expect(
      auditPlanScope("context.presentation['shapes'].items;", scopedDeck, shapeScope)?.enumerations,
    ).toEqual(["shapes.items"]);
    expect(
      auditPlanScope('presentation?.["slides"].load("items/id");', scopedDeck, shapeScope)
        ?.enumerations,
    ).toEqual(["slides.load"]);
    // A quoted key is syntax; a quoted sentence is still not code.
    expect(auditPlanScope('const note = "slides.items";', scopedDeck, shapeScope)).toBeNull();
  });

  it("ignores ids that only appear in comments", () => {
    const source = '// touch "s2" later\n/* and "s3" */\nawait context.sync();';
    expect(auditPlanScope(source, scopedDeck, shapeScope)).toBeNull();
  });

  /*
   * Layouts and masters are the hole the slide-level relaxation left.
   *
   * `slide.layout.shapes.getItem("Title 1")` starts from a slide the script is
   * allowed to have and lands on a shape that belongs to every slide using that
   * layout — so "the shapes of the selected slide" was never true of it. The id
   * net cannot help: layout and master shape ids are not in the snapshot at
   * all. Entering is the offence, `getItem` included.
   */
  it("treats layouts and masters as outside every selection", () => {
    const slideScope = { kind: "selection" as const, level: "slide" as const, slideIds: ["s1"], shapeIds: [] };
    for (const scope of [shapeScope, slideScope]) {
      expect(
        auditPlanScope(
          'sl.layout.shapes.getItem("Title 1").textFrame.textRange.text = "JP";',
          scopedDeck,
          scope,
        )?.enumerations,
      ).toEqual(["layout.shapes"]);
      expect(
        auditPlanScope("sl.slideMaster.shapes.getItemAt(0).delete();", scopedDeck, scope)
          ?.enumerations,
      ).toEqual(["slideMaster.shapes"]);
      expect(
        auditPlanScope(
          'context.presentation.slideMasters.getItemAt(0).shapes.getItem("Title 1");',
          scopedDeck,
          scope,
        )?.enumerations,
      ).toEqual(["slideMasters.getItemAt"]);
      expect(auditPlanScope("const l = sl.layout;", scopedDeck, scope)?.enumerations).toEqual([
        "layout.*",
      ]);
    }
  });

  /*
   * `const { slides } = context.presentation` leaves no `.slides` token behind,
   * and the loop after it walks the entire deck. Not a false-positive trade —
   * the same escape, spelled differently.
   */
  it("catches a destructured collection", () => {
    const slideScope = { kind: "selection" as const, level: "slide" as const, slideIds: ["s1"], shapeIds: [] };
    const source =
      "const { slides } = context.presentation;\n" +
      'slides.load("items/id");\n' +
      "await context.sync();";
    expect(auditPlanScope(source, scopedDeck, shapeScope)?.enumerations).toContain("{ slides }");
    expect(auditPlanScope(source, scopedDeck, slideScope)?.enumerations).toContain("{ slides }");
    // Shapes follow the same level rule as the member form: in scope under a
    // slide pick, out of scope under a shape pick.
    expect(auditPlanScope("const { shapes } = slide;", scopedDeck, slideScope)).toBeNull();
    expect(auditPlanScope("const { shapes } = slide;", scopedDeck, shapeScope)?.enumerations).toEqual(
      ["{ shapes }"],
    );
  });

  /*
   * A regex literal containing a quote used to open a string that swallowed the
   * rest of the script — after which the deck walk below it was invisible to
   * both checks. A blind guard passes everything.
   */
  it("is not blinded by a regex literal", () => {
    const source =
      "const q = /\"/g;\n" +
      "for (const s of context.presentation.slides.items) s.delete();";
    expect(auditPlanScope(source, scopedDeck, shapeScope)?.enumerations).toEqual(["slides.items"]);
  });

  it("still reads a division as arithmetic", () => {
    const source = "const half = total / count;\nconst x = s.slides.items;";
    expect(auditPlanScope(source, scopedDeck, shapeScope)?.enumerations).toEqual(["slides.items"]);
    expect(scanSource("const half = total / count;").literals).toEqual([]);
  });

  /*
   * `getItemOrNullObject` takes an id like `getItem` does; flagging it would be
   * noise on a plan that is addressing exactly what it was given.
   */
  it("lets a null-object lookup through", () => {
    expect(
      auditPlanScope('p.slides.getItemOrNullObject("s1").shapes.getItem("s1-title");', scopedDeck, shapeScope),
    ).toBeNull();
  });

  /*
   * Short ids and ordinary prose collide: a deck whose shape ids are numbers
   * would see "Revenue was $257" as naming shape 257. Exact matches always
   * count, which is the form an id takes where it matters — `getItem("257")`.
   */
  it("does not read a short numeric id out of prose", () => {
    const numeric: PresentationEditorContext = {
      slides: [
        { id: "1", index: 0, shapes: [textShape("257", "Body", "Revenue")] },
        { id: "2", index: 1, shapes: [textShape("311", "Body", "Costs")] },
      ],
      selectedSlideIds: [],
      selectedShapes: [],
    };
    const scope = { kind: "selection" as const, level: "shape" as const, slideIds: ["1"], shapeIds: ["257"] };
    expect(
      auditPlanScope('shape.textFrame.textRange.text = "Revenue was $311 in Q2";', numeric, scope),
    ).toBeNull();
    expect(auditPlanScope('s.shapes.getItem("311");', numeric, scope)?.ids).toEqual(["311"]);
  });

  it("never flags a document-scoped plan", () => {
    const scope = { kind: "document" as const, slideIds: [], shapeIds: [] };
    expect(auditPlanScope(wholeDeckByWalk.source, scopedDeck, scope)).toBeNull();
  });

  it("splits comments and strings apart", () => {
    const { code, literals } = scanSource(
      'const a = "hi // there"; // slides.items\nconst b = `x${y.slides.items}`;',
    );
    expect(literals).toContain("hi // there");
    expect(code).not.toContain("hi // there");
    // Template contents stay in the code half so an enumeration hidden in an
    // interpolation is still seen.
    expect(code).toContain("slides.items");
  });

  it("says what the plan would do in numbers the user can check", () => {
    const message = describeScopeBreach(
      { ids: ["s2", "s3"], enumerations: ["slides.items"] },
      shapeScope,
    );
    expect(message).toContain("2 ids outside it (s2, s3)");
    expect(message).toContain("reaches slides or shapes it was not given");
    expect(message).toContain("You selected 1 shape on 1 slide");
  });
});

describe("resolving the scope", () => {
  it("treats a selection the snapshot does not contain as no selection", () => {
    // The chip was captured before the deck moved on. An id the inspect pass
    // never saw is one the plan could not address either, so narrowing to it
    // would drop the instruction on the floor.
    const resolved = resolveEditScope(
      picked({ selectedShapes: [{ id: "ghost", name: "Gone", type: "TextBox" }] }),
      { preferSelection: true },
    );
    expect(resolved).toMatchObject({ scope: { kind: "document" }, basis: "no-selection" });
  });

  it("matches a quote against text the snapshot truncated", () => {
    const long = "A".repeat(500);
    const deck = picked({
      slides: [{ id: "s1", index: 0, shapes: [textShape("s1-title", "Title", long.slice(0, 400))] }],
    });
    const resolved = resolveEditScope(deck, { preferSelection: true, quotedText: long });
    expect(resolved).toMatchObject({ basis: "quoted-text", scope: { shapeIds: ["s1-title"] } });
  });

  it("does not let a short quote claim a longer shape", () => {
    const resolved = resolveEditScope(scopedDeck, { preferSelection: true, quotedText: "Why" });
    expect(resolved).toMatchObject({ scope: { kind: "document" }, basis: "quoted-text-unmatched" });
  });

  it("records which rule decided, for the log", () => {
    expect(resolveEditScope(scopedDeck, { preferSelection: false }).basis).toBe("no-reference");
    expect(
      resolveEditScope(picked({ selectedSlideIds: ["s2"] }), { preferSelection: true }).basis,
    ).toBe("selected-slides");  });

  /*
   * The chip quotes a multi-shape selection as the shapes' texts joined with
   * newlines, while the snapshot holds one text per shape — so the whole-quote
   * comparison could only ever match a single shape, and every multi-shape
   * reference fell through to "unmatched" and took the whole deck with it.
   */
  it("places a multi-shape quote line by line", () => {
    const resolved = resolveEditScope(scopedDeck, {
      preferSelection: true,
      quotedText: "Why We Win\nBecause we ship",
    });
    expect(resolved.basis).toBe("quoted-text");
    expect(resolved.scope).toMatchObject({
      level: "shape",
      shapeIds: ["s1-title", "s1-body"],
      slideIds: ["s1"],
    });
  });

  it("gathers lines across slides, and ignores the ones that match nothing", () => {
    const resolved = resolveEditScope(scopedDeck, {
      preferSelection: true,
      quotedText: "Why We Win\nsomething nobody wrote\nAgenda",
    });
    expect(resolved.scope).toMatchObject({ shapeIds: ["s1-title", "s2-title"], slideIds: ["s1", "s2"] });
  });

  /*
   * One ambiguous line poisons the whole result rather than being dropped: a
   * scope built from "the lines I could place" is not a scope the user
   * described.
   */
  it("falls back when any line of the quote is ambiguous", () => {
    const twins = picked({
      slides: [
        { id: "s1", index: 0, shapes: [textShape("s1-title", "Title", "Why We Win")] },
        { id: "s2", index: 1, shapes: [textShape("s2-title", "Title", "Agenda")] },
        { id: "s3", index: 2, shapes: [textShape("s3-title", "Title", "Agenda")] },
      ],
    });
    const resolved = resolveEditScope(twins, {
      preferSelection: true,
      quotedText: "Why We Win\nAgenda",
    });
    expect(resolved).toMatchObject({ scope: { kind: "document" }, basis: "quoted-text-ambiguous" });
    // The words survive the fallback: the prompt and the gate both need them.
    expect(resolved.scope.quotedText).toBe("Why We Win\nAgenda");
  });
});

/*
 * The fallback path, which is where the original bug lived.
 *
 * A quote that cannot be placed lands on the whole deck — behaviour identical
 * to before any of this existed. That is defensible only if the planner is told
 * a passage was quoted, and only if a plan that then walks every slide has to
 * be approved rather than assumed.
 */
describe("a reference that could not be placed", () => {
  const unlocated = (
    overrides: Partial<Parameters<ReturnType<typeof createPptxEditRunner>>[0]> = {},
  ) =>
    request({
      instruction: "Change it to Japanese",
      preferSelection: true,
      selection: { label: "deck.pptx · Title", text: "A line this deck does not contain" },
      ...overrides,
    });

  it("tells the planner what was quoted even though it could not be found", async () => {
    const h = harness({ decks: [scopedDeck, scopedDeck] });
    await h.runner(unlocated());

    const { prompt, context } = h.planned[0];
    expect(context.scope).toMatchObject({ kind: "document" });
    expect(context.slides).toHaveLength(3);
    expect(prompt).toContain("A line this deck does not contain");
    expect(prompt).toContain("could not be matched");
    expect(prompt).toContain("Change it to Japanese");
  });

  it("asks before running a plan that walks the whole deck", async () => {
    const asked: { text: string; danger?: boolean }[] = [];
    const h = harness({ plan: wholeDeckByWalk, decks: [scopedDeck, scopedAfter(scopedDeck)] });
    const result = await h.runner(
      unlocated({
        onConfirm: async (question) => {
          asked.push(question);
          return false;
        },
      }),
    );

    expect(asked).toHaveLength(1);
    expect(asked[0].text).toMatch(/could not be found in this deck/i);
    expect(asked[0].text).toContain("all 3 slides");
    expect(asked[0].danger).toBe(true);
    expect(h.executed).toHaveLength(0);
    expect(result.applied).toBe(0);
  });

  it("refuses that plan when there is nowhere to ask", async () => {
    const h = harness({ plan: wholeDeckByWalk, decks: [scopedDeck, scopedAfter(scopedDeck)] });
    await expect(h.runner(unlocated())).rejects.toThrow(/could not be found in this deck/i);
    expect(h.executed).toHaveLength(0);
  });

  /*
   * A pinpoint plan is not the bug, and interrupting it would be the kind of
   * noise that teaches people to click through the gate that matters.
   */
  it("does not interrupt a plan that edits one named shape", async () => {
    const pinpoint = plan({
      source:
        'return await PowerPoint.run(async (context) => {\n' +
        '  context.presentation.slides.getItem("s3").shapes.getItem("s3-title").textFrame.textRange.text = "日本語";\n' +
        "  await context.sync();\n" +
        "});",
    });
    const h = harness({ plan: pinpoint, decks: [scopedDeck, scopedAfter(scopedDeck)] });
    const result = await h.runner(unlocated());

    expect(h.executed[0]).toContain("PowerPoint.run");
    expect(result.applied).toBe(1);
  });

  it("marks an out-of-scope question as dangerous too", async () => {
    const asked: { danger?: boolean }[] = [];
    const selected = picked({
      selectedSlideIds: ["s1"],
      selectedShapes: [{ id: "s1-title", name: "Title", type: "TextBox" }],
    });
    const h = harness({ plan: wholeDeckByWalk, decks: [selected, scopedAfter(selected)] });
    await h.runner(
      request({
        preferSelection: true,
        selection: { text: "Why We Win" },
        onConfirm: async (question) => {
          asked.push(question);
          return false;
        },
      }),
    );
    expect(asked[0].danger).toBe(true);
  });

  /*
   * And the planner's own "are you sure" is not marked dangerous: there the app
   * has no reason to doubt the recommendation it is passing on.
   */
  it("leaves an ordinary confirmation unmarked", async () => {
    const asked: { danger?: boolean }[] = [];
    const h = harness({
      plan: plan({ requires_confirmation: true, confirmation: { message: "This touches a dozen runs." } }),
    });
    await h.runner(
      request({
        onConfirm: async (question) => {
          asked.push(question);
          return true;
        },
      }),
    );
    expect(asked[0].danger).toBeUndefined();
  });

  it("only counts deck walks, not any collection access", () => {
    expect(enumeratesWholeDeck('p.slides.getItem("s1").shapes.load("items/id");')).toEqual([]);
    expect(enumeratesWholeDeck('p.slides.load("items/id");')).toEqual(["slides.load"]);
    expect(enumeratesWholeDeck("const { slides } = p;")).toEqual(["{ slides }"]);
  });
});
