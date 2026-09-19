import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DesktopAPI, DocumentRecord } from "../shared/types";
import type { FileMeta } from "../shared/uiPort";
import type {
  SpreadsheetCanvasHandle,
  SpreadsheetCanvasProps,
} from "../renderer/spreadsheet/SpreadsheetCanvas";

/**
 * The Excel leaf's own work, and nothing above it.
 *
 * The dispatcher (`createDesktopCanvas.test.tsx`) and the shell wiring
 * (`canvasSeam.test.tsx`) are covered elsewhere. What lives only here is the
 * translation between a `FileMeta` and a running workbook — and, above all, the
 * boolean trap: this editor's `save()` resolves to false when nothing was
 * written, and `Promise<boolean>` is assignable to `Promise<void>`, so the
 * failure would vanish on its way up and the shell would clear the dirty flag
 * over unsaved work. Half the cases below exist for that one hazard.
 *
 * The workbook editor itself is an SDK against a real grid, so it is stubbed.
 * The stub is typed as the real component, which makes it the guard on the prop
 * contract: a signature change upstream fails here rather than at runtime.
 */

/**
 * The props as the stub receives them. `ref` is not part of the component's own
 * prop type but is what React passes a function ref through, and this file
 * drives the handle by calling it.
 */
type StubProps = SpreadsheetCanvasProps & {
  ref?: (handle: SpreadsheetCanvasHandle | null) => void;
};

const canvasProps: StubProps[] = [];
let handle: SpreadsheetCanvasHandle;
let saveResult = true;
/** What the editor reports through `onSaveError` *during* a failing save. */
let saveReason: string | undefined;

vi.mock("../renderer/spreadsheet/SpreadsheetCanvas", () => ({
  SpreadsheetCanvas: (props: StubProps) => {
    canvasProps.push(props);
    queueMicrotask(() => props.ref?.(handle));
    return <div data-testid="sheet-canvas" />;
  },
}));

const { SheetCanvas } = await import("./SheetCanvas");

function record(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "document:one",
    filePath: "/tmp/officedex/budget.xlsx",
    fileName: "budget.xlsx",
    documentType: "xlsx",
    workspaceId: "",
    createdAt: "2026-09-10T09:00:00Z",
    updatedAt: "2026-09-10T09:00:00Z",
    migrationSource: "user",
    pinned: false,
    ...overrides,
  };
}

function file(id = "document:one"): FileMeta {
  return {
    id, name: "budget.xlsx", type: "sheet", folderId: "folder:default",
    createdAt: 1, updatedAt: 1, lastOpenedAt: 1, dirty: false, pinned: false,
  };
}

function stubApi(overrides: Partial<DesktopAPI> = {}): DesktopAPI {
  let issued = 0;
  return {
    getDocument: vi.fn(async (id: string) => record({ id })),
    issuePreviewToken: vi.fn(async () => {
      issued += 1;
      return { token: `token-${issued}`, fileName: "budget.xlsx", documentType: "xlsx" };
    }),
    ...overrides,
  } as unknown as DesktopAPI;
}

const noop = () => {};

beforeEach(() => {
  canvasProps.length = 0;
  saveResult = true;
  saveReason = undefined;
  // The real editor reports a failure through `onSaveError` *while* save() is
  // running, and clears it at the start of each attempt. Setting the reason
  // from outside beforehand would test a sequence that never happens — the leaf
  // resets the reason on entry precisely so a stale one is never reported.
  handle = {
    save: vi.fn(async () => {
      if (saveReason !== undefined) canvasProps.at(-1)?.onSaveError?.(saveReason);
      return saveResult;
    }),
  } as unknown as SpreadsheetCanvasHandle;
});
afterEach(cleanup);

/** Renders and waits for the leaf to hand its save function up. */
async function mounted(api: DesktopAPI = stubApi()) {
  const onSave = vi.fn();
  const onUnavailable = vi.fn();
  const onDirtyChange = vi.fn();
  const onSelectionChange = vi.fn();
  const onResolveSelection = vi.fn();
  render(
    <SheetCanvas
      api={api}
      file={file()}
      onDirtyChange={onDirtyChange}
      onSelectionChange={onSelectionChange}
      onResolveSelection={onResolveSelection}
      onSave={onSave}
      onUnavailable={onUnavailable}
    />,
  );
  await waitFor(() => expect(onSave).toHaveBeenCalled());
  const save = onSave.mock.calls.at(-1)![0] as () => Promise<void>;
  return { api, save, onSave, onUnavailable, onDirtyChange, onSelectionChange, onResolveSelection };
}

