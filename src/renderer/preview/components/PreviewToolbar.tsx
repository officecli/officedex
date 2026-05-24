import { Button, Tooltip } from "antd";
import { FileText, FileSpreadsheet, Presentation, FileType, FileCode2, ZoomIn, ZoomOut, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";

const TYPE_CONFIG: Record<string, { icon: typeof FileText; color: string; label: string }> = {
  docx: { icon: FileText, color: "#2B579A", label: "DOC" },
  xlsx: { icon: FileSpreadsheet, color: "#217346", label: "XLS" },
  pptx: { icon: Presentation, color: "#D24726", label: "PPT" },
  pdf: { icon: FileType, color: "#E8392A", label: "PDF" },
  html: { icon: FileCode2, color: "#E44D26", label: "HTML" },
  htm: { icon: FileCode2, color: "#E44D26", label: "HTML" },
};

interface PreviewToolbarProps {
  fileName: string;
  documentType?: string;
  center?: ReactNode;
  onOpenExternal?: () => void;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  zoom?: number;
}

export function PreviewToolbar({
  fileName,
  documentType,
  center,
  onOpenExternal,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  zoom,
}: PreviewToolbarProps) {
  const typeKey = documentType?.toLowerCase() ?? "";
  const config = TYPE_CONFIG[typeKey];
  const TypeIcon = config?.icon ?? FileText;

  return (
    <div className="preview-toolbar">
      <div className="preview-toolbar-left">
        <span className="preview-toolbar-type-icon" style={config ? { color: config.color } : undefined}>
          <TypeIcon size={16} strokeWidth={1.8} />
        </span>
        <span className="preview-toolbar-filename" title={fileName}>{fileName}</span>
        {config && (
          <span className="preview-toolbar-type-badge" style={{ background: config.color }}>
            {config.label}
          </span>
        )}
      </div>

      {center && <div className="preview-toolbar-center">{center}</div>}

      <div className="preview-toolbar-right">
        {(onZoomOut || onZoomIn) && (
          <div className="preview-toolbar-zoom-group">
            {onZoomOut && (
              <button className="preview-toolbar-zoom-btn" onClick={onZoomOut} title="Zoom Out">
                <ZoomOut size={14} strokeWidth={1.8} />
              </button>
            )}
            {zoom != null && onZoomReset && (
              <button className="preview-toolbar-zoom-pct" onClick={onZoomReset} title="Reset Zoom">
                {Math.round(zoom * 100)}%
              </button>
            )}
            {onZoomIn && (
              <button className="preview-toolbar-zoom-btn" onClick={onZoomIn} title="Zoom In">
                <ZoomIn size={14} strokeWidth={1.8} />
              </button>
            )}
          </div>
        )}

        {onOpenExternal && (
          <Tooltip title="Open File">
            <Button
              size="small"
              type="text"
              icon={<ExternalLink size={14} strokeWidth={1.8} />}
              onClick={onOpenExternal}
            />
          </Tooltip>
        )}
      </div>
    </div>
  );
}
