import { useT } from "../i18n";
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
  const t = useT();
  if (outputs.length === 0) return <Empty description={t("ui.copy.Nogeneratedoutputsyet")} />;
  return <section aria-label={t("ui.copy.Projectoutputs")} className="office-product-outputs">
    {outputs.map((output) => {
      const item = queue.find((entry) => entry.plan.outputId === output.id);
      const awaiting = item?.status === "awaiting_confirmation";
      return <article key={output.id} className="office-product-output" data-status={item?.status ?? output.status}>
        <div><Tag>{output.type === "image" ? t("home.type.img") : label(output.type)}</Tag><strong>{output.title}</strong><small>v{output.version}{output.lineage?.workbookFingerprint ? ` · ${output.lineage.workbookFingerprint}` : ""}</small></div>
        <div className="office-product-output__actions">
          {output.manuallyEdited ? <span title={t("ui.copy.Manualeditsareprotected")}>{t("ui.copy.Protected")}</span> : null}
          {awaiting ? <Button size="small" onClick={() => onApprove?.(output)}>{t("ui.copy.Approverefresh")}</Button> : <Button size="small" onClick={() => onRefresh?.(output)}>{t("ui.copy.Refresh")}</Button>}
          {onOpen ? <Button size="small" variant="ghost-normal" onClick={() => onOpen(output)}>{t("ui.copy.Open")}</Button> : null}
        </div>
      </article>;
    })}
  </section>;
}
