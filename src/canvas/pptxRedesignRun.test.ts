import { describe, expect, it, vi } from "vitest";

import type { DesktopAPI, PlanPptxJSResult } from "../shared/types";
import type { PresentationEditorContext } from "../shared/presentationInspect";
import type { PresentationEditorController } from "../renderer/presentation/PresentationEditorFrame";
import { createPptxEditRunner } from "./pptxEditRun";
import { isRedesignInstruction, redesignTargetSlide } from "./pptxRedesignRun";

const EXPORTED = '<svg viewBox="0 0 1280 720"><text data-mop-id="t1" x="80" y="120">标题</text></svg>';
const EDITED = '<svg viewBox="0 0 1280 720"><text data-mop-id="t1" x="200" y="120">标题</text></svg>';

const deck: PresentationEditorContext = {
  slides: [
    { id: "s1", index: 0, shapes: [] },
    { id: "s2", index: 1, shapes: [] },
    { id: "s3", index: 2, shapes: [] },
  ],
  selectedSlideIds: ["s2"],
  selectedShapes: [],
};

interface Lint {
  severity: string;
  rule: string;
  message: string;
}

/** An editor that has the SVG slide surface, with scripted lint verdicts. */
function editor(options: { lint?: Lint[][]; unsupported?: boolean; applied?: Record<string, unknown> } = {}) {
  const scripts: string[] = [];
  const lint = [...(options.lint ?? [[]])];
  const controller = {
    inspect: vi.fn(async () => deck),
    save: vi.fn(async () => ({ filePath: "/tmp/deck.pptx", revision: 2 })),
    executeScript: vi.fn(async (source: string) => {
      scripts.push(source);
      if (source.includes("exportSlide")) {
        return { result: options.unsupported ? { unsupported: true } : { svg: EXPORTED } };
      }
      if (source.includes(".lint(")) return { result: { diagnostics: lint.shift() ?? [] } };
      if (source.includes("importSlide")) {
        return { result: options.applied ?? { applied: true, updated: 1, replaced: 0, added: 0, removed: 0, background: false } };
      }
      return { result: true };
    }),
  } as unknown as PresentationEditorController;
  return { controller, scripts };
}

interface PlanCall {
  prompt: string;
  context: Record<string, unknown>;
}

function planner(answers: Array<Partial<PlanPptxJSResult>>) {
  const queue = [...answers];
  const calls: PlanCall[] = [];
  const planPptxJS = vi.fn(async (input: PlanCall) => {
    calls.push(input);
    return { confidence: "high", warnings: [], ...(queue.shift() ?? {}) } as PlanPptxJSResult;
  });
  return { api: { planPptxJS } as unknown as DesktopAPI, planPptxJS, calls };
}

/** A request with the fields the contract requires and nothing selected. */
const ask = (instruction: string) => ({ instruction, preferSelection: false });

describe("redesign intent", () => {
  it("recognises a request to lay the page out afresh", () => {
    for (const text of ["把这页重新设计一下", "换个版式", "这页改成时间线布局", "Redesign this slide", "重做这页"]) {
      expect(isRedesignInstruction(text), text).toBe(true);
    }
    for (const text of ["把标题改成 Hello", "第二页标题翻译成日文", "make the title bold"]) {
      expect(isRedesignInstruction(text), text).toBe(false);
    }
  });

  it("targets the named page, else the single selected slide", () => {
    expect(redesignTargetSlide(deck, "重新设计第 3 页")).toEqual({ id: "s3", position: 2 });
    expect(redesignTargetSlide(deck, "重新设计这页")).toEqual({ id: "s2", position: 1 });
    expect(redesignTargetSlide({ ...deck, selectedSlideIds: [] }, "重新设计这页")).toBeNull();
    expect(redesignTargetSlide({ ...deck, selectedSlideIds: ["s1", "s2"] }, "重新设计这页")).toBeNull();
    expect(redesignTargetSlide(deck, "重新设计第 9 页")).toBeNull();
  });
});

