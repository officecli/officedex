import { Component, Suspense, useMemo } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { ConfigProvider, Result, Button } from "antd";
import { theme } from "../designTokens";
import { LoadingState } from "./components/LoadingState";
import { UnsupportedViewer } from "./viewers/UnsupportedViewer";
import {
  PptxViewer,
  DocxViewer,
  XlsxViewer,
  PdfViewer,
  HtmlViewer,
} from "./viewers/previewViewers";
import { officecli } from "../bridge";
import "./PreviewApp.css";

class PreviewErrorBoundary extends Component<
  { children: ReactNode },
  { error: string | null }
> {
  state: { error: string | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error: error.message || String(error) };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[PreviewApp] Render error:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="preview-error">
          <Result
            status="error"
            title="Preview Render Failed"
            subTitle={this.state.error}
            extra={
              <Button onClick={() => this.setState({ error: null })}>
                Retry
              </Button>
            }
          />
        </div>
      );
    }
    return this.props.children;
  }
}

function usePreviewParams() {
  return useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return {
      previewToken: params.get("previewToken") || "",
      fileName: params.get("fileName") || "Unknown File",
      documentType: params.get("documentType") || "",
    };
  }, []);
}

export default function PreviewApp() {
  const { previewToken, fileName, documentType } = usePreviewParams();

  const openExternal = () => {
    officecli.openPath(fileName).catch(() => {});
  };

  const viewer = (() => {
    switch (documentType) {
      case "pptx":
        return <PptxViewer previewToken={previewToken} fileName={fileName} />;
      case "docx":
        return <DocxViewer previewToken={previewToken} fileName={fileName} />;
      case "xlsx":
        return <XlsxViewer previewToken={previewToken} fileName={fileName} />;
      case "pdf":
        return <PdfViewer previewToken={previewToken} fileName={fileName} />;
      case "html":
      case "htm":
        return <HtmlViewer previewToken={previewToken} fileName={fileName} documentType={documentType} />;
      default:
        return (
          <UnsupportedViewer
            fileName={fileName}
            documentType={documentType}
            onOpenExternal={openExternal}
          />
        );
    }
  })();

  return (
    <ConfigProvider theme={theme}>
      <div className="preview-root">
        <PreviewErrorBoundary>
          <Suspense fallback={<LoadingState fileName={fileName} />}>
            {viewer}
          </Suspense>
        </PreviewErrorBoundary>
      </div>
    </ConfigProvider>
  );
}
