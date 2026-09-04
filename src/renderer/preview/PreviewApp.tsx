import { Component, Suspense, useMemo } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Button, DialogHost, Result } from "../ui";
import { LoadingState } from "./components/LoadingState";
import { UnsupportedViewer } from "./viewers/UnsupportedViewer";
import { previewViewerFor } from "./viewers/previewViewers";
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

  const Viewer = previewViewerFor(documentType);
  const viewer = Viewer ? (
    <Viewer previewToken={previewToken} fileName={fileName} documentType={documentType} />
  ) : (
    <UnsupportedViewer
      fileName={fileName}
      documentType={documentType}
      onOpenExternal={openExternal}
    />
  );

  return (
    <>
      <DialogHost />
      <div className="preview-root">
        <PreviewErrorBoundary>
          <Suspense fallback={<LoadingState fileName={fileName} />}>
            {viewer}
          </Suspense>
        </PreviewErrorBoundary>
      </div>
    </>
  );
}
