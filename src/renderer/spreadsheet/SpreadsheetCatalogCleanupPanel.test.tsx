import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpreadsheetCatalogCleanupPanel } from "./SpreadsheetCatalogCleanupPanel";
import type { CatalogCleanupBatch, CatalogSelection } from "./catalogCleanupWorkflow";

const { executeAgentWorkflowMock } = vi.hoisted(() => ({ executeAgentWorkflowMock: vi.fn() }));
vi.mock("../agentRuntime", () => ({ executeAgentWorkflow: executeAgentWorkflowMock, confirmAgentApproval: async () => true }));

afterEach(() => { cleanup(); vi.restoreAllMocks(); executeAgentWorkflowMock.mockReset(); });

const selection: CatalogSelection = { sheetId: "sheet-1", sheetName: "Supplier Catalog", rows: [["Supplier SKU", "Product Name", "Unit Price"], ["SKU-1", "Travel Mug", "$12.50"]], selectionStartRow: 1 };
const inspection = { selections: [selection], advancedSelection: false };

function batch(overrides: Partial<CatalogCleanupBatch> = {}): CatalogCleanupBatch {
  return {
    sheetId: "sheet-1", sheetName: "Supplier Catalog", headerRowIndex: 0, firstRowIndex: 1, existingColumnCount: 3,
    headers: selection.rows[0], sourceRows: selection.rows.slice(1), intent: "create", creditEstimate: 1,
    mapping: [
      { column: 0, header: "Supplier SKU", role: "sku", confidence: .9, reason: "Matched" },
      { column: 1, header: "Product Name", role: "title", confidence: .9, reason: "Matched" },
      { column: 2, header: "Unit Price", role: "price", confidence: .9, reason: "Matched" },
    ],
    rows: [{ rowIndex: 1, status: "Ready", issues: [], findings: [], cleanupActions: [{ code: "normalize_price", field: "price", before: "$12.50", after: "12.5", safety: "safe", message: "Normalized price" }], values: { sku: "SKU-1", title: "Travel Mug", price: "12.5", handle: "travel-mug" } }],
    batchFindings: [], resultColumns: { status: 3, issues: 4, cleanup: 5, handle: 6, sku: 7, title: 8, price: 9 },
    ruleVersion: "shopify-product-csv-2026-08", taxonomyVersion: "2026-05", shopifyCsv: "Title,URL handle", findingsCsv: "Scope,Code",
    ...overrides,
  };
}

function mockRuntime(cleanupBackend: (input: Record<string, unknown>) => Promise<CatalogCleanupBatch>) {
  executeAgentWorkflowMock.mockImplementation(async (workflow: string, input: Record<string, unknown>, options: { approve?: () => Promise<boolean>; clientTools?: Record<string, (request: { arguments: Record<string, unknown> }) => Promise<unknown>> }) => {
    if (workflow === "catalog.cleanup.v1") {
      return { run: { id: "scan-run", status: "completed" }, result: await cleanupBackend(input.parameters as Record<string, unknown>) };
    }
    if (workflow === "client-tools.v1") {
      const directives = input.client_tools as Array<{ tool: string; arguments?: Record<string, unknown> }>;
      for (const directive of directives) {
        if (options.approve && !await options.approve()) throw new Error("approval denied");
        const handler = options.clientTools?.[directive.tool];
        if (!handler) throw new Error(`missing client tool ${directive.tool}`);
        await handler({ arguments: directive.arguments ?? {} });
      }
      return { run: { id: "apply-run", status: "completed" }, result: input.parameters };
    }
    throw new Error(`unexpected workflow ${workflow}`);
  });
}

