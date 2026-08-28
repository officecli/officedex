import type { AgentRun, AgentRunApproveInput, BridgeEvent } from "../shared/types";
import { agentClientId, dispatchAgentClientToolEvent, type AgentClientToolHandlers } from "./AgentClientToolHost";
import { requestAgentApproval } from "./agentApprovalCenter";
import { officecli } from "./bridge";
import { recordValue, stringValue } from "./utils/values";
import { delay } from "./utils/timing";

export type { AgentClientToolRequest } from "./AgentClientToolHost";

export interface AgentRunWaitOptions {
  clientTools?: AgentClientToolHandlers;
  approve?: (
    request: AgentRunApproveInput & { payload: Record<string, unknown> },
  ) => Promise<boolean>;
  timeoutMs?: number;
  pollMs?: number;
  cancelOnTimeout?: boolean;
}

class AgentRunTimeoutError extends Error {
  constructor(readonly timeoutMs: number, readonly status?: AgentRun["status"]) {
    super(`Agent Runtime timed out after ${timeoutMs / 1000} seconds while waiting for completion.`);
    this.name = "AgentRunTimeoutError";
  }
}

// A Run parked on a human decision is not stuck: cancelling it would discard
// work the user is still deciding about.
const humanWaitStatuses = new Set<AgentRun["status"]>([
  "waiting_input",
  "waiting_approval",
  "waiting_client_tool",
]);

function isHumanWaitStatus(status?: AgentRun["status"]): boolean {
  return Boolean(status && humanWaitStatuses.has(status));
}

export type AgentRunOutcome =
  | { kind: "completed"; run: AgentRun }
  | {
      kind: "input";
      run: AgentRun;
      requestId: string;
      question: string;
      payload: Record<string, unknown>;
    };

// Stamp the originating page onto every Run it starts. Client tools raised by
// the Run then default to this host, so a write cannot be claimed by another tab
// holding a different workbook.
function withOriginClientId(metadata?: Record<string, string>): Record<string, string> {
  return { ...(metadata ?? {}), origin_client_id: agentClientId() };
}

export async function confirmAgentApproval(
  request: AgentRunApproveInput & { payload: Record<string, unknown> },
): Promise<boolean> {
  return requestAgentApproval(request);
}

export async function executeAgentWorkflow<T>(
  workflow: string,
  input: Record<string, unknown>,
  options: AgentRunWaitOptions = {},
  metadata?: Record<string, string>,
): Promise<{ run: AgentRun; result: T }> {
  const started = await officecli.startAgentRun({ workflow, input, metadata: withOriginClientId(metadata) });
  let outcome: AgentRunOutcome;
  try {
    outcome = await waitForAgentRun(started.id, options);
  } catch (reason) {
    if (options.cancelOnTimeout && reason instanceof AgentRunTimeoutError && !isHumanWaitStatus(reason.status)) {
      try {
        await officecli.cancelAgentRun(started.id);
      } catch (cancelReason) {
        const message = cancelReason instanceof Error ? cancelReason.message : String(cancelReason);
        throw new Error(`${reason.message} Automatic cancellation failed: ${message}`);
      }
    }
    throw reason;
  }
  if (outcome.kind !== "completed") {
    throw new Error(outcome.question || "Agent Runtime requires additional input.");
  }
  return { run: outcome.run, result: unwrapAgentRunResult<T>(outcome.run) };
}

export async function restorePendingAgentInput(
  workflow: string,
  surface?: string,
): Promise<{ runId: string; requestId: string; question: string } | undefined> {
  const runs = await officecli.listAgentRuns(100);
  const run = runs.find((candidate) =>
    candidate.workflow === workflow &&
    candidate.status === "waiting_input" &&
    (!surface || candidate.metadata?.surface === surface),
  );
  if (!run) return undefined;
  const pending = latestPendingRequest(run.events ?? [], "input.requested");
  if (!pending) return undefined;
  const payload = recordPayload(pending);
  const request = recordValue(payload.request);
  const requestId = stringValue(payload.request_id);
  if (!requestId) return undefined;
  return {
    runId: run.id,
    requestId,
    question: stringValue(request.question) || stringValue(request.message) || "请补充完成此任务所需的信息。",
  };
}

const terminalStatuses = new Set(["completed", "failed", "cancelled"]);

