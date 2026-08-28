import { createXlsxLocalEditRequest, normalizeXlsxRange, resolveXlsxSelection, type XlsxWorkbookIdentity, type XlsxSheetIdentity } from "./xlsxRangeAddressing";

export const xlsxRangeWorkbookFixture: XlsxWorkbookIdentity = Object.freeze({ workbookId: "workbook-catalog-01", workbookName: "catalog.xlsx" });
export const xlsxRangeSheetFixture: XlsxSheetIdentity = Object.freeze({ sheetId: "sheet-products", sheetName: "Products" });
export const xlsxCellRangeFixture = normalizeXlsxRange("$b$2");
export const xlsxRectangleRangeFixture = normalizeXlsxRange("D8:B4");
export const xlsxDocumentSelectionFixture = resolveXlsxSelection(xlsxRangeWorkbookFixture, xlsxRangeSheetFixture);
export const xlsxRangeSelectionFixture = resolveXlsxSelection(xlsxRangeWorkbookFixture, xlsxRangeSheetFixture, { range: "B2:D8" });
export const xlsxDocumentEditFixture = createXlsxLocalEditRequest({ workbook: xlsxRangeWorkbookFixture, sheet: xlsxRangeSheetFixture, instruction: "Refresh the product description" });
export const xlsxRangeEditFixture = createXlsxLocalEditRequest({ workbook: xlsxRangeWorkbookFixture, sheet: xlsxRangeSheetFixture, selection: { range: "B2:D8" }, instruction: "Normalize the selected prices" });
