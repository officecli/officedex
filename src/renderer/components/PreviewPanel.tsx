import { Suspense } from "react";
import { X } from "lucide-react";
import type { PreviewGrant } from "../../shared/types";
import { LoadingState } from "../preview/components/LoadingState";
import { UnsupportedViewer } from "../preview/viewers/UnsupportedViewer";
import {
  PptxViewer,
  DocxViewer,
  XlsxViewer,
  PdfViewer,
  HtmlViewer,
} from "../preview/viewers/previewViewers";
import "../preview/PreviewApp.css";

interface PreviewPanelProps {
  grant: PreviewGrant;
  onClose: () => void;
}

export function PreviewPanel({ grant, onClose }: PreviewPanelProps) {
  const { token, fileName, documentType } = grant;

  const viewer = (() => {
    switch (documentType) {
      case "pptx":
        return <PptxViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      case "docx":
        return <DocxViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      case "xlsx":
        return <XlsxViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      case "pdf":
        return <PdfViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      case "html":
      case "htm":
        return <HtmlViewer previewToken={token} fileName={fileName} documentType={documentType} />;
      default:
        return <UnsupportedViewer fileName={fileName} documentType={documentType} onOpenExternal={() => {}} />;
    }
  })();

  return (
    <div className="preview-panel-root">
      <button
        type="button"
        className="preview-panel-close"
        onClick={onClose}
        title="Close Preview"
        aria-label="Close Preview"
      >
        <X size={15} strokeWidth={1.8} />
      </button>
      <div className="preview-panel-body">
        <Suspense fallback={<LoadingState fileName={fileName} />}>
          {viewer}
        </Suspense>
      </div>
    </div>
  );
}
