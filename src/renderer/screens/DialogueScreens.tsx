import { Button, Dropdown, Form, Image, InputNumber, Modal, Popover, Progress, Radio, Space, Spin, Tag, Timeline, Tooltip, toast as message, type MenuProps } from "../ui";
import {
  CheckCircleFilled,
  CheckCircleOutlined,
  CloseCircleFilled,
  CloseCircleOutlined,
  CloseOutlined,
  CloudOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  DownOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  LinkOutlined,
  LoadingOutlined,
  MoreOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
  WarningFilled,
} from "../ui/icons";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type DragEvent, type FormEvent, type ReactNode } from "react";
import { getAttachmentSpec } from "../../shared/types";
import type { Artifact, BridgeEvent, DesktopTask, DocumentType, GenerateInput, GenerationMode, ImagePromptSlot, ImagePromptTemplate, ImageRatio, ModifyPptistDeckResult, StageState, VibeProjectTreeNode, VibeTreeSnapshot, WorkspaceSummary } from "../../shared/types";
import { defaultGenerateInput, documentTypeOptions, normalizeNewGenerationDocumentType } from "../defaults";
import { useSettings } from "../useSettings";
import { useAttachments } from "../useAttachments";
import { officecli } from "../bridge";
import { FileGlyph, MaterialSymbol } from "../components/Shell";
import { TaskRuntimePanel } from "../components/TaskRuntimePanel";
import { Waiting2048Game } from "../components/Waiting2048Game";
import { acquireBlob, releaseBlob } from "../imageCache";
import { buildImageTemplateTagFilters, imageTemplateMatchesTag } from "../imageTemplateTags";
import { useT } from "../i18n";
import { useNow } from "../useNow";
import { useReportCapability } from "../useReportCapability";
import { ReportIssueDialog } from "../components/ReportIssueDialog";
import { ImeInput, ImePlainTextArea, ImeTextArea } from "../components/ImeInput";
import { ViewportAnchoredPopover } from "../components/ViewportAnchoredPopover";
import { Check as CheckIcon, Copy as CopyIcon } from "lucide-react";
import { loadLocalImageTemplates } from "../localImageTemplates";
import {
  AnimatedTextLine,
  AnimatedVisualAssetIcon,
  IDEA_NODE_DRAWING_MS,
  VIBE_NODE_DRAWING_MS,
  VIBE_NODE_MAX_VISUAL_ASSETS,
  VIBE_NODE_TEXT_START_MS,
  VIBE_NODE_VISUAL_ASSET_MS,
  vibeNodeDrawingDurationMs,
  vibeNodeDrawingTexts,
  vibeNodeLineTimings,
  vibeNodeVisualAssetTimings,
} from "./vibeNodeAnimation";
import { PptistEmbedPanel, type PptistEmbedPanelHandle } from "../components/PptistEmbedPanel";
import type { PptistEditOp, PptistElementSelection, PptistSlide } from "../../shared/pptistProtocol";
import { vibeNodeToSlide } from "../vibeSlideConverter";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node as FlowNode,
  type NodeProps,
} from "@xyflow/react";

// Re-exported for existing tests that import these from this module.
export { IDEA_NODE_DRAWING_MS, VIBE_NODE_DRAWING_MS };

function withPptistTypewriterAnimation(ops: PptistEditOp[]): PptistEditOp[] {
  return ops.map((op) => {
    if (op.type !== "element:update-text") return op;
    return {
      ...op,
      animation: op.animation ?? { mode: "typewriter", clearFirst: true, showCaret: true },
    };
  });
}

function FocusToolbarButton({
  className,
  disabled,
  icon,
  label,
  onClick,
  type = "default",
}: {
  className?: string;
  disabled?: boolean;
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  type?: "default" | "primary";
}) {
  return (
    <Tooltip title={label}>
      <span className="living-tree-pptx-tooltip-anchor">
        <Button
          className={className}
          icon={icon}
          aria-label={label}
          title={label}
          type={type}
          disabled={disabled}
          onClick={onClick}
        />
      </span>
    </Tooltip>
  );
}

function uint8ArrayToBase64(data: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

type Translator = (key: string, vars?: Record<string, string | number>) => string;
export type VibeCanvasNodeKind = "root" | "branch" | "slide_group" | "outline" | "generated_slide" | "deck";
type VibeFlowNodeKind = VibeCanvasNodeKind | "thinking";
type CanvasPreparationPhase = "expanding" | "ready";
type CanvasPreparationState = { taskId: string; phase: CanvasPreparationPhase; durationMs: number };
type VibeThinkingState = "active" | "done" | "fading";
type VibeCanvasData = {
  treeNode: VibeProjectTreeNode;
  kind: VibeFlowNodeKind;
  label: string;
  muted?: boolean;
  assembling?: boolean;
  ideaDrawing?: boolean;
  nodeDrawing?: boolean;
  nodeWaiting?: boolean;
  confirmed?: boolean;
  confirmable?: boolean;
  expectedPageCount?: number;
  laneIndex?: number;
  thinkingState?: VibeThinkingState;
  thinkingTargetKind?: VibeCanvasNodeKind;
  popoverOpen?: boolean;
  popoverContent?: ReactNode;
  onPopoverAlignerChange?: (aligner: VoidFunction | null) => void;
  slidePushState?: "pushing" | "pushed" | "waiting";
  slideData?: PptistSlide;
  completedArtifact?: Artifact;
  completedArtifactTitle?: string;
  onPreviewArtifact?: (artifact: Artifact) => void;
};

export type FailureKind = "connection" | "auth" | "task" | "setup" | "other";

export interface NewGenerationDraft {
  documentType: DocumentType;
  generationMode?: GenerationMode;
  topic: string;
  prompt: string;
  sourceFile?: string;
  referenceImages?: string[];
  imageRatio?: ImageRatio;
  fps?: number;
}

export type NewChatTarget =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "none" };

interface DialogueProps {
  tasks: DesktopTask[];
  newGenerationDraft?: NewGenerationDraft;
  newChatNudgeKey?: number;
  busy: boolean;
  lastError?: string;
  errorKind: FailureKind;
  errorDetails?: string;
  bridgeStatus: string;
  onSubmit: (values: GenerateInput) => Promise<void>;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onRetry: () => void;
  onPreview: (artifact: Artifact) => void;
  onNewGenerationDraftChange?: (patch: Partial<NewGenerationDraft>) => void;
  onForceCancel?: (taskId: string) => void;
  onContinueGeneration?: (documentType: string, prompt: string, referenceImages?: string[], imageRatio?: ImageRatio, fps?: number) => void;
  onContinueModify?: (documentType: string, prompt: string) => void;
  onRetryTask?: (task: DesktopTask) => void;
  workspaces?: WorkspaceSummary[];
  newChatTarget?: NewChatTarget;
  onNewChatTargetChange?: (target: NewChatTarget) => void;
  onAddWorkspace?: () => void;
}

const EMPTY_NEW_GENERATION_DRAFT: NewGenerationDraft = {
  documentType: "pptx",
  generationMode: "plan",
  topic: "",
  prompt: "",
  imageRatio: "square",
  fps: 16,
};

const CANVAS_PREPARATION_MIN_MS = 3000;
const CANVAS_PREPARATION_MAX_MS = 5000;
const VIBE_THINKING_NODE_WIDTH = 164;
const VIBE_THINKING_NODE_HEIGHT = 108;
const VIBE_THINKING_DONE_MS = 420;
const VIBE_THINKING_FADE_MS = 520;

type VibeThinkingTransition = {
  key: string;
  stage: VibeTreeSnapshot["stage"];
  treeId: string;
  sourceNodeIds: string[];
  targetKind: VibeCanvasNodeKind;
  phase: VibeThinkingState;
};

function vibeNodeEditableText(node: VibeProjectTreeNode) {
  const sections = [
    node.title,
    node.summary && node.summary !== node.title ? node.summary : undefined,
    node.outline?.length ? node.outline.map((item) => `- ${item}`).join("\n") : undefined,
  ];
  return sections.filter((text): text is string => Boolean(text?.trim())).join("\n\n");
}

function vibeNodeEditLabel(kind: VibeCanvasNodeKind, t: (key: string, vars?: Record<string, string | number>) => string) {
  return t(`vibe.editLabel.${kind}`);
}

function generationModeForNewDocumentType(documentType: DocumentType): GenerationMode | undefined {
  return documentType === "pptx" || documentType === "docx" || documentType === "xlsx" || documentType === "report" ? "plan" : undefined;
}

function randomCanvasPreparationDurationMs() {
  return CANVAS_PREPARATION_MIN_MS + Math.round(Math.random() * (CANVAS_PREPARATION_MAX_MS - CANVAS_PREPARATION_MIN_MS));
}

const IMAGE_RATIO_OPTIONS: ImageRatio[] = ["square", "landscape", "portrait"];
const GIF_FPS_MIN = 4;
const GIF_FPS_MAX = 24;
const DEFAULT_GIF_FPS = 16;

function normalizeGenerationMode(_value: unknown): GenerationMode {
  return "plan";
}

function normalizeImageRatio(value: unknown): ImageRatio {
  return IMAGE_RATIO_OPTIONS.includes(value as ImageRatio) ? (value as ImageRatio) : "square";
}

function imageRatioOptions(t: Translator) {
  return IMAGE_RATIO_OPTIONS.map((ratio) => ({
    value: ratio,
    label: t(`dialogue.imageRatio.${ratio}`),
  }));
}

function normalizeGIFFPS(value: unknown): number {
  const fps = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(fps)) return DEFAULT_GIF_FPS;
  return Math.min(GIF_FPS_MAX, Math.max(GIF_FPS_MIN, Math.round(fps)));
}

/**
 * Frontend-only assembly of a slotted image-template preset into a flat prompt.
 * For each `{{key}}` marker: a matching slot resolves to the user value, then its
 * defaultValue, then `[label]` — never the literal `{{key}}`. Orphan markers with
 * no matching slot are left verbatim (admin-side warns; runtime stays lossless).
 */
export function assembleSlots(
  preset: string,
  slots: ImagePromptSlot[],
  values: Record<string, string>,
): string {
  const byKey = new Map(slots.map((slot) => [slot.key, slot] as const));
  return preset.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    const slot = byKey.get(key);
    if (!slot) return match;
    const raw = values[key];
    if (raw && raw.trim()) return raw;
    if (slot.defaultValue) return slot.defaultValue;
    return `[${slot.label}]`;
  });
}

function localizedSlotLabel(slot: ImagePromptSlot, slug: string, t: Translator): string {
  const key = `dialogue.imageTemplates.slotLabel.${slug}.${slot.key}`;
  const translated = t(key);
  return translated === key ? slot.label : translated;
}

function MessageCopyButton({ text, ariaLabel }: { text: string; ariaLabel: string }) {
  const t = useT();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const cleanText = text.trim();
  if (!cleanText) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(cleanText);
      setState("copied");
      void message.success(t("dialogue.messageCopy.copied"));
    } catch {
      setState("failed");
      void message.error(t("dialogue.messageCopy.failed"));
    }
    window.setTimeout(() => setState("idle"), 1800);
  }

  const title = state === "copied"
    ? t("dialogue.messageCopy.copied")
    : state === "failed"
      ? t("dialogue.messageCopy.failed")
      : ariaLabel;

  return (
    <button
      type="button"
      className={`message-copy-button ${state !== "idle" ? "is-active" : ""}`}
      aria-label={ariaLabel}
      title={title}
      onClick={copy}
    >
      {state === "copied" ? <CheckIcon size={14} strokeWidth={2} /> : <CopyIcon size={14} strokeWidth={2} />}
    </button>
  );
}

export function DialogueScreen({ tasks, newGenerationDraft, newChatNudgeKey = 0, busy, lastError, errorKind, errorDetails, bridgeStatus, onSubmit, onOpenSettings, onOpenLogin, onRetry, onPreview, onNewGenerationDraftChange, onForceCancel, onContinueGeneration, onContinueModify, onRetryTask, workspaces = [], newChatTarget = { kind: "none" }, onNewChatTargetChange, onAddWorkspace }: DialogueProps) {
  if (lastError) {
    return <ConnectionFailure kind={errorKind} status={bridgeStatus} error={lastError} details={errorDetails} onOpenSettings={onOpenSettings} onOpenLogin={onOpenLogin} onRetry={onRetry} />;
  }
  // No tasks = fresh new generation prompt
  if (tasks.length === 0) {
    return (
      <FluidNewGeneration
        draft={newGenerationDraft ?? EMPTY_NEW_GENERATION_DRAFT}
        newChatNudgeKey={newChatNudgeKey}
        busy={busy}
        workspaces={workspaces}
        newChatTarget={newChatTarget}
        onSubmit={onSubmit}
        onDraftChange={onNewGenerationDraftChange ?? (() => undefined)}
        onNewChatTargetChange={onNewChatTargetChange ?? (() => undefined)}
        onAddWorkspace={onAddWorkspace ?? (() => undefined)}
      />
    );
  }
  // Conversation view with all rounds
  return <ConversationView tasks={tasks} onPreview={onPreview} onForceCancel={onForceCancel} onContinueGeneration={onContinueGeneration} onContinueModify={onContinueModify} onRetryTask={onRetryTask} onOpenLogin={onOpenLogin} />;
}

function FluidNewGeneration({ draft, newChatNudgeKey, busy, workspaces, newChatTarget, onSubmit, onDraftChange, onNewChatTargetChange, onAddWorkspace }: {
  draft: NewGenerationDraft;
  newChatNudgeKey: number;
  busy: boolean;
  workspaces: WorkspaceSummary[];
  newChatTarget: NewChatTarget;
  onSubmit: (values: GenerateInput) => Promise<void>;
  onDraftChange: (patch: Partial<NewGenerationDraft>) => void;
  onNewChatTargetChange: (target: NewChatTarget) => void;
  onAddWorkspace: () => void;
}) {
  const [form] = Form.useForm<GenerateInput>();
  const { settings } = useSettings();
  const t = useT();
  const initialValues = { ...defaultGenerateInput, ...settings.defaults, ...draft };
  initialValues.documentType = normalizeNewGenerationDocumentType(initialValues.documentType);
  initialValues.generationMode = normalizeGenerationMode(initialValues.generationMode);
  const [currentDocumentType, setCurrentDocumentType] = useState<DocumentType>(initialValues.documentType as DocumentType);
  const docType = currentDocumentType;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const [imageTemplates, setImageTemplates] = useState<ImagePromptTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const [slotValues, setSlotValues] = useState<Record<string, string>>({});
  const [slotErrors, setSlotErrors] = useState<Record<string, string>>({});
  const [rawDecoupled, setRawDecoupled] = useState(false);
  const [rawOpen, setRawOpen] = useState(false);
  const [promptNudgeActive, setPromptNudgeActive] = useState(false);
  const imageTemplateRequestId = useRef(0);
  const dropTargetRef = useRef<HTMLDivElement | null>(null);
  const attachmentDropHandlersRef = useRef({
    dragOver: (_event: globalThis.DragEvent) => {},
    drop: (_event: globalThis.DragEvent) => {},
  });
  const selectedTemplate = useMemo(
    () => imageTemplates.find((tpl) => String(tpl.id) === selectedTemplateId),
    [imageTemplates, selectedTemplateId],
  );
  const targetWorkspace = newChatTarget.kind === "workspace"
    ? workspaces.find((workspace) => workspace.id === newChatTarget.workspaceId)
    : undefined;
  const projectMenu: MenuProps = {
    items: [
      ...workspaces.map((workspace) => ({
        key: `workspace:${workspace.id}`,
        label: workspace.name,
        icon: <FolderOpenOutlined />,
      })),
      { type: "divider" as const },
      { key: "add", label: t("dialogue.projectPicker.addProject"), icon: <FolderOpenOutlined /> },
      { key: "none", label: t("dialogue.projectPicker.noProject"), icon: <GlobalOutlined /> },
    ],
    onClick: ({ key }) => {
      if (key === "add") {
        onAddWorkspace();
        return;
      }
      if (key === "none") {
        onNewChatTargetChange({ kind: "none" });
        return;
      }
      if (typeof key === "string" && key.startsWith("workspace:")) {
        onNewChatTargetChange({ kind: "workspace", workspaceId: key.slice("workspace:".length) });
      }
    },
  };
  const slots = useMemo(() => selectedTemplate?.slots ?? [], [selectedTemplate]);
  const hasSlots = slots.length > 0;
  const assembledPreview = hasSlots && selectedTemplate
    ? assembleSlots(selectedTemplate.promptPreset, slots, slotValues)
    : "";
  const projectHeading = targetWorkspace ? (
    <h1 className="fluid-start-title image-template-form-title">
      <span>{t("dialogue.startTitleInProjectPrefix")}</span>
      <Dropdown menu={projectMenu} trigger={["click"]}>
        <button type="button" className="project-picker-button" aria-label={targetWorkspace.name}>
          {targetWorkspace.name}
          <DownOutlined />
        </button>
      </Dropdown>
    </h1>
  ) : (
    <>
      <h1 className="image-template-form-title">{t("dialogue.startTitleNoProject")}</h1>
      <Dropdown menu={projectMenu} trigger={["click"]}>
        <button type="button" className="project-picker-button project-picker-secondary" aria-label={t("dialogue.projectPicker.noProject")}>
          <GlobalOutlined />
          {t("dialogue.projectPicker.noProject")}
          <DownOutlined />
        </button>
      </Dropdown>
    </>
  );
  const attachments = useAttachments(docType, {
    sourceFile: draft.sourceFile ?? null,
    referenceImages: draft.referenceImages ?? [],
    onChange: (next) => onDraftChange(next),
  });
  const [nativeReferenceDropSignal, setNativeReferenceDropSignal] = useState(0);

  useEffect(() => {
    if (!attachments.referenceImagesSpec) return undefined;
    return officecli.onFileDrop((paths) => {
      setNativeReferenceDropSignal((signal) => signal + 1);
      const added = attachments.addReferenceImagePaths(paths);
      if (added > 0) {
        message.success(added === 1 ? t("dialogue.attach.paste.attached") : t("dialogue.attach.paste.attachedMany", { count: added }));
      }
    });
  }, [attachments.referenceImagesSpec, attachments.addReferenceImagePaths, t]);

  attachmentDropHandlersRef.current = {
    dragOver: (event: globalThis.DragEvent) => handleAttachmentDragOver(event, attachments),
    drop: (event: globalThis.DragEvent) => handleAttachmentDrop(event, attachments, t),
  };

  const nativeDragOverHandler = useCallback((event: globalThis.DragEvent) => {
    attachmentDropHandlersRef.current.dragOver(event);
  }, []);

  const nativeDropHandler = useCallback((event: globalThis.DragEvent) => {
    attachmentDropHandlersRef.current.drop(event);
  }, []);

  const bindDropTarget = useCallback((target: HTMLDivElement | null) => {
    if (dropTargetRef.current) {
      dropTargetRef.current.removeEventListener("dragover", nativeDragOverHandler);
      dropTargetRef.current.removeEventListener("drop", nativeDropHandler);
    }
    dropTargetRef.current = target;
    if (target) {
      target.addEventListener("dragover", nativeDragOverHandler);
      target.addEventListener("drop", nativeDropHandler);
    }
  }, [nativeDragOverHandler, nativeDropHandler]);

  useEffect(() => {
    const nextDocumentType = normalizeNewGenerationDocumentType(draft.documentType);
    setCurrentDocumentType(nextDocumentType);
    form.setFieldsValue({
      documentType: nextDocumentType,
      generationMode: normalizeGenerationMode(draft.generationMode),
      topic: draft.topic,
      prompt: draft.prompt,
      imageRatio: normalizeImageRatio(draft.imageRatio),
      fps: normalizeGIFFPS(draft.fps),
    });
  }, [form, draft.documentType, draft.generationMode, draft.topic, draft.prompt, draft.imageRatio, draft.fps]);

  useEffect(() => {
    if (newChatNudgeKey === 0) return;
    setPromptNudgeActive(false);
    const start = window.setTimeout(() => setPromptNudgeActive(true), 0);
    const end = window.setTimeout(() => setPromptNudgeActive(false), 900);
    return () => {
      window.clearTimeout(start);
      window.clearTimeout(end);
    };
  }, [newChatNudgeKey]);

  const loadImageTemplates = useCallback(() => {
    const requestId = imageTemplateRequestId.current + 1;
    imageTemplateRequestId.current = requestId;
    setTemplatesLoading(true);
    officecli.listImageTemplates()
      .then((items) => {
        if (requestId !== imageTemplateRequestId.current) return;
        const localTemplates = loadLocalImageTemplates().filter((item) => item.enabled);
        setImageTemplates([...localTemplates, ...items.filter((item) => item.enabled)]);
        setTemplatesError("");
      })
      .catch((error: unknown) => {
        if (requestId !== imageTemplateRequestId.current) return;
        setTemplatesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (requestId === imageTemplateRequestId.current) setTemplatesLoading(false);
      });
  }, []);

  useEffect(() => {
    if (docType !== "img") {
      form.setFieldValue("promptTemplateId", undefined);
      setSelectedTemplateId(undefined);
      setTemplatesError("");
      setSlotValues({});
      setSlotErrors({});
      setRawDecoupled(false);
      setRawOpen(false);
      return;
    }
    loadImageTemplates();
    return () => {
      imageTemplateRequestId.current += 1;
    };
  }, [docType, form, loadImageTemplates]);

  function applyDraftPatch(patch: Partial<NewGenerationDraft>) {
    if (patch.documentType) {
      setCurrentDocumentType(normalizeNewGenerationDocumentType(patch.documentType));
    }
    form.setFieldsValue(patch);
    onDraftChange(patch);
  }

  function seedSlots(template: ImagePromptTemplate) {
    const templateSlots = template.slots ?? [];
    const initial: Record<string, string> = {};
    for (const slot of templateSlots) initial[slot.key] = slot.defaultValue ?? "";
    const assembled = assembleSlots(template.promptPreset, templateSlots, initial);
    setSlotValues(initial);
    setSlotErrors({});
    setRawDecoupled(false);
    setRawOpen(false);
    form.setFieldValue("prompt", assembled);
    form.setFieldValue("promptTemplateId", undefined);
    onDraftChange({ prompt: assembled });
  }

  function applyImageTemplate(template: ImagePromptTemplate) {
    const templateSlots = template.slots ?? [];
    // Slotted templates seed defaults + preview directly (the guided form owns the prompt).
    if (templateSlots.length > 0) {
      setSelectedTemplateId(String(template.id));
      seedSlots(template);
      return;
    }
    // Legacy (no slots): raw fill, with a confirm when there's already a prompt.
    const nextPrompt = template.promptPreset.trim();
    const currentPrompt = String(form.getFieldValue("prompt") ?? "");
    const apply = () => {
      setSlotValues({});
      setSlotErrors({});
      setRawDecoupled(false);
      setRawOpen(false);
      form.setFieldValue("prompt", nextPrompt);
      form.setFieldValue("promptTemplateId", undefined);
      setSelectedTemplateId(String(template.id));
      onDraftChange({ prompt: nextPrompt });
    };
    if (currentPrompt.trim()) {
      Modal.confirm({
        title: t("dialogue.imageTemplates.confirmReplaceTitle"),
        content: t("dialogue.imageTemplates.confirmReplaceBody"),
        okText: t("dialogue.imageTemplates.confirmReplaceOk"),
        cancelText: t("dialogue.imageTemplates.confirmReplaceCancel"),
        onOk: apply,
      });
      return;
    }
    apply();
  }

  function handleSlotChange(key: string, value: string) {
    const next = { ...slotValues, [key]: value };
    setSlotValues(next);
    if (slotErrors[key]) setSlotErrors({ ...slotErrors, [key]: "" });
    if (hasSlots && !rawDecoupled && selectedTemplate) {
      const assembled = assembleSlots(selectedTemplate.promptPreset, slots, next);
      form.setFieldValue("prompt", assembled);
      onDraftChange({ prompt: assembled });
    }
  }

  function handleRawPromptEdit() {
    if (hasSlots && !rawDecoupled) setRawDecoupled(true);
  }

  function resetToTemplate() {
    if (selectedTemplate) seedSlots(selectedTemplate);
  }

  function clearImageTemplate() {
    setSelectedTemplateId(undefined);
    setSlotValues({});
    setSlotErrors({});
    setRawDecoupled(false);
    setRawOpen(false);
    form.setFieldsValue({ prompt: "", promptTemplateId: undefined });
    onDraftChange({ prompt: "" });
  }

  function validateSlots(): { ok: boolean; firstError?: string } {
    if (!hasSlots || rawDecoupled) return { ok: true };
    const errs: Record<string, string> = {};
    for (const slot of slots) {
      const value = slotValues[slot.key] ?? "";
      if (slot.required && !value.trim() && !slot.defaultValue?.trim()) {
        errs[slot.key] = t("dialogue.imageTemplates.slotRequired", { label: localizedSlotLabel(slot, selectedTemplate?.slug ?? "", t) });
      } else if (value.includes("{{")) {
        errs[slot.key] = t("dialogue.imageTemplates.slotBraceForbidden");
      }
    }
    setSlotErrors(errs);
    const firstKey = slots.find((slot) => errs[slot.key])?.key;
    return { ok: firstKey === undefined, firstError: firstKey ? errs[firstKey] : undefined };
  }

  const composerActions = (detached: boolean) => {
    const showAuxiliaryActions = !(detached && docType === "img");
    return (
      <div className={`composer-actions ${detached ? "image-template-actions-footer" : ""}`}>
        {showAuxiliaryActions ? (
          <Space>
            {attachments.sourceWorkbookSpec ? (
              <Tooltip
                title={
                  attachments.sourceWorkbookSpec.required
                    ? t("dialogue.attach.sourceFile.required", { label: attachments.sourceWorkbookSpec.label, ext: attachments.sourceWorkbookSpec.extensions[0] })
                    : attachments.sourceWorkbookSpec.label
                }
              >
                <Button icon={<PaperClipOutlined />} onClick={attachments.pickSourceFile} aria-label={t("dialogue.attach.sourceFile.aria")} />
              </Tooltip>
            ) : null}
            {attachments.referenceImagesSpec ? (
              <Tooltip title={t("dialogue.attach.referenceImages.tooltip", { max: attachments.referenceImagesSpec.maxCount })}>
                <Button
                  className="reference-image-upload-button"
                  icon={<MaterialSymbol name="image" />}
                  onClick={attachments.pickReferenceImages}
                  disabled={attachments.isReferenceLimitReached}
                  aria-label={t("dialogue.attach.referenceImages.attach")}
                >
                  {t("dialogue.attach.referenceImages.uploadCta")}
                </Button>
              </Tooltip>
            ) : null}
            <Tooltip title={t("dialogue.attach.advancedOptions")}>
              <Button icon={<MaterialSymbol name="tune" />} disabled />
            </Tooltip>
          </Space>
        ) : null}
        <Button
          type="primary"
          htmlType={detached ? "button" : "submit"}
          icon={<SendOutlined />}
          loading={busy}
          onClick={detached ? () => form.submit() : undefined}
        >
          {t("dialogue.generate")}
        </Button>
      </div>
    );
  };

  const documentTypeSelector = (
    <Radio.Group
      optionType="button"
      options={documentTypeOptions.map((option) => ({ value: option.value, label: option.label }))}
    />
  );
  const promptField = (
    <Form.Item name="prompt" rules={[{ required: true, message: t("dialogue.prompt.required") }]} hidden={hasSlots && !rawDecoupled && !rawOpen}>
      <ImeTextArea className={`new-chat-nudge-input ${promptNudgeActive ? "is-new-chat-nudging" : ""}`} autoSize={{ minRows: 4, maxRows: 8 }} placeholder={t("dialogue.prompt.placeholder")} onChange={handleRawPromptEdit} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); form.submit(); } }} onPaste={makePasteHandler(attachments, t)} />
    </Form.Item>
  );
  const sourceFileAttachment = attachments.sourceWorkbookSpec && attachments.sourceFile ? (
    <div className="attached-file">
      <PaperClipOutlined />
      <span title={attachments.sourceFile}>{attachments.sourceFile.split(/[/\\]/).pop()}</span>
      <Button type="text" size="small" icon={<DeleteOutlined />} onClick={attachments.clearSourceFile} />
    </div>
  ) : null;
  const referenceImageStrip = attachments.referenceImagesSpec && attachments.referenceImages.length > 0 ? (
    <ReferenceImageStrip
      items={attachments.referenceImages}
      maxCount={attachments.referenceImagesSpec.maxCount}
      onRemove={attachments.removeReferenceImage}
      showHeader
      showBadge
    />
  ) : null;
  const imageTemplateControls = (
    <>
      {hasSlots && !rawDecoupled ? (
        <TemplateSlotForm
          slots={slots}
          slug={selectedTemplate?.slug ?? ""}
          values={slotValues}
          errors={slotErrors}
          previewText={assembledPreview}
          onChange={handleSlotChange}
          t={t}
        />
      ) : null}
      {hasSlots && rawDecoupled ? (
        <div className="slot-raw-decoupled">
          <span>{t("dialogue.imageTemplates.rawDecoupledHint")}</span>
          <Button size="small" onClick={resetToTemplate}>{t("dialogue.imageTemplates.resetToTemplate")}</Button>
        </div>
      ) : null}
      {hasSlots && !rawDecoupled ? (
        <Button type="link" size="small" className="slot-edit-raw-toggle" onClick={() => setRawOpen((open) => !open)}>
          {t("dialogue.imageTemplates.editRawToggle")}
        </Button>
      ) : null}
      {selectedTemplateId && !hasSlots ? (
        <div className="image-template-replace-hint">{t("dialogue.imageTemplates.replaceHint")}</div>
      ) : null}
      {promptField}
      {sourceFileAttachment}
      {referenceImageStrip}
    </>
  );

  return (
    <div
      className={`fluid-new-task ${docType === "img" ? "image-template-workspace" : ""}`}
      data-testid="new-generation-form"
      data-document-type={docType}
      ref={bindDropTarget}
    >
      {docType === "img" ? (
        <div className="image-template-prompt-header image-template-form-header">
          {projectHeading}
          <div className="format-row">
            <span>{t("dialogue.format.label")}</span>
            <Radio.Group
              optionType="button"
              value={docType}
              options={documentTypeOptions.map((option) => ({ value: option.value, label: option.label }))}
              onChange={(event) => applyDraftPatch({ documentType: normalizeNewGenerationDocumentType(event.target.value) })}
            />
          </div>
        </div>
      ) : null}
      <section className={`fluid-start-card ${docType === "img" ? "image-template-gallery-pane" : ""}`}>
        {docType === "img" ? null : (
          <div className="fluid-spark">
            <MaterialSymbol name="auto_awesome" />
          </div>
        )}
        {docType !== "img" ? (
          targetWorkspace ? (
            <h1 className="fluid-start-title">
              <span>{t("dialogue.startTitleInProjectPrefix")}</span>
              <Dropdown menu={projectMenu} trigger={["click"]}>
                <button type="button" className="project-picker-button" aria-label={targetWorkspace.name}>
                  {targetWorkspace.name}
                  <DownOutlined />
                </button>
              </Dropdown>
            </h1>
          ) : (
            <>
              <h1>{t("dialogue.startTitleNoProject")}</h1>
              <Dropdown menu={projectMenu} trigger={["click"]}>
                <button type="button" className="project-picker-button project-picker-secondary" aria-label={t("dialogue.projectPicker.noProject")}>
                  <GlobalOutlined />
                  {t("dialogue.projectPicker.noProject")}
                  <DownOutlined />
                </button>
              </Dropdown>
            </>
          )
        ) : null}
        {docType === "img" ? (
          <div className="fluid-start-template-list">
            <ImageTemplatePicker
              templates={imageTemplates}
              selectedId={selectedTemplateId}
              loading={templatesLoading}
              error={templatesError}
              onSelect={applyImageTemplate}
              onClear={clearImageTemplate}
              onRefresh={loadImageTemplates}
              t={t}
            />
          </div>
        ) : (
          <>
            <p>{t("dialogue.startSubtitle")}</p>
            <div className="fluid-prompt-grid">
              <button onClick={() => applyDraftPatch({ documentType: "report", topic: t("dialogue.preset.report.title"), prompt: t("dialogue.preset.report.desc") })}>
                <MaterialSymbol name="analytics" />
                <strong>{t("dialogue.preset.report.title")}</strong>
                <span>{t("dialogue.preset.report.desc")}</span>
              </button>
              <button onClick={() => applyDraftPatch({ documentType: "pptx", topic: t("dialogue.preset.pptx.title"), prompt: t("dialogue.preset.pptx.desc") })}>
                <MaterialSymbol name="present_to_all" />
                <strong>{t("dialogue.preset.pptx.title")}</strong>
                <span>{t("dialogue.preset.pptx.desc")}</span>
              </button>
              <button onClick={() => applyDraftPatch({ documentType: "xlsx", topic: t("dialogue.preset.xlsx.title"), prompt: t("dialogue.preset.xlsx.desc") })}>
                <MaterialSymbol name="table_chart" />
                <strong>{t("dialogue.preset.xlsx.title")}</strong>
                <span>{t("dialogue.preset.xlsx.desc")}</span>
              </button>
            </div>
          </>
        )}
      </section>
      <div className={`fluid-command-footer ${docType === "img" ? "image-template-form-pane" : ""}`}>
        <Form form={form} layout="vertical" initialValues={initialValues} onValuesChange={(_, values) => {
          const nextDocumentType = normalizeNewGenerationDocumentType(values.documentType ?? draft.documentType);
          setCurrentDocumentType(nextDocumentType);
          onDraftChange({
            documentType: nextDocumentType,
            generationMode: generationModeForNewDocumentType(nextDocumentType),
            topic: values.topic ?? "",
            prompt: values.prompt ?? "",
            imageRatio: normalizeImageRatio(values.imageRatio),
            fps: normalizeGIFFPS(values.fps),
          });
        }} onFinish={(values) => {
          const validation = attachments.validateForSubmit();
          if (!validation.ok) {
            message.warning(validation.reason);
            return;
          }
          const slotCheck = validateSlots();
          if (!slotCheck.ok) {
            if (slotCheck.firstError) message.warning(slotCheck.firstError);
            return;
          }
          const { promptTemplateId: _promptTemplateId, imageRatio: rawImageRatio, fps: rawFPS, ...submitValues } = values;
          void _promptTemplateId;
          const documentType = normalizeNewGenerationDocumentType(submitValues.documentType);
          const prompt = hasSlots && !rawDecoupled && selectedTemplate
            ? assembleSlots(selectedTemplate.promptPreset, slots, slotValues)
            : submitValues.prompt;
          const nextInput: GenerateInput = { ...submitValues, documentType, prompt, ...attachments.collect() };
          const generationMode = generationModeForNewDocumentType(documentType);
          if (generationMode) {
            nextInput.generationMode = generationMode;
          } else {
            delete nextInput.generationMode;
          }
          if (targetWorkspace) {
            nextInput.workspaceId = targetWorkspace.id;
            delete nextInput.noProject;
          } else {
            delete nextInput.workspaceId;
            nextInput.noProject = true;
          }
          if (documentType === "img") {
            nextInput.imageRatio = normalizeImageRatio(rawImageRatio);
          } else if (documentType === "gif") {
            nextInput.fps = normalizeGIFFPS(rawFPS);
          }
          onSubmit(nextInput);
        }} className="fluid-command-bar">
          {docType === "img" ? (
            <Form.Item name="documentType" hidden>
              <ImeInput />
            </Form.Item>
          ) : (
            <div className="format-row">
              <span>{t("dialogue.format.label")}</span>
              <Form.Item name="documentType" noStyle>
                {documentTypeSelector}
              </Form.Item>
            </div>
          )}
          {docType === "img" ? (
            <div className="image-ratio-row">
              <span>{t("dialogue.imageRatio.label")}</span>
              <Form.Item name="imageRatio" noStyle>
                <Radio.Group optionType="button" options={imageRatioOptions(t)} />
              </Form.Item>
            </div>
          ) : null}
          {docType === "gif" ? (
            <div className="image-ratio-row">
              <span>{t("dialogue.gifFps.label")}</span>
              <Form.Item name="fps" noStyle>
                <InputNumber min={GIF_FPS_MIN} max={GIF_FPS_MAX} precision={0} aria-label={t("dialogue.gifFps.label")} />
              </Form.Item>
            </div>
          ) : null}
          <Form.Item name="topic" hidden>
            <ImeInput />
          </Form.Item>
          <Form.Item name="promptTemplateId" hidden>
            <ImeInput />
          </Form.Item>
          {docType === "img" ? (
            selectedTemplateId ? (
              <div className="image-template-template-composer">
                <SelectedImageTemplateSummary template={selectedTemplate} onClear={clearImageTemplate} t={t} />
                <div className="image-template-template-form-scroll">
                  {imageTemplateControls}
                </div>
              </div>
            ) : (
              <div className="image-template-scratch-composer">
                <div className="image-template-scratch-prompt-card">
                  {promptField}
                </div>
                <div className="image-template-scratch-workspace">
                  <ReferenceImageDropZone attachments={attachments} nativeDropSignal={nativeReferenceDropSignal} t={t}>
                    {referenceImageStrip ?? <ReferenceImageEmptyState t={t} />}
                  </ReferenceImageDropZone>
                  <ImageOutputPreviewPlaceholder t={t} />
                </div>
                {sourceFileAttachment}
              </div>
            )
          ) : (
            <>
              {promptField}
              {sourceFileAttachment}
              {attachments.referenceImagesSpec && attachments.referenceImages.length > 0 ? (
                <ReferenceImageStrip
                  items={attachments.referenceImages}
                  maxCount={attachments.referenceImagesSpec.maxCount}
                  onRemove={attachments.removeReferenceImage}
                  onAdd={attachments.pickReferenceImages}
                />
              ) : null}
              {composerActions(false)}
            </>
          )}
        </Form>
        {docType === "img" ? composerActions(true) : null}
      </div>
    </div>
  );
}

