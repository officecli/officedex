import type { AgentRunApproveInput } from "../shared/types";
import { dialog } from "./ui";
import { trimmedStringValue as stringValue } from "./utils/values";

export interface AgentApprovalRequest extends AgentRunApproveInput {
  payload: Record<string, unknown>;
}

interface PendingApproval {
  request: AgentApprovalRequest;
  resolve: (approved: boolean) => void;
}

const approvalQueue: PendingApproval[] = [];
let approvalActive = false;

export function requestAgentApproval(request: AgentApprovalRequest): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    approvalQueue.push({ request, resolve });
    showNextApproval();
  });
}

function showNextApproval() {
  if (approvalActive) return;
  const pending = approvalQueue.shift();
  if (!pending) return;
  approvalActive = true;
  const tool = stringValue(pending.request.payload.tool) || "OfficeDex operation";
  const risk = stringValue(pending.request.payload.risk);
  const resource = stringValue(pending.request.payload.resource_ref);
  const settle = (approved: boolean) => {
    pending.resolve(approved);
    approvalActive = false;
    window.setTimeout(showNextApproval, 0);
  };
  dialog.confirm({
    title: `Approve ${tool}?`,
    content: (
      <div className="agent-approval-center" data-run-id={pending.request.run_id}>
        <p>This operation is waiting for your review before OfficeDex continues the Run.</p>
        <dl>
          <div><dt>Tool</dt><dd>{tool}</dd></div>
          {risk ? <div><dt>Risk</dt><dd>{risk}</dd></div> : null}
          {resource ? <div><dt>Resource</dt><dd>{resource}</dd></div> : null}
          <div><dt>Run</dt><dd>{pending.request.run_id}</dd></div>
        </dl>
      </div>
    ),
    okText: "Approve",
    cancelText: "Reject",
    tone: risk === "publish" ? "danger" : "default",
    onOk: () => settle(true),
    onCancel: () => settle(false),
  });
}


