import { lazy } from "react";
import type { ComponentType, LazyExoticComponent } from "react";

export const PptxViewer = lazy(() => import("./PptxViewer"));
export const DocxViewer = lazy(() => import("./DocxViewer"));
export const XlsxViewer = lazy(() => import("./XlsxViewer"));
export const PdfViewer = lazy(() => import("./PdfViewer"));
export const HtmlViewer = lazy(() => import("./HtmlViewer"));

export interface PreviewViewerProps {
  previewToken: string;
  fileName: string;
  documentType?: string;
}

type PreviewViewer = LazyExoticComponent<ComponentType<PreviewViewerProps>>;

// Viewer per preview extension. PreviewApp used to switch over document types
// inline, so adding a viewer meant editing the switch and the imports; now it
// is a row here (and the extension in the capability table).
export const PREVIEW_VIEWERS: Readonly<Record<string, PreviewViewer>> = {
  pptx: PptxViewer as PreviewViewer,
  docx: DocxViewer as PreviewViewer,
  xlsx: XlsxViewer as PreviewViewer,
  pdf: PdfViewer as PreviewViewer,
  html: HtmlViewer as PreviewViewer,
  htm: HtmlViewer as PreviewViewer,
};

export function previewViewerFor(documentType: string | undefined): PreviewViewer | undefined {
  const key = (documentType ?? "").toLowerCase().replace(/^\./, "");
  return Object.prototype.hasOwnProperty.call(PREVIEW_VIEWERS, key) ? PREVIEW_VIEWERS[key] : undefined;
}
