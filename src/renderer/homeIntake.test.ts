import { describe, expect, it } from "vitest";
import { inferHomeTaskRoute } from "./homeIntake";

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
