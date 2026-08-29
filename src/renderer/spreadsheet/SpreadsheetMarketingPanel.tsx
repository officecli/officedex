import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Image as ImageIcon,
  LoaderCircle,
  Play,
  RefreshCw,
  XCircle,
} from "lucide-react";
import type {
  DesktopTask,
  ImageRatio,
  RecentFile,
  SpreadsheetFieldRole,
  SpreadsheetPlanFieldsResult,
} from "../../shared/types";
import { officecli } from "../bridge";
import { useT } from "../i18n";
import { Button, Input, Select } from "../ui";
import {
  MARKETING_FIELD_ROLE_OPTIONS,
  rebuildMarketingBatch,
  recommendedRatio,
  type CampaignChannel,
  type MarketingCampaignSettings,
  type MarketingAssetKind,
  type MarketingBatchDraft,
  type MarketingSheetRow,
} from "./marketingWorkflow";
import {
  loadMarketingMapping,
  saveMarketingMapping,
} from "./marketingMappingStore";
import { MarketingRuntimeError, runMarketingPostprocess } from "./marketingAgentRuntime";

type MarketingJobStatus =
  "queued" | "submitting" | "running" | "completed" | "failed";

interface MarketingJob {
  id: string;
  row: MarketingSheetRow;
  status: MarketingJobStatus;
  taskId?: string;
  error?: string;
  channel?: CampaignChannel;
  outputTemplateId?: string;
  outputColumn?: number;
  creditCharged?: number;
  campaign?: MarketingCampaignSettings;
  runtimeRunId?: string;
  sourceFilePath?: string;
}

export interface SpreadsheetMarketingPanelProps {
  tasks: Record<string, DesktopTask>;
  workbookPath?: string;
  workspaceId?: string;
  bridgeInterruptionKey?: number;
  existingImages?: RecentFile[];
  onInspect: (assetKind: MarketingAssetKind) => MarketingBatchDraft;
  onPrepare: (batch: MarketingBatchDraft) => void;
  onSetStatus: (
    batch: MarketingBatchDraft,
    rowIndex: number,
    status: string,
  ) => Promise<void>;
  onInsertImage: (
    batch: MarketingBatchDraft,
    rowIndex: number,
    filePath: string,
  ) => Promise<void>;
  onGenerate: (
    row: MarketingSheetRow,
    ratio: ImageRatio,
  ) => Promise<{ taskId: string }>;
  onSave?: () => Promise<boolean>;
  onAnalyze: (
    batch: MarketingBatchDraft,
  ) => Promise<SpreadsheetPlanFieldsResult>;
  onMappingChange: (mapping?: MarketingBatchDraft["mapping"]) => void;
  mappingStorageKey?: string;
  creditBalance?: number | null;
}

const MAX_CONCURRENCY = 2;
const CAMPAIGN_CHANNELS: CampaignChannel[] = [
  "shopify.product-media",
  "shopify.collection-image",
  "shopify.theme-banner",
];
const CAMPAIGN_CHANNEL_LABEL_KEYS: Record<CampaignChannel, string> = {
  "shopify.product-media": "channels.shopify.productMedia.name",
  "shopify.collection-image": "channels.shopify.collectionImage.name",
  "shopify.theme-banner": "channels.shopify.themeBanner.name",
};

const DEFAULT_CAMPAIGN_SETTINGS: MarketingCampaignSettings = {
  name: "Shopify Campaign",
  market: "United States",
  language: "English",
  offer: "",
  cta: "Shop now",
  channels: [
    "shopify.product-media",
    "shopify.collection-image",
    "shopify.theme-banner",
  ],
};

function campaignChannelKey(channel: CampaignChannel): string {
  return CAMPAIGN_CHANNEL_LABEL_KEYS[channel] ?? channel;
}

function jobBatch(
  batch: MarketingBatchDraft,
  job: MarketingJob,
): MarketingBatchDraft {
  if (job.outputColumn === undefined) return batch;
  return { ...batch, outputColumn: job.outputColumn };
}

