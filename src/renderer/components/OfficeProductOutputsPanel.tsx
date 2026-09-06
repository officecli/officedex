import { Button, Empty, Tag } from "../ui";
import type { OfficeOutputRef } from "../../shared/officeProduct";
import type { RefreshQueueItem } from "../refreshQueue";

export interface OfficeProductOutputsPanelProps {
  outputs: OfficeOutputRef[];
  queue?: RefreshQueueItem[];
  onOpen?: (output: OfficeOutputRef) => void;
  onRefresh?: (output: OfficeOutputRef) => void;
  onApprove?: (output: OfficeOutputRef) => void;
}

function label(type: OfficeOutputRef["type"]): string {
  return type === "html-app" ? "HTML" : type === "presentation" ? "PPT" : type === "document" ? "DOCX" : type === "image" ? "Image" : "Excel";
}

export function OfficeProductOutputsPanel({ outputs, queue = [], onOpen, onRefresh, onApprove }: OfficeProductOutputsPanelProps) {
  if (outputs.length === 0) return <Empty description="No generated outputs yet" />;
  return <section aria-label="Project outputs" className="office-product-outputs">
    {outputs.map((output) => {
      const item = queue.find((entry) => entry.plan.outputId === output.id);
      const awaiting = item?.status === "awaiting_confirmation";
      return <article key={output.id} className="office-product-output" data-status={item?.status ?? output.status}>
        <div><Tag>{label(output.type)}</Tag><strong>{output.title}</strong><small>v{output.version}{output.lineage?.workbookFingerprint ? ` · ${output.lineage.workbookFingerprint}` : ""}</small></div>
        <div className="office-product-output__actions">
          {output.manuallyEdited ? <span title="Manual edits are protected">Protected</span> : null}
          {awaiting ? <Button size="small" onClick={() => onApprove?.(output)}>Approve refresh</Button> : <Button size="small" onClick={() => onRefresh?.(output)}>Refresh</Button>}
          {onOpen ? <Button size="small" variant="ghost-normal" onClick={() => onOpen(output)}>Open</Button> : null}
        </div>
      </article>;
    })}
  </section>;
}
