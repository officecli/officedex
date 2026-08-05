import { createPortal } from "react-dom";
import { Button } from "../ui";

export interface UnsavedChangesDialogProps {
  open: boolean;
  saving: boolean;
  onSave: () => Promise<boolean>;
  onDiscard: () => void;
  onCancel: () => void;
}

export function UnsavedChangesDialog({ open, saving, onSave, onDiscard, onCancel }: UnsavedChangesDialogProps) {
  if (!open) return null;
  return createPortal(
    <div className="spreadsheet-unsaved" role="presentation">
      <div className="spreadsheet-unsaved__dialog" role="dialog" aria-modal="true" aria-labelledby="spreadsheet-unsaved-title">
        <h2 id="spreadsheet-unsaved-title">Save changes to this workbook?</h2>
        <p>Your latest cell edits have not been written to the XLSX file.</p>
        <div className="spreadsheet-unsaved__actions">
          <Button variant="secondary" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button variant="danger" disabled={saving} onClick={onDiscard}>Discard Changes</Button>
          <Button variant="primary" loading={saving} onClick={() => void onSave()}>Save and Continue</Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
