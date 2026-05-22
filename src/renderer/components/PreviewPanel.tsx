import { Suspense, lazy } from "react";
import type { PreviewGrant } from "../../shared/types";
import { LoadingState } from "../preview/components/LoadingState";
import { UnsupportedViewer } from "../preview/viewers/UnsupportedViewer";
import "../preview/PreviewApp.css";

const OfficeHtmlViewer = lazy(() => import("../preview/viewers/OfficeHtmlViewer"));
const DocxViewer = lazy(() => import("../preview/viewers/DocxViewer"));
const XlsxViewer = lazy(() => import("../preview/viewers/XlsxViewer"));
const PdfViewer = lazy(() => import("../preview/viewers/PdfViewer"));
const HtmlViewer = lazy(() => import("../preview/viewers/HtmlViewer"));

interface PreviewPanelProps {
  grant: PreviewGrant;
  onClose: () => void;
}

export function PreviewPanel({ grant, onClose }: PreviewPanelProps) {
  const { token, fileName, documentType } = grant;

  const viewer = (() => {
    switch (documentType) {
      case "pptx":
        return <OfficeHtmlViewer previewToken={token} fileName={fileName} documentType={documentType} onClose={onClose} />;
      case "docx":
        return <DocxViewer previewToken={token} fileName={fileName} documentType={documentType} onClose={onClose} />;
      case "xlsx":
        return <XlsxViewer previewToken={token} fileName={fileName} documentType={documentType} onClose={onClose} />;
      case "pdf":
        return <PdfViewer previewToken={token} fileName={fileName} documentType={documentType} onClose={onClose} />;
      case "html":
      case "htm":
        return <HtmlViewer previewToken={token} fileName={fileName} documentType={documentType} onClose={onClose} />;
      default:
        return <UnsupportedViewer fileName={fileName} documentType={documentType} onOpenExternal={() => {}} />;
    }
  })();

  return (
    <div className="preview-panel-root">
      <div className="preview-panel-body">
        <Suspense fallback={<LoadingState fileName={fileName} />}>
          {viewer}
        </Suspense>
      </div>
    </div>
  );
}
