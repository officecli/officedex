import ReactDOM from "react-dom/client";
import { Suspense, StrictMode, lazy } from "react";
import "@xyflow/react/dist/style.css";
import { App } from "./App";
import { PerfPptistCompletedScreen } from "./screens/PerfPptistCompletedScreen";
import { LocaleProvider } from "./i18n";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/home.css";
import "./styles/spreadsheet.css";
import "./styles/app-builder.css";
import "./styles/dialogue.css";
import "./styles/settings.css";
import "./styles/tasks.css";
import "./styles/onboarding-update.css";
import "./styles/vibe-officing-demo.css";

const PreviewApp = lazy(() => import("./preview/PreviewApp"));

function isOfflinePreviewRoute() {
  return new URLSearchParams(window.location.search).has("offlinePreview");
}

function isPptistPerfRoute() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get("perf") === "pptist-completed";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LocaleProvider>
      {isOfflinePreviewRoute() ? (
        <Suspense>
          <PreviewApp />
        </Suspense>
      ) : isPptistPerfRoute() ? (
        <PerfPptistCompletedScreen />
      ) : (
        <App />
      )}
    </LocaleProvider>
  </StrictMode>,
);
