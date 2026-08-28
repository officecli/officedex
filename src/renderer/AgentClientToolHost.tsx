import { useEffect, useRef, type MutableRefObject } from "react";
import type { AgentRun, BridgeEvent } from "../shared/types";
import { agentClientId } from "./agentClientIdentity";
import { officecli } from "./bridge";
import { recordValue, trimmedStringValue as stringValue } from "./utils/values";

export interface AgentClientToolRequest {
  callId: string;
  tool: string;
  resourceRef?: string;
  risk?: string;
  arguments: Record<string, unknown>;
}

export type AgentClientToolHandler = (request: AgentClientToolRequest) => Promise<unknown>;
export type AgentClientToolHandlers = Record<string, AgentClientToolHandler>;
export type AgentClientToolSurfaces = Record<string, AgentClientToolHandlers>;

export class AgentClientToolDeferredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentClientToolDeferredError";
  }
}

interface AgentClientToolHostConfig {
  surfaces: AgentClientToolSurfaces;
  routeToSurface?: (surface: string, run: AgentRun) => Promise<void>;
  onError?: (error: Error, run: AgentRun) => void;
  // Path of the document this page currently has open. Used as the final check
  // before a write: routing may be skipped entirely when a panel supplies its
  // own handlers, so identity alone is not enough to prove the call will land in
  // the document the Run was created against.
  currentDocumentPath?: () => string | undefined;
}

interface AgentClientToolHostProps extends AgentClientToolHostConfig {
  pollMs?: number;
}

let activeHost: MutableRefObject<AgentClientToolHostConfig> | undefined;
const inFlightCalls = new Set<string>();

// The document a Run expects to act on, if it named one.
function runDocumentPath(run: AgentRun): string {
  return stringValue(run.metadata?.workbook_path) || stringValue(run.metadata?.source_path);
}

// A call belongs to this page when it targets us, or when it carries no target
// at all (tools with no document affinity). An explicit reassignment moves the
// target, so the newest reassignment wins over the original request.
export { agentClientId };

export function isClientToolForThisHost(run: AgentRun, callId: string): boolean {
  let target = "";
  for (const event of run.events ?? []) {
    if (stringValue(event.payload?.call_id) !== callId) continue;
    if (event.type === "client-tool.requested") target = stringValue(event.payload?.target_client_id);
    else if (event.type === "client-tool.reassigned") target = stringValue(event.payload?.to_client_id);
  }
  return target === "" || target === agentClientId();
}

// Reconciliation interval. Client tools arrive by push; this slow sweep only
// catches what a dropped or reconnecting event stream missed, so it no longer
// has to be fast enough to feel responsive.
const RECONCILE_POLL_MS = 5_000;

