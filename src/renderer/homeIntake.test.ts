import { describe, expect, it } from "vitest";
import { inferHomeTaskRoute, outputFileStem, requestedFileName, unsupportedOutputFormat } from "./homeIntake";

describe("inferHomeTaskRoute", () => {
  it("keeps a selected PPT template as pptx even when the prompt looks like a Word brief", () => {
    expect(inferHomeTaskRoute({
      prompt: "制作一份品牌新品发布方案，呈现产品故事、核心卖点和上市计划。",
      documentType: "pptx",
      templateId: "tpl-company",
      templateVersion: 2,
      templateAssetDir: "/local/ppt-templates/tpl-company",
    })).toEqual({ kind: "generate", documentType: "pptx" });
  });

  it("keeps the home output-type picker over prompt keywords", () => {
    expect(inferHomeTaskRoute({
      prompt: "制作一份酒店营销推广方案",
      documentType: "pptx",
    })).toEqual({ kind: "generate", documentType: "pptx" });
  });

  it("still infers docx from 方案 when the user did not pick a type or template", () => {
    expect(inferHomeTaskRoute({ prompt: "写一份合作方案" })).toEqual({
      kind: "generate",
      documentType: "docx",
    });
  });

  it("still routes catalog cleanup before the output-type picker", () => {
    expect(inferHomeTaskRoute({
      prompt: "Clean this supplier catalog",
      documentType: "pptx",
      sourceFile: "/tmp/supplier.xlsx",
    })).toEqual({
      kind: "catalog_cleanup",
      documentType: "xlsx",
      sourceFile: "/tmp/supplier.xlsx",
    });
  });

  /*
   * The composer's output chip states a type for a *new* file, and cleanup has
   * nothing to clean. This used to come back as `needs_source`, which the agent
   * service turns into "that request needs a file to work from. Open one
   * first." — a refusal, for a request that needs no file.
   */
  it("does not send a stated type into catalog cleanup when there is no source", () => {
    expect(inferHomeTaskRoute({
      prompt: "Write up how we should clean the product catalog",
      documentType: "docx",
    })).toEqual({ kind: "generate", documentType: "docx" });
  });

  it("still asks for a source when catalog cleanup is the inference, not a choice", () => {
    expect(inferHomeTaskRoute({ prompt: "Clean up the supplier catalog" })).toEqual({
      kind: "needs_source",
      documentType: "xlsx",
    });
  });

  /*
   * "New workbook" is a statement that there is not one yet.
   *
   * The stated type stops docx and pptx from being dragged into cleanup, but
   * `xlsx` passes the guard — and the composer's output chip sets that type
   * precisely when the user asked for a *new* workbook, clearing the active
   * file as it does. So the one request the chip exists to express, "make me a
   * product list", came back as "that request needs a file to work from" about
   * a file the user never claimed to have. Cleanup needs something to clean;
   * with nothing to clean, a workbook is what was asked for.
   */
  it("makes a new workbook when the user asked for one and has no catalog to clean", () => {
    // Both halves of the cleanup match are here — 「整理」is the action,
    // 「产品」the subject — and there is still nothing to clean.
    expect(inferHomeTaskRoute({
      prompt: "帮我整理一份新品的产品清单表",
      documentType: "xlsx",
    })).toEqual({ kind: "generate", documentType: "xlsx" });
  });

  it("still cleans the catalog the user pointed at", () => {
    expect(inferHomeTaskRoute({
      prompt: "Clean up this product catalog",
      documentType: "xlsx",
      sourceFile: "/tmp/catalog.xlsx",
    })).toEqual({ kind: "catalog_cleanup", documentType: "xlsx", sourceFile: "/tmp/catalog.xlsx" });
  });

  it("does not steal a PPT template into catalog cleanup", () => {
    expect(inferHomeTaskRoute({
      prompt: "Clean this supplier catalog",
      documentType: "pptx",
      templateId: "tpl-company",
      templateAssetDir: "/local/ppt-templates/tpl-company",
      sourceFile: "/tmp/supplier.xlsx",
    })).toEqual({
      kind: "generate",
      documentType: "pptx",
      sourceFile: "/tmp/supplier.xlsx",
    });
  });
});

