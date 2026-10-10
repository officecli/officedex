import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useKeyboardShortcuts } from "./useKeyboardShortcuts";

const mocks = vi.hoisted(() => ({ save: vi.fn(), file: { id: "deck", name: "OD23.pptx" } }));
vi.mock("./useFileActions", () => ({ useFileActions: () => ({ save: mocks.save }) }));
vi.mock("../nav/useLibraryActions", () => ({ useLibraryActions: () => ({ openFromDisk: vi.fn() }) }));
vi.mock("../state/ShellContext", () => ({ useShell: () => ({ dispatch: vi.fn(), activeFile: mocks.file }) }));

afterEach(() => { cleanup(); document.querySelectorAll("iframe").forEach(frame => frame.remove()); vi.clearAllMocks(); });

it("saves through the same host action from slide title, notes and shell focus, exactly once", async () => {
  const hook = renderHook(() => useKeyboardShortcuts({ onNew: vi.fn() }));
  const frame = document.createElement("iframe"); document.body.append(frame);
  frame.contentDocument!.body.innerHTML = '<div contenteditable="true">Slide title</div><textarea>Notes</textarea>';
  await act(async () => {}); // MutationObserver binds the newly mounted frame.
  const editorSave = vi.fn(); frame.contentWindow!.addEventListener("keydown", editorSave);
  const press = (element: Element, patch = {}) => {
    const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true, ...patch });
    element.dispatchEvent(event); return event;
  };
  for (const target of [frame.contentDocument!.querySelector("div")!, frame.contentDocument!.querySelector("textarea")!, document.body]) {
    expect(press(target).defaultPrevented).toBe(true);
  }
  expect(mocks.save).not.toHaveBeenCalled(); // no binding on the iframe event stack
  await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(3));
  expect(mocks.save).toHaveBeenLastCalledWith(mocks.file, { quiet: true });
  expect(editorSave).not.toHaveBeenCalled();
  press(document.body, { shiftKey: true }); press(document.body, { altKey: true }); press(document.body, { isComposing: true });
  expect(mocks.save).toHaveBeenCalledTimes(3);
  hook.unmount(); press(document.body);
  expect(mocks.save).toHaveBeenCalledTimes(3);
});

it("removes listeners from unmounted editor frames", async () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  const win = frame.contentWindow!;
  const remove = vi.spyOn(win, "removeEventListener");
  renderHook(() => useKeyboardShortcuts({ onNew: vi.fn() }));
  frame.remove();
  await waitFor(() => expect(remove).toHaveBeenCalledWith("keydown", expect.any(Function), true));
});

it("N24-04 native menu Save reaches the same action with editor focus and unsubscribes", () => {
  const dispose = vi.fn(); let callback!: () => void;
  const original = (window as unknown as { runtime?: unknown }).runtime;
  Object.assign(window, { runtime: { EventsOnMultiple: vi.fn((_name, cb) => { callback = cb; return dispose; }) } });
  try {
    const hook = renderHook(() => useKeyboardShortcuts({ onNew: vi.fn() }));
    callback();
    expect(mocks.save).toHaveBeenCalledWith(mocks.file, { quiet: true });
    hook.unmount(); expect(dispose).toHaveBeenCalledOnce();
  } finally { Object.assign(window, { runtime: original }); }
});


it("exports even when the editor has already claimed Cmd+S for its own session flush", async () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  frame.contentDocument!.body.innerHTML = '<textarea>Notes</textarea>';
  const editorFlush = vi.fn((event: KeyboardEvent) => event.preventDefault());
  frame.contentWindow!.addEventListener("keydown", editorFlush, true);
  renderHook(() => useKeyboardShortcuts({ onNew: vi.fn() }));
  const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true });
  frame.contentDocument!.querySelector("textarea")!.dispatchEvent(event);
  expect(editorFlush).toHaveBeenCalledOnce();
  expect(event.defaultPrevented).toBe(true);
  expect(mocks.save).not.toHaveBeenCalled();
  await waitFor(() => expect(mocks.save).toHaveBeenCalledExactlyOnceWith(mocks.file, { quiet: true }));
});
