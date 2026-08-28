import { describe, expect, it } from "vitest";
import { createInitialPptxProgress, reducePptxProgress, reducePptxProgressEvents } from "./pptxProgress";

describe("pptx progressive progress reducer", () => {
  it("reveals brief, outline, draft, and drawing as events arrive", () => {
    const events = [
      { event_id: "started", type: "task.started", payload: { topic: "Q3 review" } },
      { event_id: "plan", type: "task.plan", payload: { outline: { slides: ["Overview", "Actions"] } } },
      { event_id: "draft", type: "task.progress", payload: { phase: "draft", message: "Draft ready" } },
      { event_id: "slide", type: "task.progress", payload: { slide: 1, total_slides: 2, message: "Drawing slide 1" } },
    ];
    const state = reducePptxProgressEvents(events);
    expect(state.phase).toBe("drawing");
    expect(state.outline).toEqual({ slides: ["Overview", "Actions"] });
    expect(state.totalSlides).toBe(2);
    expect(state.currentSlide).toBe(1);
    expect(state.pages).toEqual([
      { slide: 1, status: "active", opCount: 0 },
    ]);
  });

  it("maps output and primitive batches to page progress immediately", () => {
    let state = reducePptxProgress(createInitialPptxProgress(), {
      event_id: "out", type: "task.output", payload: { slide: 1, total_slides: 2 },
    });
    state = reducePptxProgress(state, {
      event_id: "ops", type: "task.vibe_primitives", payload: { slide: 2, primitives: [{ op: "text.add" }, { op: "shape.add" }] },
    });
    expect(state.phase).toBe("drawing");
    expect(state.completedSlides).toBe(1);
    expect(state.currentSlide).toBe(2);
    expect(state.opCount).toBe(2);
    expect(state.pages).toEqual([
      { slide: 1, status: "completed", opCount: 0 },
      { slide: 2, status: "active", opCount: 0 },
    ]);
  });

  it("does not apply duplicate events and completes known pages", () => {
    const started = createInitialPptxProgress();
    const once = reducePptxProgress(started, { event_id: "same", type: "task.progress", payload: { slide: 1 } });
    const twice = reducePptxProgress(once, { event_id: "same", type: "task.progress", payload: { slide: 1 } });
    expect(twice).toEqual(once);
    const completed = reducePptxProgress(twice, { event_id: "done", type: "task.completed", payload: { total_slides: 2 } });
    expect(completed.phase).toBe("completed");
    expect(completed.completedSlides).toBe(2);
    expect(completed.pages.every((page) => page.status === "completed")).toBe(true);
  });

  it("keeps terminal failure and cancellation visible", () => {
    const failed = reducePptxProgressEvents([
      { type: "task.started", payload: {} },
      { type: "task.failed", payload: { error: "provider unavailable" } },
    ]);
    expect(failed.phase).toBe("failed");
    expect(failed.message).toBe("provider unavailable");
    const cancelled = reducePptxProgressEvents([
      { type: "task.started", payload: {} },
      { type: "task.cancelled", payload: {} },
    ]);
    expect(cancelled.phase).toBe("cancelled");
  });
});
