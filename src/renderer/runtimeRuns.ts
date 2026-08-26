import type { AgentRun } from "../shared/types";

export function isHistoricalRuntimeRun(run: Pick<AgentRun, "workflow">): boolean {
  return run.workflow.startsWith("legacy.");
}

// Runs whose caller is an AI client outside this repository, not the OfficeDex
// UI. The "agent." prefix is orthogonal to "legacy.": the former says who calls
// it, the latter says it is retired. Filtering on the name alone is deliberate —
// an audit must never have to guess whether "no OfficeDex caller" means broken
// or by design.
export function isExternalAgentRuntimeRun(run: Pick<AgentRun, "workflow">): boolean {
  return run.workflow.startsWith("agent.");
}

export function runtimeStatusColor(status: AgentRun["status"]): "blue" | "green" | "orange" | "red" | "gray" {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "cancelled") return "gray";
  if (status.startsWith("waiting") || status === "review_ready") return "orange";
  return "blue";
}

/** Runs that are blocked on the user rather than on the machine. */
export function isWaitingOnUser(run: Pick<AgentRun, "status">): boolean {
  return run.status === "waiting_input" || run.status === "waiting_approval" || run.status === "waiting_client_tool";
}
