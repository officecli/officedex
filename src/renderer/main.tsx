import ReactDOM from "react-dom/client";
import { Suspense, StrictMode, lazy } from "react";
import "@xyflow/react/dist/style.css";
import { App } from "./App";
import { PerfPptistCompletedScreen } from "./screens/PerfPptistCompletedScreen";
import { LocaleProvider } from "./i18n";
import { mountTheme } from "./ui/theme";
import "./ui/design-tokens.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/dialogue.css";
import "./styles/settings.css";
import "./styles/tasks.css";
import "./styles/onboarding-update.css";
import "./styles/vibe-officing-demo.css";
import "./styles/beautiful.css";

const PreviewApp = lazy(() => import("./preview/PreviewApp"));

function isOfflinePreviewRoute() {
  return new URLSearchParams(window.location.search).has("offlinePreview");
}

function isPptistPerfRoute() {
  return import.meta.env.DEV && new URLSearchParams(window.location.search).get("perf") === "pptist-completed";
}

// Mount the local Beautiful UI semantic palette before the first render so
// `ui/design-tokens.css` can resolve the app-level `--od-*` aliases.
mountTheme();

// Keep the existing non-StrictMode shell while bridge and embedded editor
// lifecycles are still being normalized; local primitives themselves are
// StrictMode-safe (see strictmode-select.test.tsx).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <>
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
  </>,
);
