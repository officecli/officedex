import { Button } from "antd";
import { AlertCircle } from "lucide-react";

interface ErrorStateProps {
  message: string;
  fileName: string;
  onRetry: () => void;
  onOpenExternal?: () => void;
}

export function ErrorState({ message, fileName, onRetry, onOpenExternal }: ErrorStateProps) {
  return (
    <div className="preview-error">
      <div className="preview-error-compact">
        <span className="preview-error-icon">
          <AlertCircle size={24} strokeWidth={1.8} />
        </span>
        <p className="preview-error-title">Cannot preview {fileName}</p>
        <p className="preview-error-msg">{message}</p>
        <div className="preview-error-actions">
          <Button type="primary" size="small" onClick={onRetry}>
            Retry
          </Button>
          {onOpenExternal && (
            <Button size="small" onClick={onOpenExternal}>
              Open in System App
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
