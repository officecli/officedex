import { describe, expect, it, vi } from "vitest";
import type { OutputTypeClassification } from "../shared/types";
import { classifyOutputType, OUTPUT_TYPE_MIN_CONFIDENCE } from "./outputTypeClassifier";

const answering = (answer: Partial<OutputTypeClassification>) => ({
  classifyOutputType: vi.fn(async () => ({ available: true, documentType: "docx", confidence: 0.9, ...answer })),
});

describe("asking the engine what kind of file a request wants", () => {
  it("returns the type the engine is sure of", async () => {
    const api = answering({ documentType: "docx", confidence: 0.93, reason: "Asks for an explanation." });

    expect(await classifyOutputType(api, "给我详细介绍一下绝区零的剧情")).toEqual({ documentType: "docx", confidence: 0.93, reason: "Asks for an explanation." });
    expect(api.classifyOutputType).toHaveBeenCalledWith("给我详细介绍一下绝区零的剧情");
  });

  it("has no answer on a desktop host that predates the classifier", async () => {
    expect(await classifyOutputType({}, "anything")).toEqual({ documentType: null, why: "unsupported" });
  });

  it("has no answer when the running engine predates the classifier", async () => {
    expect(await classifyOutputType(answering({ available: false, documentType: "", confidence: 0 }), "anything")).toEqual({ documentType: null, why: "unsupported" });
  });

  it("has no answer when the call fails", async () => {
    const api = { classifyOutputType: vi.fn(async () => { throw new Error("offline"); }) };

    expect(await classifyOutputType(api, "anything")).toEqual({ documentType: null, why: "failed" });
  });

  it("stops waiting for an answer that is too slow", async () => {
    const api = { classifyOutputType: vi.fn(() => new Promise<OutputTypeClassification>(() => {})) };

    expect(await classifyOutputType(api, "anything", 10)).toEqual({ documentType: null, why: "timeout" });
  });

  it("does not act on a guess", async () => {
    expect(await classifyOutputType(answering({ confidence: OUTPUT_TYPE_MIN_CONFIDENCE - 0.01 }), "anything")).toEqual({ documentType: null, why: "unsure" });
    expect(await classifyOutputType(answering({ confidence: OUTPUT_TYPE_MIN_CONFIDENCE }), "anything")).toMatchObject({ documentType: "docx" });
  });

  it("does not act on a type this path does not make, or a confidence that is not a number", async () => {
    expect(await classifyOutputType(answering({ documentType: "report" }), "anything")).toEqual({ documentType: null, why: "invalid" });
    expect(await classifyOutputType(answering({ documentType: "pdf" }), "anything")).toEqual({ documentType: null, why: "invalid" });
    expect(await classifyOutputType(answering({ confidence: Number.NaN }), "anything")).toEqual({ documentType: null, why: "invalid" });
  });

  it("reads the type whatever its case", async () => {
    expect(await classifyOutputType(answering({ documentType: " XLSX " }), "anything")).toMatchObject({ documentType: "xlsx" });
  });
});
