import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DesktopAPI } from "../../shared/types";
import type { PresentationEmbedEvent, PresentationHostCommand } from "../../shared/presentationProtocol";
import { DesktopApiProvider } from "../services/desktopApi";
import { PresentationEditorFrame } from "./PresentationEditorFrame";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ protocolVersion: 1 }) })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const prepared = (id: string) => ({ sessionId: `session-${id}`, fileId: id, title: id, sourceFileName: `${id}.pptx`, content: new Uint8Array([id.charCodeAt(0)]), documentRevision: 0, assets: [] });
async function say(source: Window, data: PresentationEmbedEvent) {
  await act(async () => { window.dispatchEvent(new MessageEvent("message", { source, data })); await vi.advanceTimersByTimeAsync(0); });
}

it.each([false, true])("isolates the new deck from the previous iframe and late prepare (delayed=%s)", async delayed => {
  let resolveA!: (value: ReturnType<typeof prepared>) => void;
  const pendingA = new Promise<ReturnType<typeof prepared>>(resolve => { resolveA = resolve; });
  const api = {
    preparePptxEditor: vi.fn(async (token: string) => token === "A" && delayed ? pendingA : prepared(token)),
    closePptxEditor: vi.fn(async () => {}),
    savePptxEditorSnapshot: vi.fn(async () => ({ revision: 1 })),
    exportPptxEditor: vi.fn(async () => ({ filePath: "/B.pptx", revision: 1 })),
  } as unknown as DesktopAPI;
  const onController = vi.fn(); const onReady = vi.fn(); const onUnavailable = vi.fn();
  const view = (token: string) => <DesktopApiProvider api={api}><PresentationEditorFrame previewToken={token} fileName={`${token}.pptx`} onController={onController} onReady={onReady} onUnavailable={onUnavailable} /></DesktopApiProvider>;
  const { rerender } = render(view("A")); await settle();
  const frameA = document.querySelector("iframe")!; const windowA = frameA.contentWindow!;
  await say(windowA, { type: "presentation:embed-ready", protocolVersion: 1 });
  const oldController = onController.mock.calls.at(-1)?.[0];
  rerender(view("B")); await settle();
  const frameB = document.querySelector("iframe")!; const windowB = frameB.contentWindow!;
  expect(frameB).not.toBe(frameA);
  const post = vi.spyOn(windowB, "postMessage");
  await say(windowB, { type: "presentation:embed-ready", protocolVersion: 1 });
  if (delayed) { await act(async () => { resolveA(prepared("A")); }); }
  await say(windowA, { type: "presentation:dirty-changed", dirty: true });
  await say(windowA, { type: "presentation:save-snapshot", sessionId: "session-A", requestId: "stale", content: new ArrayBuffer(1), baseRevision: 0, revision: 1 });
  expect(api.savePptxEditorSnapshot).not.toHaveBeenCalled();
  expect(post.mock.calls.filter(call => call[0].type === "presentation:load").map(call => call[0].fileId)).toEqual(["B"]);
  expect(api.closePptxEditor).toHaveBeenCalledWith({ previewToken: "A", sessionId: "session-A" });
  const controller = onController.mock.calls.at(-1)![0];
  expect(controller.session()).toEqual({ previewToken: "B", sessionId: "session-B" });
  if (oldController) await expect(oldController.executeScript("old edit")).rejects.toThrow();
  let saved = false;
  const saving = controller.save().then(() => { saved = true; });
  await settle();
  const request = post.mock.calls.map(call => call[0] as PresentationHostCommand).find(command => command.type === "presentation:flush")!;
  await say(windowA, { type: "presentation:flush-result", requestId: request.requestId, ok: true, revision: 0 });
  expect(saved).toBe(false);
  expect(api.exportPptxEditor).not.toHaveBeenCalled();
  await say(windowB, { type: "presentation:flush-result", requestId: request.requestId, ok: true, revision: 0 });
  await saving;
  expect(api.exportPptxEditor).toHaveBeenCalledWith({ previewToken: "B", sessionId: "session-B", revision: 0 });
  expect(onUnavailable).not.toHaveBeenCalled();
});
