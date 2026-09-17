import { useCallback, useMemo, useRef, useState } from "react";
import type { Artifact, DesktopTask, GenerateInput, TaskHistoryEntry, UserSettings, WorkspaceSummary } from "../../shared/types";
import { getCapability, isDocumentType } from "../../shared/types";
import { useDesktopApi } from "../services/desktopApi";
import { useTaskStore } from "../store/taskStore";
import {
  applyTaskEvent,
  attachTaskContext,
  deleteTask,
  discardLocalTask,
  promoteLocalTask,
  startLocalTask,
  type TaskContextPatch,
} from "../taskState";
import { resolveFollowUpTarget, runFollowUpTask, type FollowUpDeps, type PendingGenerate } from "../flows/followUpTask";
import { inferHomeTaskRoute, type HomeTaskIntake } from "../homeIntake";
import { buildReferenceTextPrompt } from "../referenceTextPrompt";
import { PRESENTATION_PLACEHOLDER_TOPIC } from "../taskTitle";
import { captureHomeEntryTransition, type HomeEntryTransition } from "../homeEntryTransition";
import { classifyError, extractStderr, type FailureKind } from "../failureKind";
import { errorMessage } from "../utils/values";
import { delay } from "../utils/timing";
import type { AppRoutingController } from "./useAppRouting";

export interface RecoverableTaskExpectation {
  documentType: string;
  sourceFile?: string;
  parentTaskId?: string;
  createdAfter?: number;
}

/**
 * Find a task the runtime accepted even though the generate RPC did not return
 * a usable id. Parent lineage is the strongest signal; source file + document
 * type is the fallback for older runtimes that did not persist parentTaskId on
 * the history envelope.
 */
export function findRecoverableTaskHistoryEntry(
  entries: TaskHistoryEntry[],
  expectation: RecoverableTaskExpectation,
): TaskHistoryEntry | undefined {
  const expectedType = expectation.documentType.toLowerCase();
  const expectedSource = expectation.sourceFile;
  const createdAfter = expectation.createdAfter ?? 0;
  return [...entries]
    .sort((a, b) => {
      const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.NEGATIVE_INFINITY;
      const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.NEGATIVE_INFINITY;
      return (Number.isFinite(bTime) ? bTime : Number.NEGATIVE_INFINITY) - (Number.isFinite(aTime) ? aTime : Number.NEGATIVE_INFINITY);
    })
    .find((entry) => {
      if (!entry.taskId || (entry.createdAt && Date.parse(entry.createdAt) < createdAfter)) return false;
      if (!entry.events.some((event) => {
        const type = typeof event.payload?.document_type === "string" ? event.payload.document_type.toLowerCase() : "";
        return type === expectedType || type === "";
      })) return false;
      if (expectation.parentTaskId && (
        entry.parentTaskId === expectation.parentTaskId
        || entry.events.some((event) => event.payload?.parent_task_id === expectation.parentTaskId)
      )) return true;
      if (!expectedSource) return false;
      return entry.events.some((event) => event.payload?.source_file === expectedSource);
    });
}

/**
 * The file a follow-up modification may edit: the finished document when there
 * is one, otherwise the deck a stopped run already drew and saved.
 *
 * Keeping this in one place is the point. The partial deck used to live only in
 * preview state, so every consumer that asked the task model "what did this run
 * produce?" got nothing — which is why a failed run could not be opened, and
 * why a modification instruction silently landed on an older deck in the same
 * conversation instead of the one on screen.
 */
export function sourceArtifactFor(task: DesktopTask | undefined): Artifact | undefined {
  return task?.artifact ?? task?.partialArtifact;
}

/**
 * The run a modification applies to. The one the user is looking at wins:
 * falling through to "newest artifact in the conversation" is what sent an
 * instruction meant for the stopped deck to whichever earlier deck happened to
 * have completed (R-C-10).
 */
export function findModifySourceTask(tasks: DesktopTask[], documentType: string, preferredTaskId?: string): DesktopTask | undefined {
  const targetType = documentType.trim().toLowerCase();
  const matches = (task: DesktopTask): boolean => {
    const artifact = sourceArtifactFor(task);
    if (!artifact?.filePath) return false;
    return (artifact.documentType || task.documentType || "").toLowerCase() === targetType;
  };
  if (preferredTaskId) {
    const preferred = tasks.find((task) => task.id === preferredTaskId);
    if (preferred && matches(preferred)) return preferred;
  }
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (matches(tasks[i])) return tasks[i];
  }
  return undefined;
}

