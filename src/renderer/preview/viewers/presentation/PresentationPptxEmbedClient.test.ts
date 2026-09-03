import { describe, expect, it } from "vitest";
import {
  PRESENTATION_PPTX_PROTOCOL,
  type PresentationPptxEditorMessage,
} from "../../../../shared/presentationPptxProtocol";
import { PresentationPptxEmbedClient } from "./PresentationPptxEmbedClient";

describe("PresentationPptxEmbedClient editor bootstrap errors", () => {
  it("rejects editor readiness immediately with the iframe error", async () => {
    const channel = "test-channel";
    const target = { postMessage() {} } as unknown as Window;
    const client = new PresentationPptxEmbedClient({
      channel,
      getTargetWindow: () => target,
      hostWindow: window,
    });
    client.attach();
    const ready = client.waitForEditorReady(60_000);
    const message: PresentationPptxEditorMessage = {
      protocol: PRESENTATION_PPTX_PROTOCOL,
      channel,
      type: "officedex:pptx-editor-error",
      phase: "open",
      error: "Promise.withResolvers is not a function",
    };
    window.dispatchEvent(new MessageEvent("message", { data: message }));
    await expect(ready).rejects.toThrow("Promise.withResolvers is not a function");
    expect(client.getState().lastError).toBe("Promise.withResolvers is not a function");
    client.dispose();
  });
});
