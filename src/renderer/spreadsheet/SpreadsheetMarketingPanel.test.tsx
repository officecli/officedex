import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopTask } from "../../shared/types";
import { LocaleProvider } from "../i18n";
import { SpreadsheetMarketingPanel } from "./SpreadsheetMarketingPanel";
import type { MarketingBatchDraft } from "./marketingWorkflow";

const bridgeMocks = vi.hoisted(() => ({
  planShopifyCatalogCampaign: vi.fn(
    async (input: {
      rows: Array<{
        rowIndex: number;
        productName: string;
        basePrompt: string;
        referenceImages?: string[];
      }>;
      campaign: { selectedChannelIds: string[] };
    }) => ({
      ruleVersion: "private-test-v1",
      channels: [],
      missingChannels: [] as string[],
      jobs: input.rows.flatMap((row) =>
        input.campaign.selectedChannelIds.map((channelId, index) => ({
          rowIndex: row.rowIndex,
          productName: row.productName,
          referenceImages: row.referenceImages,
          channelId,
          outputTemplateId: `${channelId}.private-template.v1`,
          ratio: channelId === "shopify.theme-banner" ? "landscape" : "square",
          outputColumn: index + 5,
          prompt: `${row.basePrompt}\nPrivate channel plan: ${channelId}`,
        })),
      ),
    }),
  ),
  composeCampaignImage: vi.fn(
    async (input: {
      sourcePath: string;
      channelId: string;
      outputTemplateId?: string;
      campaignName?: string;
      productName?: string;
      offer?: string;
      cta?: string;
    }) => ({
      filePath: `${input.sourcePath}.${input.outputTemplateId}.png`,
      width: 1080,
      height: 1080,
    }),
  ),
}));

vi.mock("../bridge", () => ({ officecli: bridgeMocks }));

vi.mock("./marketingAgentRuntime", () => {
  class MarketingRuntimeError extends Error {
    constructor(message: string, readonly runId: string) { super(message); }
  }
  return {
    MarketingRuntimeError,
    runMarketingPostprocess: vi.fn(async (input: {
      jobId: string;
      sourceFilePath: string;
      channel?: string;
      outputTemplateId?: string;
      campaign?: { name: string; offer?: string; cta?: string };
      productName: string;
      finalStatus: string;
    }, handlers: { insertImage(filePath: string): Promise<void>; setStatus(status: string): Promise<void>; save(): Promise<void> }) => {
      let filePath = input.sourceFilePath;
      if (input.channel && input.campaign) {
        filePath = (await bridgeMocks.composeCampaignImage({
          sourcePath: input.sourceFilePath,
          channelId: input.channel,
          outputTemplateId: input.outputTemplateId,
          campaignName: input.campaign.name,
          productName: input.productName,
          offer: input.campaign.offer,
          cta: input.campaign.cta,
        })).filePath;
      }
      await handlers.insertImage(filePath);
      await handlers.setStatus(input.finalStatus);
      await handlers.save();
      return { id: `runtime-${input.jobId}`, status: "completed" };
    }),
  };
});

afterEach(() => cleanup());