export function summarizePrompt(prompt: string): string {
  const normalized = prompt.trim().replace(/\s+/g, " ");
  // Keep enough context for the production header to stay recognisable; the
  // surrounding UI applies its own layout-aware ellipsis where space is tight.
  return normalized.length > 64 ? `${normalized.slice(0, 64)}…` : normalized || "Untitled generation";
}

function createLocalTaskId(): string {
  return `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isGenerateDocumentType(value: unknown): value is GenerateInput["documentType"] {
  return isDocumentType(value);
}

export function documentTypeFromTask(task: DesktopTask, fallback: GenerateInput["documentType"] = "pptx"): GenerateInput["documentType"] {
  const value = task.documentType || task.artifact?.documentType;
  return isGenerateDocumentType(value) ? value : fallback;
}

export function generationModeForDocumentType(documentType: string | undefined): GenerateInput["generationMode"] | undefined {
  return isDocumentType(documentType) && getCapability(documentType).office ? "fast" : undefined;
}

function normalizeGenerationMode(value: unknown): GenerateInput["generationMode"] {
  return value === "plan" ? "plan" : "fast";
}

/** Strips options that do not apply to the chosen document type (R-C-07). */
export function normalizeGenerateInputForGeneration(values: GenerateInput): GenerateInput {
  const next: GenerateInput = { ...values };
  if (next.documentType !== "pptx") {
    delete next.pptxWorkflow;
    delete next.templateId;
    delete next.templateVersion;
    delete next.templateAssetDir;
  }
  const generationMode = generationModeForDocumentType(next.documentType);
  if (generationMode) {
    next.generationMode = normalizeGenerationMode(next.generationMode);
  } else {
    delete next.generationMode;
  }
  return next;
}

export interface GenerationDeps {
  readonly routing: AppRoutingController;
  readonly workspaces: WorkspaceSummary[];
  /** The directory Home is filtering by, and the default target for new work. */
  readonly homeWorkspaceId: string | undefined;
  readonly activeWorkspace: WorkspaceSummary | undefined;
  readonly refreshWorkspaces: () => void;
  readonly defaults: UserSettings["defaults"];
  /** An update gate refuses new work entirely. */
  readonly blocked: boolean;
  readonly recordError: (text: string, kind: FailureKind, details?: string) => void;
  readonly clearError: () => void;
  readonly onSettled: () => void;
  readonly onHomeEntryTransition: (transition: HomeEntryTransition | undefined) => void;
  /** Home routed the request to the catalog cleanup workflow. */
  readonly onCatalogCleanup: (sourceFile: string) => Promise<void>;
  /** Home routed the request to a workbook generation. */
  readonly onWorkbookGeneration: (input: GenerateInput) => Promise<void>;
  readonly t: (key: string, vars?: Record<string, string | number>) => string;
}

export interface SubmitOptions {
  readonly preserveWorkbookContext?: boolean;
  readonly fromHome?: boolean;
}

export interface GenerationController {
  readonly busy: boolean;
  readonly submit: (values: GenerateInput, options?: SubmitOptions) => Promise<void>;
  readonly retry: (task: DesktopTask, resumeCheckpoint?: string) => Promise<void>;
  readonly startFromHome: (input: HomeTaskIntake) => Promise<void>;
  readonly continueGeneration: (
    documentType: string,
    prompt: string,
    referenceImages?: string[],
    imageRatio?: GenerateInput["imageRatio"],
    fps?: number,
  ) => Promise<void>;
  readonly continueModify: (documentType: string, prompt: string, sourceTaskId?: string) => Promise<void>;
}

/**
 * Starting work: a first submission, a retry, a follow-up, a modification.
 *
 * The optimistic placeholder is the delicate part. A submission shows up
 * immediately under a local id and is promoted when the RPC returns, and the
 * in-flight set is a Map rather than a single slot because two submissions can
 * overlap — with one slot the second overwrote the first's prompt, parent and
 * conversation (R-C-02). Only the RPC that created a placeholder resolves it: a
 * task event naming some id proves nothing about which submission it belongs to
 * (R-C-03).
 */
export function useGeneration({
  routing,
  workspaces,
  homeWorkspaceId,
  activeWorkspace,
  refreshWorkspaces,
  defaults,
  blocked,
  recordError,
  clearError,
  onSettled,
  onHomeEntryTransition,
  onCatalogCleanup,
  onWorkbookGeneration,
  t,
}: GenerationDeps): GenerationController {
  const api = useDesktopApi();
  const { state, update } = useTaskStore();
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef<Map<string, PendingGenerate>>(new Map());

  const { conversationId, conversationTasks } = routing;

  const submit = useCallback(async (values: GenerateInput, options: SubmitOptions = {}) => {
    if (blocked) {
      recordError("Update required before continuing", "setup");
      return;
    }
    clearError();
    const topic = values.topic || summarizePrompt(values.prompt);
    const localTaskId = createLocalTaskId();
    onHomeEntryTransition(
      options.fromHome && values.documentType === "pptx" ? captureHomeEntryTransition(values.prompt || "") : undefined,
    );
    const submittedValues = normalizeGenerateInputForGeneration(values);
    const noProject = values.noProject === true || !values.workspaceId;
    const targetWorkspace = noProject ? undefined : workspaces.find((workspace) => workspace.id === values.workspaceId);
    const context: TaskContextPatch = {
      conversationId: localTaskId,
      ...(targetWorkspace ? { workspaceId: targetWorkspace.id, workspacePath: targetWorkspace.path } : {}),
    };
    const pending: PendingGenerate = {
      localTaskId,
      context,
      input: {
        prompt: submittedValues.prompt,
        pptxWorkflow: submittedValues.pptxWorkflow,
        ...(submittedValues.generationMode ? { generationMode: submittedValues.generationMode } : {}),
        sourceFile: submittedValues.sourceFile,
        referenceImages: submittedValues.referenceImages,
        imageRatio: submittedValues.imageRatio,
        fps: submittedValues.fps,
        templateId: submittedValues.templateId,
        templateVersion: submittedValues.templateVersion,
        templateAssetDir: submittedValues.templateAssetDir,
      },
      parentTaskId: values.parentTaskId,
    };
    pendingRef.current.set(localTaskId, pending);
    routing.beginStage(localTaskId);
    update((current) => startLocalTask(current, localTaskId, pending.input, { documentType: values.documentType, topic }, undefined, context));
    routing.setSelectedTask({ kind: "task", id: localTaskId });
    routing.setNav("document");
    setBusy(false);
    try {
      const generateInput: GenerateInput = noProject
        ? { ...submittedValues, topic, noProject: true, workspaceId: undefined }
        : { ...submittedValues, topic, workspaceId: targetWorkspace?.id };
      const result = await api.generate(generateInput);
      if (pendingRef.current.delete(localTaskId) && result.taskId) {
        const actualContext = { ...pending.context, conversationId: result.taskId };
        update((current) => promoteLocalTask(current, localTaskId, result.taskId, pending.input, undefined, actualContext));
        routing.setSelectedTask({ kind: "task", id: result.taskId });
        routing.promoteStage(localTaskId, result.taskId);
        routing.setNav("document");
        refreshWorkspaces();
      }
    } catch (error) {
      if (!pendingRef.current.delete(localTaskId)) return;
      // Generate does its bookkeeping after the invoke returns, so a lost
      // response does not mean a lost run. Look for it in history before
      // concluding the submission failed (R-C-05).
      if (options.preserveWorkbookContext && values.documentType === "pptx") {
        let recovered: TaskHistoryEntry | undefined;
        for (let attempt = 0; attempt < 6 && !recovered; attempt += 1) {
          const entries = await api.getTaskHistory(50).catch(() => [] as TaskHistoryEntry[]);
          recovered = findRecoverableTaskHistoryEntry(entries, {
            documentType: values.documentType,
            sourceFile: values.sourceFile,
            parentTaskId: values.parentTaskId,
            createdAfter: Date.now() - 120_000,
          });
          if (!recovered && attempt < 5) await delay(500);
        }
        if (recovered) {
          update((current) => {
            let next = deleteTask(current, localTaskId);
            for (const event of recovered.events) next = applyTaskEvent(next, event);
            return attachTaskContext(next, recovered.taskId, {
              createdAt: recovered.createdAt,
              conversationId: recovered.conversationId,
              parentTaskId: recovered.parentTaskId,
              workspaceId: recovered.workspaceId,
              workspacePath: recovered.workspacePath,
            });
          });
          routing.setSelectedTask({ kind: "task", id: recovered.taskId });
          routing.beginStage(recovered.taskId);
          routing.setNav("document");
          clearError();
          return;
        }
      }
      routing.clearStage(localTaskId);
      update((current) => discardLocalTask(current, localTaskId));
      const text = errorMessage(error);
      recordError(text, classifyError(text), extractStderr(text));
      routing.setSelectedTask({ kind: "none" });
      // Where a failure lands depends on where it came from (R-C-04).
      routing.setNav(options.preserveWorkbookContext ? "spreadsheet" : "home");
    } finally {
      setBusy(false);
      onSettled();
    }
  }, [api, blocked, clearError, onHomeEntryTransition, onSettled, recordError, refreshWorkspaces, routing, update, workspaces]);

  const retry = useCallback(async (task: DesktopTask, resumeCheckpoint?: string) => {
    const input = task.userInput;
    if (!input?.prompt.trim()) return;
    const documentType = documentTypeFromTask(task);
    const values: GenerateInput = {
      documentType,
      topic: task.topic || summarizePrompt(input.prompt),
      prompt: input.prompt,
      pptxWorkflow: input.pptxWorkflow,
      ...(generationModeForDocumentType(documentType) ? { generationMode: normalizeGenerationMode(input.generationMode) } : {}),
      resumeCheckpoint,
      // A resume keeps whatever the original run decided about images; a plain
      // retry follows the current default.
      enableImages: resumeCheckpoint
        ? ([...task.events].reverse().find((event) => typeof event.payload?.resume_images === "boolean")?.payload?.resume_images as boolean | undefined) ?? defaults.enableImages
        : defaults.enableImages,
      imageQuality: defaults.imageQuality,
      sourceFile: input.sourceFile,
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      templateAssetDir: input.templateAssetDir,
    };
    if (documentType === "img") {
      values.referenceImages = input.referenceImages;
      values.imageRatio = input.imageRatio;
    } else if (documentType === "gif") {
      values.referenceImages = input.referenceImages;
      values.fps = input.fps;
    }
    if (task.workspaceId) values.workspaceId = task.workspaceId;
    else values.noProject = true;
    await submit(values);
  }, [defaults.enableImages, defaults.imageQuality, submit]);

  const startFromHome = useCallback(async (input: HomeTaskIntake) => {
    const fallback = isGenerateDocumentType(input.documentType)
      ? input.documentType
      : isGenerateDocumentType(defaults.documentType)
        ? defaults.documentType
        : "pptx";
    const route = inferHomeTaskRoute(input, fallback);
    // Attached text is read here and inlined: the runtime is a separate process
    // and cannot open the user's files itself (R-C-09).
    let groundedPrompt = input.prompt;
    if (input.referenceTextFiles?.length) {
      const documents = await api.readLocalTextDocuments(input.referenceTextFiles);
      groundedPrompt = buildReferenceTextPrompt(input.prompt, documents);
    }
    const taskPrompt = input.referenceDirectory
      ? `${groundedPrompt.trim()}\n\nReference directory: ${input.referenceDirectory}`
      : groundedPrompt;

    if (route.kind === "needs_source") throw new Error(t("home.catalogSourceRequired"));
    if (route.kind === "catalog_cleanup") {
      await onCatalogCleanup(route.sourceFile);
      return;
    }
    if (route.documentType === "xlsx") {
      await onWorkbookGeneration({
        documentType: "xlsx",
        generationMode: input.advancedMode ? "plan" : "fast",
        topic: summarizePrompt(input.prompt),
        prompt: taskPrompt,
        sourceFile: route.sourceFile,
        ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : { noProject: true }),
        enableImages: defaults.enableImages,
        imageQuality: defaults.imageQuality,
      });
      return;
    }
    await submit({
      documentType: route.documentType,
      ...(route.documentType === "pptx" ? { pptxWorkflow: input.pptxWorkflow } : {}),
      ...(route.documentType === "pptx" && input.templateId ? {
        templateId: input.templateId,
        templateVersion: input.templateVersion,
        templateAssetDir: input.templateAssetDir,
      } : {}),
      generationMode: input.advancedMode ? "plan" : generationModeForDocumentType(route.documentType),
      topic: route.documentType === "pptx" ? PRESENTATION_PLACEHOLDER_TOPIC : summarizePrompt(input.prompt),
      prompt: taskPrompt,
      sourceFile: route.sourceFile,
      ...((route.documentType === "img" || route.documentType === "gif") && input.referenceImages?.length ? { referenceImages: input.referenceImages } : {}),
      ...(route.documentType === "img" && input.imageRatio ? { imageRatio: input.imageRatio } : {}),
      ...(route.documentType === "gif" && input.fps ? { fps: input.fps } : {}),
      ...(homeWorkspaceId ? { workspaceId: homeWorkspaceId } : { noProject: true }),
      enableImages: defaults.enableImages,
      imageQuality: defaults.imageQuality,
    }, { fromHome: true });
  }, [api, defaults, homeWorkspaceId, onCatalogCleanup, onWorkbookGeneration, submit, t]);

  const followUpDeps = useMemo<FollowUpDeps>(() => ({
    pending: pendingRef.current,
    setState: update,
    showTask: (taskId) => {
      routing.setSelectedTask({ kind: "task", id: taskId });
      routing.setNav("document");
    },
    setBusy,
    recordError,
    refreshProjectLists: refreshWorkspaces,
    onSettled,
  }), [onSettled, recordError, refreshWorkspaces, routing, update]);

  const continueGeneration = useCallback(async (
    documentType: string,
    prompt: string,
    referenceImages?: string[],
    imageRatio?: GenerateInput["imageRatio"],
    fps?: number,
  ) => {
    if (blocked) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parentTaskId = conversationTasks.at(-1)?.id;
    const target = resolveFollowUpTarget(parentTaskId ? state.tasks[parentTaskId] : undefined, workspaces, activeWorkspace, conversationId);
    clearError();
    const topic = summarizePrompt(prompt);
    const generationMode = generationModeForDocumentType(documentType);
    const input: PendingGenerate["input"] = {
      prompt,
      ...(generationMode ? { generationMode } : {}),
      referenceImages: referenceImages && referenceImages.length > 0 ? referenceImages : undefined,
      imageRatio,
      fps,
    };
    await runFollowUpTask(followUpDeps, { localTaskId: createLocalTaskId(), documentType, topic, input, target }, () => api.generate({
      documentType: documentType as GenerateInput["documentType"],
      workspaceId: target.targetWorkspace?.id,
      noProject: target.noProject,
      conversationId,
      parentTaskId: target.parentTaskId,
      topic,
      prompt,
      ...(generationMode ? { generationMode } : {}),
      enableImages: defaults.enableImages,
      imageQuality: defaults.imageQuality,
      referenceImages,
      imageRatio,
      fps,
    }));
  }, [activeWorkspace, api, blocked, clearError, conversationId, conversationTasks, defaults, followUpDeps, recordError, state.tasks, workspaces]);

  const continueModify = useCallback(async (documentType: string, prompt: string, sourceTaskId?: string) => {
    if (blocked) {
      recordError("Update required before continuing", "setup");
      return;
    }
    const parent = findModifySourceTask(conversationTasks, documentType, sourceTaskId);
    const sourceFile = sourceArtifactFor(parent)?.filePath;
    if (!sourceFile) {
      recordError(t("ui.copy.Nosourcedocumenttomodify"), "other");
      return;
    }
    const target = resolveFollowUpTarget(parent, workspaces, activeWorkspace, conversationId);
    clearError();
    const topic = summarizePrompt(prompt);
    await runFollowUpTask(followUpDeps, { localTaskId: createLocalTaskId(), documentType, topic, input: { prompt, sourceFile }, target }, () => api.modify({
      documentType: documentType as GenerateInput["documentType"],
      workspaceId: target.targetWorkspace?.id,
      noProject: target.noProject,
      conversationId,
      parentTaskId: target.parentTaskId,
      sourceFile,
      prompt,
    }));
  }, [activeWorkspace, api, blocked, clearError, conversationId, conversationTasks, followUpDeps, recordError, t, workspaces]);

  return { busy, submit, retry, startFromHome, continueGeneration, continueModify };
}