describe("SheetCanvas", () => {
  // This editor is the only one that wants the whole artifact as well as the
  // grant, so the record has to be kept after issuing rather than discarded.
  it("gives the editor both the artifact and the grant", async () => {
    const api = stubApi();
    await mounted(api);

    expect(api.getDocument).toHaveBeenCalledWith("document:one");
    expect(canvasProps[0].artifact).toMatchObject({
      filePath: "/tmp/officedex/budget.xlsx",
      fileName: "budget.xlsx",
      documentType: "xlsx",
    });
    expect(canvasProps[0].grant.token).toBe("token-1");
  });

  it("carries the originating task when the workbook has one", async () => {
    const api = stubApi({
      getDocument: vi.fn(async () => record({ currentArtifactTaskId: "task-9" })),
    } as unknown as Partial<DesktopAPI>);
    await mounted(api);

    expect(api.issuePreviewToken).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "task-9" }),
    );
  });

  it("saves through the editor", async () => {
    const { save } = await mounted();

    await expect(save()).resolves.toBeUndefined();

    expect(handle.save).toHaveBeenCalled();
  });

  // The hazard this file exists for. A false from the editor means the workbook
  // was not written; if it were swallowed, the shell would clear the dirty flag
  // and tell the user "Saved" over work that is still only in memory.
  it("throws when the editor reports nothing was written", async () => {
    const { save } = await mounted();
    saveResult = false;

    await expect(save()).rejects.toThrow(/could not be saved/i);
  });

  // And when the editor said why, that is what the user should read — not the
  // generic line.
  it("throws with the reason the editor gave", async () => {
    const { save } = await mounted();
    saveResult = false;
    saveReason = "the file is open in Excel";

    await expect(save()).rejects.toThrow(/open in Excel/);
  });

  // A stale reason from a previous attempt must not be reported for this one:
  // the leaf clears it on entry, so a second failure with no reason falls back
  // to the generic line rather than repeating the first one's.
  it("does not reuse the previous failure's reason", async () => {
    const { save } = await mounted();
    saveResult = false;
    saveReason = "a one-off glitch";
    await expect(save()).rejects.toThrow(/one-off glitch/);

    saveReason = undefined;
    await expect(save()).rejects.toThrow(/could not be saved/i);
  });

  // No editor means nothing can be written, and the dispatcher has to know that
  // rather than hold a handle into a session that is gone.
  it("withdraws the save function when the editor goes away", async () => {
    const { onSave } = await mounted();

    canvasProps[0].ref?.(null);

    expect(onSave).toHaveBeenLastCalledWith(null);
  });

  it("passes the editor's dirty flag straight through", async () => {
    const { onDirtyChange } = await mounted();
    expect(canvasProps[0].onDirtyChange).toBe(onDirtyChange);
  });

  // A workbook that cannot be opened has to say why; nothing renders in the
  // meantime, so otherwise the user sees the skeleton forever.
  it("reports a workbook it could not open", async () => {
    const onUnavailable = vi.fn();
    const api = stubApi({
      issuePreviewToken: vi.fn(async () => {
        throw new Error("the file is gone");
      }),
    } as unknown as Partial<DesktopAPI>);

    render(
      <SheetCanvas api={api} file={file()} onDirtyChange={noop} onSelectionChange={noop} onResolveSelection={noop} onSave={noop} onUnavailable={onUnavailable} />,
    );

    await waitFor(() => expect(onUnavailable).toHaveBeenCalledWith("the file is gone"));
    expect(canvasProps).toHaveLength(0);
  });

  it("names the workbook editor when it fails to start", async () => {
    const { onUnavailable } = await mounted();

    canvasProps[0].onError?.("the grid never loaded");

    expect(onUnavailable).toHaveBeenCalledWith(expect.stringContaining("the grid never loaded"));
    expect(onUnavailable).toHaveBeenCalledWith(expect.stringMatching(/workbook editor/i));
  });

  /*
   * Selection. The editor reports the address on every range change, which is
   * cheap; the cells themselves are read once, when the message is sent —
   * `readSelection` pulls the text of every cell in the block.
   */
  it("labels the selected range in A1 notation", async () => {
    const { onSelectionChange } = await mounted();

    canvasProps[0].onSelectionChange?.({
      sheetId: "sheet-1",
      sheetName: "Forecast",
      range: { row: 1, column: 1, rowCount: 9, columnCount: 3 },
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "budget.xlsx · Forecast!B2:D10", text: "" }),
    );
  });

  it("labels a single cell without a range", async () => {
    const { onSelectionChange } = await mounted();

    canvasProps[0].onSelectionChange?.({
      sheetId: "sheet-1",
      sheetName: "Forecast",
      range: { row: 5, column: 27, rowCount: 1, columnCount: 1 },
    });

    expect(onSelectionChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ label: "budget.xlsx · Forecast!AB6" }),
    );
  });

  it("reads the cells only when the message is sent", async () => {
    const readSelection = vi.fn(() => ({
      sheetId: "sheet-1",
      sheetName: "Forecast",
      range: { row: 0, column: 0, rowCount: 2, columnCount: 2 },
      values: [
        ["Revenue", "1200"],
        ["Cost", "800"],
      ],
    }));
    handle = { ...handle, readSelection } as unknown as SpreadsheetCanvasHandle;
    const { onResolveSelection } = await mounted();

    canvasProps[0].onSelectionChange?.({
      sheetId: "sheet-1",
      sheetName: "Forecast",
      range: { row: 0, column: 0, rowCount: 2, columnCount: 2 },
    });
    expect(readSelection).not.toHaveBeenCalled();

    const resolve = onResolveSelection.mock.calls.at(-1)![0] as () => Promise<unknown>;
    await expect(resolve()).resolves.toEqual(
      expect.objectContaining({ text: "Revenue\t1200\nCost\t800" }),
    );
  });

  // Too many cells, or a selection the tools cannot read. The message still
  // goes out; it just travels with the label alone.
  it("gives up quietly when the cells cannot be read", async () => {
    handle = {
      ...handle,
      readSelection: vi.fn(() => {
        throw new Error("The selection is too large.");
      }),
    } as unknown as SpreadsheetCanvasHandle;
    const { onResolveSelection } = await mounted();

    const resolve = onResolveSelection.mock.calls.at(-1)![0] as () => Promise<unknown>;
    await expect(resolve()).resolves.toBeNull();
  });
});
