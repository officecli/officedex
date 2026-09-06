import type { OfficeOutputRef, OfficeRefreshPlan } from "../shared/officeProduct";
import type { PlanPptxJSResult } from "../shared/types";
import type { RefreshHandlers } from "./refreshExecutor";
import { refreshHtmlApp, type HtmlAppWriter } from "./appBuilder/htmlAppRefresh";
import type { WorkbookDataSnapshot } from "./appBuilder/types";
import type { WriterApi } from "./word/writerApi";

export interface PresentationRefreshAdapter {
  inspect(output: OfficeOutputRef): Promise<unknown>;
  plan(input: { prompt: string; context: unknown }): Promise<PlanPptxJSResult>;
  apply(output: OfficeOutputRef, plan: PlanPptxJSResult): Promise<void>;
}

export function createPresentationRefreshAdapter(input: { inspect: PresentationRefreshAdapter["inspect"]; plan: PresentationRefreshAdapter["plan"]; apply: PresentationRefreshAdapter["apply"] }): PresentationRefreshAdapter {
  return { inspect: input.inspect, plan: input.plan, apply: input.apply };
}

export interface HtmlRefreshAdapter {
  refresh(output: OfficeOutputRef, plan: OfficeRefreshPlan): Promise<void>;
}

export interface OutputRefreshAdapter {
  refresh(output: OfficeOutputRef, plan: OfficeRefreshPlan): Promise<void>;
}

export function createHtmlRefreshAdapter(input: { snapshot: (output: OfficeOutputRef) => Promise<WorkbookDataSnapshot>; writer: HtmlAppWriter; onUpdated?: (output: OfficeOutputRef) => Promise<void> }): OutputRefreshAdapter {
  return {
    async refresh(output, plan) {
      const snapshot = await input.snapshot(output);
      const updated = await refreshHtmlApp(output, plan, snapshot, input.writer);
      await input.onUpdated?.(updated);
    },
  };
}

export function createWriterDocumentRefreshAdapter(input: { writer: WriterApi; replacements: (output: OfficeOutputRef, plan: OfficeRefreshPlan) => Array<{ query: string; replacement: string; scope?: "selection" | "document" }>; onSaved?: (output: OfficeOutputRef) => Promise<void> }): OutputRefreshAdapter {
  return {
    async refresh(output, plan) {
      if (!input.writer.capabilities().replaceText) throw new Error("Writer runtime does not support structured text replacement");
      const replacements = input.replacements(output, plan);
      if (replacements.length === 0) throw new Error("DOCX refresh has no replacement mapping");
      for (const replacement of replacements) await input.writer.replaceText(replacement.query, replacement.replacement, replacement.scope ?? "document");
      await input.writer.save();
      await input.onSaved?.(output);
    },
  };
}

export function createImageRefreshAdapter(input: { generate: (output: OfficeOutputRef, plan: OfficeRefreshPlan) => Promise<{ filePath: string }>; onUpdated?: (output: OfficeOutputRef, result: { filePath: string }) => Promise<void> }): OutputRefreshAdapter {
  return {
    async refresh(output, plan) {
      if (output.type !== "image") throw new Error("Image refresh requires an image output");
      const result = await input.generate(output, plan);
      if (!result.filePath) throw new Error("Image generator returned no file path");
      await input.onUpdated?.({ ...output, version: output.version + 1, filePath: result.filePath, status: "succeeded", updatedAt: new Date().toISOString() }, result);
    },
  };
}

export function createOfficeRefreshHandlers(adapters: { presentation?: PresentationRefreshAdapter; html?: HtmlRefreshAdapter; document?: OutputRefreshAdapter; image?: OutputRefreshAdapter }): RefreshHandlers {
  return {
    presentation: adapters.presentation ? async (output, plan) => {
      const context = await adapters.presentation!.inspect(output);
      const result = await adapters.presentation!.plan({
        prompt: `Refresh the data-driven content affected by views ${plan.changedViews.join(", ")}. Preserve manual edits and change only data, charts, and derived conclusions.`,
        context,
      });
      if (result.requires_confirmation || result.confidence === "low") throw new Error("Presentation refresh requires confirmation");
      await adapters.presentation!.apply(output, result);
    } : undefined,
    "html-app": adapters.html ? (output, plan) => adapters.html!.refresh(output, plan) : undefined,
    document: adapters.document ? (output, plan) => adapters.document!.refresh(output, plan) : async () => { throw new Error("DOCX refresh adapter is not connected"); },
    image: adapters.image ? (output, plan) => adapters.image!.refresh(output, plan) : async () => { throw new Error("Image refresh adapter is not connected"); },
  };
}