export async function waitForAgentRun(
  runId: string,
  options: AgentRunWaitOptions = {},
): Promise<AgentRunOutcome> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  // The deadline bounds *active execution*, not the wall clock. Time the user
  // spends reading an approval dialog, answering a question, or reopening the
  // surface a client tool needs is credited back, and any observable progress
  // restarts the budget. Otherwise a Run that is healthy but slow to be
  // approved gets reported as a Runtime timeout, masking its real outcome.
  let deadline = Date.now() + timeoutMs;
  const creditHumanWait = async <T>(action: () => Promise<T>): Promise<T> => {
    const startedAt = Date.now();
    try {
      return await action();
    } finally {
      deadline += Date.now() - startedAt;
    }
  };
  const handled = new Set<string>();
  let lastProgress = "";
  let lastStatus: AgentRun["status"] | undefined;
  for (;;) {
    const run = await officecli.getAgentRun(runId);
    lastStatus = run.status;
    // Any new event or status change means the Run is alive; restart the budget.
    const progress = `${run.status}:${(run.events ?? []).length}`;
    if (progress !== lastProgress) {
      lastProgress = progress;
      deadline = Date.now() + timeoutMs;
    }
    let interacted = false;
    const resolvedClientTools = resolvedInteractionIds(
      run.events ?? [],
      ["client-tool.completed", "client-tool.failed"],
      "call_id",
    );
    const resolvedApprovals = resolvedInteractionIds(
      run.events ?? [],
      ["approval.resolved"],
      "request_id",
    );
    for (const event of run.events ?? []) {
      const eventKey =
        event.event_id ??
        `${event.type}:${event.ts ?? ""}:${JSON.stringify(event.payload ?? {})}`;
      if (handled.has(eventKey)) continue;
      if (event.type === "client-tool.requested") {
        const callId = stringValue(event.payload?.call_id);
        if (callId && resolvedClientTools.has(callId)) continue;
        const result = await creditHumanWait(() => handleClientTool(run, event, options));
        if (result !== "deferred") handled.add(eventKey);
        interacted = true;
      } else if (event.type === "approval.requested") {
        const requestId = stringValue(event.payload?.request_id);
        if (requestId && resolvedApprovals.has(requestId)) continue;
        handled.add(eventKey);
        await creditHumanWait(() => handleApproval(run, event, options));
        interacted = true;
      }
    }

    // An approval or tool call just advanced the Run: re-read it immediately so
    // a completion or failure that landed during the wait is reported as such
    // instead of being judged against the pre-interaction snapshot.
    if (interacted) continue;

    if (run.status === "waiting_input") {
      const pending = latestPendingRequest(run.events ?? [], "input.requested");
      if (!pending) throw new Error("Agent Runtime is waiting for input without a request payload.");
      const request = recordPayload(pending);
      const nested = recordValue(request.request);
      return {
        kind: "input",
        run,
        requestId: stringValue(request.request_id),
        question:
          stringValue(nested.question) ||
          stringValue(nested.message) ||
          "请补充完成此任务所需的信息。",
        payload: nested,
      };
    }
    if (terminalStatuses.has(run.status)) {
      if (run.status === "failed")
        throw new Error(run.last_error || "Agent Runtime execution failed.");
      if (run.status === "cancelled")
        throw new Error("Agent Runtime execution was cancelled.");
      return { kind: "completed", run };
    }
    if (Date.now() >= deadline) break;
    await delay(options.pollMs ?? 80);
  }
  throw new AgentRunTimeoutError(timeoutMs, lastStatus);
}

function resolvedInteractionIds(
  events: BridgeEvent[],
  eventTypes: string[],
  idKey: string,
): Set<string> {
  const types = new Set(eventTypes);
  return new Set(
    events
      .filter((event) => types.has(event.type))
      .map((event) => stringValue(event.payload?.[idKey]))
      .filter(Boolean),
  );
}

export function unwrapAgentRunResult<T>(run: AgentRun): T {
  const outer = recordValue(run.result);
  if (!("result" in outer)) return run.result as T;
  return outer.result as T;
}

function latestPendingRequest(events: BridgeEvent[], type: string) {
  const submitted = new Set(
    events
      .filter((event) => event.type === "input.submitted")
      .map((event) => stringValue(event.payload?.request_id)),
  );
  return [...events]
    .reverse()
    .find(
      (event) =>
        event.type === type &&
        !submitted.has(stringValue(event.payload?.request_id)),
    );
}

async function handleClientTool(
  run: AgentRun,
  event: BridgeEvent,
  options: AgentRunWaitOptions,
) {
  return dispatchAgentClientToolEvent(run, event, options.clientTools);
}

async function handleApproval(
  run: AgentRun,
  event: BridgeEvent,
  options: AgentRunWaitOptions,
) {
  const payload = recordPayload(event);
  const requestId = stringValue(payload.request_id);
  if (!requestId) throw new Error("Agent Runtime emitted an invalid approval request.");
  const approved = options.approve
    ? await options.approve({
        run_id: run.id,
        request_id: requestId,
        approved: false,
        payload: recordValue(payload.request),
      })
    : false;
  await officecli.approveAgentRun({
    run_id: run.id,
    request_id: requestId,
    approved,
    reason: approved ? "Approved in OfficeDex" : "No OfficeDex approval handler accepted this operation",
  });
  if (!approved) throw new Error("The requested operation was not approved.");
}

function recordPayload(event: BridgeEvent): Record<string, unknown> {
  return recordValue(event.payload);
}


