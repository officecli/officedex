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