describe("redesign round trip", () => {
  it("exports the slide, asks for an edited SVG, lints it and imports it by id", async () => {
    const { controller, scripts } = editor();
    const { api, planPptxJS, calls } = planner([{ summary: "改成了两栏", source: EDITED }]);
    const result = await createPptxEditRunner({ api, controller })(ask("把这页重新设计成两栏"));

    expect(planPptxJS).toHaveBeenCalledTimes(1);
    const sent = calls[0];
    expect(sent.context).toMatchObject({ mode: "svg-redesign", svg: EXPORTED });
    expect(sent.prompt).toBe("把这页重新设计成两栏");
    // The selected slide (the second) is the one exported and written back.
    expect(scripts.find((source) => source.includes("exportSlide"))).toContain("exportSlide(2)");
    const applied = scripts.find((source) => source.includes("importSlide"))!;
    expect(applied).toContain("slides.getItemAt(1)");
    expect(applied).toContain(JSON.stringify(EXPORTED));
    expect(applied).toContain(JSON.stringify(EDITED));
    expect(result).toMatchObject({ summary: "改成了两栏", applied: 1, scope: "selection", saveError: null });
    expect(controller.save).toHaveBeenCalledTimes(1);
  });

  it("feeds lint findings back for a rewrite before applying anything", async () => {
    const overflow = { severity: "error", rule: "text.overflow-canvas", message: "文字超出画布 40px。" };
    const { controller, scripts } = editor({ lint: [[overflow], []] });
    const { api, planPptxJS, calls } = planner([{ source: "<svg>第一版</svg>" }, { source: EDITED }]);
    await createPptxEditRunner({ api, controller })(ask("重新设计这页"));

    expect(planPptxJS).toHaveBeenCalledTimes(2);
    const repair = calls[1].context;
    expect(repair.previous_svg).toBe("<svg>第一版</svg>");
    expect(repair.lint_feedback).toContain("text.overflow-canvas");
    expect(scripts.find((source) => source.includes("importSlide"))).toContain(JSON.stringify(EDITED));
  });

  it("refuses a page that still fails the layout check, and leaves the deck alone", async () => {
    const overlap = { severity: "error", rule: "text.overlap", message: "两段文字互相重叠。" };
    const { controller, scripts } = editor({ lint: [[overlap], [overlap], [overlap]] });
    const { api, planPptxJS } = planner([{ source: EDITED }, { source: EDITED }, { source: EDITED }]);
    await expect(createPptxEditRunner({ api, controller })(ask("重新设计这页"))).rejects.toThrow(/两段文字互相重叠/u);
    expect(planPptxJS).toHaveBeenCalledTimes(3);
    expect(scripts.some((source) => source.includes("importSlide"))).toBe(false);
    expect(controller.save).not.toHaveBeenCalled();
  });

  it("keeps a page whose only remaining findings are typographic", async () => {
    const orphan = { severity: "error", rule: "text.orphan", message: "末行只剩一个字。" };
    const { controller, scripts } = editor({ lint: [[orphan], [orphan], [orphan]] });
    const { api } = planner([{ source: EDITED }, { source: EDITED }, { source: EDITED }]);
    const result = await createPptxEditRunner({ api, controller })(ask("重新设计这页"));
    expect(result.applied).toBe(1);
    expect(scripts.some((source) => source.includes("importSlide"))).toBe(true);
  });

  it("falls back to the script path on an editor without the SVG surface", async () => {
    const { controller } = editor({ unsupported: true });
    const { api, calls } = planner([
      { summary: "done", source: "return await PowerPoint.run(async (context) => { await context.sync(); return {}; });" },
    ]);
    await createPptxEditRunner({ api, controller })(ask("重新设计这页"));
    expect(calls[0].context.mode).toBeUndefined();
  });

  it("leaves a small edit on the script path", async () => {
    const { controller, scripts } = editor();
    const { api, calls } = planner([
      { summary: "done", source: "return await PowerPoint.run(async (context) => { await context.sync(); return {}; });" },
    ]);
    await createPptxEditRunner({ api, controller })(ask("把标题改成 Hello"));
    expect(calls[0].context.mode).toBeUndefined();
    expect(scripts.some((source) => source.includes("exportSlide"))).toBe(false);
  });
});
