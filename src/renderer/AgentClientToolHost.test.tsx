import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentRun } from "../shared/types";
import { AgentClientToolHost, dispatchAgentClientToolEvent, pendingAgentClientToolEvents, resumeAgentClientTools } from "./AgentClientToolHost";
import { officecli } from "./bridge";

const now = new Date().toISOString();

function waitingRun(tool = "workbook.save"): AgentRun {
  return {
    id: "run-host-1",
    workflow: "client-tools.v1",
    status: "waiting_client_tool",
    metadata: { surface: "spreadsheet.catalog-cleanup", workbook_path: "/tmp/catalog.xlsx" },
    created_at: now,
    updated_at: now,
    events: [{
      event_id: "event-tool-1",
      type: "client-tool.requested",
      payload: { call_id: "call-1", tool, arguments: {} },
    }],
  };
}

describe("AgentClientToolHost", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(officecli, "listAgentRuns").mockResolvedValue([]);
  });

  afterEach(() => cleanup());

  it("routes a persisted run to its surface and completes the registered tool", async () => {
    const route = vi.fn(async () => undefined);
    const save = vi.fn(async () => ({ saved: true }));
    const complete = vi.spyOn(officecli, "completeAgentClientTool").mockResolvedValue();
    render(<AgentClientToolHost pollMs={60_000} routeToSurface={route} surfaces={{
      "spreadsheet.catalog-cleanup": { "workbook.save": save },
    }} />);

    await expect(resumeAgentClientTools(waitingRun())).resolves.toBe(true);
    expect(route).toHaveBeenCalledWith("spreadsheet.catalog-cleanup", expect.objectContaining({ id: "run-host-1" }));
    expect(save).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith({ run_id: "run-host-1", call_id: "call-1", status: "completed", result: { saved: true } });
  });

  it("leaves a tool pending when no matching surface handler is available", async () => {
    const complete = vi.spyOn(officecli, "completeAgentClientTool").mockResolvedValue();
    render(<AgentClientToolHost pollMs={60_000} surfaces={{}} />);

    await expect(resumeAgentClientTools(waitingRun("workbook.unknown"))).resolves.toBe(false);
    expect(complete).not.toHaveBeenCalled();
  });

  it("claims a call once when page polling and the app host race", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const save = vi.fn(async () => { await gate; return { saved: true }; });
    const complete = vi.spyOn(officecli, "completeAgentClientTool").mockResolvedValue();
    const run = waitingRun();
    const event = run.events![0];
    const first = dispatchAgentClientToolEvent(run, event, { "workbook.save": save });
    await Promise.resolve();
    await expect(dispatchAgentClientToolEvent(run, event, { "workbook.save": save })).resolves.toBe("in_flight");
    release();
    await expect(first).resolves.toBe("completed");
    expect(save).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledOnce();
  });

  it("treats a retried request with the same call id as pending after an earlier failure", () => {
    const run = waitingRun();
    run.events = [
      run.events![0],
      {
        event_id: "event-tool-failed",
        type: "client-tool.failed",
        payload: { call_id: "call-1", error: "stale editor" },
      },
      {
        event_id: "event-tool-retried",
        type: "client-tool.requested",
        payload: { call_id: "call-1", tool: "workbook.save", arguments: { retry: true } },
      },
    ];

    expect(pendingAgentClientToolEvents(run)).toEqual([
      expect.objectContaining({ event_id: "event-tool-retried" }),
    ]);
  });
});
