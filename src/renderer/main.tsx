import ReactDOM from "react-dom/client";
import { Suspense, StrictMode, lazy } from "react";
import "@xyflow/react/dist/style.css";
import { App } from "./App";
import { LocaleProvider } from "./i18n";
import { mountTheme } from "./ui/theme";
import "./ui/design-tokens.css";
import "./styles/beautiful.css";
import "./styles/tokens.css";
import "./styles/shell.css";
import "./styles/home.css";
import "./styles/spreadsheet.css";
import "./styles/app-builder.css";
import "./styles/settings.css";
import "./styles/tasks.css";
import "./styles/onboarding-update.css";

mountTheme();

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
