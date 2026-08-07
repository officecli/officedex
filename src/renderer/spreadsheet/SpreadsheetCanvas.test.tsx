import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, PreviewGrant } from "../../shared/types";
import type { SpreadsheetCanvasHandle } from "./SpreadsheetCanvas";

const mocks = vi.hoisted(() => {
  let changeListener: (() => void) | undefined;
  const order: string[] = [];
  const delta = { stringify: vi.fn(() => "serialized-modoc") };
  const editor = {
    content: {
      addChangeListener: vi.fn((listener: () => void) => {
        changeListener = listener;
        return () => order.push("unsubscribe");
      }),
      getContent: vi.fn(async () => delta),
    },
    unmount: vi.fn(async () => { order.push("unmount"); }),
    destroy: vi.fn(async () => { order.push("destroy"); }),
  };
  const officecli = {
    prepareXlsxEditor: vi.fn(async () => ({ sessionId: "session-1", modocContent: "prepared-modoc" })),
    saveXlsxEditor: vi.fn(async () => ({ filePath: "/tmp/workbook.xlsx" })),
    closeXlsxEditor: vi.fn(async () => { order.push("close"); }),
    openPath: vi.fn(async () => undefined),
  };
  return {
    editor,
    delta,
    officecli,
    order,
    createOfflineSheetEditor: vi.fn(async () => editor),
    emitChange: () => changeListener?.(),
    resetListener: () => { changeListener = undefined; },
  };
});

vi.mock("../bridge", () => ({ officecli: mocks.officecli }));
vi.mock("./sheetSdk", () => ({ createOfflineSheetEditor: mocks.createOfflineSheetEditor }));

import { SpreadsheetCanvas } from "./SpreadsheetCanvas";

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn(() => mocks.order.push("disconnect"));
  unobserve = vi.fn();
}

const artifact: Artifact = {
  taskId: "task-1",
  filePath: "/tmp/book.xlsx",
  fileName: "book.xlsx",
  documentType: "xlsx",
};

const grant: PreviewGrant = {
  token: "preview-token",
  fileName: "book.xlsx",
  documentType: "xlsx",
};

describe("SpreadsheetCanvas", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.order.length = 0;
    mocks.resetListener();
    mocks.delta.stringify.mockReturnValue("serialized-modoc");
    mocks.officecli.prepareXlsxEditor.mockResolvedValue({ sessionId: "session-1", modocContent: "prepared-modoc" });
    mocks.officecli.saveXlsxEditor.mockResolvedValue({ filePath: "/tmp/workbook.xlsx" });
    mocks.officecli.closeXlsxEditor.mockImplementation(async () => { mocks.order.push("close"); });
    mocks.createOfflineSheetEditor.mockResolvedValue(mocks.editor);
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("prepares MODoc and mounts the Sheet SDK editor", async () => {
    const { container } = render(<SpreadsheetCanvas artifact={artifact} grant={grant} />);

    await waitFor(() => expect(mocks.createOfflineSheetEditor).toHaveBeenCalledTimes(1));
    expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledWith("preview-token");
    expect(mocks.createOfflineSheetEditor).toHaveBeenCalledWith(
      container.querySelector(".spreadsheet-canvas__editor"),
      "prepared-modoc",
    );
  });

  it("reports dirty state and serializes the current workbook on imperative save", async () => {
    const onDirtyChange = vi.fn();
    const onStateChange = vi.fn();
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} onDirtyChange={onDirtyChange} onStateChange={onStateChange} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    act(() => mocks.emitChange());
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(onStateChange).toHaveBeenLastCalledWith("dirty");

    await expect(ref.current?.save()).resolves.toBe(true);
    expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
      modocContent: "serialized-modoc",
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onStateChange).toHaveBeenLastCalledWith("saved");
  });

  it("keeps edits made during save dirty", async () => {
    let resolveSave: (() => void) | undefined;
    mocks.officecli.saveXlsxEditor.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = () => resolve({ filePath: "/tmp/workbook.xlsx" });
    }));
    const onDirtyChange = vi.fn();
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} onDirtyChange={onDirtyChange} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    const saving = ref.current!.save();
    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(1));
    act(() => mocks.emitChange());
    await act(async () => resolveSave?.());

    await expect(saving).resolves.toBe(true);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
  });

  it("keeps the workbook dirty and reports only a save error when save fails", async () => {
    mocks.officecli.saveXlsxEditor.mockRejectedValueOnce(new Error("export failed"));
    const onDirtyChange = vi.fn();
    const onError = vi.fn();
    const onSaveError = vi.fn();
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} onDirtyChange={onDirtyChange} onError={onError} onSaveError={onSaveError} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    await expect(ref.current?.save()).resolves.toBe(false);

    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(onSaveError).toHaveBeenCalledWith("export failed");
    expect(onError).not.toHaveBeenCalledWith("export failed");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("coalesces repeated imperative saves", async () => {
    let resolveSave: (() => void) | undefined;
    mocks.officecli.saveXlsxEditor.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = () => resolve({ filePath: "/tmp/workbook.xlsx" });
    }));
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    const first = ref.current!.save();
    const second = ref.current!.save();
    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(1));
    await act(async () => resolveSave?.());

    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
  });

  it("handles Cmd+S only while the editor is focused", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    expect(mocks.officecli.saveXlsxEditor).not.toHaveBeenCalled();

    act(() => ref.current?.focus());
    const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(1));
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes the old session when the token or artifact changes", async () => {
    mocks.officecli.prepareXlsxEditor
      .mockResolvedValueOnce({ sessionId: "session-1", modocContent: "prepared-1" })
      .mockResolvedValueOnce({ sessionId: "session-2", modocContent: "prepared-2" });
    const { rerender } = render(<SpreadsheetCanvas artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalledTimes(1));

    rerender(<SpreadsheetCanvas artifact={{ ...artifact, filePath: "/tmp/other.xlsx", fileName: "other.xlsx" }} grant={{ ...grant, token: "preview-2" }} />);

    await waitFor(() => expect(mocks.officecli.closeXlsxEditor).toHaveBeenCalledWith({ previewToken: "preview-token", sessionId: "session-1" }));
    await waitFor(() => expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledWith("preview-2"));
  });

  it("destroys the editor and closes the backend session on unmount", async () => {
    const { unmount } = render(<SpreadsheetCanvas artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(mocks.officecli.closeXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
    }));
    expect(mocks.order).toEqual(["unsubscribe", "disconnect", "unmount", "destroy", "close"]);
  });

  it("offers retry and opening the local file when prepare fails", async () => {
    mocks.officecli.prepareXlsxEditor.mockRejectedValueOnce(new Error("native library missing"));
    render(<SpreadsheetCanvas artifact={artifact} grant={grant} />);

    expect(await screen.findByText("native library missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in System App" }));
    expect(mocks.officecli.openPath).toHaveBeenCalledWith("/tmp/book.xlsx");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledTimes(2));
  });
});
