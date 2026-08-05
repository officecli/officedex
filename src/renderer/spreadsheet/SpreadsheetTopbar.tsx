import { ArrowLeft, ExternalLink, PanelRightClose, PanelRightOpen, Save } from "lucide-react";
import { Button } from "../ui";

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
  onToggleAgent: () => void;
}

const saveLabels: Record<SpreadsheetSaveState, string> = {
  unopened: "Not opened",
  saved: "Saved",
  dirty: "Unsaved",
  saving: "Saving…",
  error: "Save failed",
};

export function SpreadsheetTopbar({ fileName, workspaceName, saveState, canSave, agentOpen, onBack, onSave, onOpenExternal, onToggleAgent }: SpreadsheetTopbarProps) {
  return (
    <header className="spreadsheet-topbar">
      <div className="spreadsheet-topbar__leading">
        <Button variant="ghost-normal" size="small" ariaLabel="Back to project home" icon={<ArrowLeft />} onClick={onBack} />
        <div className="spreadsheet-topbar__document">
          {workspaceName ? <span>{workspaceName}</span> : null}
          <strong>{fileName}</strong>
        </div>
      </div>
      <div className="spreadsheet-topbar__actions">
        <span className="spreadsheet-topbar__save-state" data-state={saveState}>{saveLabels[saveState]}</span>
        <Button
          variant="primary"
          size="small"
          icon={<Save />}
          disabled={!canSave || saveState === "saving"}
          loading={saveState === "saving"}
          onClick={onSave}
        >
          Save
        </Button>
        {onOpenExternal ? <Button variant="ghost-normal" size="small" ariaLabel="Open in System App" icon={<ExternalLink />} onClick={onOpenExternal} /> : null}
        <Button
          variant="ghost-normal"
          size="small"
          ariaLabel={agentOpen ? "Hide AI assistant" : "Show AI assistant"}
          icon={agentOpen ? <PanelRightClose /> : <PanelRightOpen />}
          onClick={onToggleAgent}
        />
      </div>
    </header>
  );
}
