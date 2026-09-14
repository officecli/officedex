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

it("preserves export diagnostics across the editor message boundary", async () => {
  const channel = "export-diagnostic-channel";
  let requestId = "";
  const target = { postMessage(message: { requestId: string }) { requestId = message.requestId; } } as unknown as Window;
  const client = new PresentationPptxEmbedClient({ channel, getTargetWindow: () => target, hostWindow: window });
  client.attach();
  const reply = (message: object) => window.dispatchEvent(new MessageEvent("message", { data: { protocol: PRESENTATION_PPTX_PROTOCOL, channel, ...message } }));
  try {
    reply({ type: "officedex:pptx-editor-ready", fileId: "test" });
    const exported = client.export();
    reply({ type: "officedex:pptx-export-result", requestId, error: "PPTX export failed.", errorCode: "PPTX_GENERATION_FAILED", errorDetail: "Invalid embedded image at root.blocks[14].data[3].resourceUri" });
    await expect(exported).rejects.toMatchObject({ message: "PPTX export failed.", code: "PPTX_GENERATION_FAILED", detail: "Invalid embedded image at root.blocks[14].data[3].resourceUri" });
  } finally { client.dispose(); }
});
