import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocaleProvider } from "../i18n";

const bridge = vi.hoisted(() => ({
  listAgentRuns: vi.fn(),
  respondAgentRun: vi.fn(),
  approveAgentRun: vi.fn(),
  getAgentRun: vi.fn(),
  reassignAgentClientTool: vi.fn(),
}));
vi.mock("../bridge", () => ({ officecli: bridge }));

import { RuntimePrompts } from "./RuntimePrompts";

afterEach(() => { cleanup(); vi.restoreAllMocks(); for (const mock of Object.values(bridge)) mock.mockReset(); });

const now = new Date().toISOString();

describe("RuntimePrompts", () => {
  it("shows only runs blocked on the user and answers a question in place", async () => {
    bridge.listAgentRuns.mockResolvedValue([
      { id: "run-busy", workflow: "office.generate", status: "running", created_at: now, updated_at: now },
      { id: "run-input", workflow: "office.generate", status: "waiting_input", created_at: now, updated_at: now, events: [{ event_id: "input-1", type: "input.requested", payload: { request_id: "question-1", request: { question: "Who is the audience?", options: ["Engineering", "Product"] } } }] },
    ]);
    bridge.respondAgentRun.mockResolvedValue(undefined);
    render(<LocaleProvider><RuntimePrompts /></LocaleProvider>);

    // The question itself is the row text — a run merely executing is machinery.
    expect(await screen.findByText("Who is the audience?")).toBeTruthy();
    expect(screen.queryByText("run-busy")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("region", { name: "Runtime needs input" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Answer" }), { target: { value: "Engineering" } });
    fireEvent.click(screen.getByRole("button", { name: "Continue run" }));
    await waitFor(() => expect(bridge.respondAgentRun).toHaveBeenCalledWith({ run_id: "run-input", request_id: "question-1", value: "Engineering" }));
  });

  it("reviews an approval inline instead of using a browser dialog", async () => {
    bridge.listAgentRuns.mockResolvedValue([
      { id: "run-approval", workflow: "client-tools.v1", status: "waiting_approval", created_at: now, updated_at: now, events: [{ event_id: "approval-1", type: "approval.requested", payload: { request_id: "save-1:approval", request: { tool: "workbook.save", risk: "write", resource_ref: "managed-sheet" } } }] },
    ]);
    bridge.approveAgentRun.mockResolvedValue(undefined);
    render(<LocaleProvider><RuntimePrompts /></LocaleProvider>);

    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));
    expect(screen.getByText("workbook.save")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve and continue" }));
    await waitFor(() => expect(bridge.approveAgentRun).toHaveBeenCalledWith(expect.objectContaining({ run_id: "run-approval", request_id: "save-1:approval", approved: true })));
  });

  it("renders nothing when no run is waiting", async () => {
    bridge.listAgentRuns.mockResolvedValue([{ id: "run-busy", workflow: "office.generate", status: "running", created_at: now, updated_at: now }]);
    const { container } = render(<LocaleProvider><RuntimePrompts /></LocaleProvider>);
    await waitFor(() => expect(bridge.listAgentRuns).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
