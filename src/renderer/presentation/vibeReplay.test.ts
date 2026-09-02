import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const readDrawingAsset = vi.fn(async (_assetsDir: string, digest: string) => ({
  digest,
  contentType: "image/jpeg",
  base64: `bytes-of-${digest}`,
}));
const captureTimelineNode = vi.fn(async (input: { slide: number }) => ({
  id: `n${input.slide}`,
  kind: "generation",
  label: `第 ${input.slide} 页完成`,
  createdAt: "2026-08-20T12:00:00Z",
}));
vi.mock("../bridge", () => ({
  officecli: {
    readDrawingAsset: (...args: [string, string]) => readDrawingAsset(...args),
    captureTimelineNode: (input: { slide: number }) => captureTimelineNode(input),
  },
}));

beforeEach(() => {
  readDrawingAsset.mockClear();
  captureTimelineNode.mockClear();
  captureTimelineNode.mockImplementation(async (input: { slide: number }) => ({
    id: `n${input.slide}`,
    kind: "generation",
    label: `第 ${input.slide} 页完成`,
    createdAt: "2026-08-20T12:00:00Z",
  }));
});
import type { VibeOp, VibeOpShape } from "../../shared/types";
import { VibeReplaySequencer, applyReslideOps, buildOpsChunkScript, buildReplayFeed, registerLiveDraft, releaseLiveDraft } from "./vibeReplay";
import type { PresentationEditorController } from "./PresentationEditorFrame";

const liveSequencers = new Set<VibeReplaySequencer>();

function makeSequencer(options: ConstructorParameters<typeof VibeReplaySequencer>[0]) {
  const sequencer = new VibeReplaySequencer(options);
  liveSequencers.add(sequencer);
  return sequencer;
}

afterEach(() => {
  for (const sequencer of liveSequencers) sequencer.dispose();
  liveSequencers.clear();
});

/** Builds a well-formed op stream for `slides` slides with two shapes each. */
function opStream(slides: number): VibeOp[] {
  const ops: VibeOp[] = [];
  let seq = 0;
  ops.push({ seq: ++seq, op: "deck.begin", slides, fonts: { latin: "Aptos", cjk: "Noto Sans CJK SC" } });
  for (let n = 1; n <= slides; n += 1) {
    ops.push({ seq: ++seq, op: "slide.begin", slide: n, composition: "grid", background: "#F6F8FB" });
    ops.push({ seq: ++seq, op: "shape.add", slide: n, shape: { kind: "rect", role: "card", left: 40, top: 120, width: 300, height: 160, fill: "#FFFFFF", line: "#D7DEEA", weight: 1, rounded: true } });
    ops.push({ seq: ++seq, op: "shape.add", slide: n, shape: { kind: "text", role: "title", left: 40, top: 60, width: 500, height: 48, text: `第 ${n} 页`, size: 36, color: "#0F172A", bold: true } });
    ops.push({ seq: ++seq, op: "slide.end", slide: n });
  }
  ops.push({ seq: ++seq, op: "deck.end", slides });
  return ops;
}

interface FakeShape {
  kind: string;
  name?: string;
  text?: string;
  left?: number;
  [key: string]: unknown;
}

/**
 * Minimal stand-in for the editor's Office.js surface, enough to actually run
 * the generated chunk scripts. Executing them for real is the point: the
 * mapping bugs worth catching here (a shape with no slide to land on) look
 * like a clean run to any mock that only records the source.
 */
const PICTURE_DIGEST = "a".repeat(64);

/** A one-slide stream whose picture op names real bytes in the asset pool. */
function pictureStream(digest = PICTURE_DIGEST): VibeOp[] {
  return [
    { seq: 1, op: "deck.begin", slides: 1, fonts: { latin: "Aptos", cjk: "Noto Sans CJK SC" }, assetsDir: "/ws/deck/.mop-assets" },
    { seq: 2, op: "slide.begin", slide: 1, composition: "cover-full-bleed", background: "#FFFFFF" },
    { seq: 3, op: "shape.add", slide: 1, shape: { kind: "picture", left: 0, top: 0, width: 480, height: 270, imageRef: { kind: "primary", mimeType: "image/jpeg", digest } } },
    { seq: 4, op: "shape.add", slide: 1, shape: { kind: "picture", left: 0, top: 280, width: 480, height: 270, imageRef: { kind: "visual", visualIndex: 1, mimeType: "image/jpeg", digest } } },
    { seq: 5, op: "slide.end", slide: 1 },
    { seq: 6, op: "deck.end", slides: 1 },
  ];
}

