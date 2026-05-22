import ReactDOM from "react-dom/client";
import { Suspense, StrictMode, lazy } from "react";
import { App } from "./App";
import "./styles.css";

const PreviewApp = lazy(() => import("./preview/PreviewApp"));

function isOfflinePreviewRoute() {
  return new URLSearchParams(window.location.search).has("offlinePreview");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {isOfflinePreviewRoute() ? (
      <Suspense>
        <PreviewApp />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
);