const batch: MarketingBatchDraft = {
  sheetId: "sheet-1",
  sheetName: "Products",
  outputColumn: 4,
  statusColumn: 5,
  headerRowIndex: 0,
  outputTitle: "OfficeDex主图",
  assetKind: "marketplace-main",
  mapping: {
    sheetId: "sheet-1",
    sheetName: "Products",
    headerRowIndex: 0,
    schemaFingerprint: "mapping-test",
    source: "rules",
    confirmed: false,
    summary: "Suggested mapping",
    confidence: "medium",
    warnings: [],
    columns: [
      {
        column: 0,
        header: "Product",
        role: "productName",
        confidence: 0.9,
        reason: "name",
        status: "suggested",
      },
      {
        column: 1,
        header: "Prompt",
        role: "marketplaceMainPrompt",
        confidence: 0.9,
        reason: "prompt",
        status: "suggested",
      },
      {
        column: 2,
        header: "Reference image",
        role: "referenceImages",
        confidence: 0.9,
        reason: "reference",
        status: "suggested",
      },
      {
        column: 3,
        header: "Generated image",
        role: "generatedImage",
        confidence: 0.9,
        reason: "output",
        status: "suggested",
      },
      {
        column: 4,
        header: "Status",
        role: "generationStatus",
        confidence: 0.9,
        reason: "status",
        status: "suggested",
      },
    ],
  },
  source: {
    headers: [
      "Product",
      "Prompt",
      "Reference image",
      "Generated image",
      "Status",
    ],
    rows: [
      [
        "Travel mug",
        "Create a clean ecommerce hero image",
        "/tmp/mug.png",
        "",
        "Queued",
      ],
    ],
    firstRowIndex: 1,
    existingColumnCount: 5,
  },
  rows: [
    {
      rowIndex: 1,
      productName: "Travel mug",
      prompt: "Create a clean ecommerce hero image",
      referenceImages: ["/tmp/mug.png"],
    },
  ],
};

const analysisResult = {
  summary: "AI mapping",
  confidence: "high" as const,
  warnings: [],
  columns: batch.mapping.columns.map(
    ({ column, role, confidence, reason }) => ({
      column,
      role,
      confidence,
      reason,
    }),
  ),
};

