import { createContext, useContext, type ReactNode } from "react";

import { useAgentTask } from "./useAgentTask";

export type Agent = ReturnType<typeof useAgentTask>;

const AgentContext = createContext<Agent | null>(null);

/**
 * The one conversation in scope, shared by every surface that shows it.
 *
 * Home's composer, the project conversation and the Dex panel over a document
 * are three entrances to the same task state (§10: "Dex 面板与项目 Chat 使用同一
 * 任务/改动状态；只是入口不同"). One hook instance means one subscription and one
 * answer to "is something running" — three instances would each hold their own
 * copy of an in-place edit and disagree about it.
 */
export function AgentProvider({ children }: { children: ReactNode }) {
  const agent = useAgentTask();
  return <AgentContext.Provider value={agent}>{children}</AgentContext.Provider>;
}

export function useAgent(): Agent {
  const agent = useContext(AgentContext);
  if (!agent) throw new Error("useAgent must be used inside <AgentProvider>");
  return agent;
}
