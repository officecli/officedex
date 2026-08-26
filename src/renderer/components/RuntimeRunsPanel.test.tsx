import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";

const bridge = vi.hoisted(() => ({
  listAgentRuns: vi.fn(),
  cancelAgentRun: vi.fn(),
  retryAgentRun: vi.fn(),
}));
vi.mock("../bridge", () => ({ officecli: bridge }));

import { RuntimeRunsPanel } from "./RuntimeRunsPanel";

afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const mock of Object.values(bridge)) mock.mockReset(); });

describe("RuntimeRunsPanel", () => {
  it("lists runs and exposes cancel and retry, keeping retired runs behind the history toggle", async () => {
    const now = new Date().toISOString();
    bridge.listAgentRuns.mockResolvedValue([
      { id: "run-active", workflow: "office.generate", status: "running", current_step: "generate", created_at: now, updated_at: now },
      { id: "run-failed", workflow: "office.review", status: "failed", last_error: "review failed", created_at: now, updated_at: now },
      { id: "run-legacy", workflow: "legacy.office-generate", status: "failed", last_error: "historical failure", created_at: now, updated_at: now },
    ]);
    bridge.cancelAgentRun.mockResolvedValue(undefined);
    bridge.retryAgentRun.mockResolvedValue({ id: "run-failed", workflow: "office.review", status: "running", created_at: now, updated_at: now });

    render(<LocaleProvider><RuntimeRunsPanel /></LocaleProvider>);
    expect(await screen.findByText("office.generate")).toBeTruthy();
    expect(screen.queryByText("legacy.office-generate")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(bridge.cancelAgentRun).toHaveBeenCalledWith("run-active"));

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(bridge.retryAgentRun).toHaveBeenCalledWith("run-failed"));

    fireEvent.click(screen.getByRole("button", { name: "Show history (1)" }));
    expect(screen.getByText("Historical compatibility record")).toBeTruthy();
    // Retired runs are readable but not re-runnable.
    expect(bridge.retryAgentRun).not.toHaveBeenCalledWith("run-legacy");
    expect(screen.getAllByRole("button", { name: "Retry" })).toHaveLength(1);
  });

  it("reports a listing failure instead of showing an empty panel", async () => {
    bridge.listAgentRuns.mockRejectedValue(new Error("runtime store unreachable"));
    render(<LocaleProvider><RuntimeRunsPanel /></LocaleProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("runtime store unreachable");
  });
});
