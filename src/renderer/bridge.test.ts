import { afterEach, describe, expect, it, vi } from "vitest";

import { createRealE2EAPI, normaliseRecentFiles } from "./bridge";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recent file bridge normalization", () => {
  it("normalizes recent files from the desktop bridge", () => {
    expect(normaliseRecentFiles([{
      filePath: "/tmp/deck.pptx",
      fileName: "deck.pptx",
      documentType: "pptx",
      source: "generated",
      workspaceId: "ws-a",
      taskId: "task-a",
      conversationId: "conv-a",
      lastOpenedAt: "2026-08-05T01:00:00Z",
    }, null, { filePath: "" }])).toEqual([{
      filePath: "/tmp/deck.pptx",
      fileName: "deck.pptx",
      documentType: "pptx",
      source: "generated",
      workspaceId: "ws-a",
      taskId: "task-a",
      conversationId: "conv-a",
      lastOpenedAt: "2026-08-05T01:00:00Z",
    }]);
  });

  it("fills safe defaults without accepting invalid sources", () => {
    expect(normaliseRecentFiles([{
      filePath: "/tmp/local.pdf",
      source: "local",
    }, {
      filePath: "/tmp/remote.pdf",
      source: "remote",
    }])).toEqual([expect.objectContaining({
      filePath: "/tmp/local.pdf",
      fileName: "local.pdf",
      documentType: "pdf",
      source: "local",
    })]);
  });
});

describe("real E2E browser event transport", () => {
  it("multiplexes renderer channels over one EventSource per tab", () => {
    class FakeEventSource {
      static instances: FakeEventSource[] = [];
      readonly listeners = new Map<string, EventListener>();
      onmessage: ((event: MessageEvent) => void) | null = null;
      closed = false;

      constructor(readonly url: string) {
        FakeEventSource.instances.push(this);
      }

      addEventListener(type: string, listener: EventListener) {
        this.listeners.set(type, listener);
      }

      close() {
        this.closed = true;
      }

      emit(channel: string, payload: unknown) {
        this.listeners.get(channel)?.({ data: JSON.stringify({ channel, payload }) } as MessageEvent as Event);
      }
    }

    vi.stubGlobal("EventSource", FakeEventSource);
    const api = createRealE2EAPI("http://127.0.0.1:53251");
    const onAuth = vi.fn();
    const onBridge = vi.fn();
    const onFileDrop = vi.fn();

    const offAuth = api.onAuthEvent(onAuth);
    const offBridge = api.onBridgeEvent(onBridge);
    const offFileDrop = api.onFileDrop(onFileDrop);

    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.instances[0].url).toBe("http://127.0.0.1:53251/events?channel=*");

    FakeEventSource.instances[0].emit("bridge", { type: "bridge.reconnected" });
    FakeEventSource.instances[0].emit("filedrop", ["/tmp/deck.pptx"]);
    expect(onBridge).toHaveBeenCalledWith({ type: "bridge.reconnected" });
    expect(onFileDrop).toHaveBeenCalledWith(["/tmp/deck.pptx"]);
    expect(onAuth).not.toHaveBeenCalled();

    offAuth();
    offBridge();
    expect(FakeEventSource.instances[0].closed).toBe(false);
    offFileDrop();
    expect(FakeEventSource.instances[0].closed).toBe(true);
  });
});
