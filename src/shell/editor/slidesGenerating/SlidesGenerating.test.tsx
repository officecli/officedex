import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DesktopTask } from "../../../shared/types";
import { SlidesGenerating } from "./SlidesGenerating";

afterEach(cleanup);

const task = (status: DesktopTask["status"]): DesktopTask => ({
  id: "run",
  conversationId: "run",
  documentType: "pptx",
  topic: "Deck",
  status,
  events: [],
});

/*
 * UX30-05. While the run is stopped at a confirmation the card says "waiting";
 * the canvas beside it used to go on saying "Drafting the outline", moving.
 */
describe("the generating canvas while a run waits", () => {
  it("says the run is waiting and holds still", () => {
    for (const status of ["question", "plan_review"] as const) {
      const view = render(<SlidesGenerating task={task(status)} />);
      const root = view.container.querySelector<HTMLElement>(".shell-gen")!;
      expect(root.dataset.waiting).toBe("true");
      expect(root.dataset.quiet).toBe("true");
      expect(view.container.querySelector("[role=status]")?.textContent).toBe("Waiting for you to confirm");
      view.unmount();
    }
  });

  it("says what it is doing while the run is going", () => {
    const view = render(<SlidesGenerating task={task("running")} />);
    const root = view.container.querySelector<HTMLElement>(".shell-gen")!;
    expect(root.dataset.waiting).toBeUndefined();
    expect(view.container.querySelector("[role=status]")?.textContent).not.toBe("Waiting for you to confirm");
  });
});
