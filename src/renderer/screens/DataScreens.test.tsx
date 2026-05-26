import { describe, expect, it } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { creditModel } from "./DataScreens";

function makeTask(overrides: Partial<DesktopTask>): DesktopTask {
  return {
    id: "task-1",
    conversationId: "task-1",
    status: "completed",
    events: [],
    ...overrides,
  } as DesktopTask;
}

describe("creditModel", () => {
  it("returns empty state for running tasks", () => {
    expect(creditModel(makeTask({ status: "running", creditCharged: 5 }))).toEqual({
      state: "empty",
      charged: 0,
      mode: "",
    });
  });

  it("returns empty state for starting/question/cancelled tasks", () => {
    for (const status of ["starting", "question", "cancelled"] as const) {
      expect(creditModel(makeTask({ status, creditCharged: 3 })).state).toBe("empty");
    }
  });

  it("returns legacy when completed task lacks creditCharged (old binary)", () => {
    const model = creditModel(makeTask({ status: "completed" }));
    expect(model.state).toBe("legacy");
    expect(model.charged).toBe(0);
  });

  it("returns zero state when creditCharged is exactly 0", () => {
    const model = creditModel(
      makeTask({ status: "completed", creditCharged: 0, creditMode: "anonymous" }),
    );
    expect(model.state).toBe("zero");
    expect(model.mode).toBe("anonymous");
  });

  it("returns value state with charged amount and mode for hosted tasks", () => {
    const model = creditModel(
      makeTask({ status: "completed", creditCharged: 12, creditMode: "hosted" }),
    );
    expect(model).toEqual({ state: "value", charged: 12, mode: "hosted" });
  });

  it("applies to failed tasks (zero settled)", () => {
    const model = creditModel(
      makeTask({ status: "failed", creditCharged: 0, creditMode: "hosted" }),
    );
    expect(model.state).toBe("zero");
  });

  it("falls back to empty mode string when creditMode is missing", () => {
    const model = creditModel(makeTask({ status: "completed", creditCharged: 4 }));
    expect(model).toEqual({ state: "value", charged: 4, mode: "" });
  });
});
