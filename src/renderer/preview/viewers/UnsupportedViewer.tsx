import { Button } from "antd";
import { FileX2 } from "lucide-react";

interface UnsupportedViewerProps {
  fileName: string;
  documentType: string;
  onOpenExternal?: () => void;
}

export function UnsupportedViewer({ fileName, documentType, onOpenExternal }: UnsupportedViewerProps) {
  return (
    <div className="preview-unsupported">
      <div className="preview-unsupported-compact">
        <span className="preview-unsupported-icon">
          <FileX2 size={24} strokeWidth={1.8} />
        </span>
        <p className="preview-unsupported-title">.{documentType} format not supported for preview</p>
        <p className="preview-unsupported-msg">File {fileName} is not supported for preview</p>
        {onOpenExternal && (
          <Button type="primary" size="small" onClick={onOpenExternal}>
            Open in System App
          </Button>
        )}
      </div>
    </div>
  );
}
