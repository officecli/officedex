import { lazy } from "react";

export const PptxViewer = lazy(() => import("./PptxViewer"));
export const DocxViewer = lazy(() => import("./DocxViewer"));
export const XlsxViewer = lazy(() => import("./XlsxViewer"));
export const PdfViewer = lazy(() => import("./PdfViewer"));
export const HtmlViewer = lazy(() => import("./HtmlViewer"));
