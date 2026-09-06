import { describe, expect, it } from "vitest";
import { workbookFingerprint } from "./workbookFingerprint";

describe("workbookFingerprint", () => {
  it("is stable and changes when cell data changes", () => {
    const base = { activeSheetId: "s", sheets: [{ id: "s", name: "Data", rowCount: 1, columnCount: 1, rows: [["1"]], truncated: false }] };
    expect(workbookFingerprint(base)).toBe(workbookFingerprint({ ...base, sheets: [...base.sheets] }));
    expect(workbookFingerprint(base)).not.toBe(workbookFingerprint({ ...base, sheets: [{ ...base.sheets[0], rows: [["2"]] }] }));
  });
});
