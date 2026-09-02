import { installOfficeDexPresentationBridge } from "./officedex-host-bridge";

async function start() {
  await installOfficeDexPresentationBridge();
  await import("@presentation/source-local-runtime-bootstrap");
  const runtimeEnvironment = ((window as unknown as {
    __RUNTIME_ENV__?: Record<string, unknown>;
  }).__RUNTIME_ENV__ ??= {});
  runtimeEnvironment.CDN_HOST = `${window.location.origin}/presentation/assets`;
  runtimeEnvironment.STATIC_ASSETS_PREFIX = `${window.location.origin}/presentation`;
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
