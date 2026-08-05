import { createPortal } from "react-dom";
import { Button } from "../ui";
import { useT } from "../i18n";

export interface UnsavedChangesDialogProps {
  open: boolean;
  saving: boolean;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ open, saving, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  const t = useT();
  if (!open) return null;
  return createPortal(
    <div className="spreadsheet-unsaved" role="presentation">
      <div className="spreadsheet-unsaved__dialog" role="dialog" aria-modal="true" aria-labelledby="spreadsheet-unsaved-title">
        <h2 id="spreadsheet-unsaved-title">{t("spreadsheet.unsaved.title")}</h2>
        <p>{t("spreadsheet.unsaved.body")}</p>
        <div className="spreadsheet-unsaved__actions">
          <Button variant="secondary" disabled={saving} onClick={onCancel}>{t("spreadsheet.unsaved.cancel")}</Button>
          <Button variant="danger" disabled={saving} onClick={onDiscard}>{t("spreadsheet.unsaved.discard")}</Button>
          <Button variant="primary" loading={saving} onClick={() => void onSave()}>{t("spreadsheet.unsaved.save")}</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
