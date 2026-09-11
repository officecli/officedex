import { describe, expect, it } from "vitest";
import { pptxRuntimeActivity } from "./pptxRuntimeActivity";
import type { DesktopTask } from "../../shared/types";
const task = (events: DesktopTask["events"]): DesktopTask => ({ id: "runtime", conversationId: "c", status: "running", events });
describe("PPTX runtime activity", () => {
  it("keeps MOP skill phases in production before any slide snapshot", () => {
    for (const step of ["assemble", "skill.plan", "skill.retrieve", "skill.images", "skill.author", "render", "export"]) {
      expect(pptxRuntimeActivity(task([{ type: "task.progress", payload: { step, content: "Working" } }])).phase).toBe("drawing");
    }
  });
  it("counts drawing operations as activity without losing the provider message", () => {
    const result = pptxRuntimeActivity(task([
      { type: "task.progress", ts: "2026-09-11T04:05:00Z", payload: { step: "assemble", content: "Generating image asset (2/2)" } },
      { type: "task.vibe_ops", ts: "2026-09-11T04:06:00Z", payload: { ops: [] } },
    ]));
    expect(result.timestamp).toBe(Date.parse("2026-09-11T04:06:00Z"));
    expect(result.image).toBe(true);
  });
  it("does not treat invalid timestamps as an infinite delay", () => {
    expect(pptxRuntimeActivity(task([{ type: "task.progress", ts: "invalid", payload: { step: "assemble" } }])).timestamp).toBeUndefined();
  });
});