function ImageTemplatePicker({ templates, selectedId, loading, error, onSelect, onClear, onRefresh, t }: {
  templates: ImagePromptTemplate[];
  selectedId?: string;
  loading: boolean;
  error: string;
  onSelect: (template: ImagePromptTemplate) => void;
  onClear: () => void;
  onRefresh: () => void;
  t: Translator;
}) {
  const [selectedTag, setSelectedTag] = useState("");
  const tagFilters = useMemo(() => buildImageTemplateTagFilters(templates), [templates]);
  const visibleTemplates = useMemo(
    () => templates.filter((template) => imageTemplateMatchesTag(template, selectedTag)),
    [templates, selectedTag],
  );

  useEffect(() => {
    if (selectedTag && !tagFilters.some((filter) => filter.key === selectedTag)) setSelectedTag("");
  }, [selectedTag, tagFilters]);

  const templateColumns = [[], [], []] as ImagePromptTemplate[][];
  visibleTemplates.forEach((template, index) => {
    templateColumns[index % templateColumns.length].push(template);
  });

  return (
    <div className="image-template-picker" aria-label={t("dialogue.imageTemplates.label")}>
      <button
        type="button"
        className={`image-template-scratch-card ${selectedId ? "" : "image-template-scratch-card-selected"}`}
        aria-pressed={!selectedId}
        onClick={() => onClear()}
      >
        <span className="image-template-scratch-icon" aria-hidden="true">
          <MaterialSymbol name="add" />
        </span>
        <span className="image-template-scratch-copy">
          <strong>{t("dialogue.imageTemplates.scratchTitle")}</strong>
          <span>{t("dialogue.imageTemplates.scratchSubtitle")}</span>
        </span>
        {!selectedId ? <span className="image-template-selected-pill">{t("dialogue.imageTemplates.selectedLabel")}</span> : null}
      </button>
      <div className="image-template-picker-toolbar">
        <div className="image-template-picker-head">
          <span>{t("dialogue.imageTemplates.label")}</span>
          <div className="image-template-picker-actions">
            <button
              type="button"
              className="image-template-refresh"
              onClick={() => onRefresh()}
              disabled={loading}
              aria-label={t("dialogue.imageTemplates.refresh")}
              title={t("dialogue.imageTemplates.refresh")}
            >
              <MaterialSymbol name="refresh" />
            </button>
          </div>
        </div>
        {tagFilters.length ? (
          <div className="image-template-tag-filters" aria-label={t("dialogue.imageTemplates.tags.aria")}>
            <button type="button" className={selectedTag === "" ? "is-selected" : ""} aria-pressed={selectedTag === ""} onClick={() => setSelectedTag("")}>
              <span>{t("dialogue.imageTemplates.tags.all")}</span><b>{templates.length}</b>
            </button>
            {tagFilters.map((filter) => (
              <button type="button" key={filter.key} className={selectedTag === filter.key ? "is-selected" : ""} aria-pressed={selectedTag === filter.key} onClick={() => setSelectedTag(filter.key)}>
                <span>{filter.label}</span><b>{filter.count}</b>
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {loading ? (
        <div className="image-template-status">
          <Spin size="small" /> <span>{t("dialogue.imageTemplates.loading")}</span>
        </div>
      ) : error ? (
        <div className="image-template-status image-template-status-error">{t("dialogue.imageTemplates.error", { error })}</div>
      ) : templates.length === 0 ? (
        <div className="image-template-status">{t("dialogue.imageTemplates.empty")}</div>
      ) : selectedTag && visibleTemplates.length === 0 ? (
        <div className="image-template-status">{t("dialogue.imageTemplates.tags.empty")}</div>
      ) : (
        <div className="image-template-grid image-template-vertical-wall">
          {templateColumns.map((column, columnIndex) => (
            <div className="image-template-masonry-column" key={columnIndex}>
              {column.map((template) => {
                const id = String(template.id);
                const selected = selectedId === id;
                return (
                  <div
                    key={id}
                    className={`image-template-card ${selected ? "image-template-card-selected" : ""}`}
                  >
                    <button
                      type="button"
                      className="image-template-card-main"
                      aria-pressed={selected}
                      onClick={() => onSelect(template)}
                    >
                      <ImageTemplateThumbnail src={template.thumbnailUrl} />
                      <strong className="image-template-card-title">{template.title}</strong>
                    </button>
                    {selected ? <span className="image-template-card-selected-badge">{t("dialogue.imageTemplates.selectedLabel")}</span> : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageTemplateThumbnail({ src }: { src?: string }) {
  const [failedSrc, setFailedSrc] = useState<string | undefined>();
  const showImage = Boolean(src && failedSrc !== src);

  useLayoutEffect(() => {
    setFailedSrc(undefined);
  }, [src]);

  return (
    <div
      className="image-template-thumb"
      style={showImage ? { "--image-template-thumb-src": `url("${src}")` } as CSSProperties : undefined}
    >
      {showImage ? (
        <img src={src} alt="" draggable={false} onError={() => setFailedSrc(src)} />
      ) : (
        <div className="image-template-thumb-placeholder" aria-hidden="true" />
      )}
    </div>
  );
}

function SelectedImageTemplateSummary({ template, onClear, t }: {
  template?: ImagePromptTemplate;
  onClear: () => void;
  t: Translator;
}) {
  return (
    <div className="image-template-selected-template-card">
      <div className="image-template-selected-template-thumb" aria-hidden="true">
        <ImageTemplateThumbnail src={template?.thumbnailUrl} />
      </div>
      <div className="image-template-selected-template-copy">
        <strong>{template?.title ?? t("dialogue.imageTemplates.selectedTemplateFallback")}</strong>
        <span>{t("dialogue.imageTemplates.selectedTemplateHint")}</span>
      </div>
      <Button onClick={onClear}>{t("dialogue.imageTemplates.scratchTitle")}</Button>
    </div>
  );
}

function ReferenceImageEmptyState({ t }: { t: Translator }) {
  return (
    <div className="image-template-reference-empty">
      <div className="image-template-reference-icon" aria-hidden="true">
        <MaterialSymbol name="image" />
      </div>
      <strong>{t("dialogue.imageTemplates.referenceEmptyTitle")}</strong>
      <span>{t("dialogue.imageTemplates.referenceEmptyBody")}</span>
    </div>
  );
}

function ReferenceImageDropZone({ attachments, nativeDropSignal, t, children }: {
  attachments: ReturnType<typeof useAttachments>;
  nativeDropSignal: number;
  t: Translator;
  children: ReactNode;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    setActive(false);
  }, [nativeDropSignal]);

  function hasPotentialFileDrag(dataTransfer: DataTransfer | null) {
    if (!attachments.supportsPaste || !dataTransfer) return false;
    const types = Array.from(dataTransfer.types ?? []);
    if (types.includes("Files")) return true;
    return Boolean(dataTransfer.files && imageFilesFrom(dataTransfer.files).length > 0);
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    if (hasPotentialFileDrag(event.dataTransfer)) {
      setActive(true);
      event.preventDefault();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = attachments.isReferenceLimitReached ? "none" : "copy";
      }
    }
    handleAttachmentDragOver(event, attachments);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setActive(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    setActive(false);
    handleAttachmentDrop(event, attachments, t);
  }

  const overlayTitle = attachments.isReferenceLimitReached
    ? t("dialogue.imageTemplates.referenceDropLimitTitle")
    : t("dialogue.imageTemplates.referenceDropActiveTitle");
  const overlayBody = attachments.isReferenceLimitReached
    ? t("dialogue.imageTemplates.referenceDropLimitBody")
    : t("dialogue.imageTemplates.referenceDropActiveBody");

  return (
    <div
      className={`image-template-reference-panel image-template-reference-drop-zone ${active ? "image-template-reference-drop-zone-active" : ""} ${active && attachments.isReferenceLimitReached ? "image-template-reference-drop-zone-limit" : ""}`}
      role="region"
      aria-label={t("dialogue.imageTemplates.referenceDropZoneLabel")}
      tabIndex={0}
      onDragEnter={handleDragOver}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onPaste={makePasteHandler(attachments, t)}
      onClick={(event) => event.currentTarget.focus()}
    >
      <div className="image-template-reference-drop-content">
        {children}
      </div>
      {active ? (
        <div className="image-template-reference-drop-overlay" aria-live="polite">
          <MaterialSymbol name={attachments.isReferenceLimitReached ? "block" : "add_photo_alternate"} />
          <strong>{overlayTitle}</strong>
          <span>{overlayBody}</span>
        </div>
      ) : null}
    </div>
  );
}

function ImageOutputPreviewPlaceholder({ t }: { t: Translator }) {
  return (
    <div className="image-template-output-preview">
      <div className="image-template-output-shape" aria-hidden="true" />
      <strong>{t("dialogue.imageTemplates.previewEmptyTitle")}</strong>
      <span>{t("dialogue.imageTemplates.previewEmptyBody")}</span>
    </div>
  );
}

function TemplateSlotForm({ slots, slug, values, errors, previewText, onChange, t }: {
  slots: ImagePromptSlot[];
  slug: string;
  values: Record<string, string>;
  errors: Record<string, string>;
  previewText: string;
  onChange: (key: string, value: string) => void;
  t: Translator;
}) {
  const [activeTab, setActiveTab] = useState<"form" | "preview">("form");

  useEffect(() => {
    if (Object.keys(errors).length > 0) setActiveTab("form");
  }, [errors]);

  return (
    <div className="template-slot-form">
      <div className="template-slot-form-header">
        <div className="template-slot-form-title">{t("dialogue.imageTemplates.slotFormTitle")}</div>
        <div className="template-slot-tabs" role="tablist" aria-label={t("dialogue.imageTemplates.slotFormTitle")}>
          <button
            type="button"
            role="tab"
            id="template-slot-tab-form"
            aria-selected={activeTab === "form"}
            aria-controls="template-slot-panel-form"
            className={activeTab === "form" ? "template-slot-tab template-slot-tab-active" : "template-slot-tab"}
            onClick={() => setActiveTab("form")}
          >
            {t("dialogue.imageTemplates.formTab")}
          </button>
          <button
            type="button"
            role="tab"
            id="template-slot-tab-preview"
            aria-selected={activeTab === "preview"}
            aria-controls="template-slot-panel-preview"
            className={activeTab === "preview" ? "template-slot-tab template-slot-tab-active" : "template-slot-tab"}
            onClick={() => setActiveTab("preview")}
          >
            {t("dialogue.imageTemplates.previewTab")}
          </button>
        </div>
      </div>
      {activeTab === "form" ? (
        <div
          id="template-slot-panel-form"
          className="template-slot-form-fields"
          role="tabpanel"
          aria-labelledby="template-slot-tab-form"
        >
          {slots.map((slot) => (
            <Form.Item
              key={slot.key}
              label={localizedSlotLabel(slot, slug, t)}
              extra={slot.helpText}
              required={slot.required}
              validateStatus={errors[slot.key] ? "error" : undefined}
              help={errors[slot.key]}
            >
              {slot.multiline ? (
                <ImeTextArea
                  autoSize={{ minRows: 2, maxRows: 6 }}
                  value={values[slot.key] ?? ""}
                  placeholder={slot.defaultValue}
                  onChange={(e) => onChange(slot.key, e.target.value)}
                />
              ) : (
                <ImeInput
                  value={values[slot.key] ?? ""}
                  placeholder={slot.defaultValue}
                  onChange={(e) => onChange(slot.key, e.target.value)}
                />
              )}
            </Form.Item>
          ))}
        </div>
      ) : (
        <div
          id="template-slot-panel-preview"
          className="template-slot-preview-panel"
          role="tabpanel"
          aria-labelledby="template-slot-tab-preview"
        >
          <div className="template-slot-preview-body">{previewText}</div>
        </div>
      )}
    </div>
  );
}

/* ─── Conversation View ─── */

function findVerticalScrollContainer(element: HTMLElement | null): HTMLElement | null {
  let current = element?.parentElement ?? null;
  while (current) {
    if (current.classList.contains("stage")) return current;
    const style = window.getComputedStyle(current);
    const overflowY = style.overflowY || style.overflow;
    if (/(auto|scroll|overlay)/.test(overflowY)) return current;
    current = current.parentElement;
  }
  return null;
}

function ConversationView({ tasks, onPreview, onForceCancel, onContinueGeneration, onContinueModify, onRetryTask, onOpenLogin }: {
  tasks: DesktopTask[];
  onPreview: (artifact: Artifact) => void;
  onForceCancel?: (taskId: string) => void;
  onContinueGeneration?: (documentType: string, prompt: string, referenceImages?: string[], imageRatio?: ImageRatio, fps?: number) => void;
  onContinueModify?: (documentType: string, prompt: string) => void;
  onRetryTask?: (task: DesktopTask) => void;
  onOpenLogin: () => void;
}) {
  const latestTask = tasks[tasks.length - 1];
  const bottomRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const appSessionStartedAtRef = useRef(Date.now());
  const seenTaskIdsRef = useRef<Set<string>>(new Set(tasks.map((task) => task.id)));
  const canvasPreparedTaskIdsRef = useRef<Set<string>>(new Set());
  const canvasRevealedTaskIdsRef = useRef<Set<string>>(new Set());
  const completedNodeAnimationKeysRef = useRef<Set<string>>(new Set());
  const canvasPreparationDurationsRef = useRef<Map<string, number>>(new Map());
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [sessionIntroducedTaskIds, setSessionIntroducedTaskIds] = useState<Set<string>>(new Set());
  const [canvasPreparationPhase, setCanvasPreparationPhase] = useState<CanvasPreparationState | null>(null);
  const conversationId = tasks[0]?.conversationId;
  const referenceImagesSpec = getAttachmentSpec("img", "referenceImages");
  const referenceImageMaxCount = referenceImagesSpec?.maxCount ?? 6;
  const latestVibeCanvasTask = [...tasks].reverse().find(isVibeCanvasTask);
  const vibeWorkspaceTask = latestVibeCanvasTask && shouldRenderVibeWorkspaceForLatestTask(latestTask, latestVibeCanvasTask)
    ? mergeVibeWorkspaceTask(latestVibeCanvasTask, latestTask)
    : undefined;
  const activeCanvasTask = vibeWorkspaceTask ?? latestTask;
  const scrollToBottom = useCallback(() => {
    const bottom = bottomRef.current;
    bottom?.scrollIntoView({ behavior: "auto", block: "end" });
    const scrollContainer = findVerticalScrollContainer(bottom);
    if (scrollContainer) {
      scrollContainer.scrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    }
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [conversationId, latestTask.id, latestTask.events.length, scrollToBottom]);

  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      scrollToBottom();
    });
    observer.observe(layout);
    return () => observer.disconnect();
  }, [conversationId, scrollToBottom]);

  useEffect(() => {
    setReferenceImages([]);
  }, [conversationId]);

  useEffect(() => {
    if (seenTaskIdsRef.current.has(latestTask.id)) return;
    seenTaskIdsRef.current.add(latestTask.id);
    setSessionIntroducedTaskIds((current) => {
      if (current.has(latestTask.id)) return current;
      const next = new Set(current);
      next.add(latestTask.id);
      return next;
    });
  }, [latestTask.id]);

  const isCanvasPreparing = isPptCanvasPreparationTask(activeCanvasTask);
  const allowCanvasPreparationForLatestTask = shouldAllowCanvasPreparationForTask(
    activeCanvasTask,
    appSessionStartedAtRef.current,
    sessionIntroducedTaskIds.has(activeCanvasTask.id),
  );
  const canvasPreparationKey = activeCanvasTask.conversationId || activeCanvasTask.id;

  useEffect(() => {
    if (allowCanvasPreparationForLatestTask && isCanvasPreparing && !canvasRevealedTaskIdsRef.current.has(canvasPreparationKey)) {
      canvasPreparedTaskIdsRef.current.add(canvasPreparationKey);
      setCanvasPreparationPhase(null);
    }
  }, [allowCanvasPreparationForLatestTask, canvasPreparationKey, isCanvasPreparing]);

  function addReferenceImage(path: string) {
    setReferenceImages((current) => mergeUniquePaths(current, [path], referenceImageMaxCount));
  }

  function canvasPreparationDurationForTask(taskId: string) {
    const existing = canvasPreparationDurationsRef.current.get(taskId);
    if (existing) return existing;
    const durationMs = randomCanvasPreparationDurationMs();
    canvasPreparationDurationsRef.current.set(taskId, durationMs);
    return durationMs;
  }

  const isActive = ["running", "starting", "question", "plan_review"].includes(latestTask.status);
  const isCanvasActive = ["running", "starting", "question", "plan_review"].includes(activeCanvasTask.status);
  const isVibeFocus = Boolean(activeCanvasTask.vibeTree && isVibeCanvasTask(activeCanvasTask) && (isCanvasActive || activeCanvasTask.status === "completed"));
  const allowNodeAnimationForLatestSnapshot = isVibeFocus && (
    shouldAllowVibeNodeAnimationForTask(activeCanvasTask, appSessionStartedAtRef.current)
    || canvasPreparedTaskIdsRef.current.has(canvasPreparationKey)
    || (allowCanvasPreparationForLatestTask && isInitialPptVibeCanvasTask(activeCanvasTask))
  );
  const shouldAnimateCanvasPreparation = isVibeFocus && allowCanvasPreparationForLatestTask && !canvasRevealedTaskIdsRef.current.has(canvasPreparationKey) && (
    canvasPreparedTaskIdsRef.current.has(canvasPreparationKey)
    || isInitialPptVibeCanvasTask(activeCanvasTask)
  );
  const resolvedCanvasPhase: CanvasPreparationPhase | null = isVibeFocus
    ? (canvasPreparationPhase?.taskId === canvasPreparationKey ? canvasPreparationPhase.phase : (shouldAnimateCanvasPreparation ? "expanding" : "ready"))
    : null;
  const canvasPreparationDurationMs = isVibeFocus && shouldAnimateCanvasPreparation
    ? canvasPreparationDurationForTask(canvasPreparationKey)
    : (canvasPreparationPhase?.taskId === canvasPreparationKey ? canvasPreparationPhase.durationMs : CANVAS_PREPARATION_MIN_MS);

  useEffect(() => {
    if (!isVibeFocus || !activeCanvasTask.vibeTree) return;
    const durationMs = canvasPreparationDurationForTask(canvasPreparationKey);
    if (!shouldAnimateCanvasPreparation) {
      canvasRevealedTaskIdsRef.current.add(canvasPreparationKey);
      setCanvasPreparationPhase((current) => current?.taskId === canvasPreparationKey && current.phase === "ready"
        ? current
        : { taskId: canvasPreparationKey, phase: "ready", durationMs });
      return;
    }
    setCanvasPreparationPhase((current) => current?.taskId === canvasPreparationKey
      ? current
      : { taskId: canvasPreparationKey, phase: "expanding", durationMs });
    const timeout = window.setTimeout(() => {
      canvasRevealedTaskIdsRef.current.add(canvasPreparationKey);
      setCanvasPreparationPhase({ taskId: canvasPreparationKey, phase: "ready", durationMs });
    }, durationMs);
    return () => window.clearTimeout(timeout);
  }, [canvasPreparationKey, isVibeFocus, activeCanvasTask.vibeTree, shouldAnimateCanvasPreparation]);

  if (isVibeFocus && activeCanvasTask.vibeTree) {
    return (
      <div
        className={`conversation-layout is-vibe-canvas-focus is-canvas-${resolvedCanvasPhase ?? "ready"}`}
        data-canvas-phase={resolvedCanvasPhase ?? "ready"}
        ref={layoutRef}
      >
        <LivingTreeCockpit
          task={activeCanvasTask}
          snapshot={activeCanvasTask.vibeTree}
          onPreview={onPreview}
          onForceCancel={onForceCancel}
          onContinueModify={onContinueModify}
          canvasReveal={resolvedCanvasPhase === "expanding" ? "pending" : "ready"}
          allowCurrentSnapshotNodeAnimation={allowNodeAnimationForLatestSnapshot}
          completedNodeAnimationKeys={completedNodeAnimationKeysRef.current}
        />
        {resolvedCanvasPhase === "expanding" ? <CanvasPreparationTransition durationMs={canvasPreparationDurationMs} /> : null}
      </div>
    );
  }

  return (
    <div className="conversation-layout" ref={layoutRef}>
      <div className="chat-thread">
        {tasks.map((task) => {
          const isLatest = task.id === latestTask.id;
          // Past rounds: always show as completed/failed/cancelled
          if (!isLatest || !isActive) {
            return <ConversationRound key={task.id} task={task} onPreview={onPreview} onOpenLogin={onOpenLogin} onUseAsReference={addReferenceImage} onRetryTask={onRetryTask} />;
          }
          // Latest + active: show as active round
          return <ActiveTaskRound key={task.id} task={task} onForceCancel={onForceCancel} allowCanvasPreparation={allowCanvasPreparationForLatestTask} />;
        })}
        <div ref={bottomRef} />
      </div>
      <div className="conversation-footer">
        <ConversationFooter
          latestTask={latestTask}
          onContinueGeneration={onContinueGeneration}
          onContinueModify={onContinueModify}
          onForceCancel={onForceCancel}
          referenceImages={referenceImages}
          onReferenceImagesChange={setReferenceImages}
        />
      </div>
    </div>
  );
}

/* ─── Conversation Round (completed / failed / cancelled) ─── */

function ConversationRound({ task, onPreview, onOpenLogin, onUseAsReference, onRetryTask }: {
  task: DesktopTask;
  onPreview: (artifact: Artifact) => void;
  onOpenLogin: () => void;
  onUseAsReference: (path: string) => void;
  onRetryTask?: (task: DesktopTask) => void;
}) {
  const t = useT();
  const subject = taskSubject(task, t);
  const timeMarker = formatLocalTimestamp(task.events[0]?.ts) || t("dialogue.history.generationHistory");

  return (
    <>
      <div className="time-marker">{timeMarker}</div>
      <UserMessage task={task} fallback={subject} />
      <TaskResultMessage task={task} onPreview={onPreview} onOpenLogin={onOpenLogin} onUseAsReference={onUseAsReference} onRetryTask={onRetryTask} />
    </>
  );
}

/* ─── Active Task Round (running / starting / question) ─── */

function ActiveTaskRound({ task, onForceCancel, allowCanvasPreparation }: {
  task: DesktopTask;
  onForceCancel?: (taskId: string) => void;
  allowCanvasPreparation?: boolean;
}) {
  const t = useT();
  const capability = useReportCapability();
  const [reportOpen, setReportOpen] = useState(false);
  const [stalledRequestId, setStalledRequestId] = useState<string | null>(null);
  const subject = taskSubject(task, t);
  const documentType = task.documentType || task.artifact?.documentType || t("dialogue.history.targetTypeDefault");
  const isRunning = task.status === "running" || task.status === "starting";
  const isQuestion = task.status === "question";
  const timeMarker = formatLocalTimestamp(task.events[0]?.ts) || (isRunning ? t("dialogue.history.taskInProgress") : t("dialogue.history.generationHistory"));

  useEffect(() => {
    if (capability?.enabled || !task.stalledSince) return;
    let cancelled = false;
    officecli.peekReportContext(task.id).then((ctx) => {
      if (!cancelled) setStalledRequestId(ctx.requestId || null);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [task.id, task.stalledSince, capability?.enabled]);

  const latestEvent = task.events.at(-1);
  const latestText = task.status === "question" ? "" : eventText(latestEvent);

  return (
    <>
      <div className="time-marker">{timeMarker}</div>
      <UserMessage task={task} fallback={subject} />
      {task.vibeTree ? <LivingTreeCockpit task={task} snapshot={task.vibeTree} /> : null}
      {isRunning ? (
        <GenerationLoadingMessage task={task} allowCanvasPreparation={allowCanvasPreparation} />
      ) : isQuestion ? null : (
        <>
          <div className="message ai-message">
            <div className="message-author">
              <MaterialSymbol name="smart_toy" />
              <strong>{t("dialogue.history.author")}</strong>
            </div>
            <ul className="ai-checks">
              <li>
                <CheckCircleFilled /> {t("dialogue.history.taskReceived", { subject })}
              </li>
              <li>
                <CheckCircleFilled /> {t("dialogue.history.targetType", { type: documentType.toUpperCase() })}
              </li>
              <li className={task.status === "question" || task.status === "plan_review" ? "active" : ""}>
                <CheckCircleFilled />{" "}
                {latestText ? <span>{latestText}</span> : t("dialogue.history.waitingEvents")}
              </li>
              <li className="muted">{t("dialogue.history.taskId", { id: task.id })}</li>
            </ul>
          </div>
          {task.status === "plan_review" && task.plan ? <PlanReviewMessage task={task} /> : null}
          {task.status === "plan_review" ? null : <TaskRuntimePanel task={task} />}
          {task.status === "plan_review" ? null : <FluidProgressPanel task={task} />}
        </>
      )}
      {task.stalledSince ? (
        <div className="message ai-message stalled-hint" style={{ borderLeft: "3px solid #fa8c16" }}>
          <div className="message-author">
            <WarningFilled style={{ color: "#fa8c16" }} />
            <strong>{t("dialogue.stalled.title")}</strong>
          </div>
          <p>{t("dialogue.stalled.hint")}</p>
          {capability?.enabled ? (
            <Button size="small" onClick={() => setReportOpen(true)}>
              {t("dialogue.stalled.reportIssue")}
            </Button>
          ) : stalledRequestId ? (
            <Button size="small" icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(stalledRequestId).then(() => { void message.success(t("report.toast.copiedRequestId")); }); }}>
              {t("dialogue.stalled.copyRequestId")}
            </Button>
          ) : (
            <Tooltip title={t("dialogue.terminal.noRequestId")}>
              <Button size="small" disabled>
                {t("dialogue.stalled.copyRequestId")}
              </Button>
            </Tooltip>
          )}
        </div>
      ) : null}
      <ReportIssueDialog open={reportOpen} taskId={task.id} onClose={() => setReportOpen(false)} />
    </>
  );
}

const vibeNodeTypes = {
  vibeNode: VibeTreeFlowNode,
  vibeLane: VibeTreeLaneNode,
};

const VIBE_NODE_VERTICAL_GAP = 34;
const VIBE_LANE_VERTICAL_PADDING = 10;
const VIBE_NODE_HEIGHTS: Record<VibeCanvasNodeKind, number> = {
  root: 116,
  branch: 126,
  slide_group: 124,
  outline: 258,
  generated_slide: 234,
  deck: 320,
};
const VIBE_NODE_WIDTH = 320;
const VIBE_NODE_WIDTHS: Record<VibeCanvasNodeKind, number> = {
  root: VIBE_NODE_WIDTH,
  branch: VIBE_NODE_WIDTH,
  slide_group: VIBE_NODE_WIDTH,
  outline: VIBE_NODE_WIDTH,
  generated_slide: 416,
  deck: 520,
};
const VIBE_NODE_COLUMN_SPACING = 504;
const VIBE_GENERATED_SLIDE_VERTICAL_GAP = 72;
const VIBE_TREE_CANVAS_CENTER_Y = 260;

export function LivingTreeCockpit({ task, snapshot, progressIndex, stageActionLabel, onStageAction, confirmableKinds, onPreview, onForceCancel, onContinueModify, canvasReveal, allowCurrentSnapshotNodeAnimation = true, completedNodeAnimationKeys }: {
  task: DesktopTask;
  snapshot: VibeTreeSnapshot;
  progressIndex?: number;
  stageActionLabel?: string;
  onStageAction?: () => void;
  confirmableKinds?: VibeCanvasNodeKind[];
  onPreview?: (artifact: Artifact) => void;
  onForceCancel?: (taskId: string) => void;
  onContinueModify?: (documentType: string, prompt: string) => void;
  canvasReveal?: "pending" | "ready";
  allowCurrentSnapshotNodeAnimation?: boolean;
  completedNodeAnimationKeys?: Set<string>;
}) {
  const t = useT();
  const [selectedNodeId, setSelectedNodeId] = useState<string>(() => snapshot.tree.rootId);
  const [popoverNodeId, setPopoverNodeId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [submittingAction, setSubmittingAction] = useState<string | null>(null);
  const [submittingRevision, setSubmittingRevision] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [confirmedNodeIds, setConfirmedNodeIds] = useState<Set<string>>(() => new Set());
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [ideaConfirmed, setIdeaConfirmed] = useState(() => snapshot.stage !== "story_ready");
  const [completedDrawingKey, setCompletedDrawingKey] = useState<string | null>(null);
  const [nodeDrawingStep, setNodeDrawingStep] = useState<{ key: string; index: number } | null>(null);
  const activeThinkingRef = useRef<Omit<VibeThinkingTransition, "phase"> | null>(null);
  const activePopoverAlignerRef = useRef<VoidFunction | null>(null);
  const ideaConfirmInFlightRef = useRef(false);
  const [optimisticThinking, setOptimisticThinking] = useState<Omit<VibeThinkingTransition, "phase"> | null>(null);
  const [dismissedThinking, setDismissedThinking] = useState<VibeThinkingTransition | null>(null);
  const guideStateRef = useRef<{ stage: VibeTreeSnapshot["stage"]; confirmableKindsKey: string } | null>(null);
  const activeSnapshot = useMemo(() => storyReadySnapshotForIdeaGate(snapshot, ideaConfirmed), [ideaConfirmed, snapshot]);
  const storyIdeaGateActive = snapshot.stage === "story_ready" && !ideaConfirmed;
  const actions = activeSnapshot.actions ?? [];
  const flowModel = useMemo(() => buildVibeFlowModel(activeSnapshot, t), [activeSnapshot, t]);
  const confirmableNodeIds = useMemo(
    () => currentStepConfirmableNodeIds(flowModel.nodes, activeSnapshot, confirmableKinds),
    [activeSnapshot, confirmableKinds, flowModel.nodes],
  );
  const sortedConfirmableNodeIds = useMemo(
    () => flowModel.nodes
      .filter((node) => confirmableNodeIds.has(node.id))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((node) => node.id),
    [confirmableNodeIds, flowModel.nodes],
  );
  const pendingNodeIds = useMemo(
    () => sortedConfirmableNodeIds.filter((id) => !confirmedNodeIds.has(id)),
    [confirmedNodeIds, sortedConfirmableNodeIds],
  );
  const artifact = task.artifact;
  const canCancelTask = ["running", "starting", "question", "plan_review"].includes(task.status);
  const confirmedCount = [...confirmableNodeIds].filter((id) => confirmedNodeIds.has(id)).length;
  const allCurrentNodesConfirmed = confirmableNodeIds.size === 0 || confirmedCount === confirmableNodeIds.size;
  const stageActionReady = (confirmableNodeIds.size > 0 && allCurrentNodesConfirmed) || (confirmableNodeIds.size === 0 && actions.length > 0);
  const visibleActions = storyIdeaGateActive ? [] : (onStageAction && stageActionLabel ? [{ id: "stage_action", label: stageActionLabel }] : actions);
  const popoverNode = popoverNodeId ? flowModel.nodeMap.get(popoverNodeId) : undefined;
  const upstreamCompletedKinds = useMemo(() => new Set(completedVibeKindsForStage(activeSnapshot.stage)), [activeSnapshot.stage]);
  const confirmableKindsKey = confirmableKinds?.join(",") ?? "";
  const snapshotGuideKey = useMemo(
    () => [
      activeSnapshot.stage,
      activeSnapshot.tree.id,
      activeSnapshot.tree.nodes.length,
      sortedConfirmableNodeIds.join(","),
      confirmableKindsKey,
    ].join(":"),
    [activeSnapshot.stage, activeSnapshot.tree.id, activeSnapshot.tree.nodes.length, confirmableKindsKey, sortedConfirmableNodeIds],
  );
  const activeProgressIndex = storyIdeaGateActive ? 0 : (progressIndex ?? vibeProgressIndex(activeSnapshot.stage));
  const motionPhase = useMotionPhase(`${activeSnapshot.tree.id}:${activeSnapshot.stage}:${flowModel.nodes.length}:${flowModel.edges.length}`);
  const canvasIsRevealed = canvasReveal !== "pending";
  const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const nodeDrawingKey = `${snapshotGuideKey}:${canvasIsRevealed ? "revealed" : "hidden"}`;
  const snapshotNodeAnimationConsumed = completedDrawingKey === nodeDrawingKey || completedNodeAnimationKeys?.has(nodeDrawingKey) === true;
  // At the rendering stage the slide nodes become "confirmable" again, which would otherwise
  // replay their per-slide draw on the canvas. The right-side deck draw-in now owns that
  // animation, so keep the canvas slides settled here.
  const shouldSkipNodeDrawingAnimation = prefersReducedMotion || !allowCurrentSnapshotNodeAnimation || snapshotNodeAnimationConsumed || activeSnapshot.stage === "rendering";
  const shouldHoldCurrentNodeReveal = Boolean(dismissedThinking && sortedConfirmableNodeIds.length > 0);
  const nodeDrawingSequenceActive = !shouldHoldCurrentNodeReveal && !shouldSkipNodeDrawingAnimation && canvasIsRevealed && sortedConfirmableNodeIds.length > 0;
  const activeDrawingIndex = nodeDrawingSequenceActive
    ? Math.min(nodeDrawingStep?.key === nodeDrawingKey ? nodeDrawingStep.index : 0, sortedConfirmableNodeIds.length - 1)
    : -1;
  const activeDrawingNodeId = nodeDrawingSequenceActive && activeDrawingIndex >= 0
    ? (sortedConfirmableNodeIds[activeDrawingIndex] ?? null)
    : null;
  const nodeDrawingIds = useMemo(() => {
    if (!nodeDrawingSequenceActive || !activeDrawingNodeId) {
      return new Set<string>();
    }
    return new Set([activeDrawingNodeId]);
  }, [activeDrawingNodeId, nodeDrawingSequenceActive]);
  const nodeWaitingIds = useMemo(() => {
    if (shouldHoldCurrentNodeReveal && sortedConfirmableNodeIds.length > 0) {
      return new Set(sortedConfirmableNodeIds);
    }
    if (!nodeDrawingSequenceActive || activeDrawingIndex < 0) return new Set<string>();
    return new Set(sortedConfirmableNodeIds.slice(activeDrawingIndex + 1));
  }, [activeDrawingIndex, nodeDrawingSequenceActive, shouldHoldCurrentNodeReveal, sortedConfirmableNodeIds]);
  const renderableFlowNodeIds = useMemo(
    () => new Set(flowModel.nodes
      .filter((node) => !nodeWaitingIds.has(node.data.treeNode.id))
      .map((node) => node.id)),
    [flowModel.nodes, nodeWaitingIds],
  );
  const nodeDrawingActive = nodeDrawingSequenceActive;
  const ideaIntroActive = storyIdeaGateActive && nodeDrawingIds.has(activeSnapshot.tree.rootId);
  const runningThinkingSourceIds = useMemo(() => {
    if (!["running", "starting"].includes(task.status)) return [];
    if (storyIdeaGateActive || confirmableNodeIds.size === 0 || !allCurrentNodesConfirmed) return [];
    if (!thinkingTargetKindForStage(activeSnapshot.stage)) return [];
    return flowModel.nodes
      .filter((node) => confirmableNodeIds.has(node.id))
      .sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x)
      .map((node) => node.id);
  }, [activeSnapshot.stage, allCurrentNodesConfirmed, confirmableNodeIds, flowModel.nodes, storyIdeaGateActive, task.status]);
  const runningThinkingTargetKind = thinkingTargetKindForStage(activeSnapshot.stage);
  const runningThinking = !optimisticThinking && runningThinkingSourceIds.length > 0 && runningThinkingTargetKind
    ? {
        key: `${activeSnapshot.tree.id}:${activeSnapshot.stage}:${runningThinkingTargetKind}:${runningThinkingSourceIds.join(",")}`,
        stage: activeSnapshot.stage,
        treeId: activeSnapshot.tree.id,
        sourceNodeIds: runningThinkingSourceIds,
        targetKind: runningThinkingTargetKind,
      }
    : null;
  const activeThinking = optimisticThinking ?? runningThinking;
  const activeThinkingKey = activeThinking?.key ?? null;
  const activeThinkingElements = useMemo(
    () => activeThinking
      ? buildVibeThinkingTransitionElements(flowModel, activeThinking.stage, activeThinking.sourceNodeIds, activeThinking.targetKind, "active")
      : { nodes: [], edges: [] },
    [activeThinking, flowModel],
  );
  const dismissedThinkingElements = useMemo(
    () => dismissedThinking
      ? buildVibeThinkingTransitionElements(flowModel, dismissedThinking.stage, dismissedThinking.sourceNodeIds, dismissedThinking.targetKind, dismissedThinking.phase)
      : { nodes: [], edges: [] },
    [dismissedThinking, flowModel],
  );
  const thinkingFocusNodeId = activeThinkingElements.nodes[0]?.id ?? dismissedThinkingElements.nodes[0]?.id ?? null;
  const cameraFocusNodeId = thinkingFocusNodeId ?? activeDrawingNodeId ?? focusedNodeId;
  const handlePopoverAlignerChange = useCallback((aligner: VoidFunction | null) => {
    activePopoverAlignerRef.current = aligner;
  }, []);

  useEffect(() => {
    setIdeaConfirmed(snapshot.stage !== "story_ready");
    setSubmittingAction(null);
  }, [snapshot.stage, snapshot.tree.id]);

  useEffect(() => {
    if (!optimisticThinking) return;
    const targetReady = flowModel.nodes.some((node) => {
      const parentId = node.data.treeNode.parentId;
      return node.data.kind === optimisticThinking.targetKind
        && typeof parentId === "string"
        && optimisticThinking.sourceNodeIds.includes(parentId);
    });
    if (activeSnapshot.stage !== optimisticThinking.stage || activeSnapshot.tree.id !== optimisticThinking.treeId || targetReady) {
      setOptimisticThinking(null);
    }
  }, [activeSnapshot.stage, activeSnapshot.tree.id, flowModel.nodes, optimisticThinking]);

  useEffect(() => {
    if (activeThinking) {
      activeThinkingRef.current = {
        key: activeThinking.key,
        stage: activeThinking.stage,
        treeId: activeThinking.treeId,
        sourceNodeIds: activeThinking.sourceNodeIds,
        targetKind: activeThinking.targetKind,
      };
      setDismissedThinking(null);
      return;
    }
    const previous = activeThinkingRef.current;
    if (!previous) {
      setDismissedThinking(null);
      return;
    }
    activeThinkingRef.current = null;
    if (previous.stage === activeSnapshot.stage && previous.key.startsWith(`${activeSnapshot.tree.id}:`)) return;
    const transitionKey = `${previous.key}:${activeSnapshot.tree.id}:${activeSnapshot.stage}`;
    setDismissedThinking({
      key: transitionKey,
      stage: previous.stage,
      treeId: previous.treeId,
      sourceNodeIds: previous.sourceNodeIds,
      targetKind: previous.targetKind,
      phase: "done",
    });
    const fadeTimer = window.setTimeout(() => {
      setDismissedThinking((current) => current?.key === transitionKey ? { ...current, phase: "fading" } : current);
    }, VIBE_THINKING_DONE_MS);
    const clearTimer = window.setTimeout(() => {
      setDismissedThinking((current) => current?.key === transitionKey ? null : current);
    }, VIBE_THINKING_DONE_MS + VIBE_THINKING_FADE_MS);
    return () => {
      window.clearTimeout(fadeTimer);
      window.clearTimeout(clearTimer);
    };
  }, [activeSnapshot.stage, activeSnapshot.tree.id, activeThinking, activeThinkingKey]);

  useEffect(() => {
    if (!canvasIsRevealed || sortedConfirmableNodeIds.length === 0) {
      setCompletedDrawingKey(null);
      setNodeDrawingStep(null);
      return;
    }
    if (shouldSkipNodeDrawingAnimation) {
      completedNodeAnimationKeys?.add(nodeDrawingKey);
      setCompletedDrawingKey(nodeDrawingKey);
      setNodeDrawingStep(null);
      return;
    }
    if (completedDrawingKey === nodeDrawingKey) return;
    setNodeDrawingStep((current) => current?.key === nodeDrawingKey ? current : { key: nodeDrawingKey, index: 0 });
  }, [canvasIsRevealed, completedDrawingKey, completedNodeAnimationKeys, nodeDrawingKey, shouldSkipNodeDrawingAnimation, sortedConfirmableNodeIds.length]);

  useEffect(() => {
    if (!nodeDrawingSequenceActive || sortedConfirmableNodeIds.length === 0) return;
    const currentIndex = Math.min(nodeDrawingStep?.key === nodeDrawingKey ? nodeDrawingStep.index : 0, sortedConfirmableNodeIds.length - 1);
    const currentNodeId = sortedConfirmableNodeIds[currentIndex];
    const currentFlowNode = flowModel.nodes.find((node) => node.id === currentNodeId);
    const drawingDurationMs = currentFlowNode
      ? vibeNodeDrawingDurationMs(currentFlowNode.data.label, currentFlowNode.data.treeNode)
      : VIBE_NODE_DRAWING_MS;
    const timeout = window.setTimeout(() => {
      if (currentIndex >= sortedConfirmableNodeIds.length - 1) {
        completedNodeAnimationKeys?.add(nodeDrawingKey);
        setCompletedDrawingKey(nodeDrawingKey);
        return;
      }
      setNodeDrawingStep({ key: nodeDrawingKey, index: currentIndex + 1 });
    }, drawingDurationMs);
    return () => window.clearTimeout(timeout);
  }, [completedNodeAnimationKeys, flowModel.nodes, nodeDrawingKey, nodeDrawingSequenceActive, nodeDrawingStep, sortedConfirmableNodeIds]);

  useEffect(() => {
    if (!flowModel.nodeMap.has(selectedNodeId)) {
      setSelectedNodeId(activeSnapshot.tree.rootId);
      setPopoverNodeId(null);
      setFocusedNodeId(activeSnapshot.tree.rootId);
    }
  }, [activeSnapshot.tree.rootId, flowModel.nodeMap, selectedNodeId]);

  useEffect(() => {
    setFeedback(popoverNode ? vibeNodeEditableText(popoverNode) : "");
    setNeedsConfirm(false);
  }, [popoverNode?.id, popoverNode?.outline, popoverNode?.summary, popoverNode?.title]);

  useEffect(() => {
    if (canvasIsRevealed) return;
    setPopoverNodeId(null);
    setFocusedNodeId(null);
  }, [canvasIsRevealed]);

  useEffect(() => {
    if (!ideaIntroActive) return;
    setPopoverNodeId(null);
    setFocusedNodeId(activeSnapshot.tree.rootId);
  }, [activeSnapshot.tree.rootId, ideaIntroActive]);

  useEffect(() => {
    if (!canvasIsRevealed) return;
    if (nodeDrawingActive) return;
    const previousGuideState = guideStateRef.current;
    // Terminal stage: the finished deck is the deliverable, not a node to confirm. Auto-confirm the
    // confirmable node(s) so the task card reads as closed ("Deck 已确认 1/1"), keep the deck selected
    // so the task card owns it, but never auto-open the confirm popover.
    if (activeSnapshot.stage === "completed") {
      setConfirmedNodeIds(new Set(sortedConfirmableNodeIds));
      const deckNodeId = sortedConfirmableNodeIds[0] ?? activeSnapshot.tree.rootId;
      const firstSlide = flowModel.nodes.find((n) => n.data.kind === "generated_slide");
      setPopoverNodeId(null);
      setSelectedNodeId(deckNodeId);
      setFocusedNodeId(firstSlide?.id ?? deckNodeId);
      guideStateRef.current = { stage: activeSnapshot.stage, confirmableKindsKey };
      return;
    }
    const shouldResetConfirmedNodes = !previousGuideState
      || previousGuideState.stage !== activeSnapshot.stage
      || previousGuideState.confirmableKindsKey !== confirmableKindsKey;
    const nextConfirmedNodeIds = shouldResetConfirmedNodes
      ? new Set<string>()
      : new Set([...confirmedNodeIds].filter((id) => confirmableNodeIds.has(id)));
    setConfirmedNodeIds(nextConfirmedNodeIds);
    const firstPendingNodeId = sortedConfirmableNodeIds.find((id) => !nextConfirmedNodeIds.has(id)) ?? null;
    setPopoverNodeId(firstPendingNodeId);
    if (firstPendingNodeId || sortedConfirmableNodeIds.length > 0) {
      setSelectedNodeId(firstPendingNodeId ?? activeSnapshot.tree.rootId);
      setFocusedNodeId(firstPendingNodeId ?? activeSnapshot.tree.rootId);
    } else {
      const firstSlideNode = flowModel.nodes.find((n) => n.data.kind === "generated_slide");
      if (firstSlideNode) {
        setSelectedNodeId(firstSlideNode.id);
        setFocusedNodeId(firstSlideNode.id);
      }
    }
    guideStateRef.current = { stage: activeSnapshot.stage, confirmableKindsKey };
  }, [activeSnapshot.stage, activeSnapshot.tree.rootId, canvasIsRevealed, confirmableKindsKey, confirmableNodeIds, nodeDrawingActive, snapshotGuideKey, sortedConfirmableNodeIds]);

  function startThinkingTransition(sourceNodeIds: string[], targetKind: VibeCanvasNodeKind) {
    if (sourceNodeIds.length === 0) return;
    setOptimisticThinking({
      key: `${activeSnapshot.tree.id}:${activeSnapshot.stage}:${targetKind}:${sourceNodeIds.join(",")}`,
      stage: activeSnapshot.stage,
      treeId: activeSnapshot.tree.id,
      sourceNodeIds,
      targetKind,
    });
    setDismissedThinking(null);
  }

  async function submitAction(actionId: string) {
    if (!actionId || submittingAction) return;
    if (!allCurrentNodesConfirmed) return;
    if (onStageAction && actionId === "stage_action") {
      setSubmittingAction(actionId);
      setPopoverNodeId(null);
      onStageAction();
      return;
    }
    setSubmittingAction(actionId);
    const targetKind = thinkingTargetKindForStage(activeSnapshot.stage);
    if (targetKind) {
      startThinkingTransition(sortedConfirmableNodeIds, targetKind);
    }
    try {
      await officecli.respond({
        taskId: task.id,
        questionId: task.question?.id,
        optionId: actionId,
      });
    } catch (err) {
      setOptimisticThinking(null);
      setSubmittingAction(null);
      message.error(`Action failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function submitNodeRevisionForNode(node: VibeProjectTreeNode, descendantCount: number): Promise<boolean> {
    const answer = feedback.trim();
    if (!answer || submittingRevision) return false;
    if (descendantCount > 0 && !needsConfirm) {
      setNeedsConfirm(true);
      return false;
    }
    setSubmittingRevision(true);
    try {
      await officecli.respond({
        taskId: task.id,
        questionId: task.question?.id,
        answer: JSON.stringify({
          kind: "vibe_node_feedback",
          nodeId: node.id,
          feedback: answer,
        }),
      });
      setFeedback(vibeNodeEditableText(node));
      setNeedsConfirm(false);
      return true;
    } catch (err) {
      message.error(`Revision failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setSubmittingRevision(false);
    }
  }

  async function cancelTask() {
    if (cancelling) return;
    setCancelling(true);
    try {
      await officecli.cancel(task.id);
      onForceCancel?.(task.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") && onForceCancel) {
        onForceCancel(task.id);
      } else {
        message.error(`Cancel failed: ${msg}`);
      }
    } finally {
      setCancelling(false);
    }
  }

  async function confirmNode(nodeId: string) {
    if (storyIdeaGateActive && nodeId === activeSnapshot.tree.rootId) {
      // Guard against double-submit: the gate stays visually active until
      // setIdeaConfirmed(true) commits, so a quick second click would fire a
      // second respond() against a question the backend has already consumed.
      if (ideaConfirmInFlightRef.current) return;
      ideaConfirmInFlightRef.current = true;
      startThinkingTransition([nodeId], "branch");
      try {
        await officecli.respond({
          taskId: task.id,
          questionId: task.question?.id,
          answer: JSON.stringify({
            kind: "vibe_node_confirmed",
            nodeId,
          }),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // "no pending input" means the idea question was already answered (a
        // racing/duplicate confirm, or the backend already advanced past the
        // gate). The desired end state — idea confirmed — is already true, so
        // treat it as success instead of surfacing a scary error toast.
        if (!msg.includes("no pending input")) {
          setOptimisticThinking(null);
          message.error(`Confirm failed: ${msg}`);
          return;
        }
      } finally {
        ideaConfirmInFlightRef.current = false;
      }
      setIdeaConfirmed(true);
    }
    const nextPendingNodeId = pendingNodeIds.find((id) => id !== nodeId) ?? null;
    setConfirmedNodeIds((current) => {
      const next = new Set(current);
      next.add(nodeId);
      return next;
    });
    setFeedback("");
    setNeedsConfirm(false);
    if (nextPendingNodeId) {
      setSelectedNodeId(nextPendingNodeId);
      setPopoverNodeId(nextPendingNodeId);
      setFocusedNodeId(nextPendingNodeId);
      return;
    }
    setSelectedNodeId(nodeId);
    setPopoverNodeId(null);
    setFocusedNodeId(nodeId);
  }

  const pptistRef = useRef<PptistEmbedPanelHandle>(null);
  const pptistAnimationSessionKeysRef = useRef<Set<string>>(new Set());
  const [slideDataMap, setSlideDataMap] = useState<Map<string, PptistSlide>>(new Map());
  const [artifactSlidesByNodeId, setArtifactSlidesByNodeId] = useState<Map<string, PptistSlide>>(new Map());
  const [importedArtifactSlideCount, setImportedArtifactSlideCount] = useState(0);
  const [selectedPptistSlideId, setSelectedPptistSlideId] = useState<string | undefined>(undefined);
  const [pptistEditRunning, setPptistEditRunning] = useState(false);
  const [pptistEditStatus, setPptistEditStatus] = useState<string>("");
  const [pendingPptistEdit, setPendingPptistEdit] = useState<ModifyPptistDeckResult | null>(null);
  const [selectedPptistElements, setSelectedPptistElements] = useState<PptistElementSelection | null>(null);
  const [pptistAutosaveState, setPptistAutosaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "failed">("idle");
  const [pptistThumbnailCapturePaused, setPptistThumbnailCapturePaused] = useState(false);
  const handleSlideUpdated = useCallback((slideId: string, slide: PptistSlide) => {
    setSlideDataMap((prev) => {
      const next = new Map(prev);
      next.set(slideId, slide);
      return next;
    });
  }, []);
  const hasPptxFile = Boolean(task.artifact?.filePath);
  const hasVibeSlides = (task.vibeSlides ?? []).length > 0;
  const isPptxgenjsAssembling =
    activeSnapshot.stage === "completed"
    && !hasPptxFile
    && task.status === "running"
    && !hasVibeSlides;
  const awaitingGeneratedSlideApproval = activeSnapshot.stage === "slides_ready"
    && Boolean(activeSnapshot.confirmation?.nodeIds?.length)
    && actions.length > 0;
  const showPptistEmbed = !isPptxgenjsAssembling
    && !awaitingGeneratedSlideApproval
    && (activeSnapshot.stage === "slides_ready" || activeSnapshot.stage === "rendering" || activeSnapshot.stage === "completed");
  const completedReviewMode = activeSnapshot.stage === "completed" && showPptistEmbed;
  const [completedCanvasTreeOpen, setCompletedCanvasTreeOpen] = useState(false);
  const canvasTreeInteractionsEnabled = !completedReviewMode || completedCanvasTreeOpen;
  const canvasTreeMounted = !completedReviewMode || completedCanvasTreeOpen;
  const pptistAnimationKey = pptistAnimationPlayedStorageKey(task.parentTaskId || task.id);
  const shouldAnimatePptist = activeSnapshot.stage !== "completed" && (
    !readPptistAnimationPlayed(pptistAnimationKey) || pptistAnimationSessionKeysRef.current.has(pptistAnimationKey)
  );
  const markPptistAnimationStarted = useCallback(() => {
    pptistAnimationSessionKeysRef.current.add(pptistAnimationKey);
    savePptistAnimationPlayed(pptistAnimationKey);
  }, [pptistAnimationKey]);
  const taskCardStage = isPptxgenjsAssembling ? "rendering" : activeSnapshot.stage;
  const showTaskCardConfirmationProgress = !isPptxgenjsAssembling && confirmableNodeIds.size > 0;
  const pptistAllSlideNodes = useMemo(() => {
    if (!showPptistEmbed) return [];
    const byId = new Map<string, VibeProjectTreeNode>();
    for (const node of activeSnapshot.tree.nodes) {
      if (kindForVibeNode(node, activeSnapshot.stage) === "generated_slide") byId.set(node.id, node);
    }
    for (const node of flowModel.nodes) {
      if (node.data.kind === "generated_slide" && !byId.has(node.data.treeNode.id)) {
        byId.set(node.data.treeNode.id, node.data.treeNode);
      }
    }
    return [...byId.values()].sort(compareVibeNodes);
  }, [activeSnapshot.stage, activeSnapshot.tree.nodes, flowModel.nodes, showPptistEmbed]);
  // Backend streams complete per-slide PptistSlide data (charts/images inlined),
  // in tree-slide-node order. Re-key each to its node id so the canvas ↔ slide
  // mapping (reveal, gotoSlide, edit overlay) keeps working.
  const streamedSlidesByNodeId = useMemo(() => {
    const map = new Map<string, PptistSlide>();
    const slides = task.vibeSlides ?? [];
    pptistAllSlideNodes.forEach((node, i) => {
      const slide = slides[i];
      if (slide) map.set(node.id, { ...slide, id: `generated-${node.id}` });
    });
    return map;
  }, [pptistAllSlideNodes, task.vibeSlides]);
  const pptistSlideIds = useMemo(
    () => pptistAllSlideNodes.map((node) => `generated-${node.id}`),
    [pptistAllSlideNodes],
  );
  const handleSlidesLoaded = useCallback((slides: PptistSlide[]) => {
    setImportedArtifactSlideCount(slides.length);
    setArtifactSlidesByNodeId(() => {
      const next = new Map<string, PptistSlide>();
      pptistAllSlideNodes.forEach((node, i) => {
        const slide = slides[i];
        if (slide) next.set(node.id, { ...slide, id: `generated-${node.id}` });
      });
      return next;
    });
    if (!shouldAnimatePptist) {
      setSlidePushIndex(slides.length > 0 ? slides.length - 1 : -1);
      setTypedNodeIds(new Set(pptistAllSlideNodes.map((node) => node.id)));
    }
  }, [pptistAllSlideNodes, shouldAnimatePptist]);
  const handlePptistEditRequest = useCallback(async (prompt: string) => {
    const api = pptistRef.current;
    if (!api) return;
    setPendingPptistEdit(null);
    setPptistEditRunning(true);
    setPptistEditStatus(t("vibe.pptx.edit.preparing"));
    try {
      const snapshot = await api.getSnapshot();
      const targetSelection = selectedPptistElements;
      const selectedSlideId = targetSelection?.slideId || snapshot.selectedSlideId || selectedPptistSlideId;
      const selectedElementIds = targetSelection?.elementIds?.length ? targetSelection.elementIds : snapshot.selectedElementIds;
      const currentPptx = await api.exportPptxBytes(task.artifact?.fileName || "deck.pptx");
      const pptxDataBase64 = uint8ArrayToBase64(currentPptx.bytes);
      setPptistEditStatus(t("vibe.pptx.edit.thinking"));
      await Promise.resolve();
      const result = await officecli.modifyPptistDeck({
        prompt,
        snapshot,
        selectedSlideId,
        selectedElementIds,
        pptxDataBase64,
      });
      if (!result.ops.length) {
        throw new Error("No PPTist edit operations returned.");
      }
      const animatedResult = { ...result, ops: withPptistTypewriterAnimation(result.ops) };
      if (result.requiresConfirmation) {
        setPendingPptistEdit(animatedResult);
        setPptistEditStatus(result.summary || t("vibe.pptx.edit.confirmHint"));
        return;
      }
      setPptistEditStatus(result.summary || t("vibe.pptx.edit.applying"));
      await Promise.resolve();
      await api.applyEditOps(animatedResult.ops);
      setPptistEditStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPptistEditStatus(t("vibe.pptx.edit.failed"));
      message.error(msg);
    } finally {
      setPptistEditRunning(false);
    }
  }, [selectedPptistElements, selectedPptistSlideId, t, task.artifact?.fileName]);
  const handleConfirmPptistEdit = useCallback(async () => {
    const api = pptistRef.current;
    const edit = pendingPptistEdit;
    if (!api || !edit) return;
    setPptistEditRunning(true);
    setPptistEditStatus(edit.summary || t("vibe.pptx.edit.applying"));
    try {
      await api.applyEditOps(edit.ops);
      setPendingPptistEdit(null);
      setPptistEditStatus("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setPptistEditStatus(t("vibe.pptx.edit.failed"));
      message.error(msg);
    } finally {
      setPptistEditRunning(false);
    }
  }, [pendingPptistEdit, t]);
  const handleCancelPptistEdit = useCallback(() => {
    setPendingPptistEdit(null);
    setPptistEditStatus("");
  }, []);
  const handlePptistSelectionChanged = useCallback((selection: PptistElementSelection) => {
    if (!selection.elementIds.length) return;
    setSelectedPptistElements(selection);
  }, []);
  const handleOpenPptistSelection = useCallback((selection: PptistElementSelection) => {
    pptistRef.current?.selectElements(selection);
  }, []);
  const handleClearPptistSelectionReference = useCallback(() => {
    setSelectedPptistElements(null);
  }, []);
  // Canvas reveal is driven by PPTist's typing progress (pptist:slide-changed),
  // so a flow node lights up exactly as that page starts typing in the editor —
  // instead of a fixed timer racing ahead of the live typing animation.
  const [slidePushIndex, setSlidePushIndex] = useState(-1);
  // Node ids whose page PPTist has FINISHED typing. The left canvas shows a page's
  // full content only once it's here — until then it renders a background-only
  // skeleton, so the live typing on the right always stays ahead of the left.
  const [typedNodeIds, setTypedNodeIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!completedReviewMode) {
      setCompletedCanvasTreeOpen(false);
      return;
    }
    if (!completedCanvasTreeOpen) setPopoverNodeId(null);
  }, [completedCanvasTreeOpen, completedReviewMode]);
  useEffect(() => {
    if (!showPptistEmbed) {
      setSlidePushIndex(-1);
      setTypedNodeIds(new Set());
      setImportedArtifactSlideCount(0);
    }
  }, [showPptistEmbed]);
  useEffect(() => {
    if (!showPptistEmbed || shouldAnimatePptist || hasPptxFile || pptistAllSlideNodes.length === 0) return;
    setSlidePushIndex(pptistAllSlideNodes.length - 1);
    setTypedNodeIds(new Set(pptistAllSlideNodes.map((node) => node.id)));
  }, [hasPptxFile, pptistAllSlideNodes, shouldAnimatePptist, showPptistEmbed]);
  // All available slides are handed to PPTist at once; PPTist owns the page-by-page
  // typing pace (one page typed in before the next). User edits override streamed data.
  const pptistSlides = useMemo(
    () => pptistAllSlideNodes
      .map((n) => {
        if (hasPptxFile) return undefined;
        return slideDataMap.get(`generated-${n.id}`) ?? streamedSlidesByNodeId.get(n.id) ?? vibeNodeToSlide(n);
      })
      .filter((s): s is PptistSlide => Boolean(s)),
    [hasPptxFile, pptistAllSlideNodes, slideDataMap, streamedSlidesByNodeId],
  );
  const totalGeneratedPages = pptistAllSlideNodes.length || pptistSlides.length;
  const importedArtifactReady = hasPptxFile && importedArtifactSlideCount > 0;
  const generatedPageCount = importedArtifactReady
    ? Math.max(totalGeneratedPages, importedArtifactSlideCount)
    : totalGeneratedPages > 0 ? Math.min(typedNodeIds.size, totalGeneratedPages) : typedNodeIds.size;
  const allPagesGenerated = importedArtifactReady || (totalGeneratedPages > 0 && generatedPageCount >= totalGeneratedPages);
  const baseFlowNodes = canvasTreeMounted ? flowModel.nodes.filter((node) => renderableFlowNodeIds.has(node.id)).map((node) => {
    const treeNode = node.data.treeNode;
    const nodeIsConfirmable = confirmableNodeIds.has(treeNode.id);
    const confirmationTargetNode = nodeIsConfirmable
      ? treeNode
      : nearestConfirmableAncestor(flowModel.nodeMap, treeNode, confirmableNodeIds);
    const descendantCount = descendantNodes(flowModel.nodeMap, treeNode.id).length;
    const nodeIsDrawing = nodeDrawingIds.has(treeNode.id);
    const nodeIsWaiting = nodeWaitingIds.has(treeNode.id);
    const nodeIsConfirmed = confirmedNodeIds.has(treeNode.id) || (!nodeIsConfirmable && upstreamCompletedKinds.has(node.data.kind as VibeCanvasNodeKind));
    const nodeIsPopoverOpen = canvasTreeInteractionsEnabled && popoverNodeId === treeNode.id && !nodeDrawingActive && !nodeIsDrawing && !nodeIsWaiting && !confirmedNodeIds.has(treeNode.id);
    const slidePushState = (() => {
      if (!showPptistEmbed || slidePushIndex < 0) return undefined;
      const outlineIndex = pptistAllSlideNodes.findIndex((n) =>
        n.parentId === treeNode.id || n.id === `generated-${treeNode.id}` || n.id === treeNode.id
      );
      if (outlineIndex < 0) return undefined;
      if (outlineIndex < slidePushIndex) return "pushed" as const;
      if (outlineIndex === slidePushIndex) return "pushing" as const;
      return "waiting" as const;
    })();

    return {
      ...node,
      selected: node.id === selectedNodeId,
      data: {
        ...node.data,
        assembling: activeSnapshot.stage === "rendering" && (node.data.kind === "generated_slide" || node.data.kind === "deck"),
        ideaDrawing: ideaIntroActive && treeNode.id === activeSnapshot.tree.rootId,
        nodeDrawing: nodeIsDrawing,
        nodeWaiting: nodeIsWaiting,
        confirmed: nodeIsConfirmed,
        confirmable: nodeIsConfirmable,
        slidePushState,
        slideData: node.data.kind === "generated_slide"
          ? (() => {
              const edited = slideDataMap.get(`generated-${treeNode.id}`);
              if (edited) return edited;
              const artifactSlide = artifactSlidesByNodeId.get(treeNode.id);
              const streamed = streamedSlidesByNodeId.get(treeNode.id);
              if (artifactSlide?.elements?.length) {
                return typedNodeIds.has(treeNode.id) ? artifactSlide : { ...artifactSlide, elements: [] };
              }
              if (hasPptxFile && streamed) return typedNodeIds.has(treeNode.id) ? streamed : { ...streamed, elements: [] };
              if (hasPptxFile) return { id: `generated-${treeNode.id}`, elements: [] };
              if (!streamed) return vibeNodeToSlide(treeNode);
              // Reveal full content only after PPTist finishes typing this page;
              // otherwise show a background-only skeleton (no spoiler).
              if (typedNodeIds.has(treeNode.id)) return streamed;
              return { ...streamed, elements: [] };
            })()
          : undefined,
        completedArtifact: node.data.kind === "deck" && task.status === "completed" && artifact && !showPptistEmbed
          ? artifact
          : undefined,
        completedArtifactTitle: node.data.kind === "deck" && task.status === "completed" && artifact && !showPptistEmbed
          ? (activeSnapshot.tree.title || artifact.fileName)
          : undefined,
        onPreviewArtifact: onPreview,
        popoverOpen: nodeIsPopoverOpen,
        onPopoverAlignerChange: handlePopoverAlignerChange,
        popoverContent: nodeIsPopoverOpen ? (
          <VibeNodePopoverContent
            node={treeNode}
            kind={node.data.kind as VibeCanvasNodeKind}
            confirmationTarget={confirmationTargetNode}
            confirmationTargetKind={confirmationTargetNode ? kindForVibeNode(confirmationTargetNode, activeSnapshot.stage) : undefined}
            confirmationTargetConfirmed={confirmationTargetNode ? confirmedNodeIds.has(confirmationTargetNode.id) : false}
            feedback={nodeIsPopoverOpen ? feedback : ""}
            needsConfirm={nodeIsPopoverOpen ? needsConfirm : false}
            submittingRevision={nodeIsPopoverOpen && submittingRevision}
            descendantCount={descendantCount}
            onConfirm={confirmNode}
            onFeedbackChange={(value) => {
              setFeedback(value);
              setNeedsConfirm(false);
            }}
            onSubmitRevision={() => submitNodeRevisionForNode(treeNode, descendantCount)}
          />
        ) : null,
      },
    };
  }) : [];
  const filteredFlowNodes = showPptistEmbed
    ? baseFlowNodes.filter((node) => node.data.kind !== "deck")
    : baseFlowNodes;
  const filteredNodeIds = showPptistEmbed ? new Set(filteredFlowNodes.map((n) => n.id)) : renderableFlowNodeIds;
  const waitingNodeIds = showPptistEmbed
    ? new Set(filteredFlowNodes.filter((n) => n.data.slidePushState === "waiting").map((n) => n.id))
    : new Set<string>();
  const flowNodes = [...filteredFlowNodes, ...activeThinkingElements.nodes, ...dismissedThinkingElements.nodes];
  const flowEdges = [
    ...flowModel.edges.filter((edge) =>
      filteredNodeIds.has(edge.source) && filteredNodeIds.has(edge.target) &&
      !waitingNodeIds.has(edge.source) && !waitingNodeIds.has(edge.target)
    ),
    ...activeThinkingElements.edges,
    ...dismissedThinkingElements.edges,
  ];
  const artifactFileName = artifact?.fileName || artifact?.filePath || "deck.pptx";
  const pptistActionBusy = pptistEditRunning || Boolean(pendingPptistEdit);
  const exportDisabled = !allPagesGenerated || task.status !== "completed" || pptistActionBusy;
  const artifactActionDisabled = task.status !== "completed";
  const completedReviewToolbar = completedReviewMode && artifact ? (
    <div className="living-tree-pptx-toolbar is-focus-toolbar">
      <div className="living-tree-pptx-action-card">
        <FocusToolbarButton
          className="living-tree-pptx-file-anchor"
          icon={<FileTextOutlined />}
          label={`${t("dialogue.completed.open")} ${artifactFileName}`}
          disabled={artifactActionDisabled}
          onClick={() => officecli.openPath(artifact.filePath)}
        />
        <div className="living-tree-pptx-action-card-buttons">
          <FocusToolbarButton
            icon={<GlobalOutlined />}
            label={t("vibe.pptx.review.openCanvasTree")}
            onClick={() => setCompletedCanvasTreeOpen(true)}
          />
          <FocusToolbarButton
            icon={<DownloadOutlined />}
            label={t("vibe.pptx.export")}
            disabled={exportDisabled}
            onClick={() => pptistRef.current?.exportPptx(artifactFileName)}
          />
          <FocusToolbarButton
            icon={<FolderOpenOutlined />}
            label={t("dialogue.completed.showInFolder")}
            disabled={artifactActionDisabled}
            onClick={() => officecli.showItemInFolder(artifact.filePath)}
          />
          {supportsOfflinePreview(artifact) && onPreview ? (
            <FocusToolbarButton
              icon={<LinkOutlined />}
              label={t("dialogue.vibeTree.openPreview")}
              disabled={artifactActionDisabled}
              onClick={() => onPreview(artifact)}
            />
          ) : null}
        </div>
      </div>
    </div>
  ) : null;

  return (
    <div
      className="living-tree-cockpit"
      aria-label="Living Tree Cockpit"
      data-vibe-stage={snapshot.stage}
      data-vibe-active-index={activeProgressIndex}
      data-motion-phase={motionPhase}
      data-canvas-reveal={canvasReveal}
    >
      <div className="living-tree-header">
        <div>
          <span className="living-tree-eyebrow">Living Tree Cockpit</span>
          <strong>{snapshot.tree.title || "OfficeDex Project Map"}</strong>
        </div>
        {completedReviewToolbar ?? (canCancelTask ? (
          <Button
            danger
            size="small"
            icon={<StopOutlined />}
            aria-label={t("dialogue.running.cancel")}
            loading={cancelling}
            onClick={() => { void cancelTask(); }}
          >
            {t("dialogue.running.cancel")}
          </Button>
        ) : null)}
      </div>
      {snapshot.tree.direction ? <div className="living-tree-direction">{snapshot.tree.direction}</div> : null}
      <VibeProgressSteps
        stage={snapshot.stage}
        progressIndex={activeProgressIndex}
        motionPhase={motionPhase}
        autoOpenTaskCard={stageActionReady && !showPptistEmbed && !submittingAction}
        taskCard={task.status !== "completed" && !showPptistEmbed && !submittingAction ? (
          <section className="living-tree-task-card" aria-label={t("vibe.task.title")}>
            <div className="living-tree-task-card-head">
              <span>{t("vibe.task.title")}</span>
              <Tag color="processing">{vibeStageLabel(taskCardStage, t)}</Tag>
            </div>
            <strong>{currentTaskTitle(taskCardStage, storyIdeaGateActive, t)}</strong>
            <p>{currentTaskDescription(taskCardStage, confirmedCount, showTaskCardConfirmationProgress ? confirmableNodeIds.size : 0, storyIdeaGateActive, t)}</p>
            {showTaskCardConfirmationProgress ? (
              <div className="living-tree-task-progress">
                <span>{t("vibe.task.confirmed", { confirmed: confirmedCount, total: confirmableNodeIds.size })}</span>
                <div>
                  <i style={{ width: `${Math.round((confirmedCount / confirmableNodeIds.size) * 100)}%` }} />
                </div>
              </div>
            ) : null}
            {pendingNodeIds.length > 0 ? (
              <Button
                block
                icon={<CheckCircleOutlined />}
                onClick={() => {
                  if (storyIdeaGateActive) {
                    const rootId = activeSnapshot.tree.rootId;
                    void confirmNode(rootId);
                  }
                  setConfirmedNodeIds(new Set(sortedConfirmableNodeIds));
                  setPopoverNodeId(null);
                }}
              >
                {t("vibe.task.confirmAll", { count: pendingNodeIds.length })}
              </Button>
            ) : null}
            {visibleActions.map((action) => (
              <Button
                key={action.id}
                type="primary"
                className={stageActionReady ? "living-tree-stage-cta-ready" : undefined}
                icon={activeSnapshot.stage === "refined_ready" ? <PlayCircleOutlined /> : <SendOutlined />}
                aria-label={action.label}
                loading={submittingAction === action.id}
                disabled={!allCurrentNodesConfirmed}
                onClick={() => { void submitAction(action.id); }}
              >
                {action.label}
              </Button>
            ))}
          </section>
        ) : undefined}
      />
      <div className={`living-tree-workbench ${showPptistEmbed ? "has-pptist-embed" : ""} ${isPptxgenjsAssembling ? "has-assembling-panel" : ""} ${completedReviewMode ? "is-completed-review" : ""} ${completedCanvasTreeOpen ? "is-canvas-tree-open" : ""}`}>
        {canvasTreeMounted ? (
          <div
            className={`living-tree-flow-shell ${activeSnapshot.stage === "rendering" ? "is-deck-assembling" : ""} ${completedReviewMode ? "is-canvas-tree-drawer" : ""}`}
            data-testid="living-tree-flow"
            data-vibe-stage={activeSnapshot.stage}
            data-camera-focus-node-id={cameraFocusNodeId ?? undefined}
            aria-hidden={completedReviewMode ? !completedCanvasTreeOpen : undefined}
          >
            {completedReviewMode ? (
              <div className="living-tree-canvas-drawer-head">
                <strong>{t("vibe.pptx.review.canvasTree")}</strong>
                <Button
                  size="small"
                  icon={<CloseCircleOutlined />}
                  aria-label={t("vibe.pptx.review.closeCanvasTree")}
                  onClick={() => {
                    setCompletedCanvasTreeOpen(false);
                    setPopoverNodeId(null);
                  }}
                >
                  {t("vibe.pptx.review.closeCanvasTree")}
                </Button>
              </div>
            ) : null}
            <ReactFlowProvider>
              <ReactFlow
                key={`${activeSnapshot.stage}-${flowModel.nodes.length}-${flowModel.edges.length}-${showPptistEmbed}`}
                nodes={flowNodes}
                edges={flowEdges}
                nodeTypes={vibeNodeTypes}
                minZoom={0.22}
                maxZoom={1.12}
                fitView={!cameraFocusNodeId}
                fitViewOptions={{ padding: 0.16, minZoom: 0.22, maxZoom: 0.88 }}
                defaultViewport={vibeNodeDefaultViewport(cameraFocusNodeId, flowNodes)}
                nodesDraggable={false}
                nodesConnectable={false}
                elementsSelectable
                panOnScroll={showPptistEmbed}
                zoomOnScroll={!showPptistEmbed}
                onMove={() => activePopoverAlignerRef.current?.()}
                onNodeClick={(_, node) => {
                  if ((node.data as VibeCanvasData | undefined)?.kind === "thinking") return;
                  setSelectedNodeId(node.id);
                  if (!canvasTreeInteractionsEnabled) {
                    setPopoverNodeId(null);
                    return;
                  }
                  if (nodeDrawingActive) return;
                  if (nodeDrawingIds.has(node.id)) return;
                  if (nodeWaitingIds.has(node.id)) return;
                  const nodeKind = (node.data as VibeCanvasData | undefined)?.kind;
                  if (nodeKind !== "generated_slide") {
                    setPopoverNodeId(node.id);
                  }
                  if (showPptistEmbed && pptistRef.current) {
                    const slideIndex = pptistAllSlideNodes.findIndex((n) => n.id === node.id || n.parentId === node.id);
                    if (slideIndex >= 0) pptistRef.current.gotoSlide(slideIndex);
                  }
                }}
                onPaneClick={() => setPopoverNodeId(null)}
              >
                <VibeTreeViewportController focusedNodeId={cameraFocusNodeId} nodes={flowNodes} />
                <Background gap={28} size={1} color="rgba(86, 69, 212, 0.10)" />
                <Controls showInteractive={false} />
                {!showPptistEmbed && (
                  <MiniMap
                    pannable
                    zoomable
                    position="bottom-right"
                    ariaLabel="Living Tree minimap"
                    style={{ width: 192, height: 128 }}
                    bgColor="rgba(255, 255, 255, 0.96)"
                    nodeColor={(node) => vibeMiniMapNodeColor((node.data as VibeCanvasData | undefined)?.kind)}
                    nodeStrokeColor={() => "rgba(10, 21, 48, 0.32)"}
                    nodeStrokeWidth={3}
                    nodeBorderRadius={7}
                    maskColor="rgba(255, 255, 255, 0.42)"
                    maskStrokeColor="rgba(86, 69, 212, 0.32)"
                    maskStrokeWidth={2}
                  />
                )}
              </ReactFlow>
            </ReactFlowProvider>
          </div>
        ) : null}
        {showPptistEmbed ? (
          <PptistEmbedPanel
            ref={pptistRef}
            slides={pptistSlides}
            artifact={hasPptxFile ? artifact : undefined}
            animateArtifact={shouldAnimatePptist}
            animateSlides={shouldAnimatePptist}
            slideIds={pptistSlideIds}
            onAnimationStarted={markPptistAnimationStarted}
            onSlideChanged={(index, slideId) => {
              // Reveal the matching flow node as PPTist begins typing this page, and
              // pan the canvas to it so the left view tracks the page rendering on the right.
              const treeNodeId = slideId.startsWith("generated-") ? slideId.slice("generated-".length) : pptistAllSlideNodes[index]?.id ?? slideId;
              setSelectedPptistSlideId(slideId);
              if (!canvasTreeMounted) return;
              setSlidePushIndex((prev) => Math.max(prev, index));
              if (flowModel.nodeMap.has(treeNodeId)) {
                setSelectedNodeId(treeNodeId);
                setFocusedNodeId(treeNodeId);
              }
            }}
            onSlideUpdated={handleSlideUpdated}
            onSelectionChanged={handlePptistSelectionChanged}
            onSlidesLoaded={handleSlidesLoaded}
            autosaveEnabled={Boolean(hasPptxFile && artifact?.filePath && task.status === "completed")}
            thumbnailCapturePaused={pptistThumbnailCapturePaused}
            ariaLabel={completedReviewMode ? t("vibe.pptx.review.editorAria") : undefined}
            onAutosaveStateChange={(state, msg) => {
              setPptistAutosaveState(state);
              if (msg) setPptistEditStatus(msg);
            }}
            onEditOpStarted={(index, op: PptistEditOp) => {
              setPptistEditStatus(t("vibe.pptx.edit.applyingStep", { current: index + 1 }));
              if ("slideId" in op && typeof op.slideId === "string") setSelectedPptistSlideId(op.slideId);
            }}
            onEditOpApplied={(index) => {
              setPptistEditStatus(t("vibe.pptx.edit.appliedStep", { current: index + 1 }));
            }}
            onSlideTyped={(index, slideId) => {
              // Page finished typing on the right → reveal its full content on the left.
              const treeNodeId = slideId.startsWith("generated-") ? slideId.slice("generated-".length) : pptistAllSlideNodes[index]?.id ?? slideId;
              setSelectedPptistSlideId(slideId);
              if (canvasTreeMounted) setSlidePushIndex((prev) => Math.max(prev, index));
              setTypedNodeIds((prev) => {
                if (prev.has(treeNodeId)) return prev;
                const next = new Set(prev);
                next.add(treeNodeId);
                return next;
              });
            }}
            onExportError={(msg) => { void message.error(t("vibe.pptx.exportFailed", { msg })); }}
          />
        ) : null}
        {showPptistEmbed ? (
          completedReviewMode && artifact ? (
            <div className="living-tree-pptx-ai-drawer" role="complementary" aria-label={t("vibe.pptx.dialogue.title")}>
              <VibePptxEditPanel
                artifact={artifact}
                task={task}
                disabled={!allPagesGenerated || task.status !== "completed"}
                busy={pptistEditRunning || Boolean(pendingPptistEdit)}
                generated={allPagesGenerated && task.status === "completed"}
                renderingGeneratedDeck={hasPptxFile && task.status === "completed" && !allPagesGenerated}
                autosaveState={pptistAutosaveState}
                statusText={pptistEditStatus}
                pendingEdit={pendingPptistEdit}
                selectedElements={selectedPptistElements}
                onEditRequest={handlePptistEditRequest}
                onConfirmEdit={handleConfirmPptistEdit}
                onCancelEdit={handleCancelPptistEdit}
                onOpenSelectedElements={handleOpenPptistSelection}
                onClearSelectedElements={handleClearPptistSelectionReference}
                showDialogueLog
                showReviewActionCard={false}
                onInputFocusChange={setPptistThumbnailCapturePaused}
              />
            </div>
          ) : (
            <div className={`living-tree-pptx-toolbar ${artifact ? "has-edit-panel" : ""}`}>
              <div className="living-tree-pptx-toolbar-status">
                {!allPagesGenerated ? (
                  <>
                    <LoadingOutlined />
                    <span>{t("vibe.pptx.generatedProgress", { generated: generatedPageCount, total: totalGeneratedPages })}</span>
                  </>
                ) : (
                  <>
                    <CheckCircleOutlined />
                    <span>{t("vibe.pptx.generatedProgress", { generated: generatedPageCount, total: totalGeneratedPages })}</span>
                  </>
                )}
              </div>
              <div className="living-tree-pptx-toolbar-actions">
                {artifact ? (
                  <VibePptxEditPanel
                    artifact={artifact}
                    task={task}
                    disabled={!allPagesGenerated || task.status !== "completed"}
                    busy={pptistEditRunning || Boolean(pendingPptistEdit)}
                    generated={allPagesGenerated && task.status === "completed"}
                    renderingGeneratedDeck={hasPptxFile && task.status === "completed" && !allPagesGenerated}
                    autosaveState={pptistAutosaveState}
                    statusText={pptistEditStatus}
                    pendingEdit={pendingPptistEdit}
                    selectedElements={selectedPptistElements}
                    onEditRequest={handlePptistEditRequest}
                    onConfirmEdit={handleConfirmPptistEdit}
                    onCancelEdit={handleCancelPptistEdit}
                    onOpenSelectedElements={handleOpenPptistSelection}
                    onClearSelectedElements={handleClearPptistSelectionReference}
                    onInputFocusChange={setPptistThumbnailCapturePaused}
                    onExportPptx={() => pptistRef.current?.exportPptx(artifact.fileName || "deck.pptx")}
                  />
                ) : null}
              </div>
            </div>
          )
        ) : null}
        {isPptxgenjsAssembling ? (
          <PptxgenjsAssemblingPanel assembleProgress={task.assembleProgress} />
        ) : null}
      </div>
    </div>
  );
}

function assembleStepKey(content: string): string {
  if (/generating.*code/i.test(content)) return "vibe.pptx.assembleStep.generating";
  if (/executing.*script/i.test(content)) return "vibe.pptx.assembleStep.executing";
  if (/script failed|retrying/i.test(content)) return "vibe.pptx.assembleStep.fixing";
  if (/qa detected|layout issue|qa-fixed/i.test(content)) return "vibe.pptx.assembleStep.qa";
  if (/presentation created/i.test(content)) return "vibe.pptx.assembleStep.done";
  return "vibe.pptx.assembling";
}

function PptxgenjsAssemblingPanel({ assembleProgress }: { assembleProgress?: { step: string; status: string; content: string } }) {
  const t = useT();
  const stepKey = assembleProgress ? assembleStepKey(assembleProgress.content) : "vibe.pptx.assembling";

  return (
    <div className="pptxgenjs-assembling-panel">
      <div className="pptxgenjs-assembling-icon">
        <FileTextOutlined />
      </div>
      <div className="pptxgenjs-assembling-title">{t("vibe.pptx.assembling")}</div>
      <div className="pptxgenjs-assembling-bar">
        <div className="pptxgenjs-assembling-bar-fill" />
      </div>
      <div className="pptxgenjs-assembling-step">{t(stepKey)}</div>
    </div>
  );
}

function VibeArtifactActions({ artifact, onPreview, disabled = false }: { artifact: Artifact; onPreview?: (artifact: Artifact) => void; disabled?: boolean }) {
  const t = useT();

  return (
    <div className="living-tree-artifact-actions" onClick={(event) => event.stopPropagation()}>
      {supportsOfflinePreview(artifact) && onPreview ? (
        <Button
          type="primary"
          icon={<PlayCircleOutlined />}
          aria-label={t("dialogue.vibeTree.openPreview")}
          disabled={disabled}
          onClick={() => onPreview(artifact)}
        >
          {t("dialogue.vibeTree.openPreview")}
        </Button>
      ) : null}
      <Button
        icon={<FolderOpenOutlined />}
        aria-label={t("dialogue.completed.showInFolder")}
        disabled={disabled}
        onClick={() => officecli.showItemInFolder(artifact.filePath)}
      >
        {t("dialogue.completed.showInFolder")}
      </Button>
    </div>
  );
}

function VibePptxEditPanel({ artifact, task, disabled, busy, generated, renderingGeneratedDeck = false, autosaveState, statusText, pendingEdit, selectedElements, onEditRequest, onConfirmEdit, onCancelEdit, showDialogueLog = false, showReviewActionCard = true, onInputFocusChange, onOpenCanvasTree, onPreview, onExportPptx, onOpenSelectedElements, onClearSelectedElements }: {
  artifact: Artifact;
  task?: DesktopTask;
  disabled: boolean;
  busy?: boolean;
  generated: boolean;
  renderingGeneratedDeck?: boolean;
  autosaveState: "idle" | "dirty" | "saving" | "saved" | "failed";
  statusText?: string;
  pendingEdit?: ModifyPptistDeckResult | null;
  selectedElements?: PptistElementSelection | null;
  onEditRequest?: (prompt: string) => void | Promise<void>;
  onConfirmEdit?: () => void | Promise<void>;
  onCancelEdit?: () => void;
  showDialogueLog?: boolean;
  showReviewActionCard?: boolean;
  onInputFocusChange?: (focused: boolean) => void;
  onOpenCanvasTree?: () => void;
  onPreview?: (artifact: Artifact) => void;
  onExportPptx?: () => void;
  onOpenSelectedElements?: (selection: PptistElementSelection) => void;
  onClearSelectedElements?: () => void;
}) {
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const [localDialogueItems, setLocalDialogueItems] = useState<VibePptxDialogueItem[]>([]);
  const [hasReviewEditActivity, setHasReviewEditActivity] = useState(false);
  const lastWorkflowStatusRef = useRef("");
  const trimmedPrompt = prompt.trim();
  const autosaveBusy = autosaveState === "dirty" || autosaveState === "saving";
  const inputDisabled = disabled || busy || autosaveBusy || !onEditRequest;
  const reviewAutosaveText = autosaveState === "idle" || (autosaveState === "saved" && !hasReviewEditActivity) ? "" : autosaveText(autosaveState, t);
  const generatedDeckRenderingHint = renderingGeneratedDeck ? t("vibe.pptx.edit.renderingHint") : "";
  const pendingOrRenderingHint = generatedDeckRenderingHint || t("vibe.pptx.edit.pendingHint");
  const reviewStatusText = statusText || (!generated ? pendingOrRenderingHint : reviewAutosaveText);
  const showFooterStatus = Boolean(reviewStatusText && (!showDialogueLog || !hasReviewEditActivity));
  const liveSelectionLabel = selectedElements?.elementIds.length ? pptistSelectionLabel(selectedElements) : "";
  const quickPrompts = [
    { label: t("vibe.pptx.dialogue.quick.sales"), prompt: t("vibe.pptx.dialogue.quick.salesPrompt") },
    { label: t("vibe.pptx.dialogue.quick.modern"), prompt: t("vibe.pptx.dialogue.quick.modernPrompt") },
    { label: t("vibe.pptx.dialogue.quick.visual"), prompt: t("vibe.pptx.dialogue.quick.visualPrompt") },
  ];

  useEffect(() => {
    if (showDialogueLog && (statusText || (autosaveState !== "idle" && autosaveState !== "saved"))) {
      setHasReviewEditActivity(true);
    }
  }, [autosaveState, showDialogueLog, statusText]);

  useEffect(() => {
    if (!showDialogueLog || !reviewStatusText || !hasReviewEditActivity) return;
    if (lastWorkflowStatusRef.current === reviewStatusText) return;
    lastWorkflowStatusRef.current = reviewStatusText;
    setLocalDialogueItems((items) => appendVibePptxDialogueItem(items, {
      role: "ai",
      text: reviewStatusText,
      state: workflowStateForStatus(reviewStatusText, t),
    }));
  }, [hasReviewEditActivity, reviewStatusText, showDialogueLog, t]);

  useEffect(() => {
    if (!showDialogueLog || !hasReviewEditActivity || busy || reviewStatusText) return;
    setLocalDialogueItems(finalizeVibePptxWorkingItems);
  }, [busy, hasReviewEditActivity, reviewStatusText, showDialogueLog]);

  function submitEditRequest() {
    if (inputDisabled || !trimmedPrompt || !onEditRequest) return;
    const submittedPrompt = trimmedPrompt;
    setLocalDialogueItems((items) => appendVibePptxDialogueItem(items, { role: "user" as const, text: submittedPrompt }));
    void onEditRequest(submittedPrompt);
    setPrompt("");
    onClearSelectedElements?.();
  }

  const selectionReferenceChip = liveSelectionLabel && selectedElements ? (
    <span className="living-tree-pptx-reference-chip">
      <button
        type="button"
        className="living-tree-pptx-reference-chip-main"
        aria-label={t("vibe.pptx.selection.open", { target: liveSelectionLabel })}
        title={t("vibe.pptx.selection.open", { target: liveSelectionLabel })}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onOpenSelectedElements?.(selectedElements)}
      >
        <span className="living-tree-pptx-reference-chip-icon" aria-hidden="true">
          <PaperClipOutlined />
        </span>
        <span className="living-tree-pptx-reference-chip-label">{liveSelectionLabel}</span>
      </button>
      <button
        type="button"
        className="living-tree-pptx-reference-chip-remove"
        aria-label={t("vibe.pptx.selection.remove", { target: liveSelectionLabel })}
        title={t("vibe.pptx.selection.remove", { target: liveSelectionLabel })}
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => {
          event.stopPropagation();
          onClearSelectedElements?.();
        }}
      >
        <CloseOutlined />
      </button>
    </span>
  ) : null;

  const editRequestRow = (
    <div className="living-tree-pptx-edit-row">
      <div className={`living-tree-pptx-edit-composer ${selectionReferenceChip ? "has-inline-reference" : ""}`}>
        {selectionReferenceChip}
        <ImePlainTextArea
          rows={1}
          className="living-tree-pptx-edit-input"
          placeholder={t("vibe.pptx.edit.placeholder")}
          value={prompt}
          disabled={inputDisabled}
          onChange={(event) => setPrompt(event.target.value)}
          onFocus={() => onInputFocusChange?.(true)}
          onBlur={() => onInputFocusChange?.(false)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.preventDefault();
              submitEditRequest();
            }
          }}
        />
      </div>
      <Button
        type="primary"
        icon={busy ? <LoadingOutlined /> : <SendOutlined />}
        aria-label={t("vibe.pptx.edit.send")}
        disabled={inputDisabled || !trimmedPrompt}
        onClick={submitEditRequest}
      />
    </div>
  );

  const editConfirmation = pendingEdit ? (
    <div className="living-tree-pptx-edit-confirmation" role="status">
      <strong>{pendingEdit.confirmation?.title || t("vibe.pptx.edit.confirmTitle")}</strong>
      {pendingEdit.confirmation?.message ? <span>{pendingEdit.confirmation.message}</span> : null}
      {pendingEdit.confirmation?.target ? <span>{pendingEdit.confirmation.target}</span> : null}
      {pendingEdit.confirmation?.changes?.length ? (
        <ul>
          {pendingEdit.confirmation.changes.map((item) => <li key={`change-${item}`}>{item}</li>)}
        </ul>
      ) : null}
      {pendingEdit.confirmation?.preserved?.length ? (
        <span>{t("vibe.pptx.edit.preserved", { items: pendingEdit.confirmation.preserved.join(", ") })}</span>
      ) : null}
      <div className="living-tree-pptx-edit-confirmation-actions">
        <Button size="small" onClick={onCancelEdit}>{t("vibe.pptx.edit.cancel")}</Button>
        <Button size="small" type="primary" onClick={() => { void onConfirmEdit?.(); }} disabled={!onConfirmEdit}>
          {t("vibe.pptx.edit.apply")}
        </Button>
      </div>
    </div>
  ) : null;

  return (
    <section className={`living-tree-pptx-edit-panel ${showDialogueLog ? "is-review-mode" : ""}`} aria-label={t("vibe.pptx.edit.title")}>
      {showDialogueLog && showReviewActionCard ? (
        <div className="living-tree-pptx-action-card">
          <div className="living-tree-pptx-file-title">
            <FileTextOutlined />
            <strong>{artifact.fileName || artifact.filePath}</strong>
          </div>
          <div className="living-tree-pptx-action-card-buttons">
            {onOpenCanvasTree ? (
              <Button
                icon={<GlobalOutlined />}
                aria-label={t("vibe.pptx.review.openCanvasTree")}
                onClick={onOpenCanvasTree}
              />
            ) : null}
            {onExportPptx ? (
              <Button
                icon={<DownloadOutlined />}
                aria-label={t("vibe.pptx.export")}
                disabled={disabled || busy}
                onClick={onExportPptx}
              />
            ) : null}
            <Button
              icon={<FolderOpenOutlined />}
              aria-label={t("dialogue.completed.showInFolder")}
              disabled={disabled || busy}
              onClick={() => officecli.showItemInFolder(artifact.filePath)}
            />
            {supportsOfflinePreview(artifact) && onPreview ? (
              <Button
                icon={<LinkOutlined />}
                aria-label={t("dialogue.vibeTree.openPreview")}
                disabled={disabled || busy}
                onClick={() => onPreview(artifact)}
              />
            ) : null}
          </div>
        </div>
      ) : (
        <div className="living-tree-pptx-edit-panel-head">
          <div>
            <strong>{t("vibe.pptx.edit.title")}</strong>
            <span>{busy ? t("vibe.pptx.edit.running") : generated ? t("vibe.pptx.edit.ready") : renderingGeneratedDeck ? t("vibe.pptx.edit.rendering") : t("vibe.pptx.edit.pending")}</span>
          </div>
          {!showDialogueLog ? <div className="living-tree-pptx-edit-panel-head-actions">
            {onOpenCanvasTree ? (
              <Button
                icon={<GlobalOutlined />}
                aria-label={t("vibe.pptx.review.openCanvasTree")}
                onClick={onOpenCanvasTree}
              >
                {t("vibe.pptx.review.canvasTree")}
              </Button>
            ) : null}
            <Button
              icon={<DownloadOutlined />}
              aria-label={t("vibe.pptx.export")}
              disabled={disabled || busy}
              onClick={onExportPptx}
            >
              {t("vibe.pptx.export")}
            </Button>
            <Button
              icon={<FolderOpenOutlined />}
              aria-label={t("dialogue.completed.showInFolder")}
              disabled={disabled || busy}
              onClick={() => officecli.showItemInFolder(artifact.filePath)}
            >
              {t("dialogue.completed.showInFolder")}
            </Button>
          </div> : null}
        </div>
      )}
	      {showDialogueLog ? (
	        task ? (
	          <VibePptxDialogueLog task={task} quickPrompts={quickPrompts} onPromptSelect={setPrompt} localItems={localDialogueItems}>
	            {showFooterStatus ? <p className="living-tree-pptx-dialogue-status">{reviewStatusText}</p> : null}
	            {editConfirmation}
	            {editRequestRow}
	          </VibePptxDialogueLog>
        ) : null
      ) : (
        <p>{statusText || autosaveText(autosaveState, t) || (generated ? t("vibe.pptx.edit.readyHint") : pendingOrRenderingHint)}</p>
      )}
      {!showDialogueLog ? editConfirmation : null}
      {!showDialogueLog ? editRequestRow : null}
    </section>
  );
}

function pptistSelectionLabel(selection: PptistElementSelection): string {
  const first = selection.elements[0];
  if (selection.elementIds.length === 1 && first) {
    const rawType = String(first.type || "object");
    const type = rawType.charAt(0).toUpperCase() + rawType.slice(1);
    const preview = first.textPreview?.trim() || first.id;
    return `${type} ${preview}`;
  }
  return `${selection.elementIds.length} objects`;
}

type VibePptxDialogueItem = {
  role: "user" | "ai";
  text: string;
  state?: "working" | "done" | "error";
};

function appendVibePptxDialogueItem(items: VibePptxDialogueItem[], item: VibePptxDialogueItem): VibePptxDialogueItem[] {
  const normalized = item.text.trim();
  if (!normalized) return items;
  const nextItem = { ...item, text: normalized };
  const baseItems = nextItem.role === "ai"
    ? items.map((existing) => (
      existing.role === "ai" && existing.state === "working" && existing.text !== nextItem.text
        ? { ...existing, state: "done" as const }
        : existing
    ))
    : items;
  const last = baseItems[baseItems.length - 1];
  if (last && last.role === nextItem.role && last.text === nextItem.text) {
    return [...baseItems.slice(0, -1), { ...last, ...nextItem }].slice(-8);
  }
  return [...baseItems, nextItem].slice(-8);
}

function finalizeVibePptxWorkingItems(items: VibePptxDialogueItem[]): VibePptxDialogueItem[] {
  let changed = false;
  const next = items.map((item) => {
    if (item.role !== "ai" || item.state !== "working") return item;
    changed = true;
    return { ...item, state: "done" as const };
  });
  return changed ? next : items;
}

function workflowStateForStatus(text: string, t: Translator): VibePptxDialogueItem["state"] {
  if (text === t("vibe.pptx.edit.failed") || text === t("vibe.pptx.autosave.failed")) return "error";
  const workingTexts = new Set([
    t("vibe.pptx.edit.preparing"),
    t("vibe.pptx.edit.thinking"),
    t("vibe.pptx.edit.applying"),
    t("vibe.pptx.autosave.dirty"),
    t("vibe.pptx.autosave.saving"),
  ]);
  if (workingTexts.has(text) || text.includes("Applying edit ") || text.includes("正在 PPTist 中应用第 ")) return "working";
  return "done";
}

function VibePptxDialogueLog({ task, quickPrompts, onPromptSelect, localItems = [], children }: {
  task: DesktopTask;
  quickPrompts: Array<{ label: string; prompt: string }>;
  onPromptSelect: (prompt: string) => void;
  localItems?: VibePptxDialogueItem[];
  children?: ReactNode;
}) {
  const t = useT();
  const items = useMemo(() => [...buildVibePptxDialogueItems(task, t), ...localItems].slice(-6), [localItems, task, t]);

  return (
    <section className="living-tree-pptx-dialogue-log" aria-label={t("vibe.pptx.dialogue.title")}>
      <div className="living-tree-pptx-dialogue-log-head">
        <div>
          <strong>{t("vibe.pptx.dialogue.title")}</strong>
          <span>{t("vibe.pptx.dialogue.subtitle")}</span>
        </div>
        <Tag color="default">{items.length}</Tag>
      </div>
      <div className="living-tree-pptx-dialogue-intent">
        <strong>{t("vibe.pptx.dialogue.intentTitle")}</strong>
        <div className="living-tree-pptx-dialogue-chips">
          {quickPrompts.map((item) => (
            <Button key={item.label} size="small" onClick={() => onPromptSelect(item.prompt)}>
              {item.label}
            </Button>
          ))}
        </div>
      </div>
	      <div className="living-tree-pptx-dialogue-log-body">
	        {items.map((item, index) => (
	          <div key={`${item.role}-${index}-${item.text}`} className={`living-tree-pptx-dialogue-message is-${item.role}${item.state ? ` is-${item.state}` : ""}`}>
	            <span>{item.role === "user" ? t("vibe.pptx.dialogue.user") : t("vibe.pptx.dialogue.ai")}</span>
	            <p>
	              {item.role === "ai" && item.state === "working" ? <LoadingOutlined /> : null}
	              {item.text}
	            </p>
	          </div>
	        ))}
	      </div>
      <div className="living-tree-pptx-dialogue-footer">
        {children}
      </div>
    </section>
  );
}

function buildVibePptxDialogueItems(task: DesktopTask, t: Translator): VibePptxDialogueItem[] {
  if (task.status === "completed") {
    return [{ role: "ai", text: t("vibe.pptx.dialogue.empty") }];
  }

  const items: VibePptxDialogueItem[] = [];
  const seen = new Set<string>();
  const add = (role: VibePptxDialogueItem["role"], text: string | undefined) => {
    const normalized = text?.trim();
    if (!normalized || seen.has(`${role}:${normalized}`)) return;
    seen.add(`${role}:${normalized}`);
    items.push({ role, text: normalized });
  };

  add("user", task.userInput?.prompt || task.topic);
  for (const event of task.events) {
    const text = eventText(event);
    if (!text || text.toLowerCase() === "done") continue;
    if (event.type === "task.started" || event.type === "task.vibe_tree" || event.type === "task.vibe_slide") continue;
    add("ai", text);
  }
  if (items.length === 0) {
    add("ai", t("vibe.pptx.dialogue.empty"));
  }

  return items.slice(-6);
}

function autosaveText(state: "idle" | "dirty" | "saving" | "saved" | "failed", t: Translator): string {
  switch (state) {
    case "dirty":
      return t("vibe.pptx.autosave.dirty");
    case "saving":
      return t("vibe.pptx.autosave.saving");
    case "saved":
      return t("vibe.pptx.autosave.saved");
    case "failed":
      return t("vibe.pptx.autosave.failed");
    default:
      return "";
  }
}

function VibeDeckPptxArt() {
  return (
    <div className="living-tree-deck-pptx-art" aria-hidden="true">
      <div className="living-tree-deck-slide-fan">
        {Array.from({ length: 3 }, (_, index) => (
          <span key={`deck-fan-slide-${index}`} className="living-tree-deck-fan-slide" />
        ))}
        <span className="living-tree-deck-pptx-chip">P</span>
      </div>
    </div>
  );
}

function VibeTreeViewportController({ focusedNodeId, nodes }: {
  focusedNodeId: string | null;
  nodes: Array<FlowNode<VibeCanvasData>>;
}) {
  const { setCenter } = useReactFlow<FlowNode<VibeCanvasData>>();
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;

  useEffect(() => {
    if (!focusedNodeId) return;
    const node = nodesRef.current.find((candidate) => candidate.id === focusedNodeId);
    if (!node) return;
    const shell = document.querySelector(".living-tree-flow-shell");
    const shellRect = shell?.getBoundingClientRect();
    if (!shellRect || shellRect.width <= 0 || shellRect.height <= 0) return;
    const fallbackHeight = node.data.kind === "thinking" ? VIBE_THINKING_NODE_HEIGHT : (VIBE_NODE_HEIGHTS[node.data.kind] ?? 160);
    const nodeHeight = node.height ?? fallbackHeight;
    const fallbackWidth = node.data.kind === "thinking" ? VIBE_THINKING_NODE_WIDTH : (VIBE_NODE_WIDTHS[node.data.kind] ?? VIBE_NODE_WIDTH);
    const nodeWidth = node.width ?? fallbackWidth;
    const x = node.position.x + nodeWidth / 2;
    const y = node.position.y + nodeHeight / 2;
    const timer = window.setTimeout(() => {
      void setCenter(x, y, { zoom: 0.82, duration: 420 });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [focusedNodeId, setCenter]);

  return null;
}

function vibeNodeDefaultViewport(focusedNodeId: string | null, nodes: Array<FlowNode<VibeCanvasData>>): { x: number; y: number; zoom: number } {
  if (!focusedNodeId) return { x: 0, y: 0, zoom: 1 };
  const node = nodes.find((n) => n.id === focusedNodeId);
  if (!node) return { x: 0, y: 0, zoom: 1 };
  const zoom = 0.82;
  const fallbackWidth = node.data.kind === "thinking" ? VIBE_THINKING_NODE_WIDTH : (VIBE_NODE_WIDTHS[node.data.kind] ?? VIBE_NODE_WIDTH);
  const fallbackHeight = node.data.kind === "thinking" ? VIBE_THINKING_NODE_HEIGHT : (VIBE_NODE_HEIGHTS[node.data.kind] ?? 160);
  const nodeWidth = node.width ?? fallbackWidth;
  const nodeHeight = node.height ?? fallbackHeight;
  const centerX = node.position.x + nodeWidth / 2;
  const centerY = node.position.y + nodeHeight / 2;
  const shell = document.querySelector(".living-tree-flow-shell");
  const shellRect = shell?.getBoundingClientRect();
  const containerWidth = shellRect?.width ?? 600;
  const containerHeight = shellRect?.height ?? 500;
  return {
    x: -centerX * zoom + containerWidth / 2,
    y: -centerY * zoom + containerHeight / 2,
    zoom,
  };
}

function isVibeCanvasTask(task: DesktopTask) {
  return Boolean(task.vibeTree && (task.documentType === "pptx" || task.artifact?.documentType === "pptx"));
}

function shouldRenderVibeWorkspaceForLatestTask(latestTask: DesktopTask, vibeTask: DesktopTask) {
  if (latestTask.id === vibeTask.id) return true;
  if (latestTask.conversationId !== vibeTask.conversationId) return false;
  const latestDocumentType = (latestTask.documentType || latestTask.artifact?.documentType || "").toLowerCase();
  if (latestDocumentType !== "pptx") return false;
  const sourceFile = latestTask.userInput?.sourceFile?.trim();
  if (!sourceFile) return false;
  if (sourceFile === vibeTask.artifact?.filePath) return true;
  return Boolean(latestTask.parentTaskId);
}

function mergeVibeWorkspaceTask(vibeTask: DesktopTask, latestTask: DesktopTask): DesktopTask {
  if (latestTask.id === vibeTask.id) return vibeTask;
  return {
    ...vibeTask,
    id: latestTask.id,
    conversationId: latestTask.conversationId,
    parentTaskId: latestTask.parentTaskId || vibeTask.parentTaskId,
    status: latestTask.status,
    documentType: latestTask.documentType || vibeTask.documentType,
    topic: latestTask.topic || vibeTask.topic,
    events: [...vibeTask.events, ...latestTask.events],
    artifact: latestTask.artifact || vibeTask.artifact,
    userInput: latestTask.userInput || vibeTask.userInput,
    stages: latestTask.stages || vibeTask.stages,
    activeStageId: latestTask.activeStageId || vibeTask.activeStageId,
    error: latestTask.error || vibeTask.error,
    creditCharged: latestTask.creditCharged ?? vibeTask.creditCharged,
    creditMode: latestTask.creditMode || vibeTask.creditMode,
    runtimeSnapshot: latestTask.runtimeSnapshot || vibeTask.runtimeSnapshot,
    assembleProgress: latestTask.assembleProgress || vibeTask.assembleProgress,
  };
}

function isPptCanvasPreparationTask(task: DesktopTask) {
  const documentType = (task.documentType || task.artifact?.documentType || "").toLowerCase();
  return Boolean(
    documentType === "pptx"
    && task.userInput?.generationMode === "plan"
    && !task.plan
    && !task.vibeTree
    && (task.status === "starting" || task.status === "running")
  );
}

function isInitialPptVibeCanvasTask(task: DesktopTask) {
  const documentType = (task.documentType || task.artifact?.documentType || "").toLowerCase();
  return Boolean(
    documentType === "pptx"
    && task.userInput?.generationMode === "plan"
    && task.vibeTree
    && (task.status === "starting" || task.status === "running" || task.status === "question" || task.status === "plan_review")
  );
}

function shouldAllowCanvasPreparationForTask(task: DesktopTask, sessionStartedAtMs: number, wasIntroducedThisSession: boolean) {
  const documentType = (task.documentType || task.artifact?.documentType || "").toLowerCase();
  if (documentType !== "pptx" || task.userInput?.generationMode !== "plan") return false;
  const startedAtMs = taskStartedAtMs(task);
  if (startedAtMs != null) {
    return startedAtMs >= sessionStartedAtMs - 1000;
  }
  return wasIntroducedThisSession;
}

function shouldAllowVibeNodeAnimationForTask(task: DesktopTask, sessionStartedAtMs: number) {
  if (!task.vibeTree) return false;
  const latestVibeTreeEventAtMs = latestTaskEventAtMs(task, "task.vibe_tree");
  if (latestVibeTreeEventAtMs == null) return false;
  return latestVibeTreeEventAtMs >= sessionStartedAtMs - 1000;
}

function taskStartedAtMs(task: DesktopTask) {
  const ts = latestTaskEventTs(task, "task.started") || task.events[0]?.ts;
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function latestTaskEventAtMs(task: DesktopTask, type: BridgeEvent["type"]) {
  const ts = latestTaskEventTs(task, type);
  if (!ts) return null;
  const ms = Date.parse(ts);
  return Number.isFinite(ms) ? ms : null;
}

function latestTaskEventTs(task: DesktopTask, type: BridgeEvent["type"]) {
  for (let index = task.events.length - 1; index >= 0; index -= 1) {
    const event = task.events[index];
    if (event.type === type && typeof event.ts === "string") {
      return event.ts;
    }
  }
  return null;
}

function VibeCanvasCommandBar({ task, onForceCancel }: { task: DesktopTask; onForceCancel?: (taskId: string) => void }) {
  const t = useT();
  const [cancelling, setCancelling] = useState(false);

  return (
    <div className="docked-composer vibe-canvas-command-bar">
      <div className="vibe-canvas-command-copy">{t("vibe.task.commandBarHint")}</div>
      <div className="vibe-canvas-actions">
        <Button danger icon={<StopOutlined />} loading={cancelling} onClick={async () => {
          setCancelling(true);
          try {
            await officecli.cancel(task.id);
            onForceCancel?.(task.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("not found") && onForceCancel) {
              onForceCancel(task.id);
            } else {
              message.error(`Cancel failed: ${msg}`);
            }
          } finally {
            setCancelling(false);
          }
        }}>
          {t("dialogue.running.cancel")}
        </Button>
      </div>
    </div>
  );
}

function VibeNodePopoverContent({
  node,
  kind,
  confirmationTarget,
  confirmationTargetKind,
  confirmationTargetConfirmed,
  feedback,
  needsConfirm,
  submittingRevision,
  descendantCount,
  onConfirm,
  onFeedbackChange,
  onSubmitRevision,
}: {
  node: VibeProjectTreeNode;
  kind: VibeCanvasNodeKind;
  confirmationTarget?: VibeProjectTreeNode;
  confirmationTargetKind?: VibeCanvasNodeKind;
  confirmationTargetConfirmed: boolean;
  feedback: string;
  needsConfirm: boolean;
  submittingRevision: boolean;
  descendantCount: number;
  onConfirm: (nodeId: string) => void;
  onFeedbackChange: (value: string) => void;
  onSubmitRevision: () => Promise<boolean>;
}) {
  const t = useT();
  const editId = useId();
  const confirmationTargetIsSelected = confirmationTarget?.id === node.id;
  const confirmationPending = Boolean(confirmationTarget && !confirmationTargetConfirmed);
  const confirmLabel = confirmationTargetIsSelected
    ? t("vibe.confirm.thisNode")
    : confirmationTargetKind ? t("vibe.confirm.parentKind", { kind: vibeNodeKindLabel(confirmationTargetKind) }) : "";
  const confirmTooltip = t("vibe.confirm.tooltip");
  const feedbackChanged = feedback.trim() !== vibeNodeEditableText(node).trim();
  const primaryLabel = confirmationPending ? (confirmLabel || t("vibe.confirm.thisNode")) : (needsConfirm ? t("vibe.confirm.regenerateDownstream") : t("vibe.confirm.applyToCurrent"));

  async function handlePrimaryAction() {
    if (confirmationPending && confirmationTarget) {
      if (feedbackChanged) {
        await onSubmitRevision();
        return;
      }
      onConfirm(confirmationTarget.id);
      return;
    }
    await onSubmitRevision();
  }

  return (
    <div className="living-tree-popover" data-node-title={node.title} onClick={(event) => event.stopPropagation()}>
      <div className="living-tree-popover-head">
        <Tag color={confirmationTarget ? (confirmationTargetConfirmed ? "success" : "gold") : "default"}>
          {confirmationTarget ? (confirmationTargetConfirmed ? t("vibe.tag.confirmed") : t("vibe.tag.pending")) : t("vibe.tag.nodeDetail")}
        </Tag>
        <span>{vibeNodeKindLabel(kind)}</span>
      </div>
      {confirmationTarget && (confirmationTargetConfirmed || !confirmationTargetIsSelected) ? (
        <div className={`living-tree-popover-confirm ${confirmationTargetConfirmed ? "is-confirmed" : ""}`}>
          {confirmationTargetConfirmed ? (
            <p>{t("vibe.confirm.alreadyInScope")}</p>
          ) : (
            confirmationTargetIsSelected ? null : <p>{t("vibe.confirm.currentTarget", { title: confirmationTarget.title })}</p>
          )}
        </div>
      ) : null}
      <div className="living-tree-popover-revision">
        <label className="living-tree-popover-edit-label" htmlFor={editId}>
          {vibeNodeEditLabel(kind, t)}
        </label>
        <ImeTextArea
          id={editId}
          value={feedback}
          onChange={(event) => onFeedbackChange(event.target.value)}
          placeholder={t("vibe.confirm.placeholder")}
          autoSize={{ minRows: 4, maxRows: 8 }}
          disabled={submittingRevision}
        />
        {needsConfirm && descendantCount > 0 ? (
          <div className="living-tree-impact-warning">
            {t("vibe.confirm.impactWarning", { count: descendantCount })}
          </div>
        ) : null}
        <div className="living-tree-popover-revision-actions">
          {confirmationPending ? (
            <Tooltip title={confirmTooltip}>
              <Button
                type="primary"
                onClick={() => { void handlePrimaryAction(); }}
                loading={submittingRevision}
                disabled={!feedback.trim()}
              >
                {primaryLabel}
              </Button>
            </Tooltip>
          ) : (
            <Button
              type="primary"
              onClick={() => { void handlePrimaryAction(); }}
              loading={submittingRevision}
              disabled={!feedback.trim()}
            >
              {primaryLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function VibeTreeFlowNode({ data, selected }: NodeProps<FlowNode<VibeCanvasData>>) {
  const t = useT();
  const { treeNode, kind, label, muted, assembling, ideaDrawing, nodeDrawing, nodeWaiting, confirmed, confirmable, expectedPageCount, thinkingState, thinkingTargetKind, slidePushState, completedArtifact, completedArtifactTitle, onPreviewArtifact } = data;
  const motionRole = kind === "thinking"
    ? `thinking-${thinkingState ?? "active"}`
    : ideaDrawing ? "idea-drawing" : nodeDrawing ? "node-drawing" : nodeWaiting ? "node-waiting" : assembling ? "deck-assembly" : undefined;
  if (kind === "thinking") {
    const thinkingClassName = `living-tree-flow-node is-thinking ${selected ? "is-selected" : ""} is-thinking-${thinkingState ?? "active"}`;
    return (
      <article
        className={thinkingClassName}
        data-vibe-kind={kind}
        data-motion-role={motionRole}
      >
        <Handle type="target" position={Position.Left} />
        <Handle type="source" position={Position.Right} />
        <div className="living-tree-thinking-node-head">
          <span>{thinkingTargetKind ? vibeNodeKindLabel(thinkingTargetKind) : label}</span>
          <Tag color={thinkingState === "active" ? "processing" : "success"}>{thinkingState === "active" ? "Thinking" : "Done"}</Tag>
        </div>
        <strong>{thinkingState === "active" ? "Thinking..." : "Done"}</strong>
        <div className="living-tree-thinking-node-body">
          {thinkingState === "active" ? (
            <span className="living-tree-thinking-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          ) : (
            <CheckCircleFilled className="living-tree-thinking-check" aria-hidden="true" />
          )}
          <p>{thinkingState === "active" ? `Generating ${label}` : `${label} is ready`}</p>
        </div>
      </article>
    );
  }
  const drawingContent = Boolean(ideaDrawing || nodeDrawing);
  const drawingTexts = drawingContent ? vibeNodeDrawingTexts(label, treeNode) : [];
  const drawingTimings = drawingContent ? vibeNodeLineTimings(drawingTexts) : [];
  const visualAssets = treeNode.visualAssets?.slice(0, VIBE_NODE_MAX_VISUAL_ASSETS) ?? [];
  const visualAssetTimings = drawingContent ? vibeNodeVisualAssetTimings(drawingTimings, visualAssets.length) : [];
  const pageLabel = treeNode.slideNumber ? `Page ${treeNode.slideNumber}` : null;
  const renderNodeBadges = () => (
    <div className="living-tree-flow-node-badges">
      {confirmable ? <Tag color={confirmed ? "success" : "gold"}>{confirmed ? t("vibe.tag.confirmed") : t("vibe.tag.pending")}</Tag> : null}
      {kind === "slide_group" && expectedPageCount ? <Tag>{expectedPageCount} {expectedPageCount === 1 ? "Page" : "Pages"}</Tag> : null}
      {pageLabel ? <Tag>{pageLabel}</Tag> : null}
    </div>
  );
  let drawingLineIndex = 0;
  const nextDrawingLineProps = () => {
    const lineIndex = drawingLineIndex++;
    return {
      lineIndex,
      delayMs: drawingTimings[lineIndex]?.delayMs ?? VIBE_NODE_TEXT_START_MS,
      durationMs: drawingTimings[lineIndex]?.durationMs ?? 180,
    };
  };
  const nodeFrame = drawingContent ? (
    <span className="living-tree-node-draw-frame" aria-hidden="true">
      <svg className="living-tree-node-outline-svg" focusable="false" preserveAspectRatio="none">
        <rect className="living-tree-node-outline-rect" pathLength="1" />
      </svg>
    </span>
  ) : null;
  const nodeHandles = (
    <>
      {kind !== "root" ? <Handle type="target" position={Position.Left} /> : null}
      {kind !== "deck" ? <Handle type="source" position={Position.Right} /> : null}
    </>
  );
  const nodeClassName = `living-tree-flow-node is-${kind} ${kind === "generated_slide" ? "is-slide-thumbnail" : ""} ${selected ? "is-selected" : ""} ${muted ? "is-muted" : ""} ${assembling ? "is-assembling" : ""} ${nodeWaiting ? "is-node-waiting" : ""} ${nodeDrawing ? "is-node-drawing" : ""} ${ideaDrawing ? "is-idea-drawing" : ""} ${confirmable ? "is-confirmable" : ""} ${confirmable && !confirmed ? "is-pending" : ""} ${confirmed ? "is-confirmed" : ""}`;
  const nodeCard = kind === "generated_slide" ? (
    <article
      className={nodeClassName}
      data-vibe-kind={kind}
      data-motion-role={motionRole}
      data-slide-push={slidePushState}
    >
      {nodeFrame}
      {nodeHandles}
      <div className="living-tree-slide-thumbnail">
        {pageLabel ? (
          <div className="living-tree-slide-thumbnail-badges">
            <Tag>{pageLabel}</Tag>
          </div>
        ) : null}
        <div className="living-tree-pptx-placeholder" aria-label="PPTX placeholder">
          <div className="living-tree-pptx-underlay" aria-hidden="true">
            <strong>{treeNode.title}</strong>
            {treeNode.summary && treeNode.summary !== treeNode.title ? <p>{treeNode.summary}</p> : null}
            {treeNode.outline && treeNode.outline.length > 0 ? (
              <ul>
                {treeNode.outline.slice(0, 3).map((item, index) => (
                  <li key={`${treeNode.id}-pptx-underlay-${index}`}>{item}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="living-tree-pptx-placeholder-mask">
            <div className="living-tree-pptx-placeholder-art" aria-hidden="true">
              <span className="living-tree-pptx-placeholder-file">
                <i className="living-tree-pptx-placeholder-fold" />
                <strong>PPTX</strong>
                <span className="living-tree-pptx-placeholder-chart">
                  <i />
                  <i />
                  <i />
                </span>
              </span>
            </div>
            <div className="living-tree-pptx-placeholder-copy">
              <strong>Preview thumbnail unavailable</strong>
              <span>Final PPTX output is the source of truth</span>
            </div>
          </div>
        </div>
      </div>
    </article>
  ) : kind === "deck" && completedArtifact ? (
    <article
      className={`${nodeClassName} has-completed-artifact`}
      data-vibe-kind={kind}
      data-motion-role={motionRole}
      data-slide-push={slidePushState}
    >
      {nodeFrame}
      {nodeHandles}
      <div className="living-tree-deck-completed-copy">
        <div className="living-tree-deck-completed-head">
          <span>{label}</span>
          <Tag color="success">{vibeStageLabel("completed", t)}</Tag>
        </div>
        <strong>{completedArtifactTitle || treeNode.title}</strong>
      </div>
      <VibeDeckPptxArt />
      <VibeArtifactActions artifact={completedArtifact} onPreview={onPreviewArtifact} />
    </article>
  ) : (
    <article
      className={nodeClassName}
      data-vibe-kind={kind}
      data-motion-role={motionRole}
      data-slide-push={slidePushState}
    >
      {nodeFrame}
      {nodeHandles}
      <div className="living-tree-flow-node-head">
        {drawingContent ? <AnimatedTextLine text={label} {...nextDrawingLineProps()} /> : <span>{label}</span>}
        {renderNodeBadges()}
      </div>
      {drawingContent ? <AnimatedTextLine as="strong" text={treeNode.title} {...nextDrawingLineProps()} /> : <strong>{treeNode.title}</strong>}
      {treeNode.summary && treeNode.summary !== treeNode.title ? (
        drawingContent
          ? <AnimatedTextLine as="p" text={treeNode.summary} {...nextDrawingLineProps()} />
          : <p>{treeNode.summary}</p>
      ) : null}
      {treeNode.outline && treeNode.outline.length > 0 ? (
        <ul>
          {treeNode.outline.slice(0, 3).map((item, index) => (
            drawingContent
              ? <AnimatedTextLine as="li" key={`${treeNode.id}-outline-${index}`} text={item} {...nextDrawingLineProps()} />
              : <li key={`${treeNode.id}-outline-${index}`}>{item}</li>
          ))}
        </ul>
      ) : null}
      {visualAssets.length > 0 ? (
        <div className="living-tree-visuals">
          {visualAssets.map((asset, index) => (
            <AnimatedVisualAssetIcon
              key={`${treeNode.id}-visual-${index}`}
              asset={asset}
              index={index}
              delayMs={visualAssetTimings[index]?.delayMs ?? 0}
              durationMs={visualAssetTimings[index]?.durationMs ?? VIBE_NODE_VISUAL_ASSET_MS}
              drawing={drawingContent}
            />
          ))}
        </div>
      ) : null}
    </article>
  );

  return (
    <ViewportAnchoredPopover
      content={data.popoverContent}
      open={data.popoverOpen}
      onAlignerChange={data.onPopoverAlignerChange}
      placement="right"
      trigger="click"
      autoAdjustOverflow
      overlayClassName="living-tree-popover-overlay"
    >
      {nodeCard}
    </ViewportAnchoredPopover>
  );
}

function VibeTreeLaneNode({ data }: NodeProps<FlowNode<VibeCanvasData>>) {
  return (
    <section className={`living-tree-lane is-lane-${data.laneIndex ?? 0}`} aria-label={`${data.treeNode.title} chapter lane`}>
      <div className="living-tree-lane-label">
        <span>Chapter Lane</span>
        <strong>{data.treeNode.title}</strong>
      </div>
    </section>
  );
}

export function buildVibeFlowModel(snapshot: VibeTreeSnapshot, t?: (key: string, vars?: Record<string, string | number>) => string): {
  nodes: Array<FlowNode<VibeCanvasData>>;
  edges: Edge[];
  nodeMap: Map<string, VibeProjectTreeNode>;
} {
  const showDeck = shouldShowDeck(snapshot.stage);
  const originalNodes = showDeck ? snapshot.tree.nodes : snapshot.tree.nodes.filter((node) => node.kind !== "deck");
  const nodeMap = new Map(originalNodes.map((node) => [node.id, node]));
  const generatedSlideNodes: VibeProjectTreeNode[] = [];
  if (shouldSynthesizeGeneratedSlides(snapshot, nodeMap)) {
    for (const outline of originalNodes.filter((node) => isOutlineLikeNode(node, nodeMap))) {
      generatedSlideNodes.push({
        ...outline,
        id: `generated-${outline.id}`,
        parentId: outline.id,
        kind: "generated_slide",
        title: outline.title,
        summary: outline.summary ? (t ? t("vibe.synth.generatedPage", { summary: outline.summary }) : `Generated page: ${outline.summary}`) : (t ? t("vibe.synth.generatedPagePreview") : "Generated page preview."),
        trace: [...(outline.trace ?? []), outline.id],
      });
    }
  }
  const outputSlideNodes = [
    ...originalNodes.filter((node) => kindForVibeNode(node, snapshot.stage) === "generated_slide"),
    ...generatedSlideNodes,
  ];
  for (const s of outputSlideNodes) {
    if (!nodeMap.has(s.id)) nodeMap.set(s.id, s);
  }
  const originalDeckNode = originalNodes.find((node) => node.kind === "deck");
  const deckNode: VibeProjectTreeNode | undefined = originalDeckNode ?? (showDeck && outputSlideNodes.length > 0
    ? {
        id: "deck",
        kind: "deck",
        title: t ? t("vibe.synth.deckTitle") : "Full PPTX Deck",
        summary: snapshot.stage === "completed" ? (t ? t("vibe.synth.deckSummaryCompleted") : "All pages assembled into deliverable PPTX.") : (t ? t("vibe.synth.deckSummaryRendering") : "Assembling pages into final PPTX."),
      }
    : undefined);
  const allNodes = [...originalNodes, ...generatedSlideNodes, ...(deckNode && !originalDeckNode ? [deckNode] : [])];
  for (const node of allNodes) nodeMap.set(node.id, node);

  const byColumn = new Map<number, VibeProjectTreeNode[]>();
  for (const node of allNodes) {
    const column = vibeNodeColumn(kindForVibeNode(node, snapshot.stage));
    byColumn.set(column, [...(byColumn.get(column) ?? []), node]);
  }

  const yById = layoutVibeTreeYPositions(byColumn, allNodes, snapshot.stage);
  const xSpacing = VIBE_NODE_COLUMN_SPACING;
  const laneNodes = buildVibeLaneNodes(allNodes, yById, snapshot.stage, xSpacing);
  const flowNodes: Array<FlowNode<VibeCanvasData>> = [];
  for (const [column, columnNodes] of byColumn.entries()) {
    for (const node of [...columnNodes].sort(compareVibeNodes)) {
      const kind = kindForVibeNode(node, snapshot.stage);
      const nodeHeight = estimateVibeNodeHeight(kind, node);
      const nodeWidth = vibeNodeWidth(kind);
      const expectedPageCount = kind === "slide_group" ? countExpectedChapterPages(nodeMap, node.id, snapshot.stage) : undefined;
      flowNodes.push({
        id: node.id,
        type: "vibeNode",
        position: { x: column * xSpacing, y: yById.get(node.id) ?? VIBE_TREE_CANVAS_CENTER_Y },
        width: nodeWidth,
        height: nodeHeight,
        style: { width: nodeWidth, height: nodeHeight },
        data: {
          treeNode: node,
          kind,
          label: vibeNodeKindLabel(kind),
          muted: kind === "generated_slide" && snapshot.stage === "rendering",
          expectedPageCount,
        },
        draggable: false,
        zIndex: 2,
      });
    }
  }

  const edges: Edge[] = [];
  for (const node of allNodes) {
    if (!node.parentId || !nodeMap.has(node.parentId)) continue;
    edges.push({
      id: `${node.parentId}-${node.id}`,
      source: node.parentId,
      target: node.id,
      type: "straight",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "rgba(86, 69, 212, 0.58)" },
      className: "living-tree-edge",
    });
  }
  if (deckNode) {
    for (const slide of outputSlideNodes) {
      edges.push({
        id: `${slide.id}-${deckNode.id}`,
        source: slide.id,
        target: deckNode.id,
        type: "straight",
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        className: "living-tree-edge",
      });
    }
  }

  return { nodes: [...laneNodes, ...flowNodes], edges, nodeMap };
}

function storyReadySnapshotForIdeaGate(snapshot: VibeTreeSnapshot, ideaConfirmed: boolean): VibeTreeSnapshot {
  if (snapshot.stage !== "story_ready" || ideaConfirmed) return snapshot;
  const rootNode = snapshot.tree.nodes.find((node) => node.id === snapshot.tree.rootId) ?? snapshot.tree.nodes.find((node) => node.kind === "root");
  if (!rootNode) return snapshot;
  return {
    ...snapshot,
    tree: {
      ...snapshot.tree,
      nodes: [rootNode],
    },
    confirmation: { nodeIds: [rootNode.id] },
  };
}

function buildVibeLaneNodes(allNodes: VibeProjectTreeNode[], yById: Map<string, number>, stage: VibeTreeSnapshot["stage"], xSpacing: number) {
  const nodeMap = new Map(allNodes.map((node) => [node.id, node]));
  const laneNodes: Array<FlowNode<VibeCanvasData>> = [];
  const slideGroups = allNodes.filter((node) => kindForVibeNode(node, stage) === "slide_group").sort(compareVibeNodes);
  slideGroups.forEach((group, index) => {
    const descendants = descendantNodes(nodeMap, group.id).filter((node) => yById.has(node.id));
    const visibleMembers = [group, ...descendants].filter((node) => yById.has(node.id));
    if (visibleMembers.length <= 1) return;

    const top = Math.min(...visibleMembers.map((node) => yById.get(node.id) ?? VIBE_TREE_CANVAS_CENTER_Y));
    const bottom = Math.max(...visibleMembers.map((node) => {
      const kind = kindForVibeNode(node, stage);
      return (yById.get(node.id) ?? VIBE_TREE_CANVAS_CENTER_Y) + estimateVibeNodeHeight(kind, node);
    }));
    const rightmostColumn = Math.max(...visibleMembers.map((node) => vibeNodeColumn(kindForVibeNode(node, stage))));
    const laneX = vibeNodeColumn("slide_group") * xSpacing - 28;
    const laneY = top - VIBE_LANE_VERTICAL_PADDING;
    const rightmostNodeWidth = Math.max(...visibleMembers.map((node) => vibeNodeWidth(kindForVibeNode(node, stage))));
    const laneWidth = (rightmostColumn * xSpacing + rightmostNodeWidth + 28) - laneX;
    const laneHeight = bottom - top + VIBE_LANE_VERTICAL_PADDING * 2;

    laneNodes.push({
      id: `lane-${group.id}`,
      type: "vibeLane",
      position: { x: laneX, y: laneY },
      data: {
        treeNode: group,
        kind: "slide_group",
        label: "Chapter Lane",
        laneIndex: index,
      },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: 0,
      style: { width: laneWidth, height: laneHeight },
    });
  });
  return laneNodes;
}

function layoutVibeTreeYPositions(byColumn: Map<number, VibeProjectTreeNode[]>, allNodes: VibeProjectTreeNode[], stage: VibeTreeSnapshot["stage"]) {
  const childrenByParent = new Map<string, VibeProjectTreeNode[]>();
  for (const node of allNodes) {
    if (!node.parentId) continue;
    childrenByParent.set(node.parentId, [...(childrenByParent.get(node.parentId) ?? []), node]);
  }

  const yById = new Map<string, number>();
  const columns = [...byColumn.keys()].sort((a, b) => b - a);
  for (const column of columns) {
    const sortedNodes = [...(byColumn.get(column) ?? [])].sort(compareVibeNodes);
    if (sortedNodes.length === 0) continue;

    const compactY = compactVibeColumnPositions(sortedNodes, stage);
    const desiredY = new Map<string, number>();
    for (const node of sortedNodes) {
      const children = [...(childrenByParent.get(node.id) ?? [])].sort(compareVibeNodes).filter((child) => yById.has(child.id));
      if (children.length === 0) {
        desiredY.set(node.id, compactY.get(node.id) ?? VIBE_TREE_CANVAS_CENTER_Y);
        continue;
      }
      const childCenters = children.map((child) => {
        const childKind = kindForVibeNode(child, stage);
        return (yById.get(child.id) ?? VIBE_TREE_CANVAS_CENTER_Y) + estimateVibeNodeHeight(childKind, child) / 2;
      });
      const childClusterCenter = (Math.min(...childCenters) + Math.max(...childCenters)) / 2;
      const nodeKind = kindForVibeNode(node, stage);
      desiredY.set(node.id, childClusterCenter - estimateVibeNodeHeight(nodeKind, node) / 2);
    }

    for (const [id, y] of resolveVibeColumnCollisions(sortedNodes, desiredY, stage)) {
      yById.set(id, y);
    }
  }
  return yById;
}

function compactVibeColumnPositions(nodes: VibeProjectTreeNode[], stage: VibeTreeSnapshot["stage"]) {
  const positions = new Map<string, number>();
  const heights = nodes.map((node) => estimateVibeNodeHeight(kindForVibeNode(node, stage), node));
  const gaps = nodes.slice(0, -1).map((node, index) => vibeNodeVerticalGapBetween(node, nodes[index + 1], stage));
  const totalHeight = heights.reduce((sum, height) => sum + height, 0) + gaps.reduce((sum, gap) => sum + gap, 0);
  let cursorY = VIBE_TREE_CANVAS_CENTER_Y - totalHeight / 2;
  nodes.forEach((node, index) => {
    positions.set(node.id, cursorY);
    cursorY += (heights[index] ?? VIBE_NODE_HEIGHTS.branch) + (gaps[index] ?? 0);
  });
  return positions;
}

function resolveVibeColumnCollisions(nodes: VibeProjectTreeNode[], desiredY: Map<string, number>, stage: VibeTreeSnapshot["stage"]) {
  const resolved = new Map<string, number>();
  let previousBottom = Number.NEGATIVE_INFINITY;
  let previousNode: VibeProjectTreeNode | undefined;
  for (const node of nodes) {
    const desired = desiredY.get(node.id) ?? VIBE_TREE_CANVAS_CENTER_Y;
    const gap = previousNode ? vibeNodeVerticalGapBetween(previousNode, node, stage) : 0;
    const y = Math.max(desired, previousBottom + gap);
    resolved.set(node.id, y);
    previousBottom = y + estimateVibeNodeHeight(kindForVibeNode(node, stage), node);
    previousNode = node;
  }
  return resolved;
}

function vibeNodeVerticalGapBetween(a: VibeProjectTreeNode | undefined, b: VibeProjectTreeNode | undefined, stage: VibeTreeSnapshot["stage"]) {
  const aKind = a ? kindForVibeNode(a, stage) : undefined;
  const bKind = b ? kindForVibeNode(b, stage) : undefined;
  return aKind === "generated_slide" || bKind === "generated_slide" ? VIBE_GENERATED_SLIDE_VERTICAL_GAP : VIBE_NODE_VERTICAL_GAP;
}

function compareVibeNodes(a: VibeProjectTreeNode, b: VibeProjectTreeNode) {
  if (typeof a.slideNumber === "number" && typeof b.slideNumber === "number") return a.slideNumber - b.slideNumber;
  if (typeof a.slideNumber === "number") return -1;
  if (typeof b.slideNumber === "number") return 1;
  return a.id.localeCompare(b.id);
}

function estimateVibeNodeHeight(kind: VibeCanvasNodeKind, node: VibeProjectTreeNode) {
  const fixedHeight = VIBE_NODE_HEIGHTS[kind];
  if (kind === "generated_slide") return fixedHeight;
  const contentHeight = estimateVibeNodeContentHeight(node);
  if (kind === "outline") return Math.max(fixedHeight, contentHeight);
  const hasExtraContent = Boolean(node.outline?.length || node.visualAssets?.length);
  return Math.max(hasExtraContent ? fixedHeight + 24 : fixedHeight, contentHeight);
}

function vibeNodeWidth(kind: VibeCanvasNodeKind) {
  return VIBE_NODE_WIDTHS[kind] ?? VIBE_NODE_WIDTH;
}

function estimateVibeNodeTextLines(text: string | undefined, charsPerLine: number, maxLines?: number) {
  if (!text) return 0;
  const normalized = text.trim();
  if (!normalized) return 0;
  const lineCount = Math.max(1, Math.ceil(Array.from(normalized).length / charsPerLine));
  return typeof maxLines === "number" ? Math.min(lineCount, maxLines) : lineCount;
}

function estimateVibeNodeContentHeight(node: VibeProjectTreeNode) {
  const titleLines = estimateVibeNodeTextLines(node.title, 18);
  const summaryLines = node.summary && node.summary !== node.title ? estimateVibeNodeTextLines(node.summary, 20, 3) : 0;
  const outlineLines = (node.outline ?? [])
    .slice(0, 3)
    .reduce((sum, item) => sum + estimateVibeNodeTextLines(item, 24), 0);
  const outlineGaps = Math.max(0, Math.min(node.outline?.length ?? 0, 3) - 1) * 4;
  const visualRows = Math.min(node.visualAssets?.length ?? 0, VIBE_NODE_MAX_VISUAL_ASSETS) > 0 ? 1 : 0;
  const paddingY = 24;
  const headHeight = 18;
  const headMargin = 8;
  const titleHeight = titleLines * 19.04;
  const summaryHeight = summaryLines > 0 ? 7 + summaryLines * 18 : 0;
  const outlineHeight = outlineLines > 0 ? 8 + outlineLines * 15.62 + outlineGaps : 0;
  const visualsHeight = visualRows > 0 ? 10 + 34 : 0;
  return Math.ceil(paddingY + headHeight + headMargin + titleHeight + summaryHeight + outlineHeight + visualsHeight + 14);
}

function kindForVibeNode(node: VibeProjectTreeNode, stage: VibeTreeSnapshot["stage"]): VibeCanvasNodeKind {
  if (node.kind === "root") return "root";
  if (node.kind === "branch") return "branch";
  if (node.kind === "slide_group") return "slide_group";
  if (node.kind === "outline") return "outline";
  if (node.kind === "generated_slide") return "generated_slide";
  if (node.kind === "slide" && (stage === "slides_ready" || stage === "rendering" || stage === "completed" || node.parentId?.startsWith("outline-"))) return "generated_slide";
  if (node.kind === "deck") return "deck";
  return "outline";
}

function vibeNodeColumn(kind: VibeCanvasNodeKind) {
  switch (kind) {
    case "root":
      return 0;
    case "branch":
      return 1;
    case "slide_group":
      return 2;
    case "outline":
      return 3;
    case "generated_slide":
      return 4;
    case "deck":
      return 6;
  }
}

function vibeNodeKindLabel(kind: VibeCanvasNodeKind) {
  switch (kind) {
    case "root":
      return "Idea";
    case "branch":
      return "Story Beat";
    case "slide_group":
      return "Chapter";
    case "outline":
      return "Outline";
    case "generated_slide":
      return "Slide";
    case "deck":
      return "Deck";
  }
}

function thinkingTargetKindForStage(stage: VibeTreeSnapshot["stage"]): VibeCanvasNodeKind | null {
  switch (stage) {
    case "story_ready":
      return "slide_group";
    case "outline_ready":
      return "outline";
    case "refined_ready":
      return "generated_slide";
    default:
      return null;
  }
}

function buildVibeThinkingTransitionElements(
  flowModel: { nodes: Array<FlowNode<VibeCanvasData>>; edges: Edge[]; nodeMap: Map<string, VibeProjectTreeNode> },
  stage: VibeTreeSnapshot["stage"],
  sourceNodeIds: string[],
  targetKind: VibeCanvasNodeKind,
  phase: VibeThinkingState,
): { nodes: Array<FlowNode<VibeCanvasData>>; edges: Edge[] } {
  if (sourceNodeIds.length === 0) return { nodes: [], edges: [] };
  const nodes: Array<FlowNode<VibeCanvasData>> = [];
  const edges: Edge[] = [];
  const targetColumn = vibeNodeColumn(targetKind);
  const targetColumnWidth = vibeNodeWidth(targetKind);

  for (const sourceNodeId of sourceNodeIds) {
    const sourceNode = flowModel.nodes.find((node) => node.id === sourceNodeId);
    if (!sourceNode || sourceNode.type !== "vibeNode" || sourceNode.data.kind === "thinking") continue;
    const sourceHeight = Number(sourceNode.height ?? sourceNode.style?.height ?? estimateVibeNodeHeight(sourceNode.data.kind as VibeCanvasNodeKind, sourceNode.data.treeNode));
    const thinkingNodeId = `thinking-${sourceNodeId}-${stage}`;
    nodes.push({
      id: thinkingNodeId,
      type: "vibeNode",
      position: {
        x: targetColumn * VIBE_NODE_COLUMN_SPACING + Math.max(0, (targetColumnWidth - VIBE_THINKING_NODE_WIDTH) / 2),
        y: sourceNode.position.y + sourceHeight / 2 - VIBE_THINKING_NODE_HEIGHT / 2,
      },
      width: VIBE_THINKING_NODE_WIDTH,
      height: VIBE_THINKING_NODE_HEIGHT,
      style: { width: VIBE_THINKING_NODE_WIDTH, height: VIBE_THINKING_NODE_HEIGHT },
      draggable: false,
      selectable: false,
      focusable: false,
      zIndex: phase === "active" ? 4 : 5,
      data: {
        treeNode: {
          id: thinkingNodeId,
          parentId: sourceNodeId,
          kind: "thinking",
          title: "Thinking...",
          summary: phase === "done" ? "Done" : `Generating ${vibeNodeKindLabel(targetKind)}`,
        },
        kind: "thinking",
        label: vibeNodeKindLabel(targetKind),
        thinkingState: phase,
        thinkingTargetKind: targetKind,
      },
    });
    edges.push({
      id: `${sourceNodeId}-${thinkingNodeId}`,
      source: sourceNodeId,
      target: thinkingNodeId,
      type: "straight",
      animated: phase === "active",
      markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: phase === "active" ? "rgba(196, 122, 18, 0.92)" : phase === "done" ? "rgba(22, 163, 74, 0.86)" : "rgba(86, 69, 212, 0.58)" },
      style: { strokeWidth: 2.6 },
      className: `living-tree-edge is-thinking is-thinking-${phase}`,
    });
  }

  return { nodes, edges };
}

function shouldShowGeneratedSlides(stage: VibeTreeSnapshot["stage"]) {
  return stage === "slides_ready" || stage === "rendering" || stage === "completed";
}

function shouldShowDeck(stage: VibeTreeSnapshot["stage"]) {
  return stage === "rendering" || stage === "completed";
}

function shouldSynthesizeGeneratedSlides(snapshot: VibeTreeSnapshot, nodeMap: Map<string, VibeProjectTreeNode>) {
  if (!shouldShowGeneratedSlides(snapshot.stage)) return false;
  if (snapshot.tree.nodes.some((node) => node.kind === "slide" || node.kind === "generated_slide")) return false;
  return !snapshot.tree.nodes.some((node) => node.kind === "slide" && node.parentId && nodeMap.get(node.parentId)?.kind === "outline");
}

function isOutlineLikeNode(node: VibeProjectTreeNode, nodeMap: Map<string, VibeProjectTreeNode>) {
  if (node.kind === "outline") return true;
  return node.kind === "slide" && node.parentId !== undefined && nodeMap.get(node.parentId)?.kind !== "outline";
}

function descendantNodes(nodeMap: Map<string, VibeProjectTreeNode>, nodeId: string) {
  const descendants: VibeProjectTreeNode[] = [];
  const visit = (parentId: string) => {
    for (const node of nodeMap.values()) {
      if (node.parentId !== parentId) continue;
      descendants.push(node);
      visit(node.id);
    }
  };
  visit(nodeId);
  return descendants;
}

function countExpectedChapterPages(nodeMap: Map<string, VibeProjectTreeNode>, nodeId: string, stage: VibeTreeSnapshot["stage"]) {
  const descendants = descendantNodes(nodeMap, nodeId);
  const actualPageNodes = descendants.filter((node) => {
    const kind = kindForVibeNode(node, stage);
    return kind === "generated_slide" || node.kind === "generated_slide";
  });
  if (actualPageNodes.length > 0) return actualPageNodes.length;
  return descendants.filter((node) => isOutlineLikeNode(node, nodeMap)).length;
}

function nearestConfirmableAncestor(nodeMap: Map<string, VibeProjectTreeNode>, node: VibeProjectTreeNode, confirmableNodeIds: Set<string>) {
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodeMap.get(parentId);
    if (!parent) return undefined;
    if (confirmableNodeIds.has(parent.id)) return parent;
    parentId = parent.parentId;
  }
  return undefined;
}

function currentStepConfirmableNodeIds(nodes: Array<FlowNode<VibeCanvasData>>, snapshot: VibeTreeSnapshot, overrideKinds?: VibeCanvasNodeKind[]) {
  const kinds = overrideKinds ?? defaultConfirmableKinds(snapshot.stage);
  if (snapshot.confirmation?.nodeIds?.length) {
    return new Set(snapshot.confirmation.nodeIds);
  }
  return new Set(nodes.filter((node) => kinds.includes(node.data.kind as VibeCanvasNodeKind)).map((node) => node.id));
}

function defaultConfirmableKinds(stage: VibeTreeSnapshot["stage"]): VibeCanvasNodeKind[] {
  switch (stage) {
    case "story_ready":
      return ["branch"];
    case "outline_ready":
      return ["slide_group"];
    case "refined_ready":
      return ["outline"];
    case "slides_ready":
      return [];
    case "rendering":
      return [];
    case "completed":
      return ["deck"];
    default:
      return [];
  }
}

function completedVibeKindsForStage(stage: VibeTreeSnapshot["stage"]): VibeCanvasNodeKind[] {
  switch (stage) {
    case "story_ready":
      return ["root"];
    case "outline_ready":
      return ["root", "branch"];
    case "refined_ready":
      return ["root", "branch", "slide_group"];
    case "slides_ready":
    case "rendering":
      return ["root", "branch", "slide_group", "outline"];
    case "completed":
      return ["root", "branch", "slide_group", "outline", "generated_slide", "deck"];
    default:
      return [];
  }
}

function currentTaskTitle(stage: VibeTreeSnapshot["stage"], ideaGateActive = false, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (ideaGateActive) return t("vibe.stage.confirmIdea");
  switch (stage) {
    case "story_ready":
      return t("vibe.stage.confirmStoryBeat");
    case "outline_ready":
      return t("vibe.stage.confirmChapter");
    case "refined_ready":
      return t("vibe.stage.confirmOutline");
    case "slides_ready":
      return t("vibe.stage.pptxGenerated");
    case "rendering":
      return t("vibe.stage.generatingPptx");
    case "completed":
      return t("vibe.stage.pptxCompleted");
    default:
      return t("vibe.stage.confirmCurrentNode");
  }
}

function currentTaskDescription(stage: VibeTreeSnapshot["stage"], confirmedCount: number, totalCount: number, ideaGateActive = false, t: (key: string, vars?: Record<string, string | number>) => string) {
  if (totalCount === 0) {
    if (stage === "slides_ready") return t("vibe.desc.pptxGenerated");
    if (stage === "rendering") return t("vibe.desc.rendering");
    if (stage === "completed") return t("vibe.desc.completed");
    return t("vibe.desc.noNodesToConfirm");
  }
  if (ideaGateActive) return t("vibe.desc.confirmIdeaFirst");
  const remaining = totalCount - confirmedCount;
  if (remaining <= 0) {
    switch (stage) {
      case "story_ready":
        return t("vibe.desc.storyConfirmedNext");
      case "outline_ready":
        return t("vibe.desc.chapterConfirmedNext");
      case "refined_ready":
        return t("vibe.desc.outlineConfirmedNext");
      case "slides_ready":
        return t("vibe.desc.slidesReady");
      case "rendering":
        return t("vibe.desc.rendering");
      case "completed":
        return t("vibe.desc.completed");
      default:
        return t("vibe.desc.allConfirmedNext");
    }
  }
  return t("vibe.desc.remaining", { remaining });
}

function vibeMiniMapNodeColor(kind: VibeFlowNodeKind | undefined) {
  switch (kind) {
    case "root":
      return "#5645d4";
    case "branch":
      return "#ffb25f";
    case "slide_group":
      return "#8f7cf6";
    case "outline":
      return "#60c979";
    case "generated_slide":
      return "#42a5f5";
    case "deck":
      return "#2f855a";
    case "thinking":
      return "#c47a12";
    default:
      return "#c7c2f5";
  }
}

function VibeProgressSteps({ stage, progressIndex, motionPhase, taskCard, autoOpenTaskCard }: {
  stage: VibeTreeSnapshot["stage"];
  progressIndex?: number;
  motionPhase?: string;
  taskCard?: ReactNode;
  autoOpenTaskCard?: boolean;
}) {
  const activeIndex = progressIndex ?? vibeProgressIndex(stage);
  const [manualOpen, setManualOpen] = useState(false);
  const prevActiveIndexRef = useRef(activeIndex);
  if (prevActiveIndexRef.current !== activeIndex) {
    prevActiveIndexRef.current = activeIndex;
    if (manualOpen) setManualOpen(false);
  }
  useEffect(() => {
    if (!autoOpenTaskCard) setManualOpen(false);
  }, [autoOpenTaskCard]);
  const popoverOpen = manualOpen || Boolean(autoOpenTaskCard);
  const steps: Array<{ label: string; key: VibeCanvasNodeKind }> = [
    { label: "Idea", key: "root" },
    { label: "Story Beat", key: "branch" },
    { label: "Chapter", key: "slide_group" },
    { label: "Outline", key: "outline" },
    { label: "PPTX", key: "generated_slide" },
  ];
  return (
    <nav className="living-tree-steps" aria-label="Vibe-Officing progress" data-active-index={activeIndex} data-motion-phase={motionPhase ?? "settled"} data-vibe-stage={stage}>
      {steps.map((step, index) => {
        const isActive = index === activeIndex;
        if (isActive && taskCard) {
          return (
            <Popover
              key={step.key}
              content={taskCard}
              open={popoverOpen}
              trigger={[]}
              placement="bottom"
              overlayClassName="living-tree-step-popover"
              arrow={{ pointAtCenter: true }}
              forceRender
            >
              <button
                type="button"
                className="living-tree-step is-active"
                data-step-key={step.key}
                data-step-index={index}
                data-step-state="active"
                aria-label={`Open ${step.label} task`}
                aria-expanded={popoverOpen}
                onClick={() => setManualOpen((current) => !current)}
              >
                <span>{index + 1}</span>
                <strong>{step.label}</strong>
              </button>
            </Popover>
          );
        }
        return (
          <div
            key={step.key}
            className={`living-tree-step ${index < activeIndex ? "is-done" : ""} ${isActive ? "is-active" : ""}`}
            data-step-key={step.key}
            data-step-index={index}
            data-step-state={index < activeIndex ? "done" : isActive ? "active" : "pending"}
          >
            <span>{index < activeIndex ? "✓" : index + 1}</span>
            <strong>{step.label}</strong>
          </div>
        );
      })}
    </nav>
  );
}

function vibeProgressIndex(stage: VibeTreeSnapshot["stage"]) {
  switch (stage) {
    case "story_ready":
      return 1;
    case "outline_ready":
      return 2;
    case "refined_ready":
      return 3;
    case "slides_ready":
      return 4;
    case "rendering":
      return 4;
    case "completed":
      return 4;
    default:
      return 0;
  }
}

function vibeStageLabel(stage: VibeTreeSnapshot["stage"], t: (key: string, vars?: Record<string, string | number>) => string) {
  const key = `vibe.stageLabel.${stage}`;
  const val = t(key);
  return val !== key ? val : stage;
}

function ThinkingMessage() {
  const t = useT();
  return (
    <div className="message ai-message thinking-message" role="status" aria-live="polite">
      <span>{t("dialogue.history.thinking")}</span>
      <span className="thinking-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
    </div>
  );
}

function useMotionPhase(key: string, durationMs = 720) {
  const [phase, setPhase] = useState<"entering" | "settled">("entering");

  useEffect(() => {
    setPhase("entering");
    const timeout = window.setTimeout(() => setPhase("settled"), durationMs);
    return () => window.clearTimeout(timeout);
  }, [durationMs, key]);

  return phase;
}

type GenerationLoadingVariant = "plan" | "canvas" | "docx" | "pptx" | "xlsx" | "report";

const GENERATION_LOADING_DOCUMENT_TYPES = new Set<GenerationLoadingVariant>(["docx", "pptx", "xlsx", "report"]);

function generationLoadingVariant(task: DesktopTask, allowCanvasPreparation = true): GenerationLoadingVariant | null {
  if (allowCanvasPreparation && isPptCanvasPreparationTask(task)) {
    return "canvas";
  }
  if (task.userInput?.generationMode === "plan" && !task.plan) {
    return "plan";
  }
  const documentType = (task.documentType || task.artifact?.documentType || "").toLowerCase();
  return GENERATION_LOADING_DOCUMENT_TYPES.has(documentType as GenerationLoadingVariant)
    ? (documentType as GenerationLoadingVariant)
    : null;
}

function GenerationLoadingMessage({ task, allowCanvasPreparation = true }: { task: DesktopTask; allowCanvasPreparation?: boolean }) {
  const t = useT();
  const { settings } = useSettings();
  const variant = generationLoadingVariant(task, allowCanvasPreparation);
  const stageKey = task.stages?.map((stage) => `${stage.id}:${stage.status}`).join("|") ?? "";
  const motionPhase = useMotionPhase(`${task.status}:${variant ?? "thinking"}:${task.activeStageId ?? ""}:${stageKey}`);
  if (!variant) return <ThinkingMessage />;

  return (
    <div
      className={`generation-loading-message generation-loading-${variant}`}
      role="status"
      aria-live="polite"
      data-motion-status={task.status}
      data-motion-phase={motionPhase}
      data-document-type={variant}
    >
      <div className="generation-loading-status">
        <span className="generation-loading-status-dot" aria-hidden="true" />
        <span>{t(`dialogue.loading.${variant}`)}</span>
      </div>
      <GenerationStageRail stages={task.stages} activeStageId={task.activeStageId} />
      <GenerationLoadingVisual variant={variant} stages={task.stages} />
      {settings.waiting2048Enabled ? <Waiting2048Game /> : null}
    </div>
  );
}

function GenerationStageRail({ stages, activeStageId }: { stages?: StageState[]; activeStageId?: string }) {
  if (!stages || stages.length === 0) return null;
  const resolvedActiveStageId = activeStageId ?? stages.find((stage) => stage.status === "active")?.id ?? "";
  return (
    <ol className="generation-stage-rail" data-active-stage-id={resolvedActiveStageId} data-stage-count={stages.length}>
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          className={`generation-stage-item is-stage-${stage.status}`}
          data-stage-id={stage.id}
          data-stage-index={index}
          data-stage-status={stage.status}
        >
          <span className="generation-stage-marker" aria-hidden="true" />
          <span className="generation-stage-label">{stage.label}</span>
        </li>
      ))}
    </ol>
  );
}

function GenerationLoadingVisual({ variant, stages }: { variant: GenerationLoadingVariant; stages?: StageState[] }) {
  return (
    <div className="generation-loading-visual" aria-hidden="true">
      {variant === "docx" ? <DocxGenerationSkeleton /> : null}
      {variant === "pptx" ? <PptxGenerationSkeleton /> : null}
      {variant === "canvas" ? <PptxCanvasPreparationSkeleton /> : null}
      {variant === "xlsx" ? <XlsxGenerationSkeleton /> : null}
      {variant === "report" ? <ReportGenerationSkeleton /> : null}
      {variant === "plan" ? <PlanGenerationSkeleton stages={stages} /> : null}
    </div>
  );
}

function generationLoadingStyle(vars: Record<string, string>): CSSProperties {
  return vars as CSSProperties;
}

function GenerationLoadingLine({ width, delay, height }: { width: string; delay?: string; height?: string }) {
  return (
    <span
      className="generation-loading-line"
      style={generationLoadingStyle({
        "--generation-loading-width": width,
        "--generation-loading-delay": delay ?? "0s",
        "--generation-loading-height": height ?? "8px",
      })}
    />
  );
}

function DocxGenerationSkeleton() {
  const widths = ["92%", "78%", "88%", "66%", "95%", "74%", "84%"];
  return (
    <div className="generation-loading-artifact generation-loading-doc-page">
      <span className="generation-loading-doc-top" />
      <div className="generation-loading-doc-body">
        {widths.map((width, index) => (
          <GenerationLoadingLine key={`${width}-${index}`} width={width} delay={`${index * 0.11}s`} />
        ))}
      </div>
    </div>
  );
}

function PptxGenerationSkeleton() {
  return (
    <div className="generation-loading-artifact generation-loading-slide">
      <div className="generation-loading-deck-stack" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="generation-loading-slide-body">
        <div className="generation-loading-slide-title">
          <GenerationLoadingLine width="58%" height="10px" />
          <GenerationLoadingLine width="36%" delay="0.1s" />
        </div>
        <div className="generation-loading-slide-copy">
          <GenerationLoadingLine width="92%" delay="0.18s" />
          <GenerationLoadingLine width="72%" delay="0.3s" />
          <GenerationLoadingLine width="84%" delay="0.42s" />
        </div>
        <div className="generation-loading-slide-visual">
          {[44, 72, 58].map((height, index) => (
            <span
              key={height}
              className="generation-loading-bar"
              style={generationLoadingStyle({
                "--generation-loading-bar-height": `${height}%`,
                "--generation-loading-delay": `${0.24 + index * 0.16}s`,
              })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PptxCanvasPreparationSkeleton() {
  return (
    <div className="generation-loading-canvas-stage">
      <CanvasPreparationVector />
    </div>
  );
}

function CanvasPreparationVector() {
  const gradientId = useId().replace(/:/g, "");
  const surfaceGradientId = `${gradientId}-canvas-surface`;
  const lineGradientId = `${gradientId}-canvas-line`;
  return (
    <svg className="canvas-preparation-vector" viewBox="0 0 294 202" role="img" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={surfaceGradientId} x1="34" y1="30" x2="248" y2="164" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f8fbff" />
          <stop offset="0.58" stopColor="#fffdf9" />
          <stop offset="1" stopColor="#f7fafc" />
        </linearGradient>
        <linearGradient id={lineGradientId} x1="72" y1="70" x2="188" y2="70" gradientUnits="userSpaceOnUse">
          <stop stopColor="#dce4eb" />
          <stop offset="0.5" stopColor="#edf3f4" />
          <stop offset="1" stopColor="#d8b986" />
        </linearGradient>
      </defs>
      <rect className="canvas-vector-grid" x="20" y="18" width="254" height="166" rx="18" />
      <rect className="canvas-vector-frame" x="31" y="31" width="232" height="141" rx="13" />
      <rect className="canvas-vector-page" x="45" y="44" width="204" height="115" rx="9" fill={`url(#${surfaceGradientId})`} />
      <g className="canvas-vector-copy">
        <rect className="canvas-vector-line canvas-vector-line-1" x="64" y="68" width="118" height="9" rx="4.5" fill={`url(#${lineGradientId})`} />
        <rect className="canvas-vector-line canvas-vector-line-2" x="64" y="88" width="76" height="8" rx="4" fill={`url(#${lineGradientId})`} />
        <rect className="canvas-vector-line canvas-vector-line-3" x="64" y="118" width="100" height="8" rx="4" fill={`url(#${lineGradientId})`} />
        <rect className="canvas-vector-line canvas-vector-line-4" x="64" y="138" width="84" height="8" rx="4" fill={`url(#${lineGradientId})`} />
      </g>
      <g className="canvas-vector-media">
        <rect className="canvas-vector-media-card" x="178" y="103" width="58" height="43" rx="8" />
        <rect className="canvas-vector-thumb canvas-vector-thumb-1" x="188" y="126" width="17" height="12" rx="6" />
        <rect className="canvas-vector-thumb canvas-vector-thumb-2" x="210" y="122" width="17" height="16" rx="7" />
        <rect className="canvas-vector-thumb canvas-vector-thumb-3" x="232" y="126" width="17" height="12" rx="6" />
        <rect className="canvas-vector-floating-card" x="206" y="112" width="43" height="31" rx="6" />
      </g>
      <path className="canvas-vector-route canvas-vector-route-1" d="M62 63 C98 36 151 36 183 62" />
      <path className="canvas-vector-route canvas-vector-route-2" d="M158 135 C178 169 228 166 248 135" />
    </svg>
  );
}

function CanvasPreparationTransition({ durationMs }: { durationMs: number }) {
  const t = useT();
  return (
    <div
      className="canvas-preparation-transition"
      role="status"
      aria-label={t("dialogue.loading.canvas")}
      style={generationLoadingStyle({ "--canvas-preparation-duration": `${durationMs}ms` })}
    >
      <div className="canvas-preparation-transition-visual">
        <PptxCanvasPreparationSkeleton />
        <strong className="canvas-preparation-transition-label">{t("dialogue.loading.canvas")}</strong>
      </div>
    </div>
  );
}

function XlsxGenerationSkeleton() {
  return (
    <div className="generation-loading-artifact generation-loading-sheet">
      <span className="generation-loading-sheet-bar" />
      <div className="generation-loading-sheet-grid">
        {Array.from({ length: 30 }, (_, index) => {
          const isHeader = index < 6;
          const isValue = !isHeader && [8, 9, 14, 15, 20, 21, 26, 27].includes(index);
          return (
            <span
              key={index}
              className={`generation-loading-cell${isHeader ? " generation-loading-cell-header" : ""}${isValue ? " generation-loading-cell-value" : ""}`}
              style={generationLoadingStyle({ "--generation-loading-delay": `${index * 0.045}s` })}
            />
          );
        })}
      </div>
    </div>
  );
}

function ReportGenerationSkeleton() {
  return (
    <div className="generation-loading-artifact generation-loading-report-page">
      <div className="generation-loading-report-body">
        <div className="generation-loading-report-title">
          <GenerationLoadingLine width="70%" height="10px" />
          <GenerationLoadingLine width="45%" delay="0.1s" />
        </div>
        <div className="generation-loading-report-stats">
          {[0.16, 0.28, 0.4].map((delay) => (
            <span
              key={delay}
              className="generation-loading-stat"
              style={generationLoadingStyle({ "--generation-loading-delay": `${delay}s` })}
            />
          ))}
        </div>
        <div className="generation-loading-report-copy">
          {["94%", "82%", "88%", "64%", "76%"].map((width, index) => (
            <GenerationLoadingLine key={`${width}-${index}`} width={width} delay={`${0.28 + index * 0.11}s`} />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlanGenerationSkeleton({ stages }: { stages?: StageState[] }) {
  const stageCount = Math.min(Math.max(stages?.length ?? 4, 3), 4);
  return (
    <div className="generation-loading-artifact generation-loading-plan-board">
      <div className="generation-loading-plan-body">
        <div className="generation-loading-plan-title">
          <GenerationLoadingLine width="64%" height="10px" />
          <GenerationLoadingLine width="42%" delay="0.1s" />
        </div>
        <div className="generation-loading-plan-list">
          {Array.from({ length: stageCount }, (_, index) => (
            <div
              key={index}
              className="generation-loading-plan-step"
              style={generationLoadingStyle({ "--generation-loading-delay": `${0.2 + index * 0.2}s` })}
            >
              <span className={index === 0 ? "generation-loading-plan-check" : "generation-loading-plan-dot"} />
              <span className="generation-loading-plan-step-copy">
                <GenerationLoadingLine width={index % 2 === 0 ? "88%" : "74%"} delay={`${0.28 + index * 0.2}s`} />
                <GenerationLoadingLine width={index % 2 === 0 ? "54%" : "62%"} delay={`${0.36 + index * 0.2}s`} height="6px" />
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function renderPlanInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenPattern = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let cursor = 0;
  let tokenIndex = 0;

  for (const match of text.matchAll(tokenPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }

    const token = match[0];
    const key = `${keyPrefix}-inline-${tokenIndex}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    }
    cursor = index + token.length;
    tokenIndex += 1;
  }

  if (cursor < text.length) {
    nodes.push(text.slice(cursor));
  }
  return nodes;
}

function PlanMarkdown({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  const heading = (depth: number, content: string, key: string) => {
    const children = renderPlanInlineMarkdown(content, key);
    if (depth <= 1) return <h4 key={key}>{children}</h4>;
    if (depth === 2) return <h5 key={key}>{children}</h5>;
    return <h6 key={key}>{children}</h6>;
  };

  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed) {
      index += 1;
      continue;
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      blocks.push(heading(headingMatch[1].length, headingMatch[2].trim(), `plan-heading-${index}`));
      index += 1;
      continue;
    }

    const unorderedMatch = /^\s*[-*]\s+(.+)$/.exec(line);
    const orderedMatch = /^\s*\d+\.\s+(.+)$/.exec(line);
    if (unorderedMatch || orderedMatch) {
      const ordered = Boolean(orderedMatch);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const itemMatch = ordered ? /^\s*\d+\.\s+(.+)$/.exec(lines[index]) : /^\s*[-*]\s+(.+)$/.exec(lines[index]);
        if (!itemMatch) break;
        items.push(<li key={`plan-item-${index}`}>{renderPlanInlineMarkdown(itemMatch[1].trim(), `plan-item-${index}`)}</li>);
        index += 1;
      }
      const key = `plan-list-${index}`;
      blocks.push(ordered ? <ol key={key}>{items}</ol> : <ul key={key}>{items}</ul>);
      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const current = lines[index];
      const currentTrimmed = current.trim();
      if (!currentTrimmed) break;
      if (/^(#{1,6})\s+/.test(currentTrimmed) || /^\s*[-*]\s+/.test(current) || /^\s*\d+\.\s+/.test(current)) break;
      paragraphLines.push(currentTrimmed);
      index += 1;
    }
    const text = paragraphLines.join(" ");
    if (text) {
      blocks.push(<p key={`plan-paragraph-${index}`}>{renderPlanInlineMarkdown(text, `plan-paragraph-${index}`)}</p>);
    }
  }

  return <div className="plan-review-markdown">{blocks}</div>;
}

const PLAN_REVIEW_EXPANDED_STORAGE_PREFIX = "officedex.planReview.expanded.";
const PPTIST_ANIMATION_PLAYED_STORAGE_PREFIX = "officedex.pptistAnimation.played.";

function pptistAnimationPlayedStorageKey(taskId: string) {
  return `${PPTIST_ANIMATION_PLAYED_STORAGE_PREFIX}${taskId}`;
}

function readPptistAnimationPlayed(storageKey: string) {
  if (!storageKey || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function savePptistAnimationPlayed(storageKey: string) {
  if (!storageKey || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // This only controls cosmetic replay suppression; storage failures should not block generation.
  }
}

function planReviewExpandedStorageKey(taskId: string, planId: string, revision?: number) {
  return `${PLAN_REVIEW_EXPANDED_STORAGE_PREFIX}${taskId}:${planId}:${revision ?? 0}`;
}

function readPlanReviewExpanded(storageKey: string) {
  if (!storageKey || typeof localStorage === "undefined") return false;
  try {
    return localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function savePlanReviewExpanded(storageKey: string) {
  if (!storageKey || typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey, "1");
  } catch {
    // Expansion is a convenience preference; storage failures should not block review.
  }
}

function PlanReviewMessage({ task }: { task: DesktopTask }) {
  const t = useT();
  const storageKey = task.plan ? planReviewExpandedStorageKey(task.id, task.plan.id, task.plan.revision) : "";
  const [expanded, setExpanded] = useState(() => readPlanReviewExpanded(storageKey));
  useEffect(() => {
    setExpanded(readPlanReviewExpanded(storageKey));
  }, [storageKey]);
  if (!task.plan) return null;
  const planKey = `${task.plan.id}-${task.plan.revision}`;
  const expandPlanReview = () => {
    savePlanReviewExpanded(storageKey);
    setExpanded(true);
  };

  return (
    <div className={`message ai-message plan-review-message plan-review-card ${expanded ? "is-expanded" : ""}`} key={`plan-mount-${task.id}`}>
      <div className="plan-review-card-header">
        <div className="message-author">
          <FileTextOutlined />
          <strong>{t("dialogue.planReview.title")}</strong>
          {task.plan.revision ? <Tag color="processing">{t("dialogue.planReview.revision", { revision: task.plan.revision })}</Tag> : null}
        </div>
      </div>
      <div className="plan-review-card-body" key={planKey}>
        <section className="plan-review-section">
          <h3>{t("dialogue.planReview.planTitle")}</h3>
          <PlanMarkdown markdown={task.plan.markdown} />
        </section>
        {task.plan.executionPrompt ? (
          <section className="plan-review-section plan-execution-prompt-section">
            <h3>{t("dialogue.planReview.executionPrompt")}</h3>
            <pre className="plan-execution-prompt">{task.plan.executionPrompt}</pre>
          </section>
        ) : null}
      </div>
      {!expanded ? (
        <button
          type="button"
          className="plan-review-expand-chin"
          aria-label={t("dialogue.planReview.showFull")}
          title={t("dialogue.planReview.showFull")}
          onClick={expandPlanReview}
        >
          <span>{t("dialogue.planReview.showFull")}</span>
          <DownOutlined />
        </button>
      ) : null}
    </div>
  );
}

function PlanReviewActions({ task, onForceCancel }: { task: DesktopTask; onForceCancel?: (taskId: string) => void }) {
  const t = useT();
  const [planRevision, setPlanRevision] = useState("");
  const [submittingPlanAction, setSubmittingPlanAction] = useState<"approve" | "revise" | null>(null);
  const [cancelling, setCancelling] = useState(false);
  if (!task.plan) return null;

  const submitPlanAction = async (optionId: "approve" | "revise", answer?: string) => {
    if (!task.plan || submittingPlanAction) return;
    const trimmedAnswer = answer?.trim() ?? "";
    if (optionId === "revise" && !trimmedAnswer) return;
    setSubmittingPlanAction(optionId);
    try {
      await officecli.respond({
        taskId: task.id,
        questionId: task.plan.id,
        optionId,
        answer: trimmedAnswer || undefined,
      });
      if (optionId === "revise") {
        setPlanRevision("");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`Plan response failed: ${msg}`);
    } finally {
      setSubmittingPlanAction(null);
    }
  };

  const cancelPlan = async () => {
    setCancelling(true);
    try {
      await officecli.cancel(task.id);
      onForceCancel?.(task.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") && onForceCancel) {
        onForceCancel(task.id);
      } else {
        message.error(`Cancel failed: ${msg}`);
      }
    } finally {
      setCancelling(false);
    }
  };

  return (
    <div className="docked-composer plan-review-composer">
      <div className="plan-review-actions-panel">
        <div className="plan-review-actions-title">{t("dialogue.planReview.promptTitle")}</div>
        <Button
          className="plan-review-option-row plan-review-approve"
          loading={submittingPlanAction === "approve"}
          disabled={Boolean(submittingPlanAction)}
          onClick={() => void submitPlanAction("approve")}
        >
          <span className="plan-review-option-label">{t("dialogue.planReview.approve")}</span>
        </Button>
        <div className="plan-review-composer-row">
          <ImeInput
            prefix={<EditOutlined />}
            placeholder={t("dialogue.planReview.revisePlaceholder")}
            value={planRevision}
            onChange={(event) => setPlanRevision(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Escape" || submittingPlanAction || cancelling) return;
              event.preventDefault();
              event.stopPropagation();
              void cancelPlan();
            }}
            onPressEnter={() => void submitPlanAction("revise", planRevision)}
            disabled={Boolean(submittingPlanAction)}
          />
          <Button
            type="text"
            className="plan-review-cancel"
            onClick={() => void cancelPlan()}
            loading={cancelling}
            disabled={Boolean(submittingPlanAction)}
          >
            <span>{t("dialogue.running.cancel")}</span>
            <kbd>Esc</kbd>
          </Button>
          <Button
            className="plan-review-revise-submit"
            type="primary"
            loading={submittingPlanAction === "revise"}
            disabled={Boolean(submittingPlanAction) || !planRevision.trim()}
            onClick={() => void submitPlanAction("revise", planRevision)}
          >
            {t("dialogue.planReview.revise")}
            <span className="plan-review-submit-key">↵</span>
          </Button>
        </div>
      </div>
    </div>
  );
}

function HistoryPlanDetails({ task }: { task: DesktopTask }) {
  const t = useT();
  if (!task.plan) return null;
  return (
    <details className="history-plan-details">
      <summary>{t("dialogue.history.viewPlan")}</summary>
      <pre className="history-plan-markdown">{task.plan.markdown}</pre>
      {task.plan.executionPrompt ? (
        <>
          <strong>{t("dialogue.history.executionPrompt")}</strong>
          <pre className="history-plan-execution-prompt">{task.plan.executionPrompt}</pre>
        </>
      ) : null}
    </details>
  );
}

/* ─── Task Result Message (completed / failed / cancelled) ─── */

function TaskResultMessage({ task, onPreview, onOpenLogin, onUseAsReference, onRetryTask }: {
  task: DesktopTask;
  onPreview: (artifact: Artifact) => void;
  onOpenLogin: () => void;
  onUseAsReference: (path: string) => void;
  onRetryTask?: (task: DesktopTask) => void;
}) {
  const t = useT();
  const capability = useReportCapability();
  const [reportOpen, setReportOpen] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishTemplates, setPublishTemplates] = useState<ImagePromptTemplate[]>([]);
  const [publishTemplateId, setPublishTemplateId] = useState("");
  const [publishLoading, setPublishLoading] = useState(false);
  const [publishSubmitting, setPublishSubmitting] = useState(false);
  const [publishError, setPublishError] = useState("");
  const failed = task.status === "failed";
  const completed = task.status === "completed";
  const artifact = task.artifact;
  const latestEvent = task.events.at(-1);
  const creditTag = renderCreditTag(task, t);
  const imagePublishRequestID = latestRequestID(task);
  const canRetry = failed && Boolean(task.userInput?.prompt.trim()) && Boolean(onRetryTask);

  useEffect(() => {
    if (capability?.enabled || completed) return;
    let c = false;
    officecli.peekReportContext(task.id).then((ctx) => {
      if (!c) setRequestId(ctx.requestId || null);
    }).catch(() => {});
    return () => { c = true; };
  }, [task.id, capability?.enabled, completed]);

  async function openPublishDialog() {
    setPublishOpen(true);
    setPublishError("");
    setPublishLoading(true);
    try {
      const items = await officecli.listImageTemplates();
      const privateItems = items.filter((item) => item.enabled && item.visibility === "user_private");
      setPublishTemplates(privateItems);
      setPublishTemplateId(privateItems[0] ? String(privateItems[0].id) : "");
    } catch (error) {
      setPublishError(error instanceof Error ? error.message : String(error));
      setPublishTemplates([]);
      setPublishTemplateId("");
    } finally {
      setPublishLoading(false);
    }
  }

  async function submitPublishRequest() {
    const privateTemplateID = Number(publishTemplateId);
    if (!imagePublishRequestID || !Number.isFinite(privateTemplateID) || privateTemplateID <= 0) return;
    setPublishSubmitting(true);
    try {
      await officecli.createImageTemplatePublishRequest({
        privateTemplateID,
        requestID: imagePublishRequestID,
        submitterNote: "",
      });
      setPublishOpen(false);
      void message.success(t("dialogue.completed.publishTemplateSuccess"));
    } catch (error) {
      void message.error(t("dialogue.completed.publishTemplateError", { error: error instanceof Error ? error.message : String(error) }));
    } finally {
      setPublishSubmitting(false);
    }
  }

  if (completed) {
    const completionMessage = eventText(latestEvent);
    const duration = taskDurationLabel(task.events, t);
    const completedAt = formatLocalTimestamp(artifact?.syncedAt) || formatLocalTimestamp(latestEvent?.ts) || t("dialogue.completed.completionTimeUnknown");
    const resultMessage = completionMessage || t("dialogue.completed.completionFallback");
    const publishMenu: MenuProps | undefined = imagePublishRequestID ? {
      items: [
        {
          key: "publish-template",
          label: t("dialogue.completed.publishTemplateAction"),
        },
      ],
      onClick: ({ key }) => {
        if (key === "publish-template") void openPublishDialog();
      },
    } : undefined;

    return (
      <div className="message ai-message success has-copy">
        <MessageCopyButton text={resultMessage} ariaLabel={t("dialogue.messageCopy.assistant")} />
        <div className="message-author">
          <CheckCircleFilled />
          <strong>{t("dialogue.completed.title")}</strong>
          <Tag color="green">{duration}</Tag>
          {creditTag}
        </div>
        <p>{resultMessage}</p>
        {artifact ? (
          isImageArtifact(artifact) ? (
            <div className="result-image-card">
              <InlineImagePreview artifact={artifact} />
              <div className="result-image-meta">
                <strong>{artifact.fileName}</strong>
                <span>{t("dialogue.completed.imageMeta", { type: artifact.documentType.toUpperCase(), time: completedAt })}</span>
              </div>
              <ImageWatermarkNotice task={task} />
              <div className="result-image-actions result-image-actions-single-row">
                <Button size="middle" aria-label={t("dialogue.completed.open")} icon={<PlayCircleOutlined />} onClick={() => officecli.openPath(artifact.filePath)}>
                  {t("dialogue.completed.open")}
                </Button>
                <Button size="middle" aria-label={t("dialogue.completed.continueEditing")} icon={<LinkOutlined />} onClick={() => onUseAsReference(artifact.filePath)}>
                  {t("dialogue.completed.continueEditing")}
                </Button>
                <div className="result-image-file-actions">
                  <Button size="middle" aria-label={t("dialogue.completed.showInFolder")} icon={<FolderOpenOutlined />} onClick={() => officecli.showItemInFolder(artifact.filePath)}>
                    {t("dialogue.completed.showInFolder")}
                  </Button>
                  {publishMenu ? (
                    <Dropdown menu={publishMenu} trigger={["click"]} placement="bottomRight">
                      <Button size="middle" aria-label={t("dialogue.completed.moreActions")} icon={<MoreOutlined />} />
                    </Dropdown>
                  ) : null}
                </div>
              </div>
              <Modal
                open={publishOpen}
                title={t("dialogue.completed.publishTemplateTitle")}
                onCancel={() => setPublishOpen(false)}
                onOk={submitPublishRequest}
                okText={t("dialogue.completed.publishTemplateSubmit")}
                okButtonProps={{ disabled: !publishTemplateId || publishLoading, loading: publishSubmitting }}
                cancelText={t("dialogue.imageTemplates.confirmReplaceCancel")}
              >
                <div className="image-template-publish-form">
                  <label htmlFor={`publish-template-${task.id}`}>{t("dialogue.completed.publishTemplateSelect")}</label>
                  {publishLoading ? (
                    <div className="image-template-status"><Spin size="small" /> <span>{t("dialogue.imageTemplates.loading")}</span></div>
                  ) : publishError ? (
                    <div className="image-template-status image-template-status-error">{publishError}</div>
                  ) : publishTemplates.length === 0 ? (
                    <div className="image-template-status">{t("dialogue.completed.publishTemplateEmpty")}</div>
                  ) : (
                    <select
                      id={`publish-template-${task.id}`}
                      value={publishTemplateId}
                      onChange={(event) => setPublishTemplateId(event.target.value)}
                    >
                      {publishTemplates.map((template) => (
                        <option key={template.id} value={template.id}>{template.title}</option>
                      ))}
                    </select>
                  )}
                </div>
              </Modal>
            </div>
          ) : (
            <div className="result-card">
              <FileGlyph type={artifact.documentType} />
              <div>
                <strong>{artifact.fileName}</strong>
                <span>{t("dialogue.completed.docMeta", { type: artifact.documentType.toUpperCase(), time: completedAt })}</span>
              </div>
              <Space>
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => officecli.openPath(artifact.filePath)}>
                  {t("dialogue.completed.open")}
                </Button>
                {supportsOfflinePreview(artifact) ? <Button onClick={() => onPreview(artifact)}>{t("dialogue.completed.preview")}</Button> : null}
                <Button icon={<FolderOpenOutlined />} onClick={() => officecli.showItemInFolder(artifact.filePath)}>
                  {t("dialogue.completed.showInFolder")}
                </Button>
              </Space>
            </div>
          )
        ) : null}
        <HistoryPlanDetails task={task} />
      </div>
    );
  }

  // failed or cancelled
  const rawDescription = failed
    ? task.error || eventText(latestEvent) || t("dialogue.terminal.failed.fallback")
    : eventText(latestEvent) || t("dialogue.terminal.cancelled.fallback");
  const creditsExhausted = failed && isCreditsExhaustedError(rawDescription);
  const title = creditsExhausted
    ? t("dialogue.terminal.creditsExhausted.title")
    : failed
      ? t("dialogue.terminal.failed.title")
      : t("dialogue.terminal.cancelled.title");
  const description = creditsExhausted
    ? t("dialogue.terminal.creditsExhausted.message")
    : rawDescription;

  return (
    <div className={`message ai-message terminal has-copy ${failed ? "failed" : "cancelled"}`}>
      <MessageCopyButton text={description} ariaLabel={t("dialogue.messageCopy.assistant")} />
      <div className="message-author">
        {failed ? <CloseCircleOutlined /> : <StopOutlined />}
        <strong>{title}</strong>
        <Tag color={failed ? "red" : "default"}>{task.status}</Tag>
        {creditTag}
      </div>
      <p>{description}</p>
      <HistoryPlanDetails task={task} />
      <Space size="small" wrap>
        {canRetry ? (
          <Button size="small" type="primary" icon={<CloudOutlined aria-hidden />} onClick={() => onRetryTask?.(task)}>
            {t("dialogue.failure.button.retry")}
          </Button>
        ) : null}
        {creditsExhausted ? (
          <Button size="small" type="primary" icon={<UserOutlined />} onClick={onOpenLogin}>
            {t("dialogue.terminal.creditsExhausted.signIn")}
          </Button>
        ) : capability?.enabled ? (
          <Button size="small" onClick={() => setReportOpen(true)}>
            {t("dialogue.terminal.reportIssue")}
          </Button>
        ) : requestId ? (
          <Button size="small" icon={<CopyOutlined />} onClick={() => { void navigator.clipboard.writeText(requestId).then(() => { void message.success(t("report.toast.copiedRequestId")); }); }}>
            {t("dialogue.terminal.copyRequestId")}
          </Button>
        ) : (
          <Tooltip title={t("dialogue.terminal.noRequestId")}>
            <Button size="small" disabled>
              {t("dialogue.terminal.copyRequestId")}
            </Button>
          </Tooltip>
        )}
      </Space>
      <div className="terminal-event-card">
        <span>{t("dialogue.history.taskIdLabel")}</span>
        <strong>{task.id}</strong>
      </div>
      {failed ? (
        <div className="terminal-events">
          <h3>{t("dialogue.terminal.eventsHeading")}</h3>
          <Timeline
            items={eventsForTimeline(task.events, t).map((event) => ({
              color: event.color,
              content: (
                <div className="timeline-copy">
                  <strong>{event.title}</strong>
                  <span>{event.meta}</span>
                </div>
              ),
            }))}
          />
        </div>
      ) : null}
      <ReportIssueDialog open={reportOpen} taskId={task.id} onClose={() => setReportOpen(false)} />
    </div>
  );
}

/* ─── Multi-Question Composer ─── */

type QuestionDraft = { optionId?: string; answer: string; freeform: string };

const questionDraftMemory = new Map<string, Record<string, QuestionDraft>>();

function questionDraftMemoryKey(taskId: string, question?: DesktopTask["question"]) {
  const questionSetKey = Array.isArray(question?.questions) && question.questions.length > 0
    ? question.questions.map((item) => item.id || item.question).join("|")
    : question?.id;
  return `${taskId}:${questionSetKey || "question"}`;
}

function readQuestionDrafts(key: string): Record<string, QuestionDraft> {
  return { ...(questionDraftMemory.get(key) ?? {}) };
}

function rememberQuestionDrafts(key: string, drafts: Record<string, QuestionDraft>) {
  questionDraftMemory.set(key, { ...drafts });
}

function draftsFromQuestionAnswers(question?: DesktopTask["question"]): Record<string, QuestionDraft> {
  const out: Record<string, QuestionDraft> = {};
  for (const item of question?.answers ?? []) {
    if (!item.questionId || !item.answer) continue;
    out[item.questionId] = {
      optionId: item.optionId,
      answer: item.answer,
      freeform: item.optionId ? "" : item.answer,
    };
  }
  return out;
}

function MultiQuestionComposer({ task, onForceCancel }: { task: DesktopTask; onForceCancel?: (taskId: string) => void }) {
  const t = useT();
  const question = task.question;
  const questions = question?.questions;
  const questionSet = Array.isArray(questions) && questions.length > 0 ? questions : undefined;
  const isPlanQuestionSet = Boolean(questionSet);
  const isMulti = Boolean(questionSet && questionSet.length > 1);
  const totalQuestions = questionSet ? questionSet.length : 1;
  const draftMemoryKey = questionDraftMemoryKey(task.id, question);
  const persistedDrafts = useMemo(() => draftsFromQuestionAnswers(question), [question?.answers]);
  const [currentIndex, setCurrentIndex] = useState(() => question?.currentIndex ?? 0);
  const [drafts, setDrafts] = useState<Record<string, QuestionDraft>>(() => ({
    ...readQuestionDrafts(draftMemoryKey),
    ...persistedDrafts,
  }));
  const [freeformValue, setFreeformValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const currentQ = questionSet ? questionSet[currentIndex] : question;
  const currentDraft = drafts[currentQ?.id ?? ""] ?? { answer: "", freeform: "" };
  const hasFreeformAnswer = currentDraft.freeform.trim().length > 0 && !currentDraft.optionId;

  function saveDrafts(nextDrafts: Record<string, QuestionDraft>) {
    rememberQuestionDrafts(draftMemoryKey, nextDrafts);
    setDrafts(nextDrafts);
  }

  useEffect(() => {
    setDrafts({
      ...readQuestionDrafts(draftMemoryKey),
      ...persistedDrafts,
    });
  }, [draftMemoryKey, persistedDrafts]);

  useEffect(() => {
    setCurrentIndex(question?.currentIndex ?? 0);
  }, [task.id, question?.id, question?.currentIndex]);

  useEffect(() => {
    if (currentQ) {
      setFreeformValue(currentDraft.freeform || "");
    }
  }, [currentIndex, currentQ?.id, currentDraft.freeform]);

  async function answerQuestion(optionId?: string, value?: string) {
    if (!currentQ || submitting) return;
    const answeredQuestion = currentQ;
    const answeredIndex = currentIndex;
    const optionAnswer = optionId ? currentQ.options.find((option) => option.id === optionId)?.label ?? optionId : "";
    const answer = value?.trim() || optionAnswer;
    if (!answer) return;
    const responseQuestionId = isPlanQuestionSet && question?.id ? question.id : answeredQuestion.id;
    const nextDrafts = {
      ...drafts,
      [answeredQuestion.id]: { optionId, answer, freeform: optionId ? "" : answer },
    };
    setSubmitting(true);
    try {
      saveDrafts(nextDrafts);
      if (isPlanQuestionSet && questionSet) {
        const responseAnswers = questionSet
          .map((item, index) => {
            const draft = nextDrafts[item.id];
            if (!draft?.answer) return null;
            return {
              questionGroupId: responseQuestionId,
              questionId: item.id,
              ...(draft.optionId ? { optionId: draft.optionId } : {}),
              answer: draft.answer,
              questionIndex: index,
            };
          })
          .filter((item): item is NonNullable<typeof item> => item !== null);
        await officecli.respond({
          taskId: task.id,
          questionId: responseQuestionId,
          ...(optionId ? { optionId, answer } : { answer }),
          answers: responseAnswers,
        });
      } else {
        await officecli.respond({
          taskId: task.id,
          questionId: responseQuestionId,
          ...(optionId ? { optionId, answer } : { answer }),
        });
      }
    } catch (err) {
      setCurrentIndex(answeredIndex);
      const msg = err instanceof Error ? err.message : String(err);
      message.error(`Response failed: ${msg}`);
    } finally {
      setSubmitting(false);
    }
  }

  function navigateTo(index: number) {
    if (!currentQ) {
      setCurrentIndex(index);
      return;
    }
    const draft = freeformValue.trim();
    const selectedOptionId = draft ? undefined : currentDraft.optionId;
    saveDrafts({
      ...drafts,
      [currentQ?.id ?? ""]: {
        optionId: selectedOptionId,
        answer: draft || currentDraft.answer,
        freeform: draft || currentDraft.freeform,
      },
    });
    setCurrentIndex(index);
  }

  function updateFreeformValue(value: string) {
    setFreeformValue(value);
    if (!currentQ) return;
    const trimmed = value.trim();
    saveDrafts({
      ...drafts,
      [currentQ.id]: {
        optionId: trimmed ? undefined : currentDraft.optionId,
        answer: trimmed,
        freeform: value,
      },
    });
  }

  function submitFreeform(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const answer = freeformValue.trim();
    if (!answer) return;
    answerQuestion(undefined, answer);
  }

  if (!currentQ) return null;

  return (
    <div className="docked-composer question-composer multi-question-composer">
      {isMulti ? (
        <div className="multi-question-progress">
          <button
            type="button"
            className="multi-question-nav-btn"
            disabled={currentIndex <= 0}
            onClick={() => navigateTo(currentIndex - 1)}
            aria-label={t("dialogue.question.previous")}
          >
            ‹
          </button>
          <span className="multi-question-counter">
            {t("dialogue.question.progress", { current: currentIndex + 1, total: totalQuestions })}
          </span>
          <button
            type="button"
            className="multi-question-nav-btn"
            disabled={currentIndex >= totalQuestions - 1}
            onClick={() => navigateTo(currentIndex + 1)}
            aria-label={t("dialogue.question.next")}
          >
            ›
          </button>
        </div>
      ) : null}

      <div className="question-composer-prompt">
        <span className="question-composer-badge">Q{currentIndex + 1}</span>
        <span className="question-composer-title">{currentQ.question}</span>
      </div>

      <div className="question-composer-options">
        {(currentQ.options.length > 0 ? currentQ.options : [
          { id: "include", label: t("dialogue.question.option.include") },
          { id: "skip", label: t("dialogue.question.option.skip") },
        ] as Array<{ id: string; label: string; description?: string; recommended?: boolean }>).map((option) => (
          <Button
            key={option.id}
            className="question-composer-option"
            type={currentDraft.optionId === option.id ? "primary" : "default"}
            onClick={() => answerQuestion(option.id)}
            disabled={submitting}
          >
            {option.label}
            {option.recommended ? <Tag aria-hidden="true" style={{ marginLeft: 4 }} color="processing">{t("dialogue.question.recommended")}</Tag> : null}
          </Button>
        ))}
      </div>

      {currentQ.allowFreeform !== false ? (
        <form className={`inline-answer${hasFreeformAnswer ? " user-answer-selected" : ""}`} onSubmit={submitFreeform}>
          <ImeInput
            placeholder={t("dialogue.question.inputPlaceholder")}
            disabled={submitting}
            value={freeformValue}
            onChange={(event) => updateFreeformValue(event.target.value)}
          />
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={submitting} />
        </form>
      ) : null}

      <Button danger icon={<StopOutlined />} onClick={async () => {
        try {
          await officecli.cancel(task.id);
          onForceCancel?.(task.id);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("not found") && onForceCancel) {
            onForceCancel(task.id);
          } else {
            message.error(`Cancel failed: ${msg}`);
          }
        }
      }}>
        {t("dialogue.running.cancel")}
      </Button>
    </div>
  );
}

/* ─── Conversation Footer ─── */

function ConversationFooter({ latestTask, onContinueGeneration, onContinueModify, onForceCancel, referenceImages, onReferenceImagesChange }: {
  latestTask: DesktopTask;
  onContinueGeneration?: (documentType: string, prompt: string, referenceImages?: string[], imageRatio?: ImageRatio, fps?: number) => void;
  onContinueModify?: (documentType: string, prompt: string) => void;
  onForceCancel?: (taskId: string) => void;
  referenceImages: string[];
  onReferenceImagesChange: (next: string[]) => void;
}) {
  const t = useT();
  const status = latestTask.status;
  const artifact = latestTask.artifact;
  const docType = latestTask.documentType || artifact?.documentType || "docx";
  const isGIFGeneration = docType === "gif" || (artifact ? isGIFArtifact(artifact) : false);
  const isImageGeneration = !isGIFGeneration && (docType === "img" || (artifact ? isImageArtifact(artifact) : false));
  const [imageRatio, setImageRatio] = useState<ImageRatio>(() => normalizeImageRatio(latestTask.userInput?.imageRatio));
  const [gifFPS, setGIFFPS] = useState<number>(() => normalizeGIFFPS(latestTask.userInput?.fps));
  const [continuationPrompt, setContinuationPrompt] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const referenceImagesSpec = getAttachmentSpec(isGIFGeneration ? "gif" : "img", "referenceImages");
  const referenceImageMaxCount = referenceImagesSpec?.maxCount ?? 6;

  useEffect(() => {
    setImageRatio(normalizeImageRatio(latestTask.userInput?.imageRatio));
  }, [latestTask.id, latestTask.userInput?.imageRatio]);

  useEffect(() => {
    setGIFFPS(normalizeGIFFPS(latestTask.userInput?.fps));
  }, [latestTask.id, latestTask.userInput?.fps]);

  if (status === "plan_review" && latestTask.plan) {
    return (
      <PlanReviewActions
        key={`${latestTask.id}:${latestTask.plan.id}:${latestTask.plan.revision}`}
        task={latestTask}
        onForceCancel={onForceCancel}
      />
    );
  }
  if (status === "plan_review") return null;

  // Running / Starting / Question: readonly composer with cancel
  if (status === "running" || status === "starting") {
    return (
      <div className="docked-composer readonly">
        <ImeInput prefix={<PaperClipOutlined />} suffix={<LoadingOutlined />} placeholder={t("dialogue.running.placeholder")} disabled />
        <Button danger icon={<StopOutlined />} loading={cancelling} onClick={async () => {
          setCancelling(true);
          try {
            await officecli.cancel(latestTask.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes("not found") && onForceCancel) {
              onForceCancel(latestTask.id);
            } else {
              message.error(`Cancel failed: ${msg}`);
            }
          } finally {
            setCancelling(false);
          }
        }}>
          {t("dialogue.running.cancel")}
        </Button>
      </div>
    );
  }

  if (status === "question" && isVibeCanvasTask(latestTask)) {
    return <VibeCanvasCommandBar task={latestTask} onForceCancel={onForceCancel} />;
  }

  // Question: show answer form
  if (status === "question" && latestTask.question) {
    return <MultiQuestionComposer task={latestTask} onForceCancel={onForceCancel} />;
  }

  // Completed / Failed / Cancelled: show continuation composer for ALL types
  if (status === "completed" || status === "failed" || status === "cancelled") {
    // Completed office documents (pptx/docx/xlsx) support in-place "continue editing" via office.modify.
    const isModifiable = status === "completed" && Boolean(artifact) && isModifiableArtifact(artifact!) && Boolean(onContinueModify);
    // Disable input only for completed non-image, non-modifiable artifacts (e.g. report).
    const inputDisabled = Boolean(artifact && !isImageArtifact(artifact) && !isModifiable);
    const supportsReferenceImages = isImageGeneration || isGIFGeneration;
    const referenceLimitReached = referenceImages.length >= referenceImageMaxCount;
    const pickReferenceImages = async () => {
      if (!referenceImagesSpec || referenceLimitReached) return;
      try {
        const paths = await officecli.openMultiFileDialog({
          filters: [{ name: referenceImagesSpec.label, extensions: referenceImagesSpec.extensions }],
        });
        if (paths && paths.length > 0) {
          onReferenceImagesChange(mergeUniquePaths(referenceImages, paths, referenceImageMaxCount));
        }
      } catch {
        // File picking is user-driven and non-critical; cancellation should not surface as an error.
      }
    };
    const handleFooterPaste = supportsReferenceImages ? (event: ClipboardEvent<HTMLElement>) => {
      const items = event.clipboardData?.files;
      if (!items || items.length === 0) return;
      const images = imageFilesFrom(items);
      if (images.length === 0) return;
      event.preventDefault();
      if (referenceLimitReached) {
        message.warning(t("dialogue.attach.referenceImages.limit", { max: referenceImageMaxCount }));
        return;
      }
      const allowedExtensions = new Set((referenceImagesSpec?.extensions ?? IMAGE_EXTENSIONS).map((e) => e.toLowerCase()));
      void (async () => {
        const savedPaths: string[] = [];
        for (const file of images) {
          if (referenceImages.length + savedPaths.length >= referenceImageMaxCount) break;
          const ext = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() : undefined;
          const resolvedExt = ext && allowedExtensions.has(ext) ? ext : "png";
          try {
            const buffer = await file.arrayBuffer();
            const path = await officecli.savePastedImage(new Uint8Array(buffer), resolvedExt);
            if (path && !referenceImages.includes(path) && !savedPaths.includes(path)) {
              savedPaths.push(path);
            }
          } catch { /* skip failed saves */ }
        }
        if (savedPaths.length === 0) return;
        onReferenceImagesChange(mergeUniquePaths(referenceImages, savedPaths, referenceImageMaxCount));
        message.success(savedPaths.length === 1 ? t("dialogue.attach.paste.attached") : t("dialogue.attach.paste.attachedMany", { count: savedPaths.length }));
      })().catch((error) => {
        message.error(t("dialogue.attach.paste.error", { error: (error as Error).message }));
      });
    } : undefined;

    const submitContinuation = () => {
      if (inputDisabled || !continuationPrompt.trim()) return;
      if (isModifiable && onContinueModify) {
        onContinueModify(docType, continuationPrompt.trim());
      } else if (onContinueGeneration) {
        const refs = referenceImages.length > 0 ? referenceImages : undefined;
        if (isGIFGeneration) {
          onContinueGeneration(docType, continuationPrompt.trim(), refs, undefined, gifFPS);
        } else {
          onContinueGeneration(docType, continuationPrompt.trim(), refs, isImageGeneration ? imageRatio : undefined);
        }
      } else {
        return;
      }
      setContinuationPrompt("");
      onReferenceImagesChange([]);
    };

    return (
      <div className="docked-composer" data-testid="continuation-composer">
        {referenceImages.length > 0 ? (
          <ReferenceImageStrip
            items={referenceImages}
            maxCount={referenceImageMaxCount}
            onRemove={(path) => onReferenceImagesChange(referenceImages.filter((p) => p !== path))}
            onAdd={pickReferenceImages}
          />
        ) : null}
        {isImageGeneration ? (
          <div className="image-ratio-row image-ratio-row-compact">
            <span>{t("dialogue.imageRatio.label")}</span>
            <Radio.Group
              optionType="button"
              options={imageRatioOptions(t)}
              value={imageRatio}
              onChange={(event) => setImageRatio(normalizeImageRatio(event.target.value))}
            />
          </div>
        ) : null}
        {isGIFGeneration ? (
          <div className="image-ratio-row image-ratio-row-compact">
            <span>{t("dialogue.gifFps.label")}</span>
            <InputNumber
              min={GIF_FPS_MIN}
              max={GIF_FPS_MAX}
              precision={0}
              value={gifFPS}
              aria-label={t("dialogue.gifFps.label")}
              onChange={(value) => setGIFFPS(normalizeGIFFPS(value))}
            />
          </div>
        ) : null}
        <div className="composer-row">
          {supportsReferenceImages ? (
            <Tooltip title={t("dialogue.attach.referenceImages.tooltip", { max: referenceImageMaxCount })}>
              <Button
                className="reference-image-upload-button"
                icon={<MaterialSymbol name="image" />}
                onClick={pickReferenceImages}
                disabled={inputDisabled || referenceLimitReached}
                aria-label={t("dialogue.attach.referenceImages.attach")}
              >
                {t("dialogue.attach.referenceImages.uploadCta")}
              </Button>
            </Tooltip>
          ) : null}
          <ImeTextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={artifact && isImageArtifact(artifact) ? t("dialogue.completed.continuationPlaceholder") : isModifiable ? t("dialogue.completed.modifyPlaceholder") : t("dialogue.completed.askPlaceholder")}
            value={continuationPrompt}
            onChange={(e) => setContinuationPrompt(e.target.value)}
            disabled={inputDisabled}
            onPaste={handleFooterPaste}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                submitContinuation();
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            aria-label={t("dialogue.generate")}
            disabled={inputDisabled || !continuationPrompt.trim()}
            onClick={submitContinuation}
          />
        </div>
      </div>
    );
  }

  // Fallback: readonly composer
  return (
    <div className="docked-composer readonly">
      <ImeInput disabled suffix={<SendOutlined />} placeholder={t("dialogue.completed.askPlaceholder")} />
    </div>
  );
}

function ConnectionFailure({ kind, status, error, details, onOpenSettings, onRetry, onOpenLogin }: { kind: FailureKind; status: string; error: string; details?: string; onOpenSettings: () => void; onRetry: () => void; onOpenLogin: () => void }) {
  const t = useT();
  const copy = failureCopy(kind, t);
  const isSetup = kind === "setup";
  return (
    <div className="failure-workspace">
      <div className="failure-banner">
        <WarningFilled />
        <span>{copy.banner}</span>
        {kind === "auth" ? (
          <Button size="small" onClick={onOpenLogin}>
            {t("dialogue.failure.button.login")}
          </Button>
        ) : (
          <Button size="small" onClick={onOpenSettings}>
            {t("dialogue.failure.button.settings")}
          </Button>
        )}
        {isSetup ? null : (
          <Button size="small" type="primary" onClick={onRetry}>
            {t("dialogue.failure.button.retry")}
          </Button>
        )}
      </div>
      <div className="failure-center">
        {kind === "connection" ? <DisconnectOutlined /> : <WarningFilled />}
        <h1>{copy.title}</h1>
        <p>{error || status}</p>
        {details ? <FailureDetails details={details} /> : null}
        <Space>
          {kind === "auth" ? (
            <Button type="primary" icon={<UserOutlined />} onClick={onOpenLogin}>
              {t("dialogue.failure.button.signIn")}
            </Button>
          ) : isSetup ? (
            <Button type="primary" icon={<FileTextOutlined />} onClick={onOpenSettings}>
              {copy.primaryAction}
            </Button>
          ) : (
            <Button type="primary" icon={<CloudOutlined />} onClick={onRetry}>
              {copy.primaryAction}
            </Button>
          )}
          {isSetup ? (
            <Button icon={<CloudOutlined />} onClick={onRetry}>
              {t("dialogue.failure.button.retry")}
            </Button>
          ) : (
            <Button icon={<FileTextOutlined />} onClick={onOpenSettings}>
              {t("dialogue.failure.button.openSettings")}
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}

function FailureDetails({ details }: { details: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const summaryLabel = open ? t("dialogue.failure.hideDetails") : t("dialogue.failure.showDetails");
  async function copy() {
    try {
      await navigator.clipboard.writeText(details);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
    window.setTimeout(() => setCopyState("idle"), 2000);
  }
  const copyLabel =
    copyState === "copied" ? t("dialogue.failure.copied") :
    copyState === "failed" ? t("dialogue.failure.copyFailed") :
    t("dialogue.failure.copy");
  return (
    <details
      className="failure-details-block"
      open={open}
      onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}
    >
      <summary>{summaryLabel}</summary>
      <pre className="failure-details">{details}</pre>
      <div className="failure-details-actions">
        <Button size="small" icon={<CopyOutlined />} onClick={copy} aria-label={copyLabel}>
          {copyLabel}
        </Button>
      </div>
    </details>
  );
}

function failureCopy(kind: FailureKind, t: Translator): { banner: string; title: string; primaryAction: string } {
  return {
    banner: t(`dialogue.failure.${kind}.banner`),
    title: t(`dialogue.failure.${kind}.title`),
    primaryAction: t(`dialogue.failure.${kind}.primary`),
  };
}

function FluidProgressPanel({ task }: { task: DesktopTask }) {
  const t = useT();
  const stages = task.stages ?? [];
  const startedMessage = startedEventText(task.events);
  const completedCount = stages.filter((s) => s.status === "completed").length;
  const failedCount = stages.filter((s) => s.status === "failed").length;
  const hasActive = stages.some((s) => s.status === "active");
  const status = task.status;
  const isRunning = status === "running" || status === "starting" || status === "question" || status === "plan_review";
  const percent = !isRunning
    ? 100
    : stages.length === 0
      ? 12
      : Math.round(((completedCount + (hasActive ? 0.5 : 0)) / stages.length) * 100);
  const header = headerForStatus(status, t);
  const panelClassName = `fluid-progress-panel stage-progress-panel stage-panel-${status}${!isRunning ? " stage-panel-terminal" : ""}`;
  return (
    <div className={panelClassName}>
      <div className="message-author">
        {header.icon}
        <strong>{header.title}</strong>
        <Tag color={header.tagColor}>{header.tagText}</Tag>
      </div>
      {startedMessage ? <div className="stage-banner">{startedMessage}</div> : null}
      {stages.length === 0 ? (
        <div className="stage-empty">
          {isRunning ? <LoadingOutlined /> : <CheckCircleFilled />}
          <span>{isRunning ? t("dialogue.progress.preparing") : t("dialogue.progress.noStages")}</span>
        </div>
      ) : (
        <ul className="stage-list">
          {stages.map((stage) => (
            <li key={stage.id} className={`stage-item stage-${stage.status}`}>
              <StageDot status={stage.status} />
              <span className="stage-label">{stage.label}</span>
              <StageMeta stage={stage} />
            </li>
          ))}
        </ul>
      )}
      <Progress
        percent={percent}
        showInfo={false}
        status={status === "failed" ? "exception" : failedCount > 0 ? "exception" : isRunning ? "active" : "success"}
      />
    </div>
  );
}

function headerForStatus(status: DesktopTask["status"], t: Translator) {
  switch (status) {
    case "completed":
      return { icon: <CheckCircleFilled />, title: t("dialogue.progress.header.completed.title"), tagColor: "green", tagText: t("dialogue.progress.header.completed.tag") };
    case "failed":
      return { icon: <CloseCircleFilled />, title: t("dialogue.progress.header.failed.title"), tagColor: "red", tagText: t("dialogue.progress.header.failed.tag") };
    case "cancelled":
      return { icon: <StopOutlined />, title: t("dialogue.progress.header.cancelled.title"), tagColor: "default", tagText: t("dialogue.progress.header.cancelled.tag") };
    case "question":
      return { icon: <LoadingOutlined />, title: t("dialogue.progress.header.question.title"), tagColor: "processing", tagText: t("dialogue.progress.header.question.tag") };
    case "plan_review":
      return { icon: <FileTextOutlined />, title: t("dialogue.progress.header.planReview.title"), tagColor: "processing", tagText: t("dialogue.progress.header.planReview.tag") };
    default:
      return { icon: <LoadingOutlined />, title: t("dialogue.progress.header.running.title"), tagColor: "processing", tagText: t("dialogue.progress.header.running.tag") };
  }
}


function startedEventText(events: BridgeEvent[]): string {
  const started = events.find((event) => event.type === "task.started");
  return started ? eventText(started) : "";
}

function StageDot({ status }: { status: StageState["status"] }) {
  if (status === "active") return <LoadingOutlined className="stage-dot stage-dot-active" aria-hidden />;
  if (status === "completed") return <CheckCircleFilled className="stage-dot stage-dot-completed" aria-hidden />;
  if (status === "failed") return <CloseCircleFilled className="stage-dot stage-dot-failed" aria-hidden />;
  return <span className="stage-dot stage-dot-pending" aria-hidden />;
}

function StageMeta({ stage }: { stage: StageState }) {
  const liveSeconds = useElapsedSeconds(stage.status === "active" ? stage.startedAt : undefined);
  if (stage.status === "active") {
    return <span className="stage-meta">… {formatSeconds(liveSeconds)}</span>;
  }
  if (stage.status === "completed" || stage.status === "failed") {
    const duration = stageDurationSeconds(stage);
    if (duration > 0) return <span className="stage-meta">{formatSeconds(duration)}</span>;
  }
  return null;
}

function useElapsedSeconds(startedAt?: string): number {
  const now = useNow(200);
  if (!startedAt) return 0;
  const start = Date.parse(startedAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, (now - start) / 1000);
}

function stageDurationSeconds(stage: StageState): number {
  if (!stage.startedAt || !stage.completedAt) return 0;
  const start = Date.parse(stage.startedAt);
  const end = Date.parse(stage.completedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return (end - start) / 1000;
}

function formatSeconds(seconds: number): string {
  if (seconds >= 60) return `${Math.round(seconds / 60)}m`;
  return seconds >= 10 ? `${Math.round(seconds)}s` : `${seconds.toFixed(1)}s`;
}

function eventsForTimeline(events: BridgeEvent[], t: Translator) {
  const fallback = [
    { title: t("dialogue.terminal.events.waiting"), meta: t("dialogue.terminal.events.noProgress"), color: "gray" },
  ];
  if (events.length === 0) return fallback;
  return events.map((event) => ({
    title: event.type,
    meta: eventMeta(event, t),
    color: event.type === "task.failed" ? "red" : event.type === "task.completed" ? "green" : "blue",
  }));
}

function eventText(event?: BridgeEvent): string {
  const payload = event?.payload || {};
  return String(payload.message || payload.stage || payload.status || payload.question || "");
}

function latestRequestID(task: DesktopTask): string {
  for (let i = task.events.length - 1; i >= 0; i -= 1) {
    const event = task.events[i];
    const requestID = event.request_id || (typeof event.payload?.request_id === "string" ? event.payload.request_id : "");
    if (requestID.trim()) return requestID.trim();
  }
  return "";
}

// Recognises the officecli error emitted when the device's anonymous credit
// pool is depleted (e.g. "Anonymous credits are exhausted. Run `officecli
// login`, then buy hosted credits for your account."). The wording can shift
// across CLI versions, so we match the durable phrase plus the login hint.
export function isCreditsExhaustedError(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (!lower.includes("anonymous") || !lower.includes("credit")) return false;
  return (
    lower.includes("credits are exhausted") ||
    lower.includes("credits exhausted") ||
    (lower.includes("credit") && lower.includes("officecli login"))
  );
}

function formatLocalTimestamp(ts: string | undefined | null): string {
  if (!ts) return "";
  const ms = Date.parse(ts);
  if (!Number.isFinite(ms)) return ts;
  const d = new Date(ms);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function eventMeta(event: BridgeEvent, t: Translator): string {
  const text = eventText(event) || t("dialogue.terminal.events.fallback");
  const ts = formatLocalTimestamp(event.ts);
  return ts ? `${ts} · ${text}` : text;
}

function ImageWatermarkNotice({ task }: { task: DesktopTask }) {
  const t = useT();
  const metadata = task.imageWatermark;
  if (!metadata) return null;
  const notice = metadata.canDisable
    ? t("dialogue.completed.watermarkPaidNotice")
    : metadata.applied
      ? t("dialogue.completed.watermarkFreeNotice")
      : "";
  if (!notice) return null;
  return (
    <div className={`image-watermark-notice ${metadata.canDisable ? "paid" : "free"}`}>
      <MaterialSymbol name="info" />
      <span>{notice}</span>
    </div>
  );
}

function taskSubject(task: DesktopTask, t: Translator): string {
  return task.topic || task.artifact?.fileName || task.documentType || t("dialogue.history.subject.fallback");
}

function renderCreditTag(task: DesktopTask, t: Translator) {
  if (task.status !== "completed" && task.status !== "failed") return null;
  const charged = task.creditCharged;
  if (typeof charged !== "number") {
    return (
      <Tooltip title={t("tasks.credit.legacy")}>
        <Tag color="default">—</Tag>
      </Tooltip>
    );
  }
  const mode = task.creditMode || "";
  const modeKey = mode ? `tasks.credit.mode.${mode}` : "";
  const modeLabel = modeKey ? t(modeKey) : "";
  const modeText = modeLabel && modeLabel !== modeKey ? modeLabel : mode;
  if (charged === 0) {
    return (
      <Tooltip title={t("tasks.credit.zero")}>
        <Tag color="default">{modeText ? `0 · ${modeText}` : "0"}</Tag>
      </Tooltip>
    );
  }
  const text = t("tasks.credit.unit", { count: charged });
  return <Tag color="purple">{modeText ? `${text} · ${modeText}` : text}</Tag>;
}

function taskDurationLabel(events: BridgeEvent[], t: Translator): string {
  const firstTs = events.find((event) => event.ts)?.ts;
  const lastTs = [...events].reverse().find((event) => event.ts)?.ts;
  if (!firstTs || !lastTs || firstTs === lastTs) {
    return t("dialogue.completed.duration.completed");
  }
  const start = Date.parse(firstTs);
  const end = Date.parse(lastTs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return t("dialogue.completed.duration.completed");
  }
  const seconds = Math.round((end - start) / 1000);
  return seconds > 0 ? t("dialogue.completed.duration.elapsed", { seconds }) : t("dialogue.completed.duration.completed");
}

function supportsOfflinePreview(artifact: Artifact) {
  const type = artifact.documentType.toLowerCase();
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  const supported = ["docx", "xlsx", "pptx", "pdf", "html", "htm"];
  return supported.includes(type) || supported.includes(extension);
}

function makePasteHandler(attachments: ReturnType<typeof useAttachments>, t: Translator) {
  return (event: ClipboardEvent<HTMLElement>) => {
    const items = event.clipboardData?.files;
    if (!items || items.length === 0) return;
    const images = imageFilesFrom(items);
    if (images.length === 0) return;
    if (!attachments.supportsPaste) return;
    event.preventDefault();
    if (attachments.isReferenceLimitReached) {
      message.warning(t("dialogue.attach.referenceImages.limit", { max: attachments.referenceImagesSpec?.maxCount ?? 0 }));
      return;
    }
    void attachments.handlePastedFiles(images).then((added) => {
      const max = attachments.referenceImagesSpec?.maxCount;
      if (added === 0) {
        if (max !== undefined) {
          message.warning(t("dialogue.attach.referenceImages.limit", { max }));
        }
        return;
      }
      message.success(added === 1 ? t("dialogue.attach.paste.attached") : t("dialogue.attach.paste.attachedMany", { count: added }));
    }).catch((error) => {
      message.error(t("dialogue.attach.paste.error", { error: (error as Error).message }));
    });
  };
}

function handleAttachmentDragOver(event: { dataTransfer: DataTransfer | null; preventDefault: () => void }, attachments: ReturnType<typeof useAttachments>) {
  const files = event.dataTransfer?.files;
  if (!attachments.supportsPaste || !files || imageFilesFrom(files).length === 0) return;
  event.preventDefault();
  event.dataTransfer!.dropEffect = attachments.isReferenceLimitReached ? "none" : "copy";
}

function handleAttachmentDrop(event: { dataTransfer: DataTransfer | null; preventDefault: () => void; stopPropagation: () => void }, attachments: ReturnType<typeof useAttachments>, t: Translator) {
  const files = event.dataTransfer?.files;
  if (!files || files.length === 0) return;
  const images = imageFilesFrom(files);
  if (images.length === 0) return;
  if (!attachments.supportsPaste) return;
  event.preventDefault();
  event.stopPropagation();
  if (attachments.isReferenceLimitReached) {
    message.warning(t("dialogue.attach.referenceImages.limit", { max: attachments.referenceImagesSpec?.maxCount ?? 0 }));
    return;
  }
  void attachments.handlePastedFiles(images).then((added) => {
    const max = attachments.referenceImagesSpec?.maxCount;
    if (added === 0) {
      if (max !== undefined) {
        message.warning(t("dialogue.attach.referenceImages.limit", { max }));
      }
      return;
    }
    message.success(added === 1 ? t("dialogue.attach.paste.attached") : t("dialogue.attach.paste.attachedMany", { count: added }));
  }).catch((error) => {
    message.error(t("dialogue.attach.paste.error", { error: (error as Error).message }));
  });
}

function imageFilesFrom(files: FileList | File[]): File[] {
  return Array.from(files).filter((file) => file.type.startsWith("image/"));
}

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"];
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
};

function ReferenceImageStrip({
  items,
  maxCount,
  onRemove,
  onAdd,
  showHeader = false,
  showBadge = false,
}: {
  items: string[];
  maxCount: number;
  onRemove: (path: string) => void;
  onAdd?: () => void;
  showHeader?: boolean;
  showBadge?: boolean;
}) {
  const t = useT();
  const cards = (
    <>
      {items.map((path) => (
        <ReferenceImageChip key={path} path={path} onRemove={() => onRemove(path)} showBadge={showBadge} />
      ))}
      {onAdd && items.length < maxCount ? (
        <button type="button" className="reference-image-add" onClick={onAdd} aria-label={t("dialogue.attach.referenceImages.aria")}>
          <MaterialSymbol name="add_photo_alternate" />
          <span>{items.length === 0 ? t("dialogue.attach.referenceImages.add") : t("dialogue.attach.referenceImages.addMore")}</span>
        </button>
      ) : null}
    </>
  );

  if (showHeader) {
    return (
      <div className="reference-image-strip reference-image-strip-with-header" aria-label={t("dialogue.attach.referenceImages.aria.strip")}>
        <div className="reference-image-strip-header">
          <div className="reference-image-strip-title-block">
            <div className="reference-image-strip-title">
              <MaterialSymbol name="photo_library" />
              <strong>{t("dialogue.attach.referenceImages.title")}</strong>
            </div>
            <span>{t("dialogue.attach.referenceImages.helper")}</span>
          </div>
          <span className="reference-image-strip-count">{items.length} / {maxCount}</span>
        </div>
        <div className="reference-image-strip-grid">
          {cards}
        </div>
      </div>
    );
  }

  return (
    <div className="reference-image-strip" aria-label={t("dialogue.attach.referenceImages.aria.strip")}>
      {cards}
    </div>
  );
}

function ReferenceImageChip({ path, onRemove, showBadge = false }: { path: string; onRemove: () => void; showBadge?: boolean }) {
  const t = useT();
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileName = path.split(/[/\\]/).pop() || path;

  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError(null);
    const cacheKey = `ref:${path}`;
    acquireBlob(cacheKey, async () => {
      const { data, mime } = await officecli.readLocalImage(path);
      const arrayBuf = data instanceof ArrayBuffer ? data : new Uint8Array(data as Uint8Array).buffer;
      return new Blob([new Uint8Array(arrayBuf as ArrayBuffer)], { type: mime || "application/octet-stream" });
    }).then((url) => {
      if (!cancelled) setSrc(url);
      else releaseBlob(cacheKey);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      releaseBlob(cacheKey);
    };
  }, [path]);

  return (
    <div className="reference-image-chip" title={path}>
      <div className="reference-image-preview">
        {showBadge ? <span className="reference-image-badge">{t("dialogue.attach.referenceImages.badge")}</span> : null}
        {src ? (
          <img src={src} alt={fileName} />
        ) : error ? (
          <div className="reference-image-preview-fallback" title={`${fileName}: ${error}`}>
            <MaterialSymbol name="broken_image" />
            <span>{t("dialogue.attach.referenceImages.previewUnavailable")}</span>
          </div>
        ) : (
          <div className="reference-image-preview-loading" aria-label={t("dialogue.attach.referenceImages.loading", { name: fileName })} />
        )}
      </div>
      <div className="reference-image-card-footer">
        <span className="reference-image-name">{fileName}</span>
        <button type="button" className="reference-image-remove" onClick={onRemove} aria-label={t("dialogue.attach.referenceImages.remove", { name: fileName })}>
          <CloseCircleFilled />
        </button>
      </div>
    </div>
  );
}

function mergeUniquePaths(current: string[], incoming: string[], maxCount: number): string[] {
  const merged = [...current];
  for (const path of incoming) {
    if (typeof path !== "string" || path.length === 0) continue;
    if (!merged.includes(path)) merged.push(path);
  }
  return merged.slice(0, maxCount);
}

function isImageArtifact(artifact: Artifact): boolean {
  const type = (artifact.documentType || "").toLowerCase();
  if (type === "img" || IMAGE_EXTENSIONS.includes(type)) return true;
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.includes(extension);
}

function isGIFArtifact(artifact: Artifact): boolean {
  const type = (artifact.documentType || "").toLowerCase();
  if (type === "gif") return true;
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  return extension === "gif";
}

// office.modify supports in-place editing of these office document types.
const MODIFIABLE_EXTENSIONS = ["pptx", "docx", "xlsx"];

function isModifiableArtifact(artifact: Artifact): boolean {
  if (isImageArtifact(artifact)) return false;
  const type = (artifact.documentType || "").toLowerCase();
  if (MODIFIABLE_EXTENSIONS.includes(type)) return true;
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  return MODIFIABLE_EXTENSIONS.includes(extension);
}

function imageExtensionFor(artifact: Artifact): string {
  const type = (artifact.documentType || "").toLowerCase();
  if (IMAGE_EXTENSIONS.includes(type)) return type;
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.includes(extension) ? extension : "png";
}

function UserMessage({ task, fallback }: { task: DesktopTask; fallback: string }) {
  const t = useT();
  const input = task.userInput;
  const prompt = input?.prompt?.trim();
  const referenceImages = input?.referenceImages ?? [];
  const sourceFile = input?.sourceFile;
  const hasAttachments = referenceImages.length > 0 || Boolean(sourceFile);
  const displayText = prompt || (hasAttachments ? "" : fallback);

  return (
    <div className="message user-message has-copy">
      <MessageCopyButton text={displayText} ariaLabel={t("dialogue.messageCopy.user")} />
      {displayText ? <div className="user-message-prompt">{displayText}</div> : null}
      {referenceImages.length > 0 ? (
        <div className="user-message-images">
          {referenceImages.map((path) => (
            <UserReferenceImage key={path} filePath={path} />
          ))}
        </div>
      ) : null}
      {sourceFile ? (
        <div className="user-message-file">
          <PaperClipOutlined />
          <span title={sourceFile}>{sourceFile.split(/[/\\]/).pop()}</span>
        </div>
      ) : null}
    </div>
  );
}

function UserReferenceImage({ filePath }: { filePath: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `ref:${filePath}`;
    acquireBlob(cacheKey, async () => {
      const { data, mime } = await officecli.readLocalImage(filePath);
      const arrayBuf = data instanceof ArrayBuffer ? data : new Uint8Array(data as Uint8Array).buffer;
      return new Blob([new Uint8Array(arrayBuf as ArrayBuffer)], { type: mime || "application/octet-stream" });
    }).then((url) => {
      if (!cancelled) setSrc(url);
      else releaseBlob(cacheKey);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      releaseBlob(cacheKey);
    };
  }, [filePath]);

  async function copyImage() {
    if (!src) return;
    try {
      await copyImageToClipboard(filePath, src);
      setCopyLabel(t("dialogue.userMessage.imageCopied"));
      void message.success(t("dialogue.userMessage.imageCopied"));
    } catch {
      setCopyLabel(t("dialogue.userMessage.imageCopyFailed"));
      void message.error(t("dialogue.userMessage.imageCopyFailed"));
    }
    window.setTimeout(() => setCopyLabel(null), 2000);
  }

  const fileName = filePath.split(/[/\\]/).pop() || filePath;

  if (error) {
    return (
      <div className="user-message-image-fallback" title={`${fileName}: ${error}`}>
        <PaperClipOutlined />
        <span>{fileName}</span>
      </div>
    );
  }
  if (!src) {
    return <div className="user-message-image-skeleton" />;
  }
  return (
    <>
      <div className="user-message-image-thumb" onClick={() => setPreviewOpen(true)}>
        <Image src={src} alt={fileName} preview={false} />
      </div>
      <Modal
        open={previewOpen}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
        width="auto"
        centered
        styles={{ body: { padding: 0 } }}
        title={fileName}
      >
        <img
          src={src}
          alt={fileName}
          style={{ maxWidth: "100%", maxHeight: "80vh", display: "block" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", gap: 8 }}>
          {copyLabel ? <span style={{ fontSize: 12, color: "var(--n-slate)" }}>{copyLabel}</span> : null}
          <Button size="small" icon={<CopyOutlined />} onClick={copyImage}>
            {t("dialogue.userMessage.copyImage")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function InlineImagePreview({ artifact }: { artifact: Artifact }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [copyLabel, setCopyLabel] = useState<string | null>(null);
  const tokenRef = useRef<string | null>(null);
  const t = useT();

  useEffect(() => {
    let cancelled = false;
    const cacheKey = `artifact:${artifact.filePath}`;
    acquireBlob(cacheKey, async () => {
      const grant = await officecli.issuePreviewToken(artifact);
      tokenRef.current = grant.token;
      const { data } = await officecli.readArtifactFile(grant.token);
      const arrayBuf = data instanceof ArrayBuffer ? data : new Uint8Array(data as Uint8Array).buffer;
      const mime = IMAGE_MIME_BY_EXT[imageExtensionFor(artifact)] || "application/octet-stream";
      return new Blob([new Uint8Array(arrayBuf as ArrayBuffer)], { type: mime });
    }).then((url) => {
      if (!cancelled) setSrc(url);
      else releaseBlob(cacheKey);
    }).catch((err) => {
      if (!cancelled) setError(err instanceof Error ? err.message : String(err));
    });
    return () => {
      cancelled = true;
      releaseBlob(cacheKey);
      if (tokenRef.current) {
        officecli.revokePreviewToken(tokenRef.current).catch(() => {});
        tokenRef.current = null;
      }
    };
  }, [artifact.filePath]);

  async function copyImage() {
    if (!src) return;
    try {
      await copyImageToClipboard(artifact.filePath, src);
      setCopyLabel(t("dialogue.completed.imageCopied"));
      void message.success(t("dialogue.completed.imageCopied"));
    } catch {
      setCopyLabel(t("dialogue.completed.imageCopyFailed"));
      void message.error(t("dialogue.completed.imageCopyFailed"));
    }
    window.setTimeout(() => setCopyLabel(null), 2000);
  }

  if (error) {
    return (
      <div className="result-image-fallback">
        <FileGlyph type={artifact.documentType} />
        <span>{error}</span>
      </div>
    );
  }
  if (!src) {
    return <div className="result-image-skeleton" />;
  }
  return (
    <>
      <div className="result-image-thumb" onClick={() => setPreviewOpen(true)}>
        <Image src={src} alt={artifact.fileName} preview={false} />
      </div>
      <Modal
        open={previewOpen}
        footer={null}
        onCancel={() => setPreviewOpen(false)}
        width="auto"
        centered
        styles={{ body: { padding: 0 } }}
        title={artifact.fileName}
      >
        <img
          src={src}
          alt={artifact.fileName}
          style={{ maxWidth: "100%", maxHeight: "80vh", display: "block" }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 12px", gap: 8 }}>
          {copyLabel ? <span style={{ fontSize: 12, color: "var(--n-slate)" }}>{copyLabel}</span> : null}
          <Button size="small" icon={<CopyOutlined />} onClick={copyImage}>
            {t("dialogue.completed.copyImage")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

async function copyImageToClipboard(filePath: string, src: string) {
  try {
    await officecli.copyImageToClipboard(filePath);
    return;
  } catch {
    await copyImageViaWebClipboard(src);
  }
}

async function copyImageViaWebClipboard(src: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
    throw new Error("image clipboard write is unavailable");
  }
  const response = await fetch(src);
  const blob = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({ [blob.type]: blob }),
  ]);
}
