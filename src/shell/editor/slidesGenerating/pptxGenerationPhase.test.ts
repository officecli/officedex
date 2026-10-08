import { describe, expect, it } from "vitest";

import type { DesktopTask, VibeOp } from "../../../shared/types";
import { fixtureGenerationTask } from "./generationTaskFixtures";
import {
  generationCanvasPhase,
  generationMotionQuiet,
  GENERATION_QUIET_AFTER_MS,
  lastContentOpKind,
} from "./pptxGenerationPhase";

function task(overrides: Partial<DesktopTask> = {}): DesktopTask {
  return {
    id: "task-1",
    conversationId: "c-1",
    status: "running",
    events: [],
    ...overrides,
  };
}

function progress(step: string, content = "working"): DesktopTask["events"][number] {
  return { type: "task.progress", payload: { step, content } };
}

describe("generationCanvasPhase", () => {
  it("maps plan.research to research only when the run actually searched", () => {
    expect(generationCanvasPhase(task({ events: [progress("plan.research", "Searching the web")] }))).toBe("research");
    expect(generationCanvasPhase(task({ events: [progress("research")] }))).toBe("research");
  });

  it("treats a live run with no research step as outlining, not searching", () => {
    expect(generationCanvasPhase(task({ status: "starting" }))).toBe("outline");
    expect(generationCanvasPhase(task({ status: "running" }))).toBe("outline");
    expect(generationCanvasPhase(task({ events: [progress("license")] }))).toBe("outline");
  });

  it("maps outline events and outline payloads to outline", () => {
    expect(generationCanvasPhase(task({ events: [progress("plan.outline")] }))).toBe("outline");
    expect(generationCanvasPhase(task({ events: [progress("plan.style")] }))).toBe("outline");
    expect(generationCanvasPhase(task({ vibeOutline: { slides: [{ slide: 1, headline: "Intro" }] } }))).toBe("outline");
    expect(generationCanvasPhase(task({ status: "plan_review", plan: { id: "p", markdown: "# One", revision: 1 } }))).toBe("outline");
    expect(generationCanvasPhase(task({ status: "question" }))).toBe("outline");
  });

  it("maps text ops and expand/generate steps to writing", () => {
    const ops: VibeOp[] = [{ seq: 1, op: "shape.add", slide: 1, shape: { kind: "text", role: "title", text: "Hello" } }];
    expect(generationCanvasPhase(task({ vibeOps: ops }))).toBe("writing");
    expect(generationCanvasPhase(task({ events: [progress("plan.expand", "Writing slide 3")] }))).toBe("writing");
    expect(generationCanvasPhase(task({ events: [progress("generate_llm")] }))).toBe("writing");
  });

  it("maps picture/chart/diagram ops and skill/assemble steps to drawing", () => {
    const picture: VibeOp[] = [{ seq: 2, op: "shape.add", slide: 1, shape: { kind: "picture", imageRef: { digest: "abc" } } }];
    expect(generationCanvasPhase(task({ vibeOps: picture }))).toBe("drawing");
    expect(generationCanvasPhase(task({ events: [progress("skill.images")] }))).toBe("drawing");
    expect(generationCanvasPhase(task({ events: [progress("assemble")] }))).toBe("drawing");
    expect(generationCanvasPhase(task({ events: [progress("assemble", "Generating image asset (1/2)")] }))).toBe("drawing");
  });

  it("maps export/finalize and a fully-ready deck to polish", () => {
    expect(generationCanvasPhase(task({ events: [progress("export")] }))).toBe("polish");
    expect(generationCanvasPhase(task({ events: [progress("finalize")] }))).toBe("polish");
    expect(
      generationCanvasPhase(
        task({
          vibeOutline: { slides: [{ slide: 1, headline: "A" }, { slide: 2, headline: "B" }] },
          events: [
            { type: "task.progress", payload: { slide_state: { slide: 1, state: "ready" } } },
            { type: "task.progress", payload: { slide_state: { slide: 2, state: "ready" } } },
          ],
        }),
      ),
    ).toBe("polish");
  });

  it("unloads on failed or cancelled rather than inventing a failure phase", () => {
    expect(generationCanvasPhase(task({ status: "failed", events: [progress("plan.research")] }))).toBeNull();
    expect(generationCanvasPhase(task({ status: "cancelled" }))).toBeNull();
  });

  it("prefers the latest content op over a stale step", () => {
    const ops: VibeOp[] = [
      { seq: 1, op: "shape.add", slide: 1, shape: { kind: "text", text: "Title" } },
      { seq: 2, op: "shape.add", slide: 1, shape: { kind: "picture" } },
    ];
    expect(generationCanvasPhase(task({ events: [progress("plan.expand")], vibeOps: ops }))).toBe("drawing");
  });
});

it("maps the fixture sequence onto the five canvas phases", () => {
  expect(generationCanvasPhase(fixtureGenerationTask("research"))).toBe("research");
  expect(generationCanvasPhase(fixtureGenerationTask("outline"))).toBe("outline");
  expect(generationCanvasPhase(fixtureGenerationTask("writing"))).toBe("writing");
  expect(generationCanvasPhase(fixtureGenerationTask("drawing"))).toBe("drawing");
  expect(generationCanvasPhase(fixtureGenerationTask("polish"))).toBe("polish");
});

describe("lastContentOpKind", () => {
  it("ignores deck/slide bookkeeping", () => {
    expect(lastContentOpKind([{ seq: 1, op: "deck.begin", slides: 5 }, { seq: 2, op: "slide.begin", slide: 1 }])).toBeNull();
  });
});

describe("generationMotionQuiet", () => {
  it("is a switch, not a restyle: quiet after 30s", () => {
    const createdAt = "2026-09-11T08:00:00Z";
    const now = Date.parse(createdAt) + GENERATION_QUIET_AFTER_MS - 1;
    expect(generationMotionQuiet(task({ createdAt }), now)).toBe(false);
    expect(generationMotionQuiet(task({ createdAt }), now + 2)).toBe(true);
  });
});
