import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskRuntimePanel } from "./TaskRuntimePanel";
import type { DesktopTask } from "../../shared/types";

function makeTask(overrides: Partial<DesktopTask> = {}): DesktopTask {
  return {
    id: "task-1",
    conversationId: "task-1",
    status: "completed",
    events: [],
    ...overrides,
  } as DesktopTask;
}

describe("TaskRuntimePanel", () => {
  it("renders nothing when the task has no runtimeSnapshot", () => {
    const { container } = render(<TaskRuntimePanel task={makeTask()} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders provider details for a custom snapshot", () => {
    const task = makeTask({
      runtimeSnapshot: {
        mode: "custom",
        provider: {
          type: "openai",
          baseUrlHost: "https://api.openai.com",
          model: "gpt-4o-mini",
          apiKeyMasked: "sk-ab••••wxyz",
          apiKeyLength: 43,
        },
        appliedAt: "2026-05-25T10:00:00Z",
      },
    });
    render(<TaskRuntimePanel task={task} />);

    expect(screen.getByText("Custom")).toBeTruthy();
    expect(screen.getByText("openai")).toBeTruthy();
    expect(screen.getByText("https://api.openai.com")).toBeTruthy();
    expect(screen.getByText("gpt-4o-mini")).toBeTruthy();
    expect(screen.getByText(/sk-ab••••wxyz/)).toBeTruthy();
    expect(screen.queryByText("sk-abcdefghijklmnopqrstuvwxyz0123456789ABCD")).toBeNull();
  });

  it("renders only mode badge for an official provider snapshot (no provider rows)", () => {
    const task = makeTask({
      runtimeSnapshot: { mode: "hosted" },
    });
    const { container } = render(<TaskRuntimePanel task={task} />);

    expect(screen.getByText("Official")).toBeTruthy();
    const rows = container.querySelectorAll(".effective-row");
    expect(rows.length).toBe(1);
  });
});
