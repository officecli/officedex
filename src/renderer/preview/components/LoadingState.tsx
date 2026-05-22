import { FileText } from "lucide-react";

export function LoadingState({ fileName }: { fileName: string }) {
  return (
    <div className="preview-loading">
      <span className="preview-loading-icon">
        <FileText size={36} strokeWidth={1.2} />
      </span>
      <p className="preview-loading-text">Rendering {fileName}…</p>
      <div className="preview-loading-bar">
        <div className="preview-loading-bar-fill" />
      </div>
    </div>
  );
}