function normalizedProductName(value: string): string {
  return value.toLowerCase().replace(/[\s_\-·.。()（）【】\[\]]/g, "");
}

function reusableImageFor(
  row: MarketingSheetRow,
  files: RecentFile[],
): RecentFile | undefined {
  const product = normalizedProductName(row.productName);
  return files.find((file) => {
    if (file.source !== "generated") return false;
    const type = file.documentType.toLowerCase();
    if (!type.includes("img") && !/\.(png|jpe?g|webp)$/i.test(file.fileName))
      return false;
    return normalizedProductName(file.fileName).includes(product);
  });
}

export function SpreadsheetMarketingPanel({
  tasks,
  workbookPath,
  workspaceId,
  bridgeInterruptionKey = 0,
  existingImages = [],
  onInspect,
  onPrepare,
  onSetStatus,
  onInsertImage,
  onGenerate,
  onSave,
  onAnalyze,
  onMappingChange,
  mappingStorageKey = "",
  creditBalance = null,
}: SpreadsheetMarketingPanelProps) {
  const t = useT();
  const [assetKind, setAssetKind] =
    useState<MarketingAssetKind>("marketplace-main");
  const [ratio, setRatio] = useState<ImageRatio>("square");
  const [campaignMode, setCampaignMode] = useState(true);
  const [campaign, setCampaign] = useState<MarketingCampaignSettings>(
    DEFAULT_CAMPAIGN_SETTINGS,
  );
  const [batch, setBatch] = useState<MarketingBatchDraft>();
  const [jobs, setJobs] = useState<MarketingJob[]>([]);
  const [error, setError] = useState<string>();
  const [mappingError, setMappingError] = useState<string>();
  const [analyzing, setAnalyzing] = useState(false);
  const launchingJobsRef = useRef(new Set<string>());
  const handledTasksRef = useRef(new Set<string>());
  const autoSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const handledBridgeInterruptionRef = useRef(bridgeInterruptionKey);
  const mappingConfirmedRef = useRef(false);
  const working = jobs.some(
    (job) =>
      job.status === "queued" ||
      job.status === "submitting" ||
      job.status === "running",
  );
  const completedCount = jobs.filter(
    (job) => job.status === "completed",
  ).length;
  const failedCount = jobs.filter((job) => job.status === "failed").length;
  const settledCredits = jobs.reduce(
    (total, job) => total + (job.creditCharged ?? 0),
    0,
  );
  const plannedOutputCount =
    batch && campaignMode
      ? batch.rows.length * campaign.channels.length
      : (batch?.rows.length ?? 0);
  const rowStatusAfter = useCallback(
    (job: MarketingJob, terminalStatus: "completed" | "failed"): string => {
      const siblings = jobs.filter(
        (item) => item.row.rowIndex === job.row.rowIndex && item.id !== job.id,
      );
      if (
        siblings.some(
          (item) =>
            item.status === "queued" ||
            item.status === "submitting" ||
            item.status === "running",
        )
      )
        return "生成中";
      const hasCompleted =
        terminalStatus === "completed" ||
        siblings.some((item) => item.status === "completed");
      const hasFailed =
        terminalStatus === "failed" ||
        siblings.some((item) => item.status === "failed");
      if (hasCompleted && hasFailed) return "部分失败";
      return hasFailed ? "生成失败" : "已完成";
    },
    [jobs],
  );
  const recoverable = useMemo(
    () =>
      batch?.rows.flatMap((row) => {
        const file = reusableImageFor(row, existingImages);
        return file ? [{ row, file }] : [];
      }) ?? [],
    [batch, existingImages],
  );

  const autoSave = useCallback(async () => {
    if (!onSave) return;
    const save = async () => {
      const saved = await onSave();
      if (!saved) throw new Error(t("spreadsheet.marketing.autoSaveFailed"));
    };
    const pending = autoSaveQueueRef.current.then(save, save);
    autoSaveQueueRef.current = pending.catch(() => undefined);
    return pending;
  }, [onSave, t]);

  const reportAutoSaveError = useCallback((saveError: unknown) => {
    setError(
      saveError instanceof Error ? saveError.message : String(saveError),
    );
  }, []);

  const inspect = useCallback(() => {
    try {
      const next = onInspect(assetKind);
      mappingConfirmedRef.current = false;
      setBatch(next);
      setJobs([]);
      setError(undefined);
      setMappingError(undefined);
      setRatio(recommendedRatio(assetKind));
      onMappingChange(next.mapping);
      const saved = loadMarketingMapping(
        mappingStorageKey,
        next.mapping.schemaFingerprint,
      );
      if (saved) {
        const restored = rebuildMarketingBatch(next, saved.columns, {
          source: "saved",
          confirmed: true,
          summary: t("spreadsheet.marketing.mapping.saved"),
          confidence: "high",
        });
        setBatch(restored);
        onMappingChange(restored.mapping);
        return;
      }
      setAnalyzing(true);
      void onAnalyze(next)
        .then((result) => {
          if (mappingConfirmedRef.current) return;
          const analyzed = rebuildMarketingBatch(next, result.columns, {
            source: "ai",
            confirmed: false,
            summary: result.summary,
            confidence: result.confidence,
            warnings: result.warnings,
          });
          setBatch(analyzed);
          onMappingChange(analyzed.mapping);
        })
        .catch((analysisError) => {
          console.warn(
            "AI spreadsheet field recognition failed; keeping rule-based suggestions",
            analysisError,
          );
          setMappingError(t("spreadsheet.marketing.mapping.aiFallback"));
        })
        .finally(() => setAnalyzing(false));
    } catch (inspectError) {
      setBatch(undefined);
      setJobs([]);
      onMappingChange(undefined);
      setError(
        inspectError instanceof Error
          ? inspectError.message
          : String(inspectError),
      );
    }
  }, [assetKind, mappingStorageKey, onAnalyze, onInspect, onMappingChange, t]);

  const changeColumnRole = useCallback(
    (columnIndex: number, role: SpreadsheetFieldRole) => {
      if (!batch || working) return;
      const columns = batch.mapping.columns.map((column) => ({
        column: column.column,
        role:
          column.column === columnIndex
            ? role
            : role !== "ignored" && column.role === role
              ? ("ignored" as const)
              : column.role,
        confidence: column.column === columnIndex ? 1 : column.confidence,
        reason:
          column.column === columnIndex
            ? t("spreadsheet.marketing.mapping.userAdjusted")
            : column.reason,
      }));
      const adjusted = rebuildMarketingBatch(batch, columns, {
        source: batch.mapping.source,
        confirmed: false,
        summary: batch.mapping.summary,
        confidence: batch.mapping.confidence,
        warnings: batch.mapping.warnings,
      });
      setBatch(adjusted);
      onMappingChange(adjusted.mapping);
    },
    [batch, onMappingChange, t, working],
  );

  const confirmMapping = useCallback(() => {
    if (!batch || working) return;
    if (
      !batch.mapping.columns.some((column) => column.role === "productName")
    ) {
      setMappingError(t("spreadsheet.marketing.mapping.productRequired"));
      return;
    }
    const confirmed = rebuildMarketingBatch(batch, batch.mapping.columns, {
      source: batch.mapping.source,
      confirmed: true,
      summary: batch.mapping.summary,
      confidence: batch.mapping.confidence,
      warnings: batch.mapping.warnings,
    });
    saveMarketingMapping(
      mappingStorageKey,
      confirmed.mapping.schemaFingerprint,
      confirmed.mapping.columns,
    );
    mappingConfirmedRef.current = true;
    setBatch(confirmed);
    setMappingError(undefined);
    onMappingChange(confirmed.mapping);
  }, [batch, mappingStorageKey, onMappingChange, t, working]);

  const start = useCallback(async () => {
    if (!batch || !batch.mapping.confirmed || working) return;
    try {
      if (campaignMode && !campaign.name.trim())
        throw new Error(t("spreadsheet.marketing.campaign.nameRequired"));
      if (campaignMode && campaign.channels.length === 0)
        throw new Error(t("spreadsheet.marketing.campaign.channelRequired"));
      const plan = campaignMode
        ? await officecli.planShopifyCatalogCampaign({
            sheetId: batch.sheetId,
            sheetName: batch.sheetName,
            headers: batch.source.headers,
            rows: batch.rows.map((row) => ({
              rowIndex: row.rowIndex,
              productName: row.productName,
              basePrompt: row.prompt,
              referenceImages: row.referenceImages,
            })),
            campaign: { ...campaign, selectedChannelIds: campaign.channels },
          })
        : undefined;
      const missingChannels = plan?.missingChannels ?? [];
      if (missingChannels.length > 0) {
        throw new Error(
          t("spreadsheet.marketing.campaign.missingColumns", {
            channels: missingChannels
              .map((channel) =>
                t(campaignChannelKey(channel as CampaignChannel)),
              )
              .join(", "),
          }),
        );
      }
      onPrepare(batch);
      launchingJobsRef.current.clear();
      handledTasksRef.current.clear();
      setError(undefined);
      const nextJobs = campaignMode
        ? (plan?.jobs ?? []).map((plannedJob) => {
            const row = batch.rows.find(
              (item) => item.rowIndex === plannedJob.rowIndex,
            )!;
            return {
              id: `${batch.sheetId}:${row.rowIndex}:${plannedJob.channelId}`,
              row: {
                ...row,
                prompt: plannedJob.prompt,
                referenceImages:
                  plannedJob.referenceImages ?? row.referenceImages,
                ratio: plannedJob.ratio,
                campaignChannel: plannedJob.channelId as CampaignChannel,
              },
              channel: plannedJob.channelId as CampaignChannel,
              outputTemplateId: plannedJob.outputTemplateId,
              outputColumn: plannedJob.outputColumn,
              campaign: { ...campaign, channels: [...campaign.channels] },
              status: "queued" as const,
            };
          })
        : batch.rows.map((row) => ({
            id: `${batch.sheetId}:${row.rowIndex}`,
            row,
            status: "queued" as const,
          }));
      setJobs(nextJobs);
      for (const row of batch.rows)
        void onSetStatus(batch, row.rowIndex, "排队中").catch(() => undefined);
    } catch (startError) {
      setError(
        startError instanceof Error ? startError.message : String(startError),
      );
    }
  }, [batch, campaign, campaignMode, onPrepare, onSetStatus, t, working]);

  const processPostprocess = useCallback(async (job: MarketingJob, sourceFilePath: string, existingRunId?: string) => {
    if (!batch) return;
    try {
      if (job.channel) await onSetStatus(batch, job.row.rowIndex, "本地合成中");
      const run = await runMarketingPostprocess({
        jobId: job.id,
        sheetId: batch.sheetId,
        rowIndex: job.row.rowIndex,
        sourceFilePath,
        finalStatus: rowStatusAfter(job, "completed"),
        channel: job.channel,
        outputTemplateId: job.outputTemplateId,
        campaign: job.campaign,
        productName: job.row.productName,
        sourceTaskId: job.taskId,
        batch: jobBatch(batch, job),
        workbookPath,
        workspaceId,
      }, {
        insertImage: (filePath) => onInsertImage(jobBatch(batch, job), job.row.rowIndex, filePath),
        setStatus: (status) => onSetStatus(batch, job.row.rowIndex, status),
        save: async () => { await autoSave(); },
      }, existingRunId);
      setJobs((current) => current.map((item) => item.id === job.id ? {
        ...item,
        status: "completed",
        runtimeRunId: run.id,
        sourceFilePath,
      } : item));
    } catch (postprocessError) {
      const message = postprocessError instanceof Error ? postprocessError.message : String(postprocessError);
      const runtimeRunId = postprocessError instanceof MarketingRuntimeError ? postprocessError.runId : existingRunId;
      await onSetStatus(batch, job.row.rowIndex, message.toLowerCase().includes("campaign image") ? "本地合成失败" : "回写失败").catch(() => undefined);
      setJobs((current) => current.map((item) => item.id === job.id ? {
        ...item,
        status: "failed",
        error: message,
        runtimeRunId,
        sourceFilePath,
      } : item));
    }
  }, [autoSave, batch, onInsertImage, onSetStatus, rowStatusAfter, workbookPath, workspaceId]);

  const retryFailed = useCallback(() => {
    if (working) return;
    handledTasksRef.current.clear();
    setError(undefined);
    const runtimeRetries = jobs.filter((job) => job.status === "failed" && job.runtimeRunId && job.sourceFilePath);
    setJobs((current) => current.map((job) =>
      job.status !== "failed" ? job : job.runtimeRunId
        ? { ...job, status: "submitting", error: undefined }
        : { ...job, status: "queued", taskId: undefined, error: undefined, creditCharged: undefined },
    ));
    for (const job of runtimeRetries) {
      void processPostprocess(job, job.sourceFilePath!, job.runtimeRunId);
    }
  }, [jobs, processPostprocess, working]);

  const recover = useCallback(() => {
    if (
      !batch ||
      !batch.mapping.confirmed ||
      recoverable.length === 0 ||
      working
    )
      return;
    try {
      onPrepare(batch);
      setError(undefined);
      setJobs(
        recoverable.map(({ row, file }) => ({
          id: `recover:${batch.sheetId}:${row.rowIndex}`,
          row,
          status: "submitting",
          sourceFilePath: file.filePath,
        })),
      );
      for (const { row } of recoverable)
        void onSetStatus(batch, row.rowIndex, "生成中").catch(() => undefined);
      for (const { row, file } of recoverable) {
        void processPostprocess({ id: `recover:${batch.sheetId}:${row.rowIndex}`, row, status: "submitting" }, file.filePath);
      }
    } catch (recoverError) {
      setError(
        recoverError instanceof Error
          ? recoverError.message
          : String(recoverError),
      );
    }
  }, [
    batch,
    onPrepare,
    onSetStatus,
    processPostprocess,
    recoverable,
    working,
  ]);

  useEffect(() => {
    if (!batch) return;
    const activeCount = jobs.filter(
      (job) => job.status === "submitting" || job.status === "running",
    ).length;
    const available = Math.max(0, MAX_CONCURRENCY - activeCount);
    const queued = jobs
      .filter(
        (job) =>
          job.status === "queued" && !launchingJobsRef.current.has(job.id),
      )
      .slice(0, available);
    for (const job of queued) {
      launchingJobsRef.current.add(job.id);
      setJobs((current) =>
        current.map((item) =>
          item.id === job.id ? { ...item, status: "submitting" } : item,
        ),
      );
      void onSetStatus(batch, job.row.rowIndex, "正在提交").catch(
        () => undefined,
      );
      void onGenerate(job.row, job.row.ratio ?? ratio)
        .then((result) => {
          setJobs((current) =>
            current.map((item) =>
              item.id === job.id
                ? { ...item, status: "running", taskId: result.taskId }
                : item,
            ),
          );
          void onSetStatus(batch, job.row.rowIndex, "生成中").catch(
            () => undefined,
          );
        })
        .catch((launchError) => {
          const message =
            launchError instanceof Error
              ? launchError.message
              : String(launchError);
          void onSetStatus(batch, job.row.rowIndex, "生成失败")
            .then(autoSave)
            .catch(reportAutoSaveError)
            .finally(() => {
              setJobs((current) =>
                current.map((item) =>
                  item.id === job.id
                    ? { ...item, status: "failed", error: message }
                    : item,
                ),
              );
            });
        })
        .finally(() => {
          launchingJobsRef.current.delete(job.id);
        });
    }
  }, [
    autoSave,
    batch,
    jobs,
    onGenerate,
    onSetStatus,
    ratio,
    reportAutoSaveError,
    t,
  ]);

  useEffect(() => {
    if (!batch) return;
    for (const job of jobs) {
      if (
        job.status !== "running" ||
        !job.taskId ||
        handledTasksRef.current.has(job.taskId)
      )
        continue;
      const task = tasks[job.taskId];
      if (!task || !["completed", "failed", "cancelled"].includes(task.status))
        continue;
      handledTasksRef.current.add(job.taskId);
      if (task.status === "completed" && task.artifact?.filePath) {
        setJobs((current) => current.map((item) => item.id === job.id ? {
          ...item,
          status: "submitting",
          creditCharged: task.creditCharged ?? 0,
          sourceFilePath: task.artifact!.filePath,
        } : item));
        void processPostprocess(job, task.artifact.filePath);
      } else {
        const message = task.error || t("spreadsheet.marketing.taskFailed");
        void onSetStatus(
          batch,
          job.row.rowIndex,
          task.status === "cancelled"
            ? "已取消"
            : rowStatusAfter(job, "failed"),
        )
          .then(autoSave)
          .catch(reportAutoSaveError)
          .finally(() => {
            setJobs((current) =>
              current.map((item) =>
                item.id === job.id
                  ? {
                      ...item,
                      status: "failed",
                      error: message,
                      creditCharged: task.creditCharged ?? 0,
                    }
                  : item,
              ),
            );
          });
      }
    }
  }, [
    batch,
    jobs,
    onSetStatus,
    processPostprocess,
    reportAutoSaveError,
    rowStatusAfter,
    t,
    tasks,
  ]);

  useEffect(() => {
    if (handledBridgeInterruptionRef.current === bridgeInterruptionKey) return;
    handledBridgeInterruptionRef.current = bridgeInterruptionKey;
    if (!batch) return;
    const interrupted = jobs.filter(
      (job) =>
        job.status === "queued" ||
        job.status === "submitting" ||
        job.status === "running",
    );
    if (interrupted.length === 0) return;
    const message = t("spreadsheet.marketing.bridgeInterrupted");
    launchingJobsRef.current.clear();
    for (const job of interrupted) {
      if (job.taskId) handledTasksRef.current.add(job.taskId);
      void onSetStatus(batch, job.row.rowIndex, "生成失败")
        .then(autoSave)
        .catch(reportAutoSaveError);
    }
    setJobs((current) =>
      current.map((job) =>
        job.status === "queued" ||
        job.status === "submitting" ||
        job.status === "running"
          ? { ...job, status: "failed", error: message }
          : job,
      ),
    );
    setError(message);
  }, [
    autoSave,
    batch,
    bridgeInterruptionKey,
    jobs,
    onSetStatus,
    reportAutoSaveError,
    t,
  ]);

  const progress = useMemo(
    () =>
      jobs.length > 0 ? `${completedCount + failedCount}/${jobs.length}` : "",
    [completedCount, failedCount, jobs.length],
  );

  return (
    <section
      className="spreadsheet-marketing-panel"
      aria-label={t("spreadsheet.marketing.title")}
    >
      <div className="spreadsheet-marketing-panel__heading">
        <div>
          <ImageIcon aria-hidden="true" />
          <strong>{t("spreadsheet.marketing.title")}</strong>
        </div>
        {progress ? <span>{progress}</span> : null}
      </div>
      <p>{t("spreadsheet.marketing.description")}</p>
      <div
        className="spreadsheet-marketing-panel__mode"
        role="group"
        aria-label={t("spreadsheet.marketing.mode")}
      >
        <Button
          size="small"
          variant={campaignMode ? "primary" : "secondary"}
          disabled={working}
          onClick={() => setCampaignMode(true)}
        >
          {t("spreadsheet.marketing.mode.campaign")}
        </Button>
        <Button
          size="small"
          variant={!campaignMode ? "primary" : "secondary"}
          disabled={working}
          onClick={() => setCampaignMode(false)}
        >
          {t("spreadsheet.marketing.mode.single")}
        </Button>
      </div>
      {campaignMode ? (
        <div className="spreadsheet-marketing-panel__campaign">
          <label>
            <span>{t("spreadsheet.marketing.campaign.name")}</span>
            <Input
              size="small"
              value={campaign.name}
              disabled={working}
              placeholder="Summer Sale 2026"
              onChange={(event) =>
                setCampaign((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>{t("spreadsheet.marketing.campaign.market")}</span>
            <Input
              size="small"
              value={campaign.market}
              disabled={working}
              onChange={(event) =>
                setCampaign((current) => ({
                  ...current,
                  market: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>{t("spreadsheet.marketing.campaign.language")}</span>
            <Input
              size="small"
              value={campaign.language}
              disabled={working}
              onChange={(event) =>
                setCampaign((current) => ({
                  ...current,
                  language: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>{t("spreadsheet.marketing.campaign.offer")}</span>
            <Input
              size="small"
              value={campaign.offer}
              disabled={working}
              placeholder="Up to 30% off"
              onChange={(event) =>
                setCampaign((current) => ({
                  ...current,
                  offer: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>{t("spreadsheet.marketing.campaign.cta")}</span>
            <Input
              size="small"
              value={campaign.cta}
              disabled={working}
              onChange={(event) =>
                setCampaign((current) => ({
                  ...current,
                  cta: event.target.value,
                }))
              }
            />
          </label>
          <fieldset disabled={working}>
            <legend>{t("spreadsheet.marketing.campaign.channels")}</legend>
            {CAMPAIGN_CHANNELS.map((channel) => {
              return (
                <label key={channel}>
                  <input
                    aria-label={t(campaignChannelKey(channel))}
                    type="checkbox"
                    checked={campaign.channels.includes(channel)}
                    onChange={(event) =>
                      setCampaign((current) => ({
                        ...current,
                        channels: event.target.checked
                          ? [...current.channels, channel]
                          : current.channels.filter((item) => item !== channel),
                      }))
                    }
                  />
                  <span>{t(campaignChannelKey(channel))}</span>
                </label>
              );
            })}
          </fieldset>
        </div>
      ) : null}
      {!campaignMode ? (
        <label>
          <span>{t("spreadsheet.marketing.assetKind")}</span>
          <Select
            size="small"
            value={assetKind}
            disabled={working}
            options={[
              {
                value: "marketplace-main",
                label: t("spreadsheet.marketing.kind.main"),
              },
              {
                value: "lifestyle",
                label: t("spreadsheet.marketing.kind.lifestyle"),
              },
              {
                value: "social-poster",
                label: t("spreadsheet.marketing.kind.social"),
              },
            ]}
            onChange={(value) => {
              const next = value as MarketingAssetKind;
              setAssetKind(next);
              setRatio(recommendedRatio(next));
              setBatch(undefined);
              setJobs([]);
              setMappingError(undefined);
              onMappingChange(undefined);
            }}
          />
        </label>
      ) : null}
      {!campaignMode ? (
        <label>
          <span>{t("spreadsheet.marketing.ratio")}</span>
          <Select
            size="small"
            value={ratio}
            disabled={working}
            options={[
              { value: "square", label: t("home.imageRatio.square") },
              { value: "landscape", label: t("home.imageRatio.landscape") },
              { value: "portrait", label: t("home.imageRatio.portrait") },
            ]}
            onChange={(value) => setRatio(value as ImageRatio)}
          />
        </label>
      ) : null}
      <Button
        size="small"
        variant="secondary"
        icon={<RefreshCw />}
        loading={analyzing}
        disabled={working || analyzing}
        onClick={inspect}
      >
        {t("spreadsheet.marketing.readSelection")}
      </Button>
      {campaignMode ? <p>{t("spreadsheet.marketing.campaign.ratioNotice")}</p> : null}
      {batch ? (
        <div className="spreadsheet-marketing-panel__batch">
          <strong>
            {t("spreadsheet.marketing.detected", { count: batch.rows.length })}
          </strong>
          <span>
            {batch.rows
              .slice(0, 3)
              .map((row) => row.productName)
              .join("、")}
            {batch.rows.length > 3 ? "…" : ""}
          </span>
          <div className="spreadsheet-marketing-panel__quote">
            <strong>
              {t("spreadsheet.marketing.campaign.plan", {
                products: batch.rows.length,
                outputs: plannedOutputCount,
              })}
            </strong>
            <span>
              {t("spreadsheet.marketing.campaign.creditEstimateUnavailable")}
            </span>
            <span>
              {creditBalance === null
                ? t("spreadsheet.marketing.campaign.balanceUnknown")
                : t("spreadsheet.marketing.campaign.balance", {
                    count: creditBalance,
                  })}
            </span>
            {settledCredits > 0 ? (
              <span>
                {t("spreadsheet.marketing.campaign.settledCredits", {
                  count: settledCredits,
                })}
              </span>
            ) : null}
          </div>
          <div
            className="spreadsheet-marketing-panel__mapping"
            data-confirmed={batch.mapping.confirmed ? "true" : "false"}
          >
            <div>
              <strong>
                {batch.mapping.confirmed
                  ? t("spreadsheet.marketing.mapping.confirmed")
                  : t("spreadsheet.marketing.mapping.review")}
              </strong>
              <span>{batch.mapping.summary}</span>
            </div>
            <div className="spreadsheet-marketing-panel__mapping-columns">
              {batch.mapping.columns.map((column) => (
                <label key={column.column}>
                  <span>{column.header || `Column ${column.column + 1}`}</span>
                  <Select
                    size="small"
                    value={column.role}
                    disabled={working || batch.mapping.confirmed}
                    options={MARKETING_FIELD_ROLE_OPTIONS}
                    onChange={(value) =>
                      changeColumnRole(
                        column.column,
                        value as SpreadsheetFieldRole,
                      )
                    }
                  />
                </label>
              ))}
            </div>
            {!batch.mapping.confirmed ? (
              <Button
                size="small"
                variant="secondary"
                disabled={working}
                onClick={confirmMapping}
              >
                {t("spreadsheet.marketing.mapping.confirm")}
              </Button>
            ) : null}
          </div>
          <Button
            size="small"
            variant="primary"
            icon={<Play />}
            loading={working}
            disabled={working || !batch.mapping.confirmed}
            onClick={start}
          >
            {campaignMode
              ? t("spreadsheet.marketing.campaign.start")
              : t("spreadsheet.marketing.start")}
          </Button>
          {recoverable.length > 0 ? (
            <Button
              size="small"
              variant="secondary"
              icon={<ImageIcon />}
              disabled={working || !batch.mapping.confirmed}
              onClick={recover}
            >
              {t("spreadsheet.marketing.recover", {
                count: recoverable.length,
              })}
            </Button>
          ) : null}
        </div>
      ) : null}
      {mappingError ? (
        <div
          className="spreadsheet-marketing-panel__mapping-error"
          role="alert"
        >
          {mappingError}
        </div>
      ) : null}
      {jobs.length > 0 ? (
        <>
          <ol className="spreadsheet-marketing-panel__jobs">
            {jobs.map((job) => (
              <li key={job.id} data-status={job.status} title={job.error}>
                {job.status === "completed" ? (
                  <CheckCircle2 aria-hidden="true" />
                ) : job.status === "failed" ? (
                  <XCircle aria-hidden="true" />
                ) : (
                  <LoaderCircle
                    className={
                      job.status === "queued" ? undefined : "is-spinning"
                    }
                    aria-hidden="true"
                  />
                )}
                <span>{job.row.productName}</span>
                {job.channel ? (
                  <small>{t(campaignChannelKey(job.channel))}</small>
                ) : null}
                {job.creditCharged ? (
                  <small>{job.creditCharged} Credits</small>
                ) : null}
              </li>
            ))}
          </ol>
          {failedCount > 0 && !working ? (
            <Button
              size="small"
              variant="secondary"
              icon={<RefreshCw />}
              onClick={retryFailed}
            >
              {t("spreadsheet.marketing.campaign.retryFailed", {
                count: failedCount,
              })}
            </Button>
          ) : null}
        </>
      ) : null}
      {error ? (
        <div className="spreadsheet-marketing-panel__error" role="alert">
          {error}
        </div>
      ) : null}
    </section>
  );
}
