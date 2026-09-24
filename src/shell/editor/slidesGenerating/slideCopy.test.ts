import { describe, expect, it } from "vitest";

import type { DesktopTask, VibeOp } from "../../../shared/types";
import { fixtureGenerationTask } from "./generationTaskFixtures";
import { slideCopyFromTask } from "./slideCopy";

describe("slideCopyFromTask", () => {
  it("prefers op text over outline headlines", () => {
    const ops: VibeOp[] = [
      { seq: 1, op: "shape.add", slide: 1, shape: { kind: "text", role: "title", text: "From the op stream" } },
      { seq: 2, op: "shape.add", slide: 1, shape: { kind: "text", role: "bullet", text: "A real bullet" } },
    ];
    const task = {
      ...fixtureGenerationTask("writing"),
      vibeOps: ops,
    } as DesktopTask;
    const copy = slideCopyFromTask(task, "writing");
    expect(copy.title).toBe("From the op stream");
    expect(copy.bullets).toContain("A real bullet");
  });

  it("fills the filmstrip from outline during outline, and not during research", () => {
    expect(slideCopyFromTask(fixtureGenerationTask("research"), "research").filledThumbs).toBe(0);
    expect(slideCopyFromTask(fixtureGenerationTask("outline"), "outline").filledThumbs).toBeGreaterThan(0);
  });
});
