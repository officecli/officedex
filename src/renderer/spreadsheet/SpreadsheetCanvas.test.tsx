import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Artifact, PreviewGrant } from "../../shared/types";
import type { SpreadsheetCanvasHandle } from "./SpreadsheetCanvas";
import { styledCellData } from "./SpreadsheetCanvas";

const mocks = vi.hoisted(() => {
  type MockRange = {
    getText: ReturnType<typeof vi.fn>;
    setText?: ReturnType<typeof vi.fn>;
    getBounding: ReturnType<typeof vi.fn>;
  };
  let changeListener: ((change?: { stringify(): string }) => void) | undefined;
  let horizontalScrollListener: (() => void) | undefined;
  let rangeListener: (() => void) | undefined;
  let emitCellTextChange = true;
  let emitImageChange = true;
  const order: string[] = [];
  const delta = { stringify: vi.fn(() => "serialized-modoc") };
  const cells = new Map<string, {
    setCellText: ReturnType<typeof vi.fn>;
    getCellText: ReturnType<typeof vi.fn>;
    clearContent: ReturnType<typeof vi.fn>;
    insertImage: ReturnType<typeof vi.fn>;
  }>();
  const getCell = vi.fn((row: number, column: number) => {
    const key = `${row}:${column}`;
    if (!cells.has(key)) {
      let text = "";
      cells.set(key, {
        setCellText: vi.fn((value: string) => {
          text = value;
          if (emitCellTextChange) queueMicrotask(() => changeListener?.());
        }),
        getCellText: vi.fn(() => text),
        clearContent: vi.fn(),
        insertImage: vi.fn(() => {
          if (emitImageChange) queueMicrotask(() => changeListener?.());
        }),
      });
    }
    return cells.get(key)!;
  });
  const setSelectionRange = vi.fn();
  const worksheet = {
    id: "sheet-1",
    name: "Products",
    visible: true,
    rowCount: 3,
    columnCount: 6,
    getSelections: vi.fn(() => [{
      getRange: () => ({ type: "cells", row: 1, rowCount: 2, column: 0, columnCount: 6 }),
      setRange: setSelectionRange,
    }]),
    getRange: vi.fn((range: { row: number }): MockRange => ({
      getText: vi.fn(() => range.row === 0
        ? [["Product", "Selling points", "Description", "Reference image", "Generated image", "Status"]]
        : [["Travel mug", "Leak proof", "For commuters", "/tmp/mug.png", "", "Queued"], ["Desk lamp", "Warm light", "For home office", "", "", "Queued"]]),
      setText: vi.fn(() => queueMicrotask(() => changeListener?.())),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    })),
    addRangeListener: vi.fn((listener: () => void) => {
      rangeListener = listener;
      return vi.fn();
    }),
    getCell,
    setActiveCell: vi.fn(),
    locateCell: vi.fn(),
    addRows: vi.fn(),
    addColumns: vi.fn(),
    setColumnsWidth: vi.fn(),
    setRowsHeight: vi.fn(),
  };
  const editor = {
    batchChanges: vi.fn(async <T,>(callback: () => T | Promise<T>) => callback()),
    content: {
      addChangeListener: vi.fn((listener: (change?: { stringify(): string }) => void) => {
        changeListener = listener;
        return () => order.push("unsubscribe");
      }),
      getContent: vi.fn(async () => delta),
    },
    activeSheet: worksheet,
    activeCell: { row: 1, column: 0, sheetId: "sheet-1" },
    selections: worksheet.getSelections(),
    workbook: {
      getWorksheetById: vi.fn((sheetId: string) => sheetId === worksheet.id ? worksheet : null),
      getWorksheets: vi.fn(() => [worksheet]),
      setActiveWorksheet: vi.fn(),
      addWorksheet: vi.fn(),
    },
    eventSubscription: {
      addHorizontalScrollListener: vi.fn((listener: () => void) => {
        horizontalScrollListener = listener;
        return vi.fn();
      }),
      addVerticalScrollListener: vi.fn(() => vi.fn()),
      addViewportSizeChangedListener: vi.fn(() => vi.fn()),
      addUrlChangedListener: vi.fn(() => vi.fn()),
    },
    unmount: vi.fn(async () => { order.push("unmount"); }),
    destroy: vi.fn(async () => { order.push("destroy"); }),
  };
  const officecli = {
    prepareXlsxEditor: vi.fn(async () => ({ sessionId: "session-1", modocContent: "prepared-modoc" })),
    saveXlsxEditor: vi.fn(async () => ({ filePath: "/tmp/workbook.xlsx" })),
    closeXlsxEditor: vi.fn(async () => { order.push("close"); }),
    openPath: vi.fn(async () => undefined),
    readLocalImage: vi.fn(async () => ({ data: new Uint8Array([137, 80, 78, 71]), mime: "image/png" })),
    stageXlsxEditorImage: vi.fn(async () => ({ url: "modoc-assets:/media/result.png" })),
  };
  return {
    editor,
    delta,
    officecli,
    worksheet,
    setSelectionRange,
    cells,
    order,
    createOfflineSheetEditor: vi.fn(async () => editor),
    registerOfflineImage: vi.fn((file: File) => file),
    emitChange: (serialized?: string) => changeListener?.(serialized ? { stringify: () => serialized } : undefined),
    emitHorizontalScroll: () => horizontalScrollListener?.(),
    emitRangeChange: () => rangeListener?.(),
    resetListener: () => {
      changeListener = undefined;
      horizontalScrollListener = undefined;
      rangeListener = undefined;
    },
    setEmitCellTextChange: (value: boolean) => { emitCellTextChange = value; },
    setEmitImageChange: (value: boolean) => { emitImageChange = value; },
  };
});

