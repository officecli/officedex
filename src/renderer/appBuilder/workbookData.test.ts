import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { defaultSelectedFieldIds, findSemanticField, parseWorkbookSnapshot } from "./workbookData";

function workbookBytes(): Uint8Array {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["任务名称", "状态", "负责人", "截止日期", "工时"],
    ["完成首页", "进行中", "陈晓", "2026-08-14", 8],
    ["发布测试环境", "已完成", "王璐", "2026-08-10", 3],
  ]);
  XLSX.utils.book_append_sheet(workbook, sheet, "全部任务");
  return XLSX.write(workbook, { type: "array", bookType: "xlsx" });
}

describe("workbook app data source", () => {
  it("extracts sheets, typed fields, and records from real XLSX bytes", () => {
    const snapshot = parseWorkbookSnapshot(workbookBytes());
    expect(snapshot.fingerprint).toBeTruthy();
    expect(snapshot.sheets).toHaveLength(1);
    expect(snapshot.sheets[0].name).toBe("全部任务");
    expect(snapshot.sheets[0].fields.map((field) => field.label)).toEqual(["任务名称", "状态", "负责人", "截止日期", "工时"]);
    expect(snapshot.sheets[0].rows).toHaveLength(2);
    expect(snapshot.sheets[0].rows[0].values["column-0"]).toBe("完成首页");
    expect(snapshot.sheets[0].rows[0].values["column-4"]).toBe(8);
  });

  it("selects a safe initial field set and detects semantic fields", () => {
    const sheet = parseWorkbookSnapshot(workbookBytes()).sheets[0];
    expect(defaultSelectedFieldIds(sheet)).toEqual(["column-0", "column-1", "column-2", "column-3", "column-4"]);
    expect(findSemanticField(sheet, "title")?.label).toBe("任务名称");
    expect(findSemanticField(sheet, "status")?.label).toBe("状态");
    expect(findSemanticField(sheet, "owner")?.label).toBe("负责人");
    expect(findSemanticField(sheet, "date")?.label).toBe("截止日期");
  });
});

