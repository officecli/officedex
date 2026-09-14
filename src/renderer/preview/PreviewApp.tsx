import { translate as t } from "../i18n";
import { Component, Suspense, useMemo } from "react";
import type { ReactNode, ErrorInfo } from "react";
import { Button, DialogHost, Result } from "../ui";
import { LoadingState } from "./components/LoadingState";
import { UnsupportedViewer } from "./viewers/UnsupportedViewer";
import { previewViewerFor } from "./viewers/previewViewers";
import type { PreviewViewerProps } from "./viewers/previewViewers";
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
            title={t("ui.text.Previewcouldnotberendered")}
            subTitle={this.state.error}
            extra={
              <Button onClick={() => this.setState({ error: null })}>{t("preview.copy.tryAgain")}</Button>
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

  // This route is mounted with one artifact grant and no workspace data, so it
  // cannot list the file's siblings. What it can do is hand the window back to
  // the surface that owns the list — in the browser that is the home shell; in
  // the packaged build the same URL is the app's own start screen.
  const closePreview = () => {
    window.location.href = "/";
  };

  const Viewer = previewViewerFor(documentType);
  // `standalone` is a DOCX-viewer prop: this route is the whole window, so the
  // workbench it draws should carry the file rail rather than relying on the
  // shell that is not mounted. The viewer table types every entry as the shared
  // PreviewViewerProps, which has no rail, so the flag is checked here instead.
  const viewerProps = {
    previewToken,
    fileName,
    documentType,
    onRequestClose: closePreview,
    standalone: true,
  } as PreviewViewerProps & { standalone: boolean };
  const viewer = Viewer ? (
    <Viewer {...viewerProps} />
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
