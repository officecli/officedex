import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../../bridge", () => ({ officecli: mocks.officecli }));
vi.mock("./sheetSdk", () => ({ createOfflineSheetEditor: mocks.createOfflineSheetEditor }));

import XlsxViewer from "./XlsxViewer";

class ResizeObserverStub {
  observe = vi.fn();
  disconnect = vi.fn(() => mocks.order.push("disconnect"));
  unobserve = vi.fn();
}

describe("XlsxViewer", () => {
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

  it("prepares modoc and mounts the sdk editor", async () => {
    const { container } = render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" documentType="xlsx" />);

    await waitFor(() => expect(mocks.createOfflineSheetEditor).toHaveBeenCalledTimes(1));
    expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledWith("preview-token");
    expect(mocks.createOfflineSheetEditor).toHaveBeenCalledWith(
      container.querySelector(".preview-xlsx-editor"),
      "prepared-modoc",
    );
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("marks dirty from content.addChangeListener", async () => {
    render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    act(() => mocks.emitChange());

    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("reports dirty changes to the host and clears them after saving", async () => {
    const onDirtyChange = vi.fn();
    render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" onDirtyChange={onDirtyChange} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);

    act(() => mocks.emitChange());
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(screen.getByText("已保存")).toBeInTheDocument());
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
  });

  it("blocks beforeunload only while the workbook is dirty", async () => {
    render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const cleanEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(cleanEvent);
    expect(cleanEvent.defaultPrevented).toBe(false);

    act(() => mocks.emitChange());
    const dirtyEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(dirtyEvent);
    expect(dirtyEvent.defaultPrevented).toBe(true);
  });

  it("serializes current content and saves once", async () => {
    render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
      modocContent: "serialized-modoc",
    }));
    expect(mocks.editor.content.getContent).toHaveBeenCalledTimes(1);
    expect(mocks.delta.stringify).toHaveBeenCalledTimes(1);
    expect(screen.getByText("已保存")).toBeInTheDocument();
  });

  it("keeps dirty and shows failure when save rejects", async () => {
    mocks.officecli.saveXlsxEditor.mockRejectedValueOnce(new Error("export failed"));
    render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    expect(await screen.findByText("保存失败")).toBeInTheDocument();
    expect(screen.getByText("export failed")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /保\s*存/ })).toBeEnabled();
  });

  it("ignores repeated save clicks while saving", async () => {
    let resolveSave: (() => void) | undefined;
    mocks.officecli.saveXlsxEditor.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = () => resolve({ filePath: "/tmp/workbook.xlsx" });
    }));
    render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());
    const save = screen.getByRole("button", { name: /保\s*存/ });

    fireEvent.click(save);
    fireEvent.click(save);

    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(1));
    await act(async () => resolveSave?.());
  });

  it("does not let an old save clear changes in a newly loaded workbook", async () => {
    let resolveSave: (() => void) | undefined;
    mocks.officecli.saveXlsxEditor.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSave = () => resolve({ filePath: "/tmp/workbook.xlsx" });
    }));
    mocks.officecli.prepareXlsxEditor
      .mockResolvedValueOnce({ sessionId: "session-1", modocContent: "prepared-modoc-1" })
      .mockResolvedValueOnce({ sessionId: "session-2", modocContent: "prepared-modoc-2" });
    const { rerender } = render(<XlsxViewer previewToken="preview-token-1" fileName="book-1.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalledTimes(1));
    act(() => mocks.emitChange());
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));
    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(1));

    rerender(<XlsxViewer previewToken="preview-token-2" fileName="book-2.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalledTimes(2));
    act(() => mocks.emitChange());
    expect(screen.getByText("未保存")).toBeInTheDocument();

    await act(async () => resolveSave?.());

    expect(screen.getByText("未保存")).toBeInTheDocument();
  });

  it("handles Cmd+S only while the editor is focused", async () => {
    const { container } = render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    fireEvent.keyDown(document, { key: "s", metaKey: true });
    expect(mocks.officecli.saveXlsxEditor).not.toHaveBeenCalled();

    fireEvent.pointerDown(container.querySelector(".preview-xlsx-editor")!);
    const event = new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(1));
    expect(event.defaultPrevented).toBe(true);
  });

  it("closes the backend session and destroys the editor on unmount", async () => {
    const { unmount } = render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    unmount();

    await waitFor(() => expect(mocks.officecli.closeXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
    }));
    expect(mocks.order).toEqual(["unsubscribe", "disconnect", "unmount", "destroy", "close"]);
  });

  it("renders retry and external-open actions when prepare fails", async () => {
    mocks.officecli.prepareXlsxEditor.mockRejectedValueOnce(new Error("native library missing"));
    render(<XlsxViewer previewToken="preview-token" fileName="book.xlsx" />);

    expect(await screen.findByText("native library missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in System App" }));
    expect(mocks.officecli.openPath).toHaveBeenCalledWith("book.xlsx");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledTimes(2));
  });
});
