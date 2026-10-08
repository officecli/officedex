import { beforeEach, describe, expect, it } from "vitest";
import { isClientToolForThisHost } from "./AgentClientToolHost";
import { __setAgentClientIdForTest, agentClientId } from "./agentClientIdentity";
import type { AgentRun } from "../shared/types";

function runWith(events: Array<{ type: string; payload: Record<string, unknown> }>): AgentRun {
  const now = new Date().toISOString();
  return {
    id: "run-1", workflow: "client-tools.v1", status: "waiting_client_tool",
    created_at: now, updated_at: now,
    events: events.map((event, index) => ({ event_id: `e${index}`, run_id: "run-1", ...event })),
  } as AgentRun;
}

describe("client tool targeting", () => {
  beforeEach(() => __setAgentClientIdForTest("client-me"));

  it("refuses a call aimed at another page", () => {
    // Regression: the host polls, so before targeting existed a second tab could
    // win the race and execute the write against a different open workbook.
    const run = runWith([
      { type: "client-tool.requested", payload: { call_id: "save-1", tool: "workbook.save", target_client_id: "client-other" } },
    ]);
    expect(isClientToolForThisHost(run, "save-1")).toBe(false);
  });

  it("claims a call aimed at this page", () => {
    const run = runWith([
      { type: "client-tool.requested", payload: { call_id: "save-1", target_client_id: agentClientId() } },
    ]);
    expect(isClientToolForThisHost(run, "save-1")).toBe(true);
  });

  it("claims an untargeted call", () => {
    const run = runWith([{ type: "client-tool.requested", payload: { call_id: "save-1" } }]);
    expect(isClientToolForThisHost(run, "save-1")).toBe(true);
  });

  it("follows an explicit reassignment in both directions", () => {
    const toMe = runWith([
      { type: "client-tool.requested", payload: { call_id: "save-1", target_client_id: "client-other" } },
      { type: "client-tool.reassigned", payload: { call_id: "save-1", to_client_id: "client-me" } },
    ]);
    expect(isClientToolForThisHost(toMe, "save-1")).toBe(true);

    const awayFromMe = runWith([
      { type: "client-tool.requested", payload: { call_id: "save-1", target_client_id: "client-me" } },
      { type: "client-tool.reassigned", payload: { call_id: "save-1", to_client_id: "client-other" } },
    ]);
    expect(isClientToolForThisHost(awayFromMe, "save-1")).toBe(false);
  });

  it("does not let another call's target leak across call ids", () => {
    const run = runWith([
      { type: "client-tool.requested", payload: { call_id: "other", target_client_id: "client-other" } },
      { type: "client-tool.requested", payload: { call_id: "save-1", target_client_id: "client-me" } },
    ]);
    expect(isClientToolForThisHost(run, "save-1")).toBe(true);
    expect(isClientToolForThisHost(run, "other")).toBe(false);
  });
});
