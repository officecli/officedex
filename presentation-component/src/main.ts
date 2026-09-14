import "./editor-polish.css";
import { installOfficeDexPresentationBridge } from "./officedex-host-bridge";
import { installPptxImportTransport } from "./pptx-import-transport";
import { usesPresentationCompatibilityProtocol } from "./protocol-mode";
import { configureEmbeddedPresentationRuntime } from "./embedded-runtime";

async function start() {
  document.documentElement.dataset.officedexEditor = "true";
  let language = navigator.language;
  try { language = localStorage.getItem("officedex.locale") || language; } catch { /* browser preference remains available */ }
  document.documentElement.lang = language.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
  // The normal OfficeDex stage uses the presentation:* host bridge. The
  // existing rich PPTX workbench uses the source repository's
  // officedex:pptx-* compatibility protocol. Both modes run from this same
  // fegit presentation bundle; selecting one here prevents two bridges from
  // competing for the same document boot.
  if (usesPresentationCompatibilityProtocol(window.location.search)) {
    installPptxImportTransport();
  } else {
    await installOfficeDexPresentationBridge();
  }
  await import("@presentation/source-local-runtime-bootstrap");
  const runtimeEnvironment = ((window as unknown as {
    __RUNTIME_ENV__?: Record<string, unknown>;
  }).__RUNTIME_ENV__ ??= {});
  configureEmbeddedPresentationRuntime(runtimeEnvironment, window.location.origin);
  await import("@presentation/source-main");
}

void start().catch((error) => {
  window.parent.postMessage(
    {
      type: "presentation:embed-error",
      error: error instanceof Error ? error.message : String(error),
    },
    "*",
  );
});
