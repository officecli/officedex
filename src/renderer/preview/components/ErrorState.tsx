import { useT } from "../../i18n";
import { Button } from "../../ui";
import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  message: string;
  fileName: string;
  onRetry?: () => void;
  onOpenExternal?: () => void;
}

export function ErrorState({ message, fileName, onRetry, onOpenExternal }: ErrorStateProps) {
  const t = useT();
  return (
    <div className="preview-error">
      <div className="preview-error-compact">
        <span className="preview-error-icon">
          <AlertCircle size={24} strokeWidth={1.8} />
        </span>
        <p className="preview-error-title">{t("preview.copy.cannot", { name: fileName })}</p>
        <p className="preview-error-msg">{message}</p>
        <div className="preview-error-actions">
          {onRetry && (
            <Button type="primary" size="small" onClick={onRetry}>{t("preview.copy.retry")}</Button>
          )}
          {onOpenExternal && (
            <Button size="small" onClick={onOpenExternal}>{t("preview.copy.openExternal")}</Button>
          )}
        </div>
      </div>
    </div>
  );
}
