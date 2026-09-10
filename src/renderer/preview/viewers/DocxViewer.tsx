import { useCallback, useState } from "react";
import type { WriterSelectionSummary } from "../../../shared/writerProtocol";
import { officecli } from "../../bridge";
import { WriterEditorFrame } from "../../word/WriterEditorFrame";
import { DocxAgentPanel, describeDocxSelection } from "../../word/DocxAgentPanel";
import { OfficeWorkbenchLayout } from "../../workbench/OfficeWorkbenchLayout";
import { useT } from "../../i18n";

interface DocxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  /** Absolute path of the artifact, shown as the panel's save target. */
  filePath?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onRequestClose?: () => void;
}

/** Before Writer reports anything, an instruction would apply to the whole file. */
const NO_SELECTION: WriterSelectionSummary = { empty: true, collapsed: true };

/**
 * DOCX viewer. The document opens in the embedded Writer editor, which is a
 * paginated layout engine — what it draws is the print layout, so there is no
 * separate preview mode. When the Writer component is not installed the frame
 * reports itself unavailable and this shows why instead of an empty pane.
 */
export default function DocxViewer({
  previewToken,
  fileName,
  filePath,
  onDirtyChange,
  onRequestClose,
}: DocxViewerProps) {
  const t = useT();
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [selection, setSelection] = useState<WriterSelectionSummary>(NO_SELECTION);

  const openExternal = useCallback(() => {
    officecli.openPath(filePath || fileName).catch(() => {});
  }, [filePath, fileName]);

  return (
    <OfficeWorkbenchLayout
      documentType="docx"
      fileName={fileName}
      saveState={dirty ? "dirty" : "saved"}
      onBack={onRequestClose}
      backLabel={t("workbench.closePreview")}
      onOpenExternal={openExternal}
      notice={
        unavailable !== null ? (
          <div className="wb-notice" role="note">
            {t("docx.viewer.editorUnavailable")}
          </div>
        ) : undefined
      }
      // No panel while the editor is missing: there is nothing to scope an
      // instruction to, and a live selection chip would be a lie.
      panel={
        unavailable === null
          ? {
              title: t("docx.agent.panelTitle"),
              target: t("docx.agent.target", { file: fileName }),
              targetTitle: filePath ?? fileName,
              scope: describeDocxSelection(selection, t),
              children: <DocxAgentPanel />,
            }
          : undefined
      }
    >
      <WriterEditorFrame
        previewToken={previewToken}
        fileName={fileName}
        onDirtyChange={(next) => {
          setDirty(next);
          onDirtyChange?.(next);
        }}
        onSelectionChange={setSelection}
        onUnavailable={(error) => setUnavailable(error ?? "")}
      />
    </OfficeWorkbenchLayout>
  );
}
