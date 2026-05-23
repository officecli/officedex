import ReactDOM from "react-dom/client";
import { Suspense, StrictMode, lazy } from "react";
import { App } from "./App";
import { LocaleProvider } from "./i18n";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/dialogue.css";
import "./styles/settings.css";
import "./styles/tasks.css";
import "./styles/onboarding-update.css";

const PreviewApp = lazy(() => import("./preview/PreviewApp"));

function isOfflinePreviewRoute() {
  return new URLSearchParams(window.location.search).has("offlinePreview");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      {isOfflinePreviewRoute() ? (
        <Suspense>
          <PreviewApp />
        </Suspense>
      ) : (
        <App />
      )}
    </LocaleProvider>
  </StrictMode>,
);