vi.mock("../bridge", () => ({ officecli: mocks.officecli }));
vi.mock("./sheetSdk", () => ({
  createOfflineSheetEditor: mocks.createOfflineSheetEditor,
  registerOfflineImage: mocks.registerOfflineImage,
}));

import {
  imageBytesToFile,
  retryWhenSheetCellsReady,
  SpreadsheetCanvas,
} from "./SpreadsheetCanvas";

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
    mocks.setEmitCellTextChange(true);
    mocks.setEmitImageChange(true);
    mocks.delta.stringify.mockReturnValue("serialized-modoc");
    mocks.officecli.prepareXlsxEditor.mockResolvedValue({ sessionId: "session-1", modocContent: "prepared-modoc" });
    mocks.officecli.saveXlsxEditor.mockResolvedValue({ filePath: "/tmp/workbook.xlsx" });
    mocks.officecli.closeXlsxEditor.mockImplementation(async () => { mocks.order.push("close"); });
    mocks.officecli.readLocalImage.mockResolvedValue({ data: new Uint8Array([137, 80, 78, 71]), mime: "image/png" });
    mocks.officecli.stageXlsxEditorImage.mockResolvedValue({ url: "modoc-assets:/media/result.png" });
    mocks.editor.workbook.getWorksheets.mockReturnValue([mocks.worksheet]);
    mocks.editor.workbook.getWorksheetById.mockImplementation((sheetId: string) => sheetId === mocks.worksheet.id ? mocks.worksheet : null);
    mocks.cells.clear();
    mocks.createOfflineSheetEditor.mockResolvedValue(mocks.editor);
    mocks.worksheet.rowCount = 3;
    mocks.worksheet.columnCount = 6;
    mocks.editor.selections = mocks.worksheet.getSelections();
    mocks.worksheet.getRange.mockImplementation((range: { row: number }) => ({
      getText: vi.fn(() => range.row === 0
        ? [["Product", "Selling points", "Description", "Reference image", "Generated image", "Status"]]
        : [["Travel mug", "Leak proof", "For commuters", "/tmp/mug.png", "", "Queued"], ["Desk lamp", "Warm light", "For home office", "", "", "Queued"]]),
      setText: vi.fn(() => queueMicrotask(() => mocks.emitChange())),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  });

  it("prepares MODoc and mounts the Sheet SDK editor", async () => {
    const { container } = render(<SpreadsheetCanvas artifact={artifact} grant={grant} />);

    await waitFor(() => expect(mocks.createOfflineSheetEditor).toHaveBeenCalledTimes(1));
    expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledWith("preview-token");
    expect(mocks.createOfflineSheetEditor).toHaveBeenCalledWith(
      container.querySelector(".spreadsheet-canvas__editor"),
      "prepared-modoc",
      [],
      expect.any(Function),
    );
  });

  it("stages pasted image bytes in the current MODoc session", async () => {
    render(<SpreadsheetCanvas artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.createOfflineSheetEditor).toHaveBeenCalledTimes(1));
    const args = mocks.createOfflineSheetEditor.mock.calls[0] as unknown as [
      HTMLElement,
      string,
      unknown[],
      (file: File) => Promise<{ assetUrl: string }>,
    ];
    const file = new File([new Uint8Array([137, 80, 78, 71])], "clipboard.png", { type: "image/png" });

    await expect(args[3](file)).resolves.toEqual({ assetUrl: "modoc-assets:/media/result.png" });
    expect(mocks.officecli.stageXlsxEditorImage).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
      data: new Uint8Array([137, 80, 78, 71]),
      mime: "image/png",
      sheetName: "clipboard",
      row: 0,
      column: 0,
      statusColumn: 0,
    });
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
      managedSheets: [],
    });
    expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    expect(onStateChange).toHaveBeenLastCalledWith("saved");
  });

  it("uses Sheet SDK JS APIs to read product rows and write marketing images", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const batch = ref.current!.inspectMarketingSelection("marketplace-main");
    expect(batch.rows).toHaveLength(2);
    expect(batch.rows[0]).toEqual(expect.objectContaining({ productName: "Travel mug", referenceImages: ["/tmp/mug.png"] }));
    expect(batch.outputColumn).toBe(4);
    expect(batch.statusColumn).toBe(5);
    expect(batch.headerRowIndex).toBe(0);

    ref.current!.prepareMarketingBatch(batch);
    expect(mocks.worksheet.addColumns).not.toHaveBeenCalled();

    await ref.current!.setMarketingStatus(batch, 1, "生成中");
    expect(mocks.cells.get("1:5")?.setCellText).toHaveBeenCalledWith("生成中");
    expect(mocks.cells.get("1:5")?.getCellText).toHaveBeenCalled();

    await ref.current!.insertMarketingImage(batch, 1, "/tmp/result.png");
    expect(mocks.officecli.readLocalImage).toHaveBeenCalledWith("/tmp/result.png");
    expect(mocks.officecli.stageXlsxEditorImage).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
      filePath: "/tmp/result.png",
      sheetName: "Products",
      row: 1,
      column: 4,
      statusColumn: 5,
    });
    expect(mocks.cells.get("1:4")?.clearContent).not.toHaveBeenCalled();
    expect(mocks.cells.get("1:4")?.insertImage).toHaveBeenCalledWith(expect.any(File));
    expect(mocks.cells.get("1:4")?.insertImage.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      name: "result.png",
      type: "image/png",
      size: 4,
    }));
    expect(mocks.registerOfflineImage).toHaveBeenCalledWith(
      expect.any(File),
      "modoc-assets:/media/result.png",
      "data:image/png;base64,iVBORw==",
    );
    expect(mocks.worksheet.setActiveCell).toHaveBeenNthCalledWith(1, { row: 1, column: 4 });
    expect(mocks.worksheet.setActiveCell).toHaveBeenNthCalledWith(2, { row: 1, column: 0 });
  });

  it("scans product rows below the header when the SDK exposes a merged A1 selection", async () => {
    mocks.worksheet.rowCount = 7;
    mocks.worksheet.columnCount = 16;
    mocks.editor.selections = [{
      getRange: () => ({ type: "cells", row: 0, rowCount: 1, column: 0, columnCount: 16 }),
      setRange: vi.fn(),
    }];
    const headers = Array.from({ length: 16 }, () => "");
    headers[0] = "Product";
    headers[4] = "Selling points";
    headers[8] = "Reference image";
    headers[12] = "Generated image";
    headers[13] = "Prompt";
    headers[15] = "Status";
    const rows = [
      ["Travel mug", "", "", "", "Leak proof", "", "", "", "/tmp/mug.png", "", "", "", "", "Studio hero image", "", "Queued"],
      ["Desk lamp", "", "", "", "Warm light", "", "", "", "", "", "", "", "", "Home office lifestyle", "", "Queued"],
    ];
    mocks.worksheet.getRange.mockImplementation((range: { row: number }) => ({
      getText: vi.fn(() => range.row === 0
        ? [["Campaign template"], ["Instructions"], headers, ...rows, [], []]
        : rows),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const batch = ref.current!.inspectMarketingSelection("marketplace-main");

    expect(batch.headerRowIndex).toBe(2);
    expect(batch.source.firstRowIndex).toBe(3);
    expect(batch.rows.map((row) => row.productName)).toEqual(["Travel mug", "Desk lamp"]);
  });

  it("limits marketing inspection to an explicit multi-row selection below the header", async () => {
    mocks.worksheet.rowCount = 12;
    mocks.worksheet.columnCount = 6;
    mocks.editor.selections = [{
      getRange: () => ({ type: "cells", row: 5, rowCount: 2, column: 0, columnCount: 6 }),
      setRange: vi.fn(),
    }];
    const headers = ["Product", "Selling points", "Description", "Reference image", "Generated image", "Status"];
    const selectedRows = [
      ["Selected mug", "Leak proof", "For commuters", "", "", "Queued"],
      ["Selected lamp", "Warm light", "For desks", "", "", "Queued"],
    ];
    mocks.worksheet.getRange.mockImplementation((range: { row: number }) => ({
      getText: vi.fn(() => range.row === 0
        ? [["Campaign template"], ["Instructions"], headers]
        : selectedRows),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const batch = ref.current!.inspectMarketingSelection("marketplace-main");

    expect(batch.headerRowIndex).toBe(2);
    expect(batch.source.firstRowIndex).toBe(5);
    expect(batch.rows.map((row) => row.rowIndex)).toEqual([5, 6]);
    expect(batch.rows.map((row) => row.productName)).toEqual(["Selected mug", "Selected lamp"]);
    expect(mocks.worksheet.getRange).toHaveBeenLastCalledWith(expect.objectContaining({ row: 5, rowCount: 2 }));
  });

  it("scans supplier rows and writes review-ready cleanup columns", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    mocks.worksheet.getRange.mockImplementation((range: { row: number }) => ({
      getText: vi.fn(() => range.row === 0 ? [
        ["SKU", "Product", "Price", "Stock", "Image", "Status"],
        ["", "Travel mug", "12", "4", "", "published"],
        ["L-2", "Desk lamp", "20", "2", "https://example.com/lamp.jpg", "draft"],
      ] : []),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitRangeChange());

    const selection = (await ref.current!.inspectCatalogSheets()).selections[0];
    expect(selection.rows).toHaveLength(3);
    expect(selection.rows[0]).toEqual(expect.arrayContaining(["SKU", "Product"]));

    const batch = {
      sheetId: selection.sheetId, sheetName: selection.sheetName, headerRowIndex: 0, firstRowIndex: 1, existingColumnCount: 6,
      headers: selection.rows[0], sourceRows: selection.rows.slice(1), mapping: [], batchFindings: [], intent: "create" as const,
      resultColumns: { status: 6, issues: 7, cleanup: 8, handle: 9, sku: 10, title: 11, price: 12 }, creditEstimate: 2,
      ruleVersion: "shopify-product-csv-test", taxonomyVersion: "2026-05", shopifyCsv: "", findingsCsv: "",
      rows: [{ rowIndex: 1, status: "Blocked", issues: ["SKU is blank"], findings: [
        { code: "sku_missing", severity: "warning", message: "SKU is blank" },
        { code: "status_invalid", severity: "error", message: "Status must be active, draft, or archived" },
      ], cleanupActions: [{ code: "generate_handle", field: "handle", before: "", after: "travel-mug", safety: "safe", message: "Generated a Shopify URL handle" }], values: { handle: "travel-mug", sku: "", title: "Travel mug", price: "12" } }],
    };

    await ref.current!.applyCatalogCleanup(batch);
    expect(mocks.worksheet.addColumns).toHaveBeenCalledWith(6, 7);
    expect(mocks.cells.get("0:6")?.setCellText).toHaveBeenCalledWith("OfficeDex Status");
    expect(mocks.cells.get("1:6")?.setCellText).toHaveBeenCalledWith("Blocked");
    expect(mocks.cells.get("1:7")?.setCellText).toHaveBeenCalledWith(expect.stringContaining("SKU is blank"));
    expect(mocks.cells.get("1:7")?.setCellText).toHaveBeenCalledWith(expect.stringContaining("Status must be active, draft, or archived"));
    expect(mocks.cells.get("1:8")?.setCellText).toHaveBeenCalledWith(expect.stringContaining("Generated a Shopify URL handle"));
    expect(mocks.cells.get("1:9")?.setCellText).toHaveBeenCalledWith("travel-mug");
    expect(mocks.cells.get("1:11")?.setCellText).toHaveBeenCalledWith("Travel mug");
  });

  it("automatically scans the worksheet used range when only one cell is active", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    mocks.worksheet.rowCount = 8;
    mocks.worksheet.columnCount = 6;
    mocks.editor.selections = [{ getRange: () => ({ type: "cells", row: 5, rowCount: 1, column: 2, columnCount: 1 }), setRange: vi.fn() }];
    mocks.worksheet.getRange.mockImplementation(() => ({
      getText: vi.fn(() => [
        ["Supplier catalog", "", "", "", "", ""],
        ["", "", "", "", "", ""],
        ["SKU", "Product", "Price", "Image", "", ""],
        ["A-1", "Mug", "12", "https://example.com/mug.jpg", "", ""],
        ["A-2", "Lamp", "20", "", "", ""],
        ["", "", "", "", "", ""],
        ["", "", "", "", "", ""],
        ["", "", "", "", "", ""],
      ]),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitRangeChange());

    const selection = (await ref.current!.inspectCatalogSheets()).selections[0];
    expect(selection.selectionStartRow).toBe(0);
    expect(selection.rows).toHaveLength(5);
    expect(selection.rows[2]).toEqual(["SKU", "Product", "Price", "Image"]);
  });

  it("automatically scans every visible worksheet and ignores hidden worksheets", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    const secondWorksheet = {
      ...mocks.worksheet,
      id: "sheet-2",
      name: "Accessories",
      getSelections: vi.fn(() => [{
        getRange: () => ({ type: "cells", row: 0, rowCount: 1, column: 0, columnCount: 1 }),
        setRange: vi.fn(),
      }]),
      getRange: vi.fn(() => ({
        getText: vi.fn(() => [["SKU", "Title"], ["A-1", "Cable"]]),
        getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
      })),
      setActiveCell: vi.fn(),
    };
    const hiddenWorksheet = {
      ...secondWorksheet,
      id: "sheet-3",
      name: "Internal notes",
      visible: false,
    };
    mocks.editor.workbook.getWorksheets.mockReturnValueOnce([
      mocks.worksheet,
      secondWorksheet,
      hiddenWorksheet,
    ]);
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const inspection = await ref.current!.inspectCatalogSheets();

    expect(inspection.advancedSelection).toBe(false);
    expect(inspection.selections.map((item) => item.sheetId)).toEqual(["sheet-1", "sheet-2"]);
    expect(inspection.selections[1].rows).toEqual([["SKU", "Title"], ["A-1", "Cable"]]);
    expect(mocks.editor.workbook.setActiveWorksheet).not.toHaveBeenCalledWith("sheet-3");
  });

  it("waits for a lazily hydrated worksheet instead of dropping it as empty", async () => {
    // The real SDK returns an all-empty matrix for a worksheet that has not been
    // activated yet, and only fills it in once activation settles. Before the
    // hydration wait this sheet was silently dropped, so a multi-sheet workbook
    // only ever detected the sheet that happened to be active.
    const ref = createRef<SpreadsheetCanvasHandle>();
    let activated = false;
    const lazyWorksheet = {
      ...mocks.worksheet,
      id: "sheet-2",
      name: "Accessories",
      getSelections: vi.fn(() => [{
        getRange: () => ({ type: "cells", row: 0, rowCount: 1, column: 0, columnCount: 1 }),
        setRange: vi.fn(),
      }]),
      getRange: vi.fn(() => ({
        getText: vi.fn(() => (activated ? [["SKU", "Title"], ["A-1", "Cable"]] : [["", ""], ["", ""]])),
        getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
      })),
      setActiveCell: vi.fn(),
    };
    mocks.editor.workbook.getWorksheets.mockReturnValueOnce([mocks.worksheet, lazyWorksheet]);
    mocks.editor.workbook.setActiveWorksheet.mockImplementation((sheetId: string) => {
      if (sheetId === "sheet-2") setTimeout(() => { activated = true; }, 60);
    });
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const inspection = await ref.current!.inspectCatalogSheets();

    expect(inspection.selections.map((item) => item.sheetId)).toEqual(["sheet-1", "sheet-2"]);
    expect(inspection.selections[1].rows).toEqual([["SKU", "Title"], ["A-1", "Cable"]]);
  });

  it("ignores the SDK initial multi-cell selection until the user changes it", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    mocks.worksheet.rowCount = 8;
    mocks.editor.selections = [{ getRange: () => ({ type: "cells", row: 4, rowCount: 4, column: 0, columnCount: 6 }), setRange: vi.fn() }];
    mocks.worksheet.getRange.mockImplementation((range: { row: number; rowCount?: number }) => ({
      getText: vi.fn(() => Array.from({ length: range.rowCount ?? 1 }, (_, index) => [`row-${range.row + index}`])),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const selection = (await ref.current!.inspectCatalogSheets()).selections[0];
    expect(selection.selectionStartRow).toBe(0);
    expect(selection.rows).toHaveLength(8);
    expect(mocks.worksheet.getRange).toHaveBeenLastCalledWith(expect.objectContaining({ row: 0, rowCount: 8 }));
  });

  it("programmatically focuses and activates A1 before an automatic catalog scan", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    await ref.current!.inspectCatalogSheets();

    expect(mocks.worksheet.setActiveCell).toHaveBeenCalledWith({ row: 0, column: 0 });
    expect(mocks.setSelectionRange).toHaveBeenCalledWith({ type: "cells", row: 0, rowCount: 1, column: 0, columnCount: 1 });
  });

  it("uses an explicit multi-cell selection as the advanced catalog range", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    mocks.worksheet.rowCount = 20;
    mocks.editor.selections = [{ getRange: () => ({ type: "cells", row: 10, rowCount: 3, column: 0, columnCount: 4 }), setRange: vi.fn() }];
    mocks.worksheet.getRange.mockImplementation((range: { row: number; rowCount?: number }) => ({
      getText: vi.fn(() => Array.from({ length: range.rowCount ?? 1 }, (_, index) => [`row-${range.row + index}`])),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitRangeChange());

    const selection = (await ref.current!.inspectCatalogSheets()).selections[0];
    expect(selection.selectionStartRow).toBe(10);
    expect(selection.rows).toHaveLength(13);
    expect(selection.rows.at(-1)).toEqual(["row-12"]);
  });

  it("keeps image writeback successful when the Sheet SDK omits its change event", async () => {
    mocks.setEmitImageChange(false);
    const onDirtyChange = vi.fn();
    const onStateChange = vi.fn();
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas
      ref={ref}
      artifact={artifact}
      grant={grant}
      onDirtyChange={onDirtyChange}
      onStateChange={onStateChange}
    />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    const batch = ref.current!.inspectMarketingSelection("marketplace-main");

    await expect(ref.current!.insertMarketingImage(batch, 1, "/tmp/result.png")).resolves.toBeUndefined();

    expect(mocks.cells.get("1:4")?.insertImage).toHaveBeenCalledTimes(1);
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(onStateChange).toHaveBeenLastCalledWith("dirty");

    mocks.editor.content.getContent.mockClear();
    await expect(ref.current!.save()).resolves.toBe(true);
    expect(mocks.editor.content.getContent).not.toHaveBeenCalled();
    expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
      modocContent: "",
      managedSheets: [],
    });
  });

  it("renders field markers as a read-only overlay without dirtying or changing MODoc", async () => {
    const onDirtyChange = vi.fn();
    const onStateChange = vi.fn();
    const ref = createRef<SpreadsheetCanvasHandle>();
    const { container } = render(<SpreadsheetCanvas
      ref={ref}
      artifact={artifact}
      grant={grant}
      onDirtyChange={onDirtyChange}
      onStateChange={onStateChange}
    />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    const batch = ref.current!.inspectMarketingSelection("marketplace-main");
    const before = (await mocks.editor.content.getContent()).stringify();
    onDirtyChange.mockClear();
    onStateChange.mockClear();

    act(() => ref.current!.setMarketingMapping(batch.mapping));

    await waitFor(() => expect(container.querySelectorAll(".spreadsheet-header-marker")).toHaveLength(6));
    const after = (await mocks.editor.content.getContent()).stringify();
    expect(after).toBe(before);
    expect(onDirtyChange).not.toHaveBeenCalled();
    expect(onStateChange).not.toHaveBeenCalledWith("dirty");
    expect(mocks.cells.size).toBe(0);
  });

  it("repositions field markers after the sheet scrolls", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    const { container } = render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.eventSubscription.addHorizontalScrollListener).toHaveBeenCalled());
    const batch = ref.current!.inspectMarketingSelection("marketplace-main");
    act(() => ref.current!.setMarketingMapping(batch.mapping));
    await waitFor(() => expect(container.querySelectorAll(".spreadsheet-header-marker")).toHaveLength(6));
    const callsBeforeScroll = mocks.worksheet.getRange.mock.calls.length;

    act(() => mocks.emitHorizontalScroll());

    await waitFor(() => expect(mocks.worksheet.getRange.mock.calls.length).toBeGreaterThan(callsBeforeScroll));
  });

  it("detects a fourth-row ecommerce header and reads the product name instead of the SKU", async () => {
    mocks.worksheet.rowCount = 16;
    mocks.worksheet.columnCount = 37;
    mocks.editor.selections = [{ getRange: () => ({ type: "cells", row: 4, rowCount: 1, column: 0, columnCount: 37 }), setRange: vi.fn() }];
    const headers = Array.from({ length: 37 }, () => "");
    headers[0] = "SKU";
    headers[1] = "商品名称";
    headers[4] = "核心卖点";
    headers[5] = "商品描述";
    headers[11] = "参考图 / 素材链接";
    headers[12] = "主图结果";
    headers[13] = "主图提示词";
    headers[14] = "比例";
    headers[34] = "状态";
    const row = Array.from({ length: 37 }, () => "");
    row[0] = "EC-EL-001";
    row[1] = "主动降噪头戴耳机";
    row[11] = "/tmp/headphones.png";
    row[13] = "白底棚拍，耳机主体居中";
    row[14] = "1:1";
    mocks.worksheet.getRange.mockImplementation((range: { row: number }) => ({
      getText: vi.fn(() => range.row === 0
        ? [["电商营销素材批量生图需求模板"], ["填写说明"], ["基础信息"], headers, row]
        : [row]),
      getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
    }));
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const batch = ref.current!.inspectMarketingSelection("marketplace-main");
    expect(batch.headerRowIndex).toBe(3);
    expect(batch.rows[0]).toEqual(expect.objectContaining({
      rowIndex: 4,
      productName: "主动降噪头戴耳机",
      prompt: "白底棚拍，耳机主体居中",
      ratio: "square",
    }));

    ref.current!.prepareMarketingBatch(batch);
    expect(batch.outputColumn).toBe(12);
    expect(batch.statusColumn).toBe(34);
    expect(mocks.worksheet.addColumns).not.toHaveBeenCalled();
  });

  it("accepts a verified status write when the SDK emits no change event", async () => {
    const onDirtyChange = vi.fn();
    const onStateChange = vi.fn();
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas
      ref={ref}
      artifact={artifact}
      grant={grant}
      onDirtyChange={onDirtyChange}
      onStateChange={onStateChange}
    />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    const batch = ref.current!.inspectMarketingSelection("marketplace-main");
    mocks.setEmitCellTextChange(false);

    await expect(ref.current!.setMarketingStatus(batch, 1, "生成中")).resolves.toBeUndefined();
    expect(mocks.cells.get("1:5")?.getCellText).toHaveBeenCalled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(onStateChange).toHaveBeenLastCalledWith("dirty");
  });

  it("wraps image bytes as a local File for the offline SDK uploader", () => {
    expect(imageBytesToFile(new Uint8Array([137, 80, 78, 71]), "image/png", "result.png"))
      .toEqual(expect.objectContaining({ name: "result.png", type: "image/png", size: 4 }));
    expect(() => imageBytesToFile(new Uint8Array(), "image/png", "empty.png")).toThrow("图片文件为空");
    expect(() => imageBytesToFile(new Uint8Array([1]), "application/octet-stream", "bad.bin"))
      .toThrow("不是受支持的图片格式");
  });

  it("serializes concurrent marketing mutations so change events cannot satisfy the wrong write", async () => {
    let resolveFirstImage: ((value: { data: Uint8Array<ArrayBuffer>; mime: string }) => void) | undefined;
    mocks.officecli.readLocalImage
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstImage = resolve; }))
      .mockResolvedValueOnce({ data: new Uint8Array([137, 80, 78, 71]), mime: "image/png" });
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    const batch = ref.current!.inspectMarketingSelection("marketplace-main");

    const first = ref.current!.insertMarketingImage(batch, 1, "/tmp/first.png");
    const second = ref.current!.insertMarketingImage(batch, 2, "/tmp/second.png");
    await waitFor(() => expect(mocks.officecli.readLocalImage).toHaveBeenCalledTimes(1));
    expect(mocks.officecli.readLocalImage).not.toHaveBeenCalledWith("/tmp/second.png");

    resolveFirstImage?.({ data: new Uint8Array([137, 80, 78, 71]), mime: "image/png" });
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
    expect(mocks.officecli.readLocalImage).toHaveBeenNthCalledWith(2, "/tmp/second.png");
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

  it("runs a follow-up save when an image is staged during an in-flight save", async () => {
    let resolveFirstSave: (() => void) | undefined;
    mocks.officecli.saveXlsxEditor.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstSave = () => resolve({ filePath: "/tmp/workbook.xlsx" });
    }));
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());
    act(() => mocks.emitChange());

    const first = ref.current!.save();
    await waitFor(() => expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(1));
    const batch = ref.current!.inspectMarketingSelection("marketplace-main");
    await ref.current!.insertMarketingImage(batch, 1, "/tmp/result.png");
    const second = ref.current!.save();
    await act(async () => resolveFirstSave?.());

    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledTimes(2);
    expect(mocks.officecli.saveXlsxEditor).toHaveBeenNthCalledWith(2, {
      previewToken: "preview-token",
      sessionId: "session-1",
      modocContent: "",
      managedSheets: [],
    });
  });

  it("waits for a managed-sheet batch to reach the content model before saving", async () => {
    let firstCellWrite = true;
    const managedGetCell = vi.fn((row: number, column: number) => {
      const cell = mocks.worksheet.getCell(row, column);
      return {
        ...cell,
        setCellText: vi.fn((value: string) => {
          if (firstCellWrite) {
            firstCellWrite = false;
            throw new Error("单元格加载中，请加载完成后再编辑");
          }
          cell.setCellText(value);
          if (row === 1 && column === 1 && value === "Fix save") {
            setTimeout(() => mocks.emitChange(), 100);
          }
        }),
      };
    });
    const managedSheet = {
      ...mocks.worksheet,
      id: "jira-sheet",
      name: "Jira Issues",
      rowCount: 200,
      columnCount: 21,
      getRange: vi.fn(() => ({
        getText: vi.fn(() => []),
        setText: vi.fn(),
        getBounding: vi.fn(() => ({ left: 40, top: 80, width: 120, height: 28 })),
      })),
      getCell: managedGetCell,
    };
    mocks.editor.workbook.getWorksheets.mockReturnValue([mocks.worksheet, managedSheet]);
    mocks.editor.workbook.getWorksheetById.mockImplementation((sheetId: string) => (
      sheetId === managedSheet.id ? managedSheet : sheetId === mocks.worksheet.id ? mocks.worksheet : null
    ));
    mocks.delta.stringify.mockReturnValue("serialized-modoc");
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    await expect(ref.current!.replaceManagedSheet({
      sheetName: "Jira Issues",
      headers: ["Issue Key", "Summary"],
      rows: [["OD-1", "Fix save"]],
      keyColumn: "Issue Key",
      preserveColumns: ["OfficeDex Notes"],
    })).resolves.toBeUndefined();
    await expect(ref.current!.save()).resolves.toBe(true);

    expect(mocks.editor.batchChanges).toHaveBeenCalledTimes(1);
    expect(mocks.editor.workbook.setActiveWorksheet).toHaveBeenCalledWith("jira-sheet");
    expect(managedSheet.setActiveCell).toHaveBeenCalledWith({ row: 0, column: 0 });
    expect(managedSheet.locateCell).toHaveBeenCalledWith(0, 0);
    expect(managedGetCell).toHaveBeenCalledWith(0, 0);
    expect(managedGetCell).toHaveBeenCalledWith(1, 1);
    expect(mocks.officecli.saveXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
      modocContent: "serialized-modoc",
      managedSheets: [{
        sheetName: "Jira Issues",
        rows: [["Issue Key", "Summary"], ["OD-1", "Fix save"]],
      }],
    });
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

  it("hydrates inactive worksheets before snapshotting them", async () => {
    // The SDK returns an all-empty matrix for a worksheet that was never
    // activated. Without waiting, a multi-sheet snapshot hands the model blank
    // data for every sheet except the one on screen.
    const ref = createRef<SpreadsheetCanvasHandle>();
    let activated = false;
    const lazyWorksheet = {
      ...mocks.worksheet,
      id: "sheet-2",
      name: "Accessories",
      isActive: false,
      getRange: vi.fn(() => ({
        getText: vi.fn(() => (activated ? [["SKU", "Title"], ["A-1", "Cable"]] : [["", ""], ["", ""]])),
        getBounding: vi.fn(() => ({ left: 0, top: 0, width: 10, height: 10 })),
      })),
    };
    mocks.editor.workbook.getWorksheets.mockReturnValueOnce([mocks.worksheet, lazyWorksheet]);
    mocks.editor.workbook.setActiveWorksheet.mockImplementation((sheetId: string) => {
      if (sheetId === "sheet-2") setTimeout(() => { activated = true; }, 60);
    });
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const snapshot = await ref.current!.snapshot({ maxRows: 20, maxColumns: 10 });

    const accessories = snapshot.sheets.find((sheet) => sheet.id === "sheet-2");
    expect(accessories?.rows).toEqual([["SKU", "Title"], ["A-1", "Cable"]]);
    // The snapshot must not leave the user on a different sheet than they started.
    expect(snapshot.activeSheetId).toBe("sheet-1");
  });

  it("serves workbook snapshot and selection tools from the live editor", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    expect(await ref.current!.snapshot({ maxRows: 20, maxColumns: 10 })).toEqual({
      activeSheetId: "sheet-1",
      sheets: [{
        id: "sheet-1",
        name: "Products",
        rowCount: 3,
        columnCount: 6,
        rows: [["Product", "Selling points", "Description", "Reference image", "Generated image", "Status"]],
        truncated: false,
      }],
    });
    expect(ref.current!.readSelection()).toEqual({
      sheetId: "sheet-1",
      sheetName: "Products",
      range: { row: 1, column: 0, rowCount: 2, columnCount: 6 },
      values: [["Travel mug", "Leak proof", "For commuters", "/tmp/mug.png", "", "Queued"], ["Desk lamp", "Warm light", "For home office", "", "", "Queued"]],
    });
  });

  it("writes a bounded matrix and stages media through the active XLSX session", async () => {
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    await expect(ref.current!.writeCells({ startRow: 1, startColumn: 2, values: [["A", "B"], ["C", "D"]] }))
      .resolves.toEqual({ written: 4, sheetId: "sheet-1", sheetName: "Products" });
    expect(mocks.worksheet.getCell(1, 2).setCellText).toHaveBeenCalledWith("A");
    expect(mocks.worksheet.getCell(2, 3).setCellText).toHaveBeenCalledWith("D");

    await expect(ref.current!.stageMedia({ filePath: "/tmp/image.png", row: 1, column: 4, statusColumn: -1 }))
      .resolves.toEqual({ url: "modoc-assets:/media/result.png", sheetId: "sheet-1", sheetName: "Products", row: 1, column: 4 });
    expect(mocks.officecli.stageXlsxEditorImage).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
      filePath: "/tmp/image.png",
      data: undefined,
      mime: undefined,
      sheetName: "Products",
      row: 1,
      column: 4,
      statusColumn: -1,
    });
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

  it("keeps the preview token valid across the StrictMode setup replay", async () => {
    let resolveFirstPrepare: ((value: { sessionId: string; modocContent: string }) => void) | undefined;
    mocks.officecli.prepareXlsxEditor
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstPrepare = resolve; }))
      .mockResolvedValueOnce({ sessionId: "session-2", modocContent: "prepared-2" });
    const onSessionClosed = vi.fn();
    const { unmount } = render(
      <StrictMode>
        <SpreadsheetCanvas artifact={artifact} grant={grant} onSessionClosed={onSessionClosed} />
      </StrictMode>,
    );

    await waitFor(() => expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mocks.createOfflineSheetEditor).toHaveBeenCalledTimes(1));
    expect(onSessionClosed).not.toHaveBeenCalled();

    await act(async () => resolveFirstPrepare?.({ sessionId: "session-1", modocContent: "prepared-1" }));
    await waitFor(() => expect(mocks.officecli.closeXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-1",
    }));
    expect(onSessionClosed).not.toHaveBeenCalled();

    unmount();

    await waitFor(() => expect(mocks.officecli.closeXlsxEditor).toHaveBeenCalledWith({
      previewToken: "preview-token",
      sessionId: "session-2",
    }));
    expect(onSessionClosed).toHaveBeenCalledTimes(1);
    expect(onSessionClosed).toHaveBeenCalledWith("preview-token");
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

    expect(await screen.findByText("Spreadsheet editor failed to load")).toBeInTheDocument();
    expect(screen.getByText("native library missing")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open in System App" }));
    expect(mocks.officecli.openPath).toHaveBeenCalledWith("/tmp/book.xlsx");

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(mocks.officecli.prepareXlsxEditor).toHaveBeenCalledTimes(2));
  });

  it("formats every requested range and clamps one that runs past the sheet", async () => {
    mocks.worksheet.rowCount = 4;
    mocks.worksheet.columnCount = 3;
    const setData = vi.fn();
    mocks.worksheet.getRange.mockImplementation(() => ({
      getData: vi.fn(() => [[{ formula: null, value: { type: "primitive", value: "Alpha" }, text: "Alpha" }]]),
      setData,
      getText: vi.fn(() => [[""]]),
      getBounding: vi.fn(() => ({ left: 0, top: 0, width: 10, height: 10 })),
    }));
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    const result = await act(async () => ref.current!.formatCells({
      ranges: [
        { startRow: 0, startColumn: 0, rowCount: 1, columnCount: 3 },
        { startRow: 2, startColumn: 0, rowCount: 99, columnCount: 99 },
      ],
      style: { background: "#FFEB3B" },
    }));

    // 1x3 plus the second range clamped from 99x99 down to the remaining 2x3.
    expect(result).toEqual({ formatted: 9, sheetId: "sheet-1", sheetName: "Products" });
    expect(mocks.worksheet.getRange).toHaveBeenCalledWith({ type: "cells", row: 2, rowCount: 2, column: 0, columnCount: 3 });
    expect(setData).toHaveBeenCalledTimes(2);
    expect(setData.mock.calls[0][0][0][0]).toEqual({ value: "Alpha", background: "#FFEB3B" });
    // Cells the range read did not cover still get styled rather than skipped.
    expect(setData.mock.calls[0][0][0][2]).toEqual({ text: "", background: "#FFEB3B" });
  });

  it("rejects a format request that lands entirely outside the sheet", async () => {
    mocks.worksheet.rowCount = 4;
    mocks.worksheet.columnCount = 3;
    const ref = createRef<SpreadsheetCanvasHandle>();
    render(<SpreadsheetCanvas ref={ref} artifact={artifact} grant={grant} />);
    await waitFor(() => expect(mocks.editor.content.addChangeListener).toHaveBeenCalled());

    await expect(ref.current!.formatCells({
      ranges: [{ startRow: 40, startColumn: 0, rowCount: 2, columnCount: 2 }],
      style: { bold: true },
    })).rejects.toThrow("超出了工作表范围");
  });
});

