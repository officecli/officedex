import { AppWindow, ArrowLeft, ExternalLink, PanelRightClose, PanelRightOpen, Save } from "lucide-react";
import { Button } from "../ui";
import { useT } from "../i18n";

export type SpreadsheetSaveState = "unopened" | "saved" | "dirty" | "saving" | "error";

export interface SpreadsheetTopbarProps {
  fileName: string;
  workspaceName?: string;
  saveState: SpreadsheetSaveState;
  canSave: boolean;
  agentOpen: boolean;
  onBack: () => void;
  onSave: () => void;
  onOpenExternal?: () => void;
  onOpenAppBuilder?: () => void;
  onToggleAgent: () => void;
}

export function SpreadsheetTopbar({ fileName, workspaceName, saveState, canSave, agentOpen, onBack, onSave, onOpenExternal, onOpenAppBuilder, onToggleAgent }: SpreadsheetTopbarProps) {
  const t = useT();
  const saveLabel = t(`spreadsheet.save.${saveState}`);
  return (
    <header className="spreadsheet-topbar">
      <div className="spreadsheet-topbar__leading">
        <Button variant="ghost-normal" size="small" ariaLabel={t("spreadsheet.topbar.back")} icon={<ArrowLeft />} onClick={onBack} />
        <div className="spreadsheet-topbar__document">
          {workspaceName ? <span>{workspaceName}</span> : null}
          <strong>{fileName}</strong>
        </div>
      </div>
      <div className="spreadsheet-topbar__actions">
        <span className="spreadsheet-topbar__save-state" data-state={saveState}>{saveLabel}</span>
        {onOpenAppBuilder ? <Button variant="secondary" size="small" icon={<AppWindow />} onClick={onOpenAppBuilder}>{t("spreadsheet.topbar.appBuilder")}</Button> : null}
        <Button
          variant="primary"
          size="small"
          icon={<Save />}
          disabled={!canSave || saveState === "saving"}
          loading={saveState === "saving"}
          onClick={onSave}
        >
          {t("spreadsheet.topbar.save")}
        </Button>
        {onOpenExternal ? <Button variant="ghost-normal" size="small" ariaLabel={t("spreadsheet.topbar.openExternal")} icon={<ExternalLink />} onClick={onOpenExternal} /> : null}
        <Button
          variant="ghost-normal"
          size="small"
          ariaLabel={agentOpen ? t("spreadsheet.topbar.hideAgent") : t("spreadsheet.topbar.showAgent")}
          icon={agentOpen ? <PanelRightClose /> : <PanelRightOpen />}
          onClick={onToggleAgent}
        />
      </div>
    </header>
  );
}