function fakePowerPoint({ attention = true, refuseVeils = false }: { attention?: boolean; refuseVeils?: boolean } = {}) {
  let rejectNextSync: string | null = null;
  const deck: Array<{ id: string; background?: string; shapes: FakeShape[] }> = [];
  const selected: string[] = [];
  /** Interleaved record of outlines and shapes, in the order they happened. */
  const timeline: string[] = [];
  const addShape = (slideIndex: number, shape: FakeShape) => {
    const stored: FakeShape = {
      ...shape,
      fill: {
        clear: () => {},
        setSolidColor: (color: string) => { stored.fillColor = color; },
        setImage: (base64: string) => { stored.image = base64; },
        // Property writes are queued and fail at the next sync, so a host that
        // lacks the capability rejects there — not at the assignment.
        set transparency(value: number) {
          stored.transparency = value;
          if (refuseVeils) rejectNextSync = "ShapeFill.transparency is not implemented by the MOP host";
        },
        get transparency() {
          return Number(stored.transparency ?? 0);
        },
      },
      lineFormat: {},
      textFrame: {
        textRange: {
          paragraphFormat: {},
          font: {},
          // Records every value the script writes, so the typing is inspectable.
          set text(value: string) {
            stored.text = value;
            (stored.typed as string[]).push(value);
            timeline.push(`type@${shape.left}`);
          },
          get text() {
            return String(stored.text ?? "");
          },
        },
      },
      typed: shape.kind === "text" ? [String(shape.text ?? "")] : [],
    };
    deck[slideIndex].shapes.push(stored);
    timeline.push(`shape@${shape.left},${shape.top}`);
    return stored;
  };
  const slideAt = (index: number) => ({
    get id() {
      return deck[index].id;
    },
    load: () => {},
    delete: () => {
      deck.splice(index, 1);
    },
    background: { fill: { setSolidFill: ({ color }: { color: string }) => { deck[index].background = color; } } },
    shapes: {
      addTextBox: (text: string, options: Record<string, unknown>) => addShape(index, { kind: "text", text, ...options }),
      addGeometricShape: (preset: string, options: Record<string, unknown>) => addShape(index, { kind: preset, ...options }),
      addDiagram: (layoutId: string, options: Record<string, unknown>) => addShape(index, { kind: "diagram", layoutId, ...options }),
      // slide.replace enumerates and deletes: expose the stored shapes as
      // deletable items, the way the editor host does.
      load: () => {},
      get items() {
        return deck[index].shapes.map((shape) => ({
          delete: () => {
            const at = deck[index].shapes.indexOf(shape);
            if (at >= 0) deck[index].shapes.splice(at, 1);
          },
        }));
      },
    },
  });
  const context = {
    presentation: {
      slides: {
        getCount: () => ({ get value() { return deck.length; } }),
        add: () => deck.push({ id: `s${deck.length + 1}`, shapes: [] }),
        getItemAt: (index: number) => slideAt(index),
      },
      setSelectedSlides: (ids: string[]) => selected.push(...ids),
      ...(attention
        ? {
            focusAttention: (rect: { left: number; top: number } | null) =>
              timeline.push(rect ? `focus@${rect.left},${rect.top}` : "focus@none"),
          }
        : {}),
    },
    sync: async () => {
      if (!rejectNextSync) return;
      const message = rejectNextSync;
      rejectNextSync = null;
      throw new Error(message);
    },
  };
  return {
    deck,
    selected,
    timeline,
    runtime: { run: (callback: (ctx: typeof context) => unknown) => callback(context) },
  };
}

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (body: string) => () => Promise<unknown>;

async function runChunkScript(source: string, powerPoint: ReturnType<typeof fakePowerPoint>) {
  const host = globalThis as unknown as { PowerPoint?: unknown };
  const previous = host.PowerPoint;
  host.PowerPoint = powerPoint.runtime;
  // The editor's own encoder, which the script asks for a copy of the document
  // after each shape lands.
  const editorWindow = window as unknown as { __presentationEmbeddedDocument?: unknown };
  editorWindow.__presentationEmbeddedDocument = {
    version: 3,
    encode: () => JSON.stringify({ shapes: powerPoint.deck.flatMap((slide) => slide.shapes.length) }),
  };
  try {
    return await new AsyncFunction(source)();
  } finally {
    host.PowerPoint = previous;
    delete editorWindow.__presentationEmbeddedDocument;
  }
}