describe("SpreadsheetCatalogCleanupPanel", () => {
  it("automatically starts the read-only preview when routed from Home", async () => {
    mockRuntime(async () => batch());
    render(<SpreadsheetCatalogCleanupPanel autoScan fileName="supplier.xlsx" onInspect={() => inspection} onApply={vi.fn()} onSave={vi.fn()} />);
    expect(await screen.findByText("1 products found")).toBeTruthy();
    expect(executeAgentWorkflowMock).toHaveBeenCalledWith("catalog.cleanup.v1", { parameters: { ...selection, intent: "create" } }, {}, expect.objectContaining({ operation: "scan" }));
  });

  it("uses the proprietary channel engine and shows its rule versions", async () => {
    mockRuntime(async () => batch());
    render(<SpreadsheetCatalogCleanupPanel onInspect={() => inspection} onApply={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Detect product catalog" }));
    expect(await screen.findByText("1 products found")).toBeTruthy();
    expect(executeAgentWorkflowMock).toHaveBeenCalledWith("catalog.cleanup.v1", { parameters: { ...selection, intent: "create" } }, {}, expect.any(Object));
    expect(screen.getByText(/proprietary OfficeCLI channel engine/)).toBeTruthy();
    expect(screen.getByText(/taxonomy 2026-05/)).toBeTruthy();
  });

  it("blocks writeback for file-level structural errors returned by the engine", async () => {
    mockRuntime(async () => batch({ batchFindings: [{ code: "duplicate_header", severity: "error", message: "Duplicate header" }] }));
    render(<SpreadsheetCatalogCleanupPanel onInspect={() => inspection} onApply={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Detect product catalog" }));
    expect(await screen.findByText("File structure needs attention")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Validate 1 rows across 1 sheets" })).toBeDisabled();
  });

  it("re-runs the closed-source engine when intent changes", async () => {
    mockRuntime(async () => batch());
    render(<SpreadsheetCatalogCleanupPanel onInspect={() => inspection} onApply={vi.fn()} onSave={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Detect product catalog" }));
    await screen.findByText("1 products found");
    fireEvent.click(screen.getByRole("button", { name: "Shopify import intent" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /Update existing products/i }));
    await waitFor(() => expect(executeAgentWorkflowMock).toHaveBeenLastCalledWith("catalog.cleanup.v1", { parameters: expect.objectContaining({ intent: "update", confirmedMapping: expect.any(Array) }) }, {}, expect.any(Object)));
  });

  it("scans all sheets, skips non-catalog sheets, and writes every detected catalog", async () => {
	vi.spyOn(window, "confirm").mockReturnValue(true);
    const secondSelection: CatalogSelection = { ...selection, sheetId: "sheet-2", sheetName: "Accessories" };
    const notesSelection: CatalogSelection = { ...selection, sheetId: "sheet-3", sheetName: "Read me" };
    mockRuntime(async (input) => {
      if (input.sheetId === "sheet-3") throw new Error("bridge: shopify cleanup: could not find catalog header");
      return batch({ sheetId: String(input.sheetId), sheetName: String(input.sheetName) });
    });
    const onApply = vi.fn(async () => undefined);
    const onSave = vi.fn(async () => true);
    render(<SpreadsheetCatalogCleanupPanel
      onInspect={() => ({ selections: [selection, secondSelection, notesSelection], advancedSelection: false })}
      onApply={onApply}
      onSave={onSave}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Detect product catalog" }));
    expect(await screen.findByText(/2 catalog sheets detected/)).toBeTruthy();
    expect(screen.getByText(/1 non-catalog sheets skipped/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Validate 2 rows across 2 sheets" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(2));
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("does not hide channel engine failures as non-catalog sheets", async () => {
    const secondSelection: CatalogSelection = { ...selection, sheetId: "sheet-2", sheetName: "Accessories" };
    mockRuntime(async (input) => {
      if (input.sheetId === "sheet-2") throw new Error("bridge connection interrupted");
      return batch({ sheetId: String(input.sheetId), sheetName: String(input.sheetName) });
    });
    render(<SpreadsheetCatalogCleanupPanel
      onInspect={() => ({ selections: [selection, secondSelection], advancedSelection: false })}
      onApply={vi.fn()}
      onSave={vi.fn()}
    />);

    fireEvent.click(screen.getByRole("button", { name: "Detect product catalog" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("bridge connection interrupted");
    expect(screen.queryByText(/catalog sheets detected/)).toBeNull();
  });
});
