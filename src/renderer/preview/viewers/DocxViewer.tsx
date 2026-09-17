import { useCallback, useState } from "react";
import { FolderClosed } from "lucide-react";
import type { WriterSelectionSummary } from "../../../shared/writerProtocol";
import { useDesktopApi } from "../../services/desktopApi";
import { WriterEditorFrame, type WriterAgentEditor } from "../../word/WriterEditorFrame";
import { DocxAgentPanel, describeDocxSelection } from "../../word/DocxAgentPanel";
import { OfficeWorkbenchLayout } from "../../workbench/OfficeWorkbenchLayout";
import { PreviewRail } from "../PreviewRail";
import { useT } from "../../i18n";
import { Button, Tooltip, toast } from "../../ui";

interface DocxViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
  /** Absolute path of the artifact, shown as the panel's save target. */
  filePath?: string;
  onDirtyChange?: (dirty: boolean) => void;
  onRequestClose?: () => void;
  /**
   * This viewer is the whole window (`?offlinePreview=1`) rather than an overlay
   * on top of the cockpit. Only then does it own a file rail: under the shell
   * the rail is already there behind the overlay, and a second one inside the
   * workbench would be two drawers with the same contents.
   */
  standalone?: boolean;
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
  standalone = false,
}: DocxViewerProps) {
  const api = useDesktopApi();
  const t = useT();
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [agentEditor, setAgentEditor] = useState<WriterAgentEditor | null>(null);
  const [selection, setSelection] = useState<WriterSelectionSummary>(NO_SELECTION);

  const openExternal = useCallback(() => {
    api.openPath(filePath || fileName).catch(() => {});
  }, [filePath, fileName]);

  return (
    <OfficeWorkbenchLayout
      documentType="docx"
      fileName={fileName}
      saveState={dirty ? "dirty" : "saved"}
      // The rail carries the way out to the file list when this window has one,
      // and the title bar drops its own back button to match (the layout keeps
      // exactly one control per trip). Viewers without a rail keep the button.
      onBack={onRequestClose}
      backLabel={t("workbench.closePreview")}
      rail={
        standalone && onRequestClose
          ? {
              label: t("workbench.railTitle"),
              children: (
                <PreviewRail
                  fileName={fileName}
                  filePath={filePath}
                  onBackToFiles={onRequestClose}
                />
              ),
            }
          : undefined
      }
      onOpenExternal={openExternal}
      actions={filePath ? (
        <Tooltip title={t("preview.showInFolder")}>
          <Button
            type="text"
            size="small"
            ariaLabel={t("preview.showInFolder")}
            icon={<FolderClosed size={16} />}
            onClick={() => {
              void api.showItemInFolder(filePath).catch((error) => {
                toast.error(t("preview.showInFolderFailed", {
                  error: error instanceof Error ? error.message : String(error),
                }));
              });
            }}
          />
        </Tooltip>
      ) : undefined}
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
              children: <DocxAgentPanel key={previewToken} editor={agentEditor} filePath={filePath} selection={selection} scope={describeDocxSelection(selection, t)} />,
            }
          : undefined
      }
    >
      <WriterEditorFrame
        key={previewToken}
        onAgentReady={setAgentEditor}
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
