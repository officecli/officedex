import type { ReactNode } from "react";
import { AgentIcon } from "../components/AgentIcon";
import "./agent-message.css";

/** Shared conversation layout; document color is inherited from the workbench. */
export function AgentMessage({ role, children }: { role: "user" | "assistant"; children: ReactNode }) {
  return <div className="agent-message" data-role={role}>
    {role === "assistant" && <span className="agent-message__avatar" aria-hidden="true"><AgentIcon /></span>}
    <div className="agent-message__body">{children}</div>
  </div>;
}