describe("retryWhenSheetCellsReady", () => {
  it("waits for the Sheet SDK cell model before retrying a row insertion", async () => {
    vi.useFakeTimers();
    const insertRows = vi.fn()
      .mockImplementationOnce(() => { throw new Error("单元格加载中，请加载完成后插入行"); })
      .mockImplementationOnce(() => undefined);

    const result = retryWhenSheetCellsReady(() => {
      insertRows();
      return "written";
    });
    await vi.advanceTimersByTimeAsync(50);

    await expect(result).resolves.toBe("written");
    expect(insertRows).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("does not retry unrelated sheet errors", async () => {
    await expect(retryWhenSheetCellsReady(() => {
      throw new Error("worksheet is protected");
    })).rejects.toThrow("worksheet is protected");
  });
});

describe("styledCellData", () => {
  const style = { background: "#FFEB3B" } as const;

  it("keeps a formula rather than flattening it to text", () => {
    expect(styledCellData({ formula: "=SUM(A1:A9)", value: { type: "primitive", value: 45 }, text: "45" } as never, style))
      .toEqual({ formula: "=SUM(A1:A9)", background: "#FFEB3B" });
  });

  it("keeps a numeric value so restyling does not turn numbers into text", () => {
    expect(styledCellData({ formula: null, value: { type: "primitive", value: 45 }, text: "45" } as never, style))
      .toEqual({ value: 45, background: "#FFEB3B" });
  });

  it("keeps the date serial for date cells", () => {
    expect(styledCellData({ formula: null, value: { type: "date", value: 45_000 }, text: "2023-03-15" } as never, style))
      .toEqual({ value: 45_000, background: "#FFEB3B" });
  });

  it("falls back to text for calc errors and empty cells", () => {
    expect(styledCellData({ formula: null, value: { type: "calcError", value: { error: "#DIV/0!" } }, text: "#DIV/0!" } as never, style))
      .toEqual({ text: "#DIV/0!", background: "#FFEB3B" });
    expect(styledCellData(undefined, style)).toEqual({ text: "", background: "#FFEB3B" });
  });

  it("carries existing styles forward and lets the request override them", () => {
    expect(styledCellData({ formula: null, value: null, text: "Total", bold: true, background: "#EEEEEE", fontSize: 12 } as never, style))
      .toEqual({ text: "Total", bold: true, background: "#FFEB3B", fontSize: 12 });
  });
});