export function AgentClientToolHost({ surfaces, routeToSurface, onError, pollMs = RECONCILE_POLL_MS }: AgentClientToolHostProps) {
  const configRef = useRef<AgentClientToolHostConfig>({ surfaces, routeToSurface, onError });
  configRef.current = { surfaces, routeToSurface, onError };

  useEffect(() => {
    activeHost = configRef;
    return () => {
      if (activeHost === configRef) activeHost = undefined;
    };
  }, []);

  // Push path. Runtime already emits client-tool events over the bridge stream,
  // so react to them directly instead of discovering work on the next tick. This
  // also removes the "whoever polls first wins" shape that let a second page
  // claim a call before its owner saw it.
  useEffect(() => {
    let disposed = false;
    const unsubscribe = officecli.onBridgeEvent((event) => {
      if (disposed) return;
      if (event.type !== "client-tool.requested" && event.type !== "client-tool.reassigned") return;
      const runId = typeof event.run_id === "string" ? event.run_id.trim() : "";
      if (!runId) return;
      void (async () => {
        try {
          const run = await officecli.getAgentRun(runId);
          if (disposed || run.status !== "waiting_client_tool") return;
          await resumeAgentClientTools(run);
        } catch (reason) {
          configRef.current.onError?.(asError(reason), { id: runId } as AgentRun);
        }
      })();
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const runs = await officecli.listAgentRuns(100);
        for (const run of runs) {
          if (disposed || run.status !== "waiting_client_tool") continue;
          try {
            await resumeAgentClientTools(run);
          } catch (reason) {
            configRef.current.onError?.(asError(reason), run);
          }
        }
      } catch {
        // Bridge reconnect handling owns connection errors. Keep the host alive
        // so persisted client tools resume on the next reconciliation sweep.
      } finally {
        if (!disposed) timer = window.setTimeout(() => void poll(), pollMs);
      }
    };
    void poll();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [pollMs]);

  return null;
}

export async function resumeAgentClientTools(runOrID: AgentRun | string): Promise<boolean> {
  const run = typeof runOrID === "string" ? await officecli.getAgentRun(runOrID) : runOrID;
  const pending = pendingAgentClientToolEvents(run);
  if (pending.length === 0) return true;
  for (const event of pending) {
    const result = await dispatchAgentClientToolEvent(run, event);
    if (result === "deferred") return false;
  }
  return true;
}

export async function dispatchAgentClientToolEvent(
  run: AgentRun,
  event: BridgeEvent,
  overrides?: AgentClientToolHandlers,
): Promise<"completed" | "deferred" | "in_flight"> {
  const payload = recordValue(event.payload);
  const callId = stringValue(payload.call_id);
  const tool = stringValue(payload.tool);
  if (!callId || !tool) throw new Error("Agent Runtime emitted an invalid client tool request.");
  // Never execute a call aimed at another page: the workbook under this editor
  // may not be the one the Run was created against.
  if (!overrides && !isClientToolForThisHost(run, callId)) return "deferred";
  const key = `${run.id}:${callId}`;
  if (inFlightCalls.has(key)) return "in_flight";
  inFlightCalls.add(key);
  try {
    const override = overrides?.[tool];
    let handler = override;
    const surface = stringValue(run.metadata?.surface);
    if (!override && surface && activeHost?.current.routeToSurface) {
      try {
        await activeHost.current.routeToSurface(surface, run);
      } catch (reason) {
        activeHost.current.onError?.(asError(reason), run);
        return "deferred";
      }
    }
    if (!handler) handler = activeHost?.current.surfaces[surface]?.[tool];
    if (!handler) return "deferred";
    // Final guard before any write. Routing already reopens the right workbook
    // for the global host, but a panel-supplied handler bypasses routing, and a
    // document can change between routing and execution. Refuse loudly rather
    // than write into whatever happens to be open.
    const expectedDocument = runDocumentPath(run);
    const openDocument = stringValue(activeHost?.current.currentDocumentPath?.());
    if (expectedDocument && openDocument && expectedDocument !== openDocument) {
      const error = new Error(
        `This page has ${openDocument} open, but the Run targets ${expectedDocument}. Refusing to run ${tool} against the wrong document.`,
      );
      await officecli.completeAgentClientTool({ run_id: run.id, call_id: callId, status: "failed", error: error.message });
      throw error;
    }
    try {
      const result = await handler({
        callId,
        tool,
        resourceRef: stringValue(payload.resource_ref) || undefined,
        risk: stringValue(payload.risk) || undefined,
        arguments: recordValue(payload.arguments),
      });
      await officecli.completeAgentClientTool({
        run_id: run.id,
        call_id: callId,
        status: "completed",
        result,
      });
      return "completed";
    } catch (reason) {
      if (reason instanceof AgentClientToolDeferredError) return "deferred";
      const error = asError(reason);
      await officecli.completeAgentClientTool({
        run_id: run.id,
        call_id: callId,
        status: "failed",
        error: error.message,
      });
      throw error;
    }
  } finally {
    inFlightCalls.delete(key);
  }
}

export function pendingAgentClientToolEvents(run: AgentRun): BridgeEvent[] {
  // A Runtime retry may reuse the same call_id. Resolve requests in event
  // order so a later requested event becomes pending again after an earlier
  // failed/completed attempt instead of being hidden forever by history.
  const pending = new Map<string, BridgeEvent>();
  for (const event of run.events ?? []) {
    const callId = stringValue(event.payload?.call_id);
    if (!callId) continue;
    if (event.type === "client-tool.requested") {
      pending.set(callId, event);
    } else if (event.type === "client-tool.completed" || event.type === "client-tool.failed") {
      pending.delete(callId);
    }
  }
  return [...pending.values()];
}

function asError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error(String(reason));
}