describe("formats the product does not make", () => {
  it("refuses a named unsupported format instead of falling back to the default", () => {
    expect(inferHomeTaskRoute({ prompt: "把这些要点存成一个 txt 文件" })).toEqual({ kind: "unsupported_format", format: "TXT" });
    expect(inferHomeTaskRoute({ prompt: "export this as a PDF" })).toEqual({ kind: "unsupported_format", format: "PDF" });
    expect(inferHomeTaskRoute({ prompt: "write the notes to README.md" })).toEqual({ kind: "unsupported_format", format: "Markdown" });
  });

  it("only refuses once every supported keyword has missed", () => {
    expect(inferHomeTaskRoute({ prompt: "turn this PDF into slides" })).toEqual({ kind: "generate", documentType: "pptx", sourceFile: undefined });
    expect(inferHomeTaskRoute({ prompt: "summarise the txt into a Word document" })).toEqual({ kind: "generate", documentType: "docx", sourceFile: undefined });
  });

  it("never refuses a stated type", () => {
    expect(inferHomeTaskRoute({ prompt: "save as txt", documentType: "docx" })).toEqual({ kind: "generate", documentType: "docx", sourceFile: undefined });
  });

  it("still falls back when nothing unsupported is named either", () => {
    expect(inferHomeTaskRoute({ prompt: "something about the launch" }, "docx")).toEqual({ kind: "generate", documentType: "docx", sourceFile: undefined });
  });

  it("never lets a default of image decide what silence means", () => {
    for (const prompt of ["给我详细介绍一下绝区零的剧情", "我想要入坑绝区零，给我写一份入坑攻略"]) {
      expect(inferHomeTaskRoute({ prompt }, "img")).toEqual({ kind: "generate", documentType: "docx", sourceFile: undefined });
      expect(inferHomeTaskRoute({ prompt }, "gif")).toEqual({ kind: "generate", documentType: "docx", sourceFile: undefined });
    }
    expect(inferHomeTaskRoute({ prompt: "something about the launch" }, "xlsx")).toMatchObject({ documentType: "xlsx" });
  });

  it("still makes an image when one is asked for", () => {
    expect(inferHomeTaskRoute({ prompt: "画一张赛博朋克风格的海报" }, "docx")).toMatchObject({ documentType: "img" });
    expect(inferHomeTaskRoute({ prompt: "给我详细介绍一下绝区零的剧情", documentType: "img" }, "docx")).toMatchObject({ documentType: "img" });
    expect(inferHomeTaskRoute({ prompt: "做一个季度复盘的 PPT" }, "img")).toMatchObject({ documentType: "pptx" });
  });

  it("names the format as the refusal will", () => {
    expect(unsupportedOutputFormat("a plain text file please")).toBe("TXT");
    expect(unsupportedOutputFormat("make me a deck")).toBeNull();
  });
});

describe("the file name the user asked for", () => {
  it("reads a name with an extension from anywhere in the text", () => {
    expect(requestedFileName("写一份项目方案，文件名叫 Q4-plan.docx")).toBe("Q4-plan.docx");
    expect(requestedFileName("Make a deck called launch-v2.pptx for Monday")).toBe("launch-v2.pptx");
  });

  it("reads a naming phrase without an extension", () => {
    expect(requestedFileName("写一份项目方案，文件名叫 季度复盘")).toBe("季度复盘");
    expect(requestedFileName("Write the memo and name it Board update")).toBe("Board update");
    expect(requestedFileName("保存为「十月计划」")).toBe("十月计划");
  });

  it("reads 「叫 X 的 <document>」 and only that shape of a bare 叫", () => {
    expect(requestedFileName("生成一个叫 ODQA-check 的 Word")).toBe("ODQA-check");
    expect(requestedFileName("做一份叫「十月计划」的 PPT")).toBe("十月计划");
    // A bare 叫 that names something other than the document is left alone.
    expect(requestedFileName("写一篇介绍叫张三的人的文章")).toBeNull();
  });

  it("finds none when none was asked for", () => {
    expect(requestedFileName("Write a memo about the launch")).toBeNull();
    expect(requestedFileName("帮我写一份项目方案")).toBeNull();
  });
});

describe("outputFileStem", () => {
  it("strips a known extension and keeps the rest", () => {
    expect(outputFileStem("Q4-plan.docx")).toBe("Q4-plan");
    expect(outputFileStem("launch-v2.PPTX")).toBe("launch-v2");
    expect(outputFileStem(" 季度复盘 ")).toBe("季度复盘");
    expect(outputFileStem("ODQA-check")).toBe("ODQA-check");
  });

  // officecli strips only the extension matching the document type, so a
  // name carrying a different one would otherwise come out as `plan.pdf.pptx`.
  it("strips an extension that does not match the output type too", () => {
    expect(outputFileStem("plan.pdf")).toBe("plan");
  });

  it("sends nothing rather than a name that is not clearly one", () => {
    expect(outputFileStem(null)).toBeNull();
    expect(outputFileStem("")).toBeNull();
    expect(outputFileStem(".docx")).toBeNull();
    expect(outputFileStem("---")).toBeNull();
    expect(outputFileStem("x".repeat(81))).toBeNull();
    expect(outputFileStem("x".repeat(80))).toBe("x".repeat(80));
  });
});
