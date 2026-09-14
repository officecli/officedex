import { useT } from "../../i18n";
import { Button } from "../../ui";
import { FileX2 } from "lucide-react";

interface UnsupportedViewerProps {
  fileName: string;
  documentType: string;
  onOpenExternal?: () => void;
}

export function UnsupportedViewer({ fileName, documentType, onOpenExternal }: UnsupportedViewerProps) {
  const t = useT();
  return (
    <div className="preview-unsupported">
      <div className="preview-unsupported-compact">
        <span className="preview-unsupported-icon">
          <FileX2 size={24} strokeWidth={1.8} />
        </span>
        <p className="preview-unsupported-title">{t("preview.copy.unsupportedType", { type: documentType })}</p>
        <p className="preview-unsupported-msg">{t("preview.copy.unsupportedFile", { name: fileName })}</p>
        {onOpenExternal && (
          <Button type="primary" size="small" onClick={onOpenExternal}>{t("preview.copy.openExternal")}</Button>
        )}
      </div>
    </div>
  );
}
