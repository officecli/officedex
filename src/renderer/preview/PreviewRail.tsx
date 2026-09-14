import { ArrowLeft, FileText } from "lucide-react";
import { useT } from "../i18n";
import "./previewRail.css";

interface PreviewRailProps {
  readonly fileName: string;
  /** Absolute path when the host knows it; shown under the name as the target. */
  readonly filePath?: string;
  /** Returns to the file list the window was opened from. */
  readonly onBackToFiles?: () => void;
}

/**
 * The file rail for a document opened on its own.
 *
 * It lists what this window actually has — itself — rather than inventing a
 * project tree it cannot see: the preview route is mounted with a single
 * artifact grant and no workspace data, and a rail that fabricates siblings
 * would be a lie about where the file lives. `onBackToFiles` is the one thing
 * that does exist here: the way out to wherever the list really lives.
 */
export function PreviewRail({ fileName, filePath, onBackToFiles }: PreviewRailProps) {
  const t = useT();

  return (
    <div className="preview-rail">
      <h2 className="preview-rail__heading">{t("workbench.railTitle")}</h2>

      <p className="preview-rail__section">{t("workbench.railCurrent")}</p>
      <div className="preview-rail__item is-current" title={filePath ?? fileName}>
        <FileText className="preview-rail__icon" size={15} aria-hidden="true" />
        <span className="preview-rail__name">{fileName}</span>
      </div>

      {filePath && filePath !== fileName && (
        <p className="preview-rail__path" title={filePath}>
          {filePath}
        </p>
      )}

      {onBackToFiles && (
        <button type="button" className="preview-rail__back" onClick={onBackToFiles}>
          <ArrowLeft size={15} aria-hidden="true" />
          <span>{t("workbench.railBack")}</span>
        </button>
      )}
    </div>
  );
}