describe("SpreadsheetMarketingPanel", () => {
  it("starts with an editable default campaign name", () => {
    render(
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={{}}
          onInspect={() => batch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={vi.fn()}
          onSetStatus={vi.fn(async () => undefined)}
          onInsertImage={vi.fn(async () => undefined)}
          onGenerate={vi.fn(async () => ({ taskId: "unused" }))}
        />
      </LocaleProvider>,
    );

    expect(screen.getByRole("textbox", { name: "Campaign name" })).toHaveValue(
      "Shopify Campaign",
    );
  });

  it("accepts a planner response whose empty missing-channel list is null", async () => {
    bridgeMocks.planShopifyCatalogCampaign.mockResolvedValueOnce({
      ruleVersion: "private-test-v1",
      channels: [],
      jobs: [],
      missingChannels: null as unknown as string[],
    });
    render(
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={{}}
          onInspect={() => batch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={vi.fn()}
          onSetStatus={vi.fn(async () => undefined)}
          onInsertImage={vi.fn(async () => undefined)}
          onGenerate={vi.fn(async () => ({ taskId: "unused" }))}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Read selected products" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm field mapping" }));
    fireEvent.click(screen.getByRole("button", { name: "Generate campaign pack" }));

    await waitFor(() => expect(bridgeMocks.planShopifyCatalogCampaign).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("builds a multi-channel campaign, writes each artifact to its own column, and totals settled Credits", async () => {
    const campaignBatch: MarketingBatchDraft = {
      ...batch,
      source: {
        ...batch.source,
        headers: [
          ...batch.source.headers,
          "Shopify Product Media",
          "Shopify Collection Image",
        ],
        rows: [batch.source.rows[0].concat("", "")],
        existingColumnCount: 7,
      },
    };
    const onPrepare = vi.fn();
    const onSetStatus = vi.fn(async () => undefined);
    const onInsertImage = vi.fn(
      async (
        _batch: MarketingBatchDraft,
        _rowIndex: number,
        _filePath: string,
      ) => undefined,
    );
    const onGenerate = vi
      .fn()
      .mockResolvedValueOnce({ taskId: "campaign-square" })
      .mockResolvedValueOnce({ taskId: "campaign-story" });
    const onSave = vi.fn(async () => true);
    const renderPanel = (tasks: Record<string, DesktopTask>) => (
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={tasks}
          creditBalance={100}
          onInspect={() => campaignBatch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={onPrepare}
          onSetStatus={onSetStatus}
          onInsertImage={onInsertImage}
          onGenerate={onGenerate}
          onSave={onSave}
        />
      </LocaleProvider>
    );

    const view = render(renderPanel({}));
    fireEvent.change(screen.getByRole("textbox", { name: "Campaign name" }), {
      target: { value: "Summer Sale" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Shopify theme banner" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm field mapping" }),
    );
    expect(screen.getByText("1 products · 2 final outputs")).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Generate campaign pack" }),
    );

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(onGenerate.mock.calls[0][0]).toEqual(
      expect.objectContaining({ campaignChannel: "shopify.product-media" }),
    );
    expect(onGenerate.mock.calls[1][0]).toEqual(
      expect.objectContaining({ campaignChannel: "shopify.collection-image" }),
    );

    view.rerender(
      renderPanel({
        "campaign-square": {
          id: "campaign-square",
          conversationId: "campaign-square",
          status: "completed",
          events: [],
          creditCharged: 3,
          artifact: {
            filePath: "/tmp/square.png",
            fileName: "square.png",
            documentType: "img",
          },
        },
        "campaign-story": {
          id: "campaign-story",
          conversationId: "campaign-story",
          status: "completed",
          events: [],
          creditCharged: 4,
          artifact: {
            filePath: "/tmp/story.png",
            fileName: "story.png",
            documentType: "img",
          },
        },
      }),
    );

    await waitFor(() => expect(onInsertImage).toHaveBeenCalledTimes(2));
    expect(
      onInsertImage.mock.calls.map((call) => [
        (call[0] as MarketingBatchDraft).outputColumn,
        call[2],
      ]),
    ).toEqual(
      expect.arrayContaining([
        [5, "/tmp/square.png.shopify.product-media.private-template.v1.png"],
        [6, "/tmp/story.png.shopify.collection-image.private-template.v1.png"],
      ]),
    );
    expect(bridgeMocks.composeCampaignImage).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: "shopify.product-media",
        campaignName: "Summer Sale",
        productName: "Travel mug",
      }),
    );
    expect(await screen.findByText("Settled cost: 7 Credits")).toBeTruthy();
  });

  it("retries only failed campaign outputs", async () => {
    const onGenerate = vi
      .fn()
      .mockResolvedValueOnce({ taskId: "failed-first" })
      .mockResolvedValueOnce({ taskId: "completed-first" })
      .mockResolvedValueOnce({ taskId: "failed-retry" });
    const campaignBatch: MarketingBatchDraft = {
      ...batch,
      source: {
        ...batch.source,
        headers: [
          ...batch.source.headers,
          "Shopify Product Media",
          "Shopify Collection Image",
        ],
        rows: [batch.source.rows[0].concat("", "")],
        existingColumnCount: 7,
      },
    };
    const renderPanel = (tasks: Record<string, DesktopTask>) => (
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={tasks}
          onInspect={() => campaignBatch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={vi.fn()}
          onSetStatus={vi.fn(async () => undefined)}
          onInsertImage={vi.fn(async () => undefined)}
          onGenerate={onGenerate}
          onSave={vi.fn(async () => true)}
        />
      </LocaleProvider>
    );
    const view = render(renderPanel({}));
    fireEvent.change(screen.getByRole("textbox", { name: "Campaign name" }), {
      target: { value: "Launch" },
    });
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Shopify theme banner" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm field mapping" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Generate campaign pack" }),
    );
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));

    view.rerender(
      renderPanel({
        "failed-first": {
          id: "failed-first",
          conversationId: "failed-first",
          status: "failed",
          events: [],
          error: "provider failed",
          creditCharged: 0,
        },
        "completed-first": {
          id: "completed-first",
          conversationId: "completed-first",
          status: "completed",
          events: [],
          creditCharged: 2,
          artifact: {
            filePath: "/tmp/story.png",
            fileName: "story.png",
            documentType: "img",
          },
        },
      }),
    );

    const retry = await screen.findByRole("button", {
      name: "Retry failed outputs (1)",
    });
    fireEvent.click(retry);
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(3));
    expect(onGenerate.mock.calls[2][0]).toEqual(
      expect.objectContaining({ campaignChannel: "shopify.product-media" }),
    );
  });

  it("launches selected rows and writes completed images back to the sheet", async () => {
    const onPrepare = vi.fn();
    const onSetStatus = vi.fn(async () => undefined);
    const onInsertImage = vi.fn(async () => undefined);
    const onGenerate = vi.fn(async () => ({ taskId: "image-task-1" }));
    const onSave = vi.fn(async () => true);
    const renderPanel = (tasks: Record<string, DesktopTask>) => (
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={tasks}
          onInspect={() => batch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={onPrepare}
          onSetStatus={onSetStatus}
          onInsertImage={onInsertImage}
          onGenerate={onGenerate}
          onSave={onSave}
        />
      </LocaleProvider>
    );

    const view = render(renderPanel({}));
    fireEvent.click(screen.getByRole("button", { name: "Single asset type" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    expect(screen.getByText("Detected 1 products")).toBeTruthy();
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm field mapping" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start batch generation" }),
    );

    await waitFor(() =>
      expect(onGenerate).toHaveBeenCalledWith(
        expect.objectContaining({
          rowIndex: 1,
          productName: "Travel mug",
          referenceImages: ["/tmp/mug.png"],
        }),
        "square",
      ),
    );
    const confirmedBatch = onPrepare.mock.calls[0][0] as MarketingBatchDraft;
    expect(confirmedBatch.mapping.confirmed).toBe(true);

    view.rerender(
      renderPanel({
        "image-task-1": {
          id: "image-task-1",
          conversationId: "image-task-1",
          status: "completed",
          events: [],
          artifact: {
            filePath: "/tmp/result.png",
            fileName: "result.png",
            documentType: "img",
          },
        },
      }),
    );

    await waitFor(() =>
      expect(onInsertImage).toHaveBeenCalledWith(
        confirmedBatch,
        1,
        "/tmp/result.png",
      ),
    );
    await waitFor(() =>
      expect(onSetStatus).toHaveBeenCalledWith(confirmedBatch, 1, "已完成"),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("auto-saves each completed image while the rest of the batch is still running", async () => {
    const multiRowBatch: MarketingBatchDraft = {
      ...batch,
      rows: [
        batch.rows[0],
        {
          rowIndex: 2,
          productName: "Desk lamp",
          prompt: "Create a warm lifestyle image",
          referenceImages: [],
        },
      ],
      source: {
        ...batch.source,
        rows: [
          ["Travel mug", "Create a clean ecommerce hero image", "/tmp/mug.png"],
          ["Desk lamp", "Create a warm lifestyle image", ""],
        ],
      },
    };
    const onSetStatus = vi.fn(async () => undefined);
    const onInsertImage = vi.fn(async () => undefined);
    const onGenerate = vi.fn(
      async (row: MarketingBatchDraft["rows"][number]) => ({
        taskId: `image-task-${row.rowIndex}`,
      }),
    );
    const onSave = vi.fn(async () => true);
    const onPrepare = vi.fn();
    const renderPanel = (tasks: Record<string, DesktopTask>) => (
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={tasks}
          onInspect={() => multiRowBatch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={onPrepare}
          onSetStatus={onSetStatus}
          onInsertImage={onInsertImage}
          onGenerate={onGenerate}
          onSave={onSave}
        />
      </LocaleProvider>
    );

    const view = render(renderPanel({}));
    fireEvent.click(screen.getByRole("button", { name: "Single asset type" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm field mapping" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start batch generation" }),
    );
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));

    view.rerender(
      renderPanel({
        "image-task-1": {
          id: "image-task-1",
          conversationId: "image-task-1",
          status: "completed",
          events: [],
          artifact: {
            filePath: "/tmp/result-1.png",
            fileName: "result-1.png",
            documentType: "img",
          },
        },
        "image-task-2": {
          id: "image-task-2",
          conversationId: "image-task-2",
          status: "running",
          events: [],
        },
      }),
    );

    const confirmedBatch = onPrepare.mock.calls[0][0] as MarketingBatchDraft;
    await waitFor(() =>
      expect(onInsertImage).toHaveBeenCalledWith(
        confirmedBatch,
        1,
        "/tmp/result-1.png",
      ),
    );
    await waitFor(() =>
      expect(onSetStatus).toHaveBeenCalledWith(confirmedBatch, 1, "已完成"),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("fails and saves active rows when the bridge connection is interrupted", async () => {
    const onPrepare = vi.fn();
    const onSetStatus = vi.fn(async () => undefined);
    const onGenerate = vi.fn(async () => ({
      taskId: "image-task-interrupted",
    }));
    const onSave = vi.fn(async () => true);
    const renderPanel = (bridgeInterruptionKey: number) => (
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={{}}
          bridgeInterruptionKey={bridgeInterruptionKey}
          onInspect={() => batch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={onPrepare}
          onSetStatus={onSetStatus}
          onInsertImage={vi.fn(async () => undefined)}
          onGenerate={onGenerate}
          onSave={onSave}
        />
      </LocaleProvider>
    );

    const view = render(renderPanel(0));
    fireEvent.click(screen.getByRole("button", { name: "Single asset type" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm field mapping" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start batch generation" }),
    );
    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));

    view.rerender(renderPanel(1));

    const confirmedBatch = onPrepare.mock.calls[0][0] as MarketingBatchDraft;
    await waitFor(() =>
      expect(onSetStatus).toHaveBeenCalledWith(confirmedBatch, 1, "生成失败"),
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(
      screen.getByText(
        "Image generation stopped because the Bridge connection was interrupted. Please retry.",
      ),
    ).toBeTruthy();
    expect(document.querySelector('[data-status="failed"]')).toBeTruthy();
  });

  it("reuses a matching recent generated image without starting another generation", async () => {
    const onPrepare = vi.fn();
    let completeStatusWritten: (() => void) | undefined;
    const onSetStatus = vi.fn(
      async (
        _batch: MarketingBatchDraft,
        _rowIndex: number,
        status: string,
      ) => {
        if (status === "已完成") {
          await new Promise<void>((resolve) => {
            completeStatusWritten = resolve;
          });
        }
      },
    );
    const onInsertImage = vi.fn(async () => undefined);
    const onGenerate = vi.fn(async () => ({ taskId: "should-not-run" }));
    const onSave = vi.fn(async () => true);
    render(
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={{}}
          existingImages={[
            {
              filePath: "/tmp/marketing-travel-mug.png",
              fileName: "Marketing · Travel mug.png",
              documentType: "img",
              source: "generated",
              lastOpenedAt: "2026-08-06T08:00:00Z",
            },
          ]}
          onInspect={() => batch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={onPrepare}
          onSetStatus={onSetStatus}
          onInsertImage={onInsertImage}
          onGenerate={onGenerate}
          onSave={onSave}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Single asset type" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    fireEvent.click(
      await screen.findByRole("button", { name: "Confirm field mapping" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Insert recent images (1)" }),
    );

    const confirmedBatch = onPrepare.mock.calls[0][0] as MarketingBatchDraft;
    await waitFor(() =>
      expect(onInsertImage).toHaveBeenCalledWith(
        confirmedBatch,
        1,
        "/tmp/marketing-travel-mug.png",
      ),
    );
    expect(onGenerate).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(onSetStatus).toHaveBeenCalledWith(confirmedBatch, 1, "已完成"),
    );
    expect(onSetStatus).toHaveBeenCalledWith(confirmedBatch, 1, "生成中");
    expect(onSave).not.toHaveBeenCalled();
    completeStatusWritten?.();
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it("does not generate or recover images before the user confirms the mapping", async () => {
    const onGenerate = vi.fn(async () => ({ taskId: "should-not-run" }));
    const onInsertImage = vi.fn(async () => undefined);
    render(
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={{}}
          existingImages={[
            {
              filePath: "/tmp/marketing-travel-mug.png",
              fileName: "Marketing · Travel mug.png",
              documentType: "img",
              source: "generated",
              lastOpenedAt: "2026-08-06T08:00:00Z",
            },
          ]}
          onInspect={() => batch}
          onAnalyze={async () => analysisResult}
          onMappingChange={vi.fn()}
          onPrepare={vi.fn()}
          onSetStatus={vi.fn(async () => undefined)}
          onInsertImage={onInsertImage}
          onGenerate={onGenerate}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Single asset type" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    const startButton = await screen.findByRole("button", {
      name: "Start batch generation",
    });
    const recoverButton = screen.getByRole("button", {
      name: "Insert recent images (1)",
    });
    expect(startButton).toBeDisabled();
    expect(recoverButton).toBeDisabled();
    fireEvent.click(startButton);
    fireEvent.click(recoverButton);
    expect(onGenerate).not.toHaveBeenCalled();
    expect(onInsertImage).not.toHaveBeenCalled();
  });

  it("uses the user's adjusted column roles when confirming the mapping", async () => {
    const adjustedBatch: MarketingBatchDraft = {
      ...batch,
      source: {
        ...batch.source,
        headers: [
          "Product",
          "Prompt",
          "Reference image",
          "Generated image",
          "Status",
          "Alternate name",
        ],
        rows: [
          [
            "Travel mug",
            "Create a clean ecommerce hero image",
            "/tmp/mug.png",
            "",
            "Queued",
            "Commuter cup",
          ],
        ],
      },
      mapping: {
        ...batch.mapping,
        columns: [
          ...batch.mapping.columns,
          {
            column: 5,
            header: "Alternate name",
            role: "ignored",
            confidence: 0,
            reason: "unused",
            status: "suggested",
          },
        ],
      },
    };
    const onPrepare = vi.fn();
    render(
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={{}}
          onInspect={() => adjustedBatch}
          onAnalyze={async () => ({
            ...analysisResult,
            columns: adjustedBatch.mapping.columns.map(
              ({ column, role, confidence, reason }) => ({
                column,
                role,
                confidence,
                reason,
              }),
            ),
          })}
          onMappingChange={vi.fn()}
          onPrepare={onPrepare}
          onSetStatus={vi.fn(async () => undefined)}
          onInsertImage={vi.fn(async () => undefined)}
          onGenerate={vi.fn(async () => ({ taskId: "image-task" }))}
        />
      </LocaleProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Single asset type" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );
    const alternateLabel = (await screen.findByText("Alternate name")).closest("label")!;
    fireEvent.click(within(alternateLabel).getByRole("button"));
    fireEvent.click(screen.getByRole("menuitemradio", { name: /商品名称|Product name/i }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm field mapping" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Start batch generation" }),
    );

    await waitFor(() => expect(onPrepare).toHaveBeenCalledTimes(1));
    const confirmed = onPrepare.mock.calls[0][0] as MarketingBatchDraft;
    expect(confirmed.rows[0].productName).toBe("Commuter cup");
    expect(
      confirmed.mapping.columns.find((column) => column.column === 0)?.role,
    ).toBe("ignored");
    expect(
      confirmed.mapping.columns.find((column) => column.column === 5)?.role,
    ).toBe("productName");
  });

  it("keeps rule suggestions confirmable when AI recognition times out", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(
      <LocaleProvider value="en">
        <SpreadsheetMarketingPanel
          tasks={{}}
          onInspect={() => batch}
          onAnalyze={async () => {
            throw new Error(
              "bridge: officecli bridge request timed out: spreadsheet/plan-fields",
            );
          }}
          onMappingChange={vi.fn()}
          onPrepare={vi.fn()}
          onSetStatus={vi.fn(async () => undefined)}
          onInsertImage={vi.fn(async () => undefined)}
          onGenerate={vi.fn(async () => ({ taskId: "image-task" }))}
        />
      </LocaleProvider>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Read selected products" }),
    );

    expect(
      await screen.findByText(/AI field recognition did not finish/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Confirm field mapping" }),
    ).not.toBeDisabled();
    expect(screen.queryByText(/bridge request timed out/)).toBeNull();
    warn.mockRestore();
  });
});
