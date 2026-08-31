import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from "docx";
import { exportDocx } from "./docxExport";
import { importDocx } from "./docxImport";

describe("local DOCX conversion", () => {
  it("uses the in-app dialog before overwriting the source document", () => {
    const source = readFileSync("src/renderer/word/DocxEditor.tsx", "utf8");

    expect(source).toContain("dialog.confirm({");
    expect(source).not.toContain("window.confirm(");
  });

  it("imports common Word content without a cloud service", async () => {
    const source = new Document({
      sections: [{
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("OfficeDex report")] }),
          new Paragraph({ children: [new TextRun({ text: "Local editing", bold: true })] }),
          new Table({
            rows: [new TableRow({ children: [
              new TableCell({ children: [new Paragraph("Metric")] }),
              new TableCell({ children: [new Paragraph("Value")] }),
            ] })],
          }),
        ],
      }],
    });
    const buffer = await Packer.toBuffer(source);
    const imported = await importDocx(new Uint8Array(buffer));

    expect(imported.html).toContain("OfficeDex report");
    expect(imported.html).toContain("<strong>Local editing</strong>");
    expect(imported.html).toContain("<table>");
  });

  it("rejects a non-ZIP file that only uses a DOCX extension", async () => {
    await expect(importDocx(new TextEncoder().encode("plain text, not a Word package")))
      .rejects.toMatchObject({ code: "invalid_package" });
  });

  it("exports Tiptap JSON as a readable DOCX", async () => {
    const bytes = await exportDocx({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Quarterly plan" }] },
        { type: "paragraph", content: [
          { type: "text", text: "Revenue", marks: [{ type: "bold" }] },
          { type: "text", text: " increased." },
        ] },
        { type: "bulletList", content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "North region" }] }] },
        ] },
      ],
    }, "Quarterly plan.docx");

    expect(String.fromCharCode(...bytes.slice(0, 2))).toBe("PK");
    const imported = await importDocx(bytes);
    expect(imported.html).toContain("Quarterly plan");
    expect(imported.html).toContain("<strong>Revenue</strong>");
    expect(imported.html).toContain("North region");
  });
});
