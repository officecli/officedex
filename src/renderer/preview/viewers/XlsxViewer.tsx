import { useCallback, useRef, useState } from "react";
import type { Artifact, PreviewGrant } from "../../../shared/types";
import { officecli } from "../../bridge";
import { useT } from "../../i18n";
import {
  SpreadsheetCanvas,
  type SpreadsheetCanvasHandle,
  type SpreadsheetCanvasState,
} from "../../spreadsheet/SpreadsheetCanvas";
import { OfficeWorkbenchLayout, type WorkbenchSaveState } from "../../workbench/OfficeWorkbenchLayout";
import { ErrorState } from "../components/ErrorState";

interface XlsxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  /** The artifact behind the grant. Without it there is nothing to edit. */
  artifact?: Artifact | null;
  grant?: PreviewGrant | null;
  onDirtyChange?: (dirty: boolean) => void;
  onRequestClose?: () => void;
}

const CANVAS_SAVE_STATE: Record<SpreadsheetCanvasState, WorkbenchSaveState> = {
  loading: "unopened",
  clean: "saved",
  saved: "saved",
  dirty: "dirty",
  saving: "saving",
  error: "error",
};

/**
 * XLSX viewer. The workbook opens in the same sheet editor the spreadsheet
 * workspace uses, so the preview is editable rather than a rendered snapshot —
 * one editor, one set of save semantics, whichever way the file was opened.
 */
export default function XlsxViewer({
  fileName,
  artifact,
  grant,
  onDirtyChange,
  onRequestClose,
}: XlsxViewerProps) {
  const t = useT();
  const canvasRef = useRef<SpreadsheetCanvasHandle>(null);
  const [canvasState, setCanvasState] = useState<SpreadsheetCanvasState>("loading");
  const [error, setError] = useState<string | undefined>(undefined);

  const openExternal = useCallback(() => {
    officecli.openPath(artifact?.filePath ?? fileName).catch(() => {});
  }, [artifact?.filePath, fileName]);

  const save = useCallback(() => {
    void canvasRef.current?.save();
  }, []);

  // A grant with no artifact behind it (a bare token, or an artifact the
  // caller could not resolve) has no file path to save back to, so the editor
  // cannot be mounted at all.
  if (!artifact || !grant) {
    return (
      <ErrorState
        message={t("xlsx.viewer.noWorkbook")}
        fileName={fileName}
        onOpenExternal={openExternal}
      />
    );
  }

  const saveState = CANVAS_SAVE_STATE[canvasState];

  return (
    <OfficeWorkbenchLayout
      documentType="xlsx"
      fileName={fileName}
      saveState={saveState}
      onBack={onRequestClose}
      backLabel={t("workbench.closePreview")}
      onSave={save}
      canSave={canvasState === "dirty"}
      onOpenExternal={openExternal}
      status={
        <span className="wb-status__item">
          {error ?? t(`workbench.state.${saveState}`)}
        </span>
      }
    >
      <SpreadsheetCanvas
        ref={canvasRef}
        artifact={artifact}
        grant={grant}
        onDirtyChange={onDirtyChange}
        onStateChange={setCanvasState}
        onError={setError}
        onSaveError={setError}
      />
    </OfficeWorkbenchLayout>
  );
}