function fakeController(options: { session?: boolean } = {}) {
  const executed: string[] = [];
  const powerPoint = fakePowerPoint();
  const saved = vi.fn(async () => ({ filePath: "/tmp/live.pptx", revision: 1 }));
  const controller: PresentationEditorController = {
    executeScript: vi.fn(async (source: string) => {
      executed.push(source);
      if (!source.includes("PowerPoint.run")) return { result: true } as never;
      return { result: await runChunkScript(source, powerPoint) } as never;
    }),
    inspect: vi.fn(),
    save: saved,
    session: options.session === false ? undefined : () => ({ previewToken: "tok", sessionId: "sess" }),
  } as never;
  return { controller, executed, saved, powerPoint };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("buildOpsChunkScript", () => {
  it("embeds the ops and mirrors the worker's drawing mapping", () => {
    const ops = opStream(1);
    const source = buildOpsChunkScript(ops, { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" }, 0);
    expect(source).toContain('"op":"slide.begin"');
    expect(source).toContain("PowerPoint.run");
    expect(source).toContain("setSelectedSlides");
    expect(source).toContain("addTextBox");
    expect(source).toContain("addGeometricShape");
    expect(source).toContain("addDiagram");
    // Pictures have no bytes on this channel: they must render as placeholders,
    // never attempt an image API.
    const withPicture = buildOpsChunkScript(
      [{ seq: 1, op: "shape.add", slide: 1, shape: { kind: "picture", left: 0, top: 0, width: 10, height: 10, imageRef: { kind: "primary" } } }],
      { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" },
      0,
    );
    expect(withPicture).toContain("image-placeholder-live");
    expect(withPicture).not.toContain("base64");
    // The CJK/Latin font split from the deck design system rides along.
    expect(source).toContain("Noto Sans CJK SC");
  });

  it("replays a native SmartArt operation through the diagram surface", async () => {
    const ops: VibeOp[] = [
      { seq: 1, op: "slide.begin", slide: 1, composition: "smartart", background: "#FFFFFF" },
      { seq: 2, op: "diagram.add", slide: 1, diagram: { layoutId: "urn:microsoft.com/office/officeart/2005/8/layout/target1", nodes: ["产品", "设计", "工程"] } },
      { seq: 3, op: "slide.end", slide: 1 },
    ];
    const powerPoint = fakePowerPoint();
    const outcome = await runChunkScript(
      buildOpsChunkScript(ops, { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" }, 0),
      powerPoint,
    ) as { executed: number; skipped: number };
    expect(outcome).toMatchObject({ executed: 1, skipped: 0 });
    expect(powerPoint.deck[0].shapes[0]).toMatchObject({ kind: "diagram", layoutId: "urn:microsoft.com/office/officeart/2005/8/layout/target1" });
  });

  it("is plain JavaScript, whatever the file it is written in allows", () => {
    // The script is a string built inside a TypeScript file and compiled by the
    // editor with new AsyncFunction. Nothing TypeScript-only can survive that,
    // and a single stray annotation takes the whole drawing down with
    // "Unexpected identifier" — so parse it the way the editor will.
    const source = buildOpsChunkScript(
      [
        ...opStream(1),
        { seq: 99, op: "shape.add", slide: 1, shape: { kind: "rect", left: 0, top: 0, width: 10, height: 10, fill: "#FFFFFF", transparency: 0.4 } },
        ...pictureStream(),
      ],
      { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" },
      0,
    );
    expect(() => new AsyncFunction(source)).not.toThrow();
  });

  it("draws a chunk that starts mid-slide, with no slide.begin of its own", async () => {
    // Chunks are cut on op count, so most of them carry only shape.add ops and
    // must resolve their target slide themselves.
    const ops = opStream(2).filter((op) => op.op === "shape.add" && op.slide === 2);
    expect(ops).toHaveLength(2);
    const powerPoint = fakePowerPoint();
    const outcome = (await runChunkScript(
      buildOpsChunkScript(ops, { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" }, 0),
      powerPoint,
    )) as { executed: number; skipped: number };

    // Unpaced (nobody watching): the text lands whole with its box — zero
    // incremental writes.
    expect(outcome).toMatchObject({ executed: 2, skipped: 0, typed: 0, captures: [] });
    // Slide 2 exists, is the active one, and holds both shapes.
    expect(powerPoint.deck).toHaveLength(2);
    expect(powerPoint.deck[0].shapes).toHaveLength(0);
    expect(powerPoint.deck[1].shapes.map((shape) => shape.kind)).toEqual(["RoundRectangle", "text"]);
    expect(powerPoint.selected.at(-1)).toBe("s2");
  });

  it("outlines where each shape will land before drawing it, and lets go at the end", async () => {
    // The outline has to lead: it marks empty space, the shape appears inside
    // it, then it moves on. An outline that trailed the shape would just be
    // pointing at work already done.
    const powerPoint = fakePowerPoint();
    await runChunkScript(
      buildOpsChunkScript(opStream(2), { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" }, 0),
      powerPoint,
    );

    const timeline = powerPoint.timeline.filter((entry) => !entry.startsWith("type@"));
    expect(timeline).toEqual([
      // Slide 1: both shapes start together, so the outline marks the area they
      // share before either exists, and is released when the page is done.
      // Unpaced typing lands in one write, so no mid-word re-assert is needed.
      "focus@40,60",
      "shape@40,120",
      "shape@40,60",
      "focus@none",
      // Slide 2, same rhythm.
      "focus@40,60",
      "shape@40,120",
      "shape@40,60",
      "focus@none",
      // And the deck ends with nothing outlined.
      "focus@none",
    ]);
  });

  it("types text in growing slices instead of pasting it whole", async () => {
    const line = "石墨文档：更轻松的在线协作文档，适合团队一起写";
    const powerPoint = fakePowerPoint();
    // Paced: someone is watching. Sleeps are stubbed so the test runs at full
    // speed while the script still takes the paced code path.
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((callback: () => void) =>
      realSetTimeout(callback, 0)) as never;
    try {
      await runChunkScript(
        buildOpsChunkScript(
          [
            { seq: 1, op: "slide.begin", slide: 1 },
            { seq: 2, op: "shape.add", slide: 1, shape: { kind: "text", role: "title", text: line, left: 40, top: 60, width: 500, height: 48, size: 30, color: "#0F172A", bold: true } },
          ],
          { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" },
        ),
        powerPoint,
      );
    } finally {
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
    }

    const typed = powerPoint.deck[0].shapes[0].typed as string[];
    // The line grows over several slices — sized by the measured editor round
    // trip rather than one per character — from a partial start to the whole.
    expect(typed.length).toBeGreaterThanOrEqual(4);
    expect(typed.at(-1)).toBe(line);
    expect(typed.every((value, index) => index === 0 || value.startsWith(typed[index - 1]))).toBe(true);
    expect(typed.every((value) => line.startsWith(value))).toBe(true);
    // The box is on screen from the first characters, not created at the end.
    expect(typed[0].length).toBeGreaterThan(0);
    expect(typed[0].length).toBeLessThan(line.length);
    // Formatting survives every rewrite, so the text never flashes unstyled.
    const { font } = (powerPoint.deck[0].shapes[0].textFrame as { textRange: { font: unknown } }).textRange;
    expect(font).toMatchObject({ size: 30, bold: true, color: "#0F172A" });
  });

  it("pastes text whole on an unpaced catch-up", async () => {
    const line = "石墨文档：更轻松的在线协作文档，适合团队一起写";
    const powerPoint = fakePowerPoint();
    await runChunkScript(
      buildOpsChunkScript(
        [
          { seq: 1, op: "slide.begin", slide: 1 },
          { seq: 2, op: "shape.add", slide: 1, shape: { kind: "text", role: "title", text: line, left: 40, top: 60, width: 500, height: 48 } },
        ],
        { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" },
        0,
      ),
      powerPoint,
    );
    const typed = powerPoint.deck[0].shapes[0].typed as string[];
    // Nobody is watching: one write, no typing performance, no wasted trips.
    expect(typed).toEqual([line]);
  });

  it("types at an uneven speed, and rests where the sentence rests", async () => {
    const delaysFor = async (text: string) => {
      const delays: number[] = [];
      const realSetTimeout = globalThis.setTimeout;
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((callback: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        return realSetTimeout(callback, 0);
      }) as never;
      try {
        await runChunkScript(
          buildOpsChunkScript(
            [
              { seq: 1, op: "slide.begin", slide: 1 },
              { seq: 2, op: "shape.add", slide: 1, shape: { kind: "text", text, left: 40, top: 60, width: 500, height: 48 } },
            ],
            { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" },
            120,
          ),
          fakePowerPoint(),
        );
      } finally {
        (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
      }
      // Typing beats are the short ones; the structural pauses are far longer.
      return delays.filter((ms) => ms < 120);
    };

    const typing = await delaysFor("石墨文档是一个非常容易上手的在线协作工具适合团队使用");
    expect(typing.length).toBeGreaterThan(4);
    expect(new Set(typing).size).toBeGreaterThan(3);

    // Same length, but written as clauses: the rests at the punctuation make
    // the whole line take longer than the one that runs on without a break.
    const clauses = await delaysFor("石墨文档，是一个，非常容易上手的，在线协作工具，适合团队");
    const total = (values: number[]) => values.reduce((sum, ms) => sum + ms, 0);
    expect(total(clauses)).toBeGreaterThan(total(typing));
  });

  it("paces the drawing unevenly, and not at all when nobody is watching", async () => {
    // Records what the script actually asks to wait for, rather than waiting.
    const runWithClock = async (source: string) => {
      const delays: number[] = [];
      const realSetTimeout = globalThis.setTimeout;
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((callback: () => void, ms?: number) => {
        delays.push(ms ?? 0);
        return realSetTimeout(callback, 0);
      }) as never;
      try {
        await runChunkScript(source, fakePowerPoint());
      } finally {
        (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
      }
      return delays;
    };
    const fonts = { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" };

    const paced = await runWithClock(buildOpsChunkScript(opStream(2), fonts, 120));
    expect(paced.length).toBeGreaterThan(6);
    // A single repeated interval is a metronome; the beats have to differ.
    expect(new Set(paced).size).toBeGreaterThan(3);
    // Two scales live here: the quick beat between typed characters — fast
    // enough to read as streaming — and the slower structural beats around
    // shapes and pages. Both stay inside a band a viewer would call "steady".
    expect(Math.min(...paced)).toBeGreaterThan(3);
    expect(Math.max(...paced)).toBeLessThan(700);
    // The same deck replays with the same rhythm — demos are reproducible.
    expect(await runWithClock(buildOpsChunkScript(opStream(2), fonts, 120))).toEqual(paced);

    // Unpaced: no waiting at all.
    expect(await runWithClock(buildOpsChunkScript(opStream(2), fonts, 0))).toEqual([]);
  });

  it("keeps drawing when the editor refuses translucent fills, and stops asking", async () => {
    // The refusal arrives at sync, which fails the whole batch — so the veil
    // must never share a round trip with the shapes it would take down.
    const powerPoint = fakePowerPoint({ refuseVeils: true });
    const veil = (seq: number) => ({
      seq,
      op: "shape.add" as const,
      slide: 1,
      shape: { kind: "rect" as const, left: seq * 10, top: 20, width: 80, height: 40, fill: "#000000", transparency: 0.4 },
    });
    const outcome = (await runChunkScript(
      buildOpsChunkScript(
        [{ seq: 1, op: "slide.begin", slide: 1 }, veil(2), veil(3)],
        { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" },
        0,
      ),
      powerPoint,
    )) as { executed: number; veilsUnsupported: boolean };

    // Both shapes are on the page, opaque, and the editor was asked once.
    expect(outcome.executed).toBe(2);
    expect(outcome.veilsUnsupported).toBe(true);
    expect(powerPoint.deck[0].shapes.map((shape) => shape.fillColor)).toEqual(["#000000", "#000000"]);
  });

  it("writes a group of shapes at the same time, not one after another", async () => {
    // A page filled strictly one shape after another reads like a queue being
    // served. Several growing at once reads like someone laying out a page.
    const lines = ["甲甲甲甲", "乙乙乙乙", "丙丙丙丙", "丁丁丁丁"];
    const ops: VibeOp[] = [
      { seq: 1, op: "slide.begin", slide: 1 },
      ...lines.map((text, index) => ({
        seq: index + 2,
        op: "shape.add" as const,
        slide: 1,
        shape: { kind: "text" as const, text, left: index * 100, top: 40, width: 90, height: 30 },
      })),
    ];
    const powerPoint = fakePowerPoint();
    // Paced: interleaved growth is a performance trait; a catch-up writes each
    // line whole. Sleeps are stubbed so the test stays fast.
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((callback: () => void) =>
      realSetTimeout(callback, 0)) as never;
    try {
      await runChunkScript(
        buildOpsChunkScript(ops, { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" }),
        powerPoint,
      );
    } finally {
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
    }

    const typing = powerPoint.timeline.filter((entry) => entry.startsWith("type@"));
    // Three to five start together, so the writes cycle between shapes rather
    // than finishing one before the next begins.
    const concurrent = new Set(typing.slice(0, 3)).size;
    expect(concurrent).toBeGreaterThan(1);
    // Whatever the grouping, every line still ends up whole.
    const written = powerPoint.deck[0].shapes.map((shape) => shape.text);
    expect(written).toEqual(lines);
  });

  it("draws the deck even when the editor has no attention outline to offer", async () => {
    // An editor without focusAttention still has to get its deck drawn.
    const powerPoint = fakePowerPoint({ attention: false });
    const outcome = (await runChunkScript(
      buildOpsChunkScript(opStream(1), { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" }, 0),
      powerPoint,
    )) as { executed: number };

    expect(outcome.executed).toBe(2);
    expect(powerPoint.timeline.filter((entry) => !entry.startsWith("type@"))).toEqual([
      "shape@40,120",
      "shape@40,60",
    ]);
  });

  it("accounts for every shape.add, including the ones it declines to draw", async () => {
    const powerPoint = fakePowerPoint();
    const outcome = await runChunkScript(
      buildOpsChunkScript(
        [
          { seq: 1, op: "slide.begin", slide: 1, background: "#FFFFFF" },
          { seq: 2, op: "shape.add", slide: 1, shape: { kind: "text", text: "   ", left: 0, top: 0, width: 10, height: 10 } },
          // A shape kind this build has no mapping for, as a newer worker would send.
          { seq: 3, op: "shape.add", slide: 1, shape: { kind: "sparkline" as VibeOpShape["kind"], left: 0, top: 0, width: 10, height: 10 } },
        ],
        { fontLatin: "Aptos", fontCJK: "Noto Sans CJK SC" },
        0,
      ),
      powerPoint,
    );
    expect(outcome).toMatchObject({ executed: 0, skipped: 2, typed: 0, captures: [] });
    expect(powerPoint.deck[0].background).toBe("#FFFFFF");
  });
});

describe("VibeReplaySequencer", () => {
  it("executes streamed ops in seq order exactly once, then saves on completion", async () => {
    const { controller, executed, saved, powerPoint } = fakeController();
    const statuses: string[] = [];
    const sequencer = makeSequencer({ controller, paceMs: 0, onStatus: (s) => statuses.push(s.state) });
    const ops = opStream(3);

    // First frames arrive, then the full stream repeats them (history replay).
    sequencer.update({ taskId: "t1", ops: ops.slice(0, 6), completed: false });
    await flush();
    sequencer.update({ taskId: "t1", ops, completed: false });
    await flush();
    await flush();
    const drawChunks = executed.filter((source) => source.includes("PowerPoint.run"));
    expect(drawChunks.length).toBeGreaterThanOrEqual(3);
    // Every shape op landed exactly once, on its own slide, in order — chunks
    // are cut on op count, so most of them carry no slide.begin.
    expect(powerPoint.deck.map((slide) => slide.shapes.map((shape) => shape.kind))).toEqual([
      ["RoundRectangle", "text"],
      ["RoundRectangle", "text"],
      ["RoundRectangle", "text"],
    ]);
    expect(powerPoint.deck.map((slide) => slide.shapes[1].text)).toEqual(["第 1 页", "第 2 页", "第 3 页"]);
    expect(saved).not.toHaveBeenCalled();

    sequencer.update({ taskId: "t1", ops, completed: true });
    await flush();
    await flush();
    // Journal flush script (default snapshot wait) precedes the export.
    expect(executed.at(-1)).toBe("return true;");
    expect(saved).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("done");
    expect(statuses).toContain("saving");
  });

  it("resumes from what the draft already holds instead of drawing it again", async () => {
    // A viewer remounts whenever its preview token is reissued — reopening the
    // task, a reload, an editor restart. The draft on disk already carries the
    // slides the previous sequencer drew and saved, so replaying that prefix
    // stacked a second copy of every object onto the deck.
    const filePath = "/live/live-resume-1.pptx";
    registerLiveDraft(filePath, "t-resume");
    const ops = opStream(2);

    const first = fakeController();
    const one = makeSequencer({ controller: first.controller, paceMs: 0 });
    one.update({ taskId: "t-resume", filePath, ops, completed: true });
    await flush();
    await flush();
    expect(first.saved).toHaveBeenCalledTimes(1);
    expect(first.powerPoint.deck.flatMap((slide) => slide.shapes).length).toBe(4);

    // The same document, reopened: the editor imports the saved deck, so the
    // fake starts empty here only because it is a fresh surface — what matters
    // is that the stream is not executed a second time.
    const second = fakeController();
    const two = makeSequencer({ controller: second.controller, paceMs: 0 });
    two.update({ taskId: "t-resume", filePath, ops, completed: true });
    await flush();
    await flush();
    expect(second.executed.filter((source) => source.includes("PowerPoint.run"))).toHaveLength(0);
    expect(second.powerPoint.deck).toHaveLength(0);

    releaseLiveDraft(filePath);
  });

  it("refuses a second task's stream rather than blending it into this drawing", async () => {
    // Two tasks number their ops from 1 independently. Accepting the new feed
    // kept executing the old task's ops while dropping the new task's ops of
    // the same seq as duplicates — one deck built out of two runs.
    const { controller, executed } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 0 });
    sequencer.update({ taskId: "t-first", ops: opStream(1), completed: false });
    await flush();
    const drawn = executed.length;

    const other = opStream(1).map((op) => (
      op.op === "shape.add" && op.shape?.kind === "text"
        ? { ...op, shape: { ...op.shape, text: "another task" } }
        : op
    ));
    sequencer.update({ taskId: "t-second", ops: other, completed: true });
    await flush();
    await flush();
    expect(executed.length).toBe(drawn);
    expect(executed.join("\n")).not.toContain("another task");
  });

  it("never executes past a gap in the seq order", async () => {
    const { controller, executed } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 0 });
    const ops = opStream(2);
    // Deliver a stream with a hole: seq 4 missing.
    sequencer.update({ taskId: "t1", ops: ops.filter((op) => op.seq !== 4), completed: false });
    await flush();
    const before = executed.length;
    expect(executed.join("\n")).not.toContain("第 2 页");
    // The hole fills in; execution resumes and reaches slide 2.
    sequencer.update({ taskId: "t1", ops, completed: false });
    await flush();
    await flush();
    expect(executed.length).toBeGreaterThan(before);
    expect(executed.join("\n")).toContain("第 2 页");
  });

  it("reports failure and stops when a chunk throws", async () => {
    const { controller } = fakeController();
    (controller.executeScript as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("editor gone"));
    const statuses: Array<{ state: string; error?: string }> = [];
    const sequencer = makeSequencer({ controller, paceMs: 0, onStatus: (s) => statuses.push(s) });
    sequencer.update({ taskId: "t1", ops: opStream(1), completed: true });
    await flush();
    await flush();
    expect(statuses.at(-1)?.state).toBe("failed");
    expect(statuses.at(-1)?.error).toContain("editor gone");
    sequencer.update({ taskId: "t1", ops: opStream(2), completed: true });
    await flush();
    expect(controller.executeScript).toHaveBeenCalledTimes(1);
  });

  it("does not save when nothing was drawn", async () => {
    const { controller, saved } = fakeController();
    const statuses: string[] = [];
    const sequencer = makeSequencer({ controller, paceMs: 0, onStatus: (s) => statuses.push(s.state) });
    sequencer.update({ taskId: "t1", ops: [], completed: true });
    await flush();
    expect(saved).not.toHaveBeenCalled();
    expect(statuses.at(-1)).toBe("done");
  });
});

describe("trace mode", () => {
  it("announces each op before executing, one op per chunk", async () => {
    const { controller, executed } = fakeController();
    const announced: number[] = [];
    const sequencer = makeSequencer({
      controller,
      paceMs: 0,
      onOp: (op) => announced.push(op.seq),
    });
    const ops = opStream(2);
    sequencer.update({ taskId: "t1", ops, completed: true, trace: true });
    await flush();
    await flush();
    await flush();
    // Every op announced exactly once, in seq order.
    expect(announced).toEqual(ops.map((op) => op.seq));
    // Shapes that start together share a script, so tracing costs fewer scripts
    // than there are ops — the announcements stay one per op regardless.
    const drawScripts = executed.filter((source) => source.includes("PowerPoint.run"));
    const drawable = ops.filter((op) => op.op === "shape.add" || op.op === "slide.begin").length;
    expect(drawScripts.length).toBeGreaterThan(0);
    expect(drawScripts.length).toBeLessThan(drawable);
  });

  it("lands every shape even though each op executes in its own script", async () => {
    // One op per chunk means every shape.add arrives without the slide.begin
    // that preceded it — the demo's exact shape, and where shapes used to be
    // dropped onto an empty deck without a word.
    const { controller, powerPoint } = fakeController();
    const statuses: string[] = [];
    const sequencer = makeSequencer({ controller, paceMs: 0, onStatus: (s) => statuses.push(s.state) });
    sequencer.update({ taskId: "t1", ops: opStream(3), completed: true, trace: true });
    for (let tick = 0; tick < 6; tick += 1) await flush();

    expect(statuses.at(-1)).toBe("done");
    expect(powerPoint.deck).toHaveLength(3);
    for (const slide of powerPoint.deck) {
      expect(slide.shapes.map((shape) => shape.kind)).toEqual(["RoundRectangle", "text"]);
      expect(slide.background).toBe("#F6F8FB");
    }
    expect(powerPoint.deck.map((slide) => slide.shapes[1].text)).toEqual(["第 1 页", "第 2 页", "第 3 页"]);
  });
});

describe("picture ops", () => {
  it("paints the real image when the pool resolves its digest", async () => {
    const { controller, powerPoint } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 0 });
    sequencer.update({ taskId: "t1", ops: pictureStream(), completed: true });
    for (let tick = 0; tick < 6; tick += 1) await flush();

    const shapes = powerPoint.deck[0].shapes;
    expect(shapes.map((shape) => shape.image)).toEqual([`bytes-of-${PICTURE_DIGEST}`, `bytes-of-${PICTURE_DIGEST}`]);
    expect(shapes.every((shape) => shape.fillColor === undefined)).toBe(true);
    // One image used twice costs one fetch: bytes are cached by digest.
    expect(readDrawingAsset).toHaveBeenCalledTimes(1);
    expect(readDrawingAsset).toHaveBeenCalledWith("/ws/deck/.mop-assets", PICTURE_DIGEST);
  });

  it("keeps the placeholder panel when the bytes cannot be resolved", async () => {
    readDrawingAsset.mockRejectedValueOnce(new Error("pool is gone"));
    const { controller, powerPoint } = fakeController();
    const statuses: string[] = [];
    const sequencer = makeSequencer({ controller, paceMs: 0, onStatus: (s) => statuses.push(s.state) });
    sequencer.update({ taskId: "t1", ops: pictureStream(), completed: true });
    for (let tick = 0; tick < 6; tick += 1) await flush();

    // A missing image holds its place rather than failing the whole drawing,
    // and the failed digest is not retried for the second op that uses it.
    const shapes = powerPoint.deck[0].shapes;
    expect(shapes.map((shape) => shape.fillColor)).toEqual(["#EDF1F7", "#EDF1F7"]);
    expect(readDrawingAsset).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe("done");
  });

  it("does not reach for the pool when a deck has no pictures", async () => {
    const { controller } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 0 });
    sequencer.update({ taskId: "t1", ops: opStream(2), completed: true });
    for (let tick = 0; tick < 6; tick += 1) await flush();
    expect(readDrawingAsset).not.toHaveBeenCalled();
  });
});

describe("performance", () => {
  /** Reads the pace the generated chunk script was built with. */
  function paceOf(source: string): number {
    return Number(/const PACE_MS = (\d+);/.exec(source)?.[1] ?? -1);
  }

  it("performs the writing while the generation is still producing it", async () => {
    const { controller, executed } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 90 });
    // The stream is still open: this is the one showing worth watching.
    sequencer.update({ taskId: "t1", ops: opStream(1).slice(0, 3), completed: false });
    for (let tick = 0; tick < 4; tick += 1) await flush();

    expect(paceOf(executed.find((source) => source.includes("PowerPoint.run")) ?? "")).toBe(90);
  });

  it("keeps performing after the task it is following completes", async () => {
    const { controller, executed } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 90 });
    sequencer.update({ taskId: "t1", ops: opStream(2).slice(0, 3), completed: false });
    for (let tick = 0; tick < 4; tick += 1) await flush();
    // The rest of the stream arrives with the task already finished; a drawing
    // in progress must not change speed halfway through.
    sequencer.update({ taskId: "t1", ops: opStream(2), completed: true });
    for (let tick = 0; tick < 8; tick += 1) await flush();

    const paces = executed.filter((source) => source.includes("PowerPoint.run")).map(paceOf);
    expect(new Set(paces)).toEqual(new Set([90]));
  });

  it("replays a finished stream at full speed instead of acting it out", async () => {
    const { controller, executed, powerPoint } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 90 });
    // Nothing here is news: scrubbing, redrawing and the console demo all
    // replay a stream that already exists, and want the state, not a show.
    sequencer.update({ taskId: "t1", ops: opStream(2), completed: true });
    for (let tick = 0; tick < 8; tick += 1) await flush();

    const paces = executed.filter((source) => source.includes("PowerPoint.run")).map(paceOf);
    expect(new Set(paces)).toEqual(new Set([0]));
    // Still draws the whole deck, just without the pauses.
    expect(powerPoint.deck).toHaveLength(2);
  });
});

describe("timeline capture", () => {
  it("records a step for every shape, named by what it put on the page", async () => {
    const { controller } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 0 });
    sequencer.update({ taskId: "task-7", ops: opStream(2), completed: false });
    for (let tick = 0; tick < 8; tick += 1) await flush();

    const recorded = captureTimelineNode.mock.calls.map(([input]) => input as unknown as Record<string, unknown>);
    // Two shapes on each of two slides: four steps, one per shape, in order.
    expect(recorded.map((step) => [step.slide, step.label])).toEqual([
      [1, "Slide 1 · card"],
      [1, "Slide 1 · 第 1 页"],
      [2, "Slide 2 · card"],
      [2, "Slide 2 · 第 2 页"],
    ]);
    expect(recorded[0]).toMatchObject({
      taskId: "task-7", previewToken: "tok", sessionId: "sess", kind: "generation", slides: 2,
    });
    // The document travels with the step, so recording costs no save.
    expect(String(recorded[0].content ?? "").length).toBeGreaterThan(0);
    expect(recorded.every((step) => step.withAssets === false)).toBe(true);
    // Each step names the object it added, so returning to it can select it.
    expect(recorded.map((step) => step.shape)).toEqual([
      "card-live-3", "title-live-4", "card-live-7", "title-live-8",
    ]);
  });

  it("records a replay too: the draft it draws into started blank", async () => {
    const { controller } = fakeController();
    const sequencer = makeSequencer({ controller, paceMs: 0 });
    // A replay redraws the deck from nothing, so the history it produces is
    // the deck's history. Skipping it would leave the reset draft with none.
    sequencer.update({ taskId: "task-7", ops: opStream(2), completed: true });
    for (let tick = 0; tick < 8; tick += 1) await flush();
    expect(captureTimelineNode.mock.calls.map(([input]) => input.slide)).toEqual([1, 1, 2, 2]);
  });

  it("keeps drawing when the timeline cannot record", async () => {
    captureTimelineNode.mockRejectedValue(new Error("disk is full"));
    const { controller, powerPoint } = fakeController();
    const statuses: string[] = [];
    const sequencer = makeSequencer({ controller, paceMs: 0, onStatus: (s) => statuses.push(s.state) });
    // Live while it draws, finished by the time it drains: a recording failure
    // must not stop either.
    sequencer.update({ taskId: "task-7", ops: opStream(3).slice(0, 4), completed: false });
    for (let tick = 0; tick < 6; tick += 1) await flush();
    sequencer.update({ taskId: "task-7", ops: opStream(3), completed: true });
    for (let tick = 0; tick < 10; tick += 1) await flush();

    // A deck that fails to record its history is still a deck.
    expect(statuses.at(-1)).toBe("done");
    expect(powerPoint.deck).toHaveLength(3);
    // And the failure is not retried on every slide.
    expect(captureTimelineNode).toHaveBeenCalledTimes(1);
  });

  it("records nothing when there is no editor session to read", async () => {
    const { controller } = fakeController({ session: false });
    const sequencer = makeSequencer({ controller, paceMs: 0 });
    sequencer.update({ taskId: "task-7", ops: opStream(2), completed: true });
    for (let tick = 0; tick < 8; tick += 1) await flush();
    expect(captureTimelineNode).not.toHaveBeenCalled();
  });
});

describe("slide.replace", () => {
  it("clears the page before redrawing, and applyReslideOps renumbers a continued stream", async () => {
    const { controller, powerPoint } = fakeController();
    // First, draw a two-slide deck the ordinary way.
    const sequencer = makeSequencer({ controller: controller as unknown as PresentationEditorController, paceMs: 0 });
    sequencer.update({ taskId: "t1", ops: opStream(2), completed: true });
    for (let tick = 0; tick < 20; tick += 1) await flush();
    sequencer.dispose();
    expect(powerPoint.deck[1].shapes.length).toBeGreaterThan(0);
    const survivor = powerPoint.deck[0].shapes.length;

    // Then apply a reslide of slide 2: ops numbered as the deck's stream
    // continuation (post-watermark), with a slide.replace opening.
    const replaceOps: VibeOp[] = [
      { seq: 101, op: "deck.begin", slides: 2, branchId: "main" } as VibeOp,
      { seq: 102, op: "slide.replace", slide: 2, composition: "process", branchId: "main" } as VibeOp,
      { seq: 103, op: "shape.add", slide: 2, shape: { kind: "rect", role: "card", left: 40, top: 40, width: 200, height: 90, fill: "#FFFFFF", rounded: true } as VibeOpShape, branchId: "main" } as VibeOp,
      { seq: 104, op: "slide.end", slide: 2, branchId: "main" } as VibeOp,
      { seq: 105, op: "deck.end", branchId: "main" } as VibeOp,
    ];
    const done = applyReslideOps(controller as unknown as PresentationEditorController, { taskId: "t1", ops: replaceOps });
    for (let tick = 0; tick < 30; tick += 1) await flush();
    await done;
    // Slide 2 holds exactly the new composition's shape; slide 1 untouched.
    expect(powerPoint.deck[1].shapes.map((shape) => shape.kind)).toEqual(["RoundRectangle"]);
    expect(powerPoint.deck[0].shapes.length).toBe(survivor);
  });
});

describe("slide.delete", () => {
  it("shrinks the deck when a tail redo removed pages", async () => {
    const { controller, powerPoint } = fakeController();
    const sequencer = makeSequencer({ controller: controller as unknown as PresentationEditorController, paceMs: 0 });
    sequencer.update({ taskId: "t1", ops: opStream(3), completed: true });
    for (let tick = 0; tick < 25; tick += 1) await flush();
    sequencer.dispose();
    expect(powerPoint.deck.length).toBe(3);

    const ops: VibeOp[] = [
      { seq: 200, op: "deck.begin", slides: 2, branchId: "main" } as VibeOp,
      { seq: 201, op: "slide.replace", slide: 2, branchId: "main" } as VibeOp,
      { seq: 202, op: "shape.add", slide: 2, shape: { kind: "rect", role: "card", left: 40, top: 40, width: 200, height: 90, fill: "#FFFFFF" } as VibeOpShape, branchId: "main" } as VibeOp,
      { seq: 203, op: "slide.end", slide: 2, branchId: "main" } as VibeOp,
      { seq: 204, op: "slide.delete", slide: 3, branchId: "main" } as VibeOp,
      { seq: 205, op: "deck.end", branchId: "main" } as VibeOp,
    ];
    const done = applyReslideOps(controller as unknown as PresentationEditorController, { taskId: "t1", ops });
    for (let tick = 0; tick < 40; tick += 1) await flush();
    await done;
    expect(powerPoint.deck.length).toBe(2);
    expect(powerPoint.deck[1].shapes.map((shape) => shape.kind)).toEqual(["Rectangle"]);
  });
});

describe("buildReplayFeed", () => {
  const ops = opStream(1);
  const finished = { status: "completed", vibeOps: ops };
  const draft = { filePath: "/live/live-t1-1.pptx", taskId: "t1", drawnSeq: 0 };

  it("performs a console replay whether it replays a recording or a finished task", () => {
    // Both are "complete" streams; both are being watched on purpose.
    expect(buildReplayFeed({ draft, ops, performing: true, trace: true })).toMatchObject({
      completed: true,
      perform: true,
    });
    expect(buildReplayFeed({ draft, performing: true, trace: true, task: finished })).toMatchObject({
      completed: true,
      perform: true,
    });
  });

  it("names the draft it draws into, so a remount can resume instead of redraw", () => {
    expect(buildReplayFeed({ draft, performing: true, trace: false, task: finished })).toMatchObject({
      taskId: "t1",
      filePath: "/live/live-t1-1.pptx",
    });
  });

  it("carries the outline gate only while the run is paused on it", () => {
    const paused = { status: "question", vibeOps: [], question: { id: "pptx-outline-gate", kind: "pptx_outline_gate" } };
    expect(buildReplayFeed({ draft, performing: false, trace: false, task: paused })).toMatchObject({
      gate: { questionId: "pptx-outline-gate" },
    });
    // A plain clarification question is not the gate.
    const plain = { status: "question", vibeOps: [], question: { id: "question-1" } };
    expect(buildReplayFeed({ draft, performing: false, trace: false, task: plain })?.gate).toBeUndefined();
    // A finished task cannot be gated, whatever stale question it carries.
    const done = { status: "completed", vibeOps: ops, question: { id: "pptx-outline-gate", kind: "pptx_outline_gate" } };
    expect(buildReplayFeed({ draft, performing: false, trace: false, task: done })?.gate).toBeUndefined();
  });

  it("catches up on history nobody asked to watch", () => {
    // Opening an old conversation replays its ops into the draft; that is
    // history, and it should be there immediately.
    expect(buildReplayFeed({ draft, performing: false, trace: false, task: finished })).toMatchObject({
      completed: true,
      perform: undefined,
    });
  });

  it("leaves a running generation alone: still arriving, so already a performance", () => {
    const live = buildReplayFeed({
      draft,
      performing: false,
      trace: false,
      task: { status: "running", vibeOps: ops },
    });
    expect(live).toMatchObject({ completed: false, perform: undefined });
  });

  it("has nothing to feed for a draft whose task this session never saw", () => {
    expect(buildReplayFeed({ draft, performing: true, trace: true })).toBeUndefined();
  });
});

describe("performance pace", () => {
  const delaysDuring = async (feed: Parameters<VibeReplaySequencer["update"]>[0]) => {
    const delays: number[] = [];
    const realSetTimeout = globalThis.setTimeout;
    (globalThis as unknown as { setTimeout: unknown }).setTimeout = ((callback: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      return realSetTimeout(callback, 0);
    }) as never;
    try {
      const { controller } = fakeController();
      const sequencer = makeSequencer({ controller });
      sequencer.update(feed);
      for (let tick = 0; tick < 8; tick += 1) await new Promise((r) => realSetTimeout(r, 0));
    } finally {
      (globalThis as unknown as { setTimeout: unknown }).setTimeout = realSetTimeout;
    }
    return delays.filter((ms) => ms > 0);
  };

  it("catches up on finished history quickly, but performs a recording", async () => {
    const ops = opStream(1);
    // History arriving after the fact: no one is watching it happen.
    expect(await delaysDuring({ taskId: "t1", ops, completed: true })).toEqual([]);
    // The same stream, replayed on purpose to be watched.
    const performed = await delaysDuring({ taskId: "t1", ops, completed: true, perform: true });
    expect(performed.length).toBeGreaterThan(4);
    expect(Math.max(...performed)).toBeGreaterThan(30);
  });
});

describe("chunk accounting", () => {
  it("fails the replay when a chunk cannot place the shapes it was given", async () => {
    const { controller } = fakeController();
    // A script that reports fewer shapes than the chunk asked for must stop the
    // replay rather than leave a half-drawn deck looking finished.
    (controller.executeScript as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ result: { executed: 0, skipped: 0 } });
    const statuses: Array<{ state: string; error?: string }> = [];
    const sequencer = makeSequencer({ controller, paceMs: 0, onStatus: (s) => statuses.push(s) });
    sequencer.update({ taskId: "t1", ops: opStream(1), completed: true });
    await flush();
    await flush();
    expect(statuses.at(-1)?.state).toBe("failed");
    expect(statuses.at(-1)?.error).toContain("of 2 shapes");
  });
});
