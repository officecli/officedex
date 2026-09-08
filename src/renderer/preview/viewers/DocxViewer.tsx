import { useState } from "react";
import { PreviewToolbar } from "../components/PreviewToolbar";
import { officecli } from "../../bridge";
import { WriterEditorFrame } from "../../word/WriterEditorFrame";
import { useT } from "../../i18n";

interface DocxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  onDirtyChange?: (dirty: boolean) => void;
}

/**
 * DOCX viewer. The document opens in the embedded Writer editor, which is a
 * paginated layout engine — what it draws is the print layout, so there is no
 * separate preview mode. When the Writer component is not installed the frame
 * reports itself unavailable and this shows why instead of an empty pane.
 */
export default function DocxViewer({
  previewToken,
  fileName,
  documentType,
  onDirtyChange,
}: DocxViewerProps) {
  const t = useT();
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  return (
    <div className="docx-workspace">
      <PreviewToolbar
        fileName={fileName}
        documentType={documentType ?? "docx"}
        onOpenExternal={openExternal}
      />
      {unavailable && (
        <div className="docx-editor-unavailable" role="note">
          {t("docx.viewer.editorUnavailable")}
        </div>
      )}
      <div className="docx-workspace-body">
        <WriterEditorFrame
          previewToken={previewToken}
          fileName={fileName}
          onDirtyChange={onDirtyChange}
          onUnavailable={(error) => setUnavailable(error ?? "")}
        />
      </div>
    </div>
  );
}
