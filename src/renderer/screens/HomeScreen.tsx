import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type ReactNode } from "react";
import type { DesktopTask, DocumentType, RecentFile, TaskQuestionAnswer, WorkspaceSummary } from "../../shared/types";
import type { OfficeOutputRef } from "../../shared/officeProduct";
import { OfficeProductOutputsPanel } from "../components/OfficeProductOutputsPanel";
import { Button, Dropdown, Empty, Loading, TextArea, ToastViewport, toast, type MenuProps } from "../ui";
import { dragHasFiles, setHomeDropZone } from "../homeDropZone";
import type { HomeTaskAnalysis, HomeTaskIntake } from "../homeIntake";
import {
  ArrowUpOutlined,
  CloseOutlined,
  FileTextOutlined,
  DownOutlined,
  FolderAddOutlined,
  FolderUnsetOutlined,
  FolderOpenOutlined,
  LeftOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  RightOutlined,
} from "../ui/icons";
import { useT } from "../i18n";
import { ProgressivePptxStage } from "../presentation/ProgressivePptxStage";
import type { PresentationEditorFrameProps } from "../presentation/PresentationEditorFrame";
import { fileExtension, fileNameFromPath } from "../utils/path";
import { MaterialSymbol } from "../components/Shell";
import { DocTypeIcon, docTypeFromPath } from "../components/DocTypeIcon";
import { RuntimePrompts } from "../components/RuntimePrompts";
import "../styles/home.css";
import { taskTitle } from "../taskTitle";

type HomeDocumentType = Extract<DocumentType, "pptx" | "img" | "docx" | "xlsx">;

/** What the intake form may ask the desktop to browse for. */
export interface HomePickers {
  taskFile?: () => Promise<string | undefined>;
  taskDirectory?: () => Promise<string | undefined>;
  referenceImages?: () => Promise<string[]>;
  referenceTextFiles?: () => Promise<string[]>;
}

/** Everything a listed task can be asked to do. */
export interface HomeTaskActions {
  checkStatus?: (task: DesktopTask) => Promise<void>;
  retryFailed?: (task: DesktopTask, checkpoint: string) => Promise<void>;
  skipResearch?: (task: DesktopTask) => Promise<void>;
  open?: (taskId: string) => void;
  retry?: (task: DesktopTask) => void;
  steer?: (task: DesktopTask, instruction: string) => void | Promise<void>;
  resume?: (task: DesktopTask, outline?: Array<{ id: string; title: string; detail?: string; estimatedSlides?: number }>) => void | Promise<void>;
  answer?: (task: DesktopTask, answer: TaskQuestionAnswer) => void | Promise<void>;
  cancel?: (task: DesktopTask) => void | Promise<void>;
  delete?: (task: DesktopTask) => void | Promise<void>;
}

export interface HomeWorkspaceActions {
  select?: (workspaceId: string) => void | Promise<void>;
  selectAll?: () => void;
  add?: () => void;
}

export interface HomeScreenProps {
  files: RecentFile[];
  attentionTasks?: DesktopTask[];
  loading: boolean;
  error?: string;
  activeWorkspaceId?: string;
  workspaces?: WorkspaceSummary[];
  onOpenFile: (file: RecentFile) => void;
  onOpenLocalFile?: () => void | Promise<void>;
  onReplayPptxDemo?: () => void | Promise<void>;
  replayPptxDemoLoading?: boolean;
  /** Retained as an optional embedding hook; Home intake is the primary creation path. */
  onCreate?: (documentType: HomeDocumentType) => void | Promise<void>;
  onRemoveFile: (filePath: string) => void;
  onRetryRecentFiles?: () => void;
  pickers?: HomePickers;
  droppedTaskPaths?: { paths: string[]; seq: number };
  workspaceActions?: HomeWorkspaceActions;
  onStartTask?: (input: HomeTaskIntake) => void | Promise<void>;
  taskActions?: HomeTaskActions;
  productionTaskId?: string;
  productionEditor?: Omit<PresentationEditorFrameProps, "previewToken" | "fileName"> & { previewToken: string; fileName: string };
  productOutputs?: OfficeOutputRef[];
}

interface HomeCategory {
  type: HomeDocumentType;
}

interface HomeTemplate {
  id: string;
  type: HomeDocumentType;
  icon: string;
  minutes?: number;
  pages?: number;
  cover?: string;
}

const HOME_CATEGORIES: HomeCategory[] = [
  { type: "pptx" },
  { type: "img" },
  { type: "docx" },
  { type: "xlsx" },
];

// Mirrors the Go allow-list in ReadLocalTextDocuments so a dropped file is
// routed the same way the backend will later agree to read it.
const TEXT_REFERENCE_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "tsv", "log", "json"]);

const HOME_TEMPLATES: HomeTemplate[] = [
  { id: "techProductLaunch", type: "pptx", icon: "rocket_launch", pages: 22, cover: "/home-cases/pptx/tech-product-launch.webp" },
  { id: "brandProductLaunch", type: "pptx", icon: "campaign", pages: 21, cover: "/home-cases/pptx/brand-product-launch.webp" },
  { id: "operationsFinance", type: "pptx", icon: "insert_chart", pages: 37, cover: "/home-cases/pptx/operations-finance-analysis.webp" },
  { id: "annualBusinessReview", type: "pptx", icon: "trending_up", pages: 15, cover: "/home-cases/pptx/annual-business-review.webp" },
  { id: "executionTraining", type: "pptx", icon: "groups", pages: 25, cover: "/home-cases/pptx/execution-training.webp" },
  { id: "spaceDefense", type: "pptx", icon: "school", pages: 21, cover: "/home-cases/pptx/space-defense.webp" },
  { id: "hotelMarketing", type: "pptx", icon: "hotel", pages: 20, cover: "/home-cases/pptx/hotel-marketing.webp" },
  { id: "personalProfile", type: "pptx", icon: "person", pages: 15, cover: "/home-cases/pptx/personal-profile.webp" },
  { id: "chineseAesthetic", type: "pptx", icon: "ink_pen", pages: 18, cover: "/home-cases/pptx/chinese-aesthetic.webp" },
  { id: "productImages", type: "img", icon: "photo_library", minutes: 3 },
  { id: "launchPoster", type: "img", icon: "campaign", minutes: 2 },
  { id: "socialCards", type: "img", icon: "collections", minutes: 2 },
  { id: "competitive", type: "docx", icon: "compare_arrows", minutes: 3 },
  { id: "meetingNotes", type: "docx", icon: "event_note", minutes: 2 },
  { id: "proposal", type: "docx", icon: "article", minutes: 4 },
  { id: "schedule", type: "xlsx", icon: "calendar_month", minutes: 1 },
  { id: "salesPipeline", type: "xlsx", icon: "conversion_path", minutes: 2 },
  { id: "budget", type: "xlsx", icon: "account_balance_wallet", minutes: 2 },
];

export function HomeScreen({ files, attentionTasks = [], loading, error, activeWorkspaceId, workspaces = [], onOpenFile, onOpenLocalFile, onReplayPptxDemo, replayPptxDemoLoading, onRemoveFile, pickers = {}, droppedTaskPaths, workspaceActions = {}, onStartTask, taskActions = {}, productionTaskId, productionEditor, onRetryRecentFiles, productOutputs = [] }: HomeScreenProps) {
  const { taskFile: onPickTaskFile, taskDirectory: onPickTaskDirectory, referenceImages: onPickReferenceImages, referenceTextFiles: onPickReferenceTextFiles } = pickers;
  const { select: onSelectWorkspace, selectAll: onSelectAllWorkspaces, add: onAddWorkspace } = workspaceActions;
  const { open: onOpenTask, retry: onRetryTask, steer: onSteerTask, resume: onResumeTask, answer: onAnswerTask, cancel: onCancelTask, delete: onDeleteTask } = taskActions;
  const t = useT();
  const [prompt, setPrompt] = useState("");
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [selectedDocumentType, setSelectedDocumentType] = useState<HomeDocumentType>("pptx");
  const [pptxWorkflow, setPptxWorkflow] = useState<"design" | "animation" | undefined>();
  const [advancedMode, setAdvancedMode] = useState(false);
  const [sourceFile, setSourceFile] = useState<string>();
  const [referenceDirectory, setReferenceDirectory] = useState<string>();
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [referenceTextFiles, setReferenceTextFiles] = useState<string[]>([]);
  const [imageRatio, setImageRatio] = useState<"square" | "landscape" | "portrait">("square");
  const [intakeError, setIntakeError] = useState<string>();
  const [starting, setStarting] = useState(false);
  const [startingPrompt, setStartingPrompt] = useState<string>();
  const [dropActive, setDropActive] = useState(false);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<string[]>([]);
  const [runtimePromptCount, setRuntimePromptCount] = useState(0);
  const lastDropSeq = useRef(0);
  const visibleTemplates = useMemo(() => HOME_TEMPLATES.filter((template) => template.type === selectedDocumentType), [selectedDocumentType]);
  const visibleFiles = useMemo(() => [...files]
    .filter((file) => !activeWorkspaceId || file.workspaceId === activeWorkspaceId)
    .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
    .slice(0, 6), [activeWorkspaceId, files]);
  // The home inbox is now the only surface for work that needs the user, so it
  // must not truncate: there is no "view all" page to overflow into.
  const actionableTasks = useMemo(() => attentionTasks
    .filter((task) => task.status === "question" || task.status === "plan_review"), [attentionTasks]);
  // The dedicated production view looks its task up in this set, so the task has
  // to stay live while it runs (and after a recent failure) even though home no
  // longer renders a running-task list.
  const liveTasks = useMemo(() => attentionTasks
    .filter((task) => task.status === "starting" || task.status === "running"
      || task.status === "question" || task.status === "plan_review"
      || (task.status === "failed" && isRecentFailure(task)))
    .filter((task) => !activeWorkspaceId || task.workspaceId === activeWorkspaceId)
    .filter((task) => !dismissedTaskIds.includes(task.id))
    .slice(0, 4), [attentionTasks, activeWorkspaceId, dismissedTaskIds]);
  const productionTask = productionTaskId ? liveTasks.find((task) => task.id === productionTaskId && task.documentType === "pptx") : undefined;

  useEffect(() => {
    if (prompt) {
      setAnimatedPlaceholder("");
      return undefined;
    }
    const phrases = ["1", "2", "3", "4"].map((index) => t(`home.placeholder.${index}`));
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (reducedMotion.matches) {
      setAnimatedPlaceholder(phrases[0]);
      return undefined;
    }

    let phraseIndex = 0;
    let characterIndex = 0;
    let deleting = false;
    let cancelled = false;
    let timer = 0;

    const schedule = (callback: () => void, delay: number) => {
      timer = window.setTimeout(callback, delay);
    };
    const render = (caret = true) => {
      setAnimatedPlaceholder(`${phrases[phraseIndex].slice(0, characterIndex)}${caret ? "▏" : ""}`);
    };
    const blinkThenDelete = (remainingBlinks: number) => {
      if (cancelled) return;
      render(remainingBlinks % 2 === 0);
      if (remainingBlinks > 0) {
        schedule(() => blinkThenDelete(remainingBlinks - 1), 240);
        return;
      }
      deleting = true;
      schedule(tick, 71);
    };
    const tick = () => {
      if (cancelled) return;
      const phrase = phrases[phraseIndex];
      if (!deleting) {
        characterIndex += 1;
        render();
        if (characterIndex < phrase.length) {
          schedule(tick, 37 + Math.round(Math.random() * 17));
        } else {
          blinkThenDelete(11);
        }
        return;
      }

      characterIndex = Math.max(0, characterIndex - 1);
      render();
      if (characterIndex > 0) {
        schedule(tick, 16);
        return;
      }
      deleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      schedule(tick, 187);
    };

    render();
    schedule(tick, 125);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [prompt, t]);

  useEffect(() => {
    if (!droppedTaskPaths || droppedTaskPaths.paths.length === 0 || droppedTaskPaths.seq === lastDropSeq.current) return;
    lastDropSeq.current = droppedTaskPaths.seq;
    // Plain-text drops accumulate as references; everything else keeps the
    // single-source behaviour that decides the document type.
    const textPaths = droppedTaskPaths.paths.filter((path) => TEXT_REFERENCE_EXTENSIONS.has(fileExtension(path)));
    const otherPaths = droppedTaskPaths.paths.filter((path) => !TEXT_REFERENCE_EXTENSIONS.has(fileExtension(path)));
    if (textPaths.length > 0) {
      setReferenceTextFiles((current) => [...new Set([...current, ...textPaths])].slice(0, 20));
    }
    const [path] = otherPaths;
    if (path) {
      const name = fileNameFromPath(path);
      // No fs access here: a trailing extension is the best available signal for
      // file-vs-directory, and a wrong guess is one chip removal away.
      if (/\.[A-Za-z0-9]{1,8}$/.test(name)) {
        setSourceFile(path);
      } else {
        setReferenceDirectory(path);
      }
    }
    setIntakeError(undefined);
    setDropActive(false);
    const attachedName = fileNameFromPath(path ?? textPaths[0]);
    toast.success(droppedTaskPaths.paths.length > 1
      ? t("home.dropAttachedMany", { count: String(droppedTaskPaths.paths.length) })
      : t("home.dropAttached", { name: attachedName }));
  }, [droppedTaskPaths, t]);

  const intakeDragOver = (event: ReactDragEvent<HTMLFormElement>) => {
    if (!dragHasFiles(event)) return;
    event.preventDefault();
    setHomeDropZone("intake");
    setDropActive(true);
  };

  const intakeDragLeave = (event: ReactDragEvent<HTMLFormElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setHomeDropZone(null);
    setDropActive(false);
  };

  const startTask = async (override?: string) => {
    if (!onStartTask || starting) return;
    const value = (override ?? promptRef.current?.value ?? prompt).trim();
    if (!value) return;
    setPrompt(value);
    if (promptRef.current && promptRef.current.value !== value) {
      promptRef.current.value = value;
    }
    setIntakeError(undefined);
    setStartingPrompt(value);
    setStarting(true);
    try {
      const documentType = sourceFile ? docTypeFromPath(sourceFile) as HomeDocumentType : selectedDocumentType;
      await onStartTask({
        prompt: value,
        sourceFile,
        referenceDirectory,
        documentType,
        ...(documentType === "pptx" ? { pptxWorkflow } : {}),
        ...(advancedMode ? { advancedMode: true } : {}),
        ...(referenceTextFiles.length > 0 ? { referenceTextFiles } : {}),
        ...(documentType === "img" && referenceImages.length > 0 ? { referenceImages } : {}),
        ...(documentType === "img" ? { imageRatio } : {}),
      });
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
      setStartingPrompt(undefined);
    }
  };

  const submitTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setIntakeError(undefined);
    const textarea = event.currentTarget.querySelector("textarea");
    void startTask(textarea?.value);
  };

  const pickTaskFile = async () => {
    if (!onPickTaskFile) return;
    setIntakeError(undefined);
    try {
      const selected = await onPickTaskFile();
      if (selected) {
        setSourceFile(selected);
      }
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    }
  };

  const pickTaskDirectory = async () => {
    if (!onPickTaskDirectory) return;
    setIntakeError(undefined);
    try {
      const selected = await onPickTaskDirectory();
      if (selected) {
        setReferenceDirectory(selected);
      }
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    }
  };

  const pickReferenceImages = async () => {
    if (!onPickReferenceImages) return;
    setIntakeError(undefined);
    try {
      const selected = await onPickReferenceImages();
      if (selected.length > 0) setReferenceImages((current) => [...new Set([...current, ...selected])].slice(0, 8));
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    }
  };

  const pickReferenceTextFiles = async () => {
    if (!onPickReferenceTextFiles) return;
    setIntakeError(undefined);
    try {
      const selected = await onPickReferenceTextFiles();
      if (selected.length > 0) setReferenceTextFiles((current) => [...new Set([...current, ...selected])].slice(0, 20));
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    }
  };

  const referenceMenu: MenuProps = {
    items: [
      { key: "open", label: t("home.openReferencedFile"), description: t("home.openReferencedFile.hint"), icon: <FolderOpenOutlined aria-hidden /> },
      { type: "divider" as const },
      { key: "file", label: t("home.referenceFile"), description: t("home.referenceFile.hint"), icon: <FileTextOutlined aria-hidden /> },
      { key: "texts", label: t("home.referenceTexts"), description: t("home.referenceTexts.hint"), icon: <FileTextOutlined aria-hidden /> },
      { key: "directory", label: t("home.referenceDirectory"), description: t("home.referenceDirectory.hint"), icon: <FolderOpenOutlined aria-hidden /> },
      { key: "images", label: t("home.referenceImages"), description: t("home.referenceImages.hint"), icon: <FileTextOutlined aria-hidden /> },
    ],
    onClick: ({ key }) => {
      if (key === "open") void onOpenLocalFile?.();
      if (key === "file") void pickTaskFile();
      if (key === "texts") void pickReferenceTextFiles();
      if (key === "directory") void pickTaskDirectory();
      if (key === "images") void pickReferenceImages();
    },
  };
  const activeWorkspace = workspaces.find((workspace) => workspace.id === activeWorkspaceId);
  const workspaceMenu: MenuProps = {
    items: [
      // A single-choice list: it says which target is current and separates
      // switching targets from creating one.
      { type: "section" as const, label: t("home.workdir.sectionUse") },
      { key: "none", label: t("home.workdir.none"), icon: <FolderUnsetOutlined aria-hidden />, selected: !activeWorkspaceId },
      ...workspaces.map((workspace) => ({
        key: `workspace:${workspace.id}`,
        label: workspace.name,
        description: workspace.path,
        icon: <FolderOpenOutlined aria-hidden />,
        selected: workspace.id === activeWorkspaceId,
      })),
      { type: "divider" as const },
      { key: "add", label: t("home.workdir.add"), icon: <FolderAddOutlined aria-hidden /> },
    ],
    onClick: ({ key }) => {
      if (key === "none") onSelectAllWorkspaces?.();
      if (key === "add") onAddWorkspace?.();
      if (key.startsWith("workspace:")) void onSelectWorkspace?.(key.slice("workspace:".length));
    },
  };

  if (productionTask) {
    const title = taskTitle(productionTask, t("tasks.untitled"));
    return (
      <section className="home-screen home-screen--production" aria-labelledby="home-production-title">
        <header className="home-production-header">
          <Button variant="ghost-normal" size="small" onClick={() => setDismissedTaskIds((current) => [...current, productionTask.id])}>
            {t("home.production.back")}
          </Button>
          <div>
            <p>{t("home.production.eyebrow")}</p>
            <h1 id="home-production-title">{title}</h1>
          </div>
        </header>
        <ProgressivePptxStage
          task={productionTask}
          onCheckStatus={taskActions.checkStatus ? () => taskActions.checkStatus!(productionTask) : undefined}
          onRetryFailed={taskActions.retryFailed ? path => taskActions.retryFailed!(productionTask, path) : undefined}
          onSkipResearch={taskActions.skipResearch ? () => taskActions.skipResearch!(productionTask) : undefined}
          draftReady={Boolean(productionEditor)}
          editor={productionEditor}
          onContinue={productionTask.status === "question" || productionTask.status === "plan_review"
            ? (onResumeTask ? (outline) => onResumeTask(productionTask, outline) : undefined)
            : undefined}
          onStartDrawing={productionTask.status === "question" || productionTask.status === "plan_review"
            ? (onResumeTask ? (outline) => onResumeTask(productionTask, outline) : undefined)
            : undefined}
          onQuestionAnswer={onAnswerTask ? (answer) => onAnswerTask(productionTask, answer) : undefined}
          onDeleteTask={onDeleteTask ? () => onDeleteTask(productionTask) : undefined}
          productionProps={{
            onCancel: onCancelTask ? () => void onCancelTask(productionTask) : undefined,
            onRetry: onRetryTask ? () => onRetryTask(productionTask) : undefined,
            onSteer: onSteerTask ? (instruction) => onSteerTask(productionTask, instruction) : undefined,
            onResume: onResumeTask ? () => onResumeTask(productionTask) : undefined,
            onOpenEditor: onOpenTask ? () => onOpenTask(productionTask.id) : undefined,
          }}
        />
      </section>
    );
  }

  return (
    <section
      className="home-screen"
      aria-labelledby="home-title"
    >
      <ToastViewport className="home-notification-space" />
      <header className="home-hero">
        <div className="home-hero__copy">
          <h1 id="home-title">{t("home.title")}</h1>
          <p>{t("home.subtitle")}</p>
        </div>
      </header>

      <form
        className={`home-intake ${dropActive ? "is-drop-active" : ""}`}
        data-type={selectedDocumentType}
        aria-label={t("home.promptLabel")}
        onSubmit={submitTask}
        onDragOver={intakeDragOver}
        onDragLeave={intakeDragLeave}
        onDrop={(event) => {
          event.preventDefault();
          setDropActive(false);
        }}
      >
        <TextArea
          ref={promptRef}
          aria-label={t("home.promptLabel")}
          autoSize={{ minRows: 3, maxRows: 6 }}
          placeholder={animatedPlaceholder}
          onChange={(event) => {
            setPrompt(event.target.value);
            setIntakeError(undefined);
          }}
          onSubmit={(value) => void startTask(value)}
        />
        {sourceFile || referenceDirectory || referenceImages.length > 0 || referenceTextFiles.length > 0 ? (
          <div className="home-intake__references" aria-label={t("home.references")}>
            {sourceFile ? (
              <div className="home-intake__attachment" aria-label={t("home.attachedFile")}>
                <DocTypeIcon type={docTypeFromPath(sourceFile)} />
                <span title={sourceFile}>{fileNameFromPath(sourceFile)}</span>
                <Button variant="ghost-normal" size="small" ariaLabel={t("home.removeAttachedFile")} icon={<CloseOutlined />} onClick={() => {
                  setSourceFile(undefined);
                  setIntakeError(undefined);
                }} />
              </div>
            ) : null}
            {referenceDirectory ? (
              <div className="home-intake__attachment" aria-label={t("home.attachedDirectory")}>
                <FolderOpenOutlined aria-hidden />
                <span title={referenceDirectory}>{fileNameFromPath(referenceDirectory)}</span>
                <Button variant="ghost-normal" size="small" ariaLabel={t("home.removeAttachedDirectory")} icon={<CloseOutlined />} onClick={() => {
                  setReferenceDirectory(undefined);
                  setIntakeError(undefined);
                }} />
              </div>
            ) : null}
            {referenceTextFiles.map((path) => (
              <div className="home-intake__attachment" aria-label={t("home.referenceTexts")} key={path}>
                <DocTypeIcon type={docTypeFromPath(path)} />
                <span title={path}>{fileNameFromPath(path)}</span>
                <Button variant="ghost-normal" size="small" ariaLabel={t("home.removeAttachedFile")} icon={<CloseOutlined />} onClick={() => setReferenceTextFiles((current) => current.filter((item) => item !== path))} />
              </div>
            ))}
            {referenceImages.map((path) => (
              <div className="home-intake__attachment" aria-label={t("home.referenceImages")} key={path}>
                <DocTypeIcon type="img" />
                <span title={path}>{fileNameFromPath(path)}</span>
                <Button variant="ghost-normal" size="small" ariaLabel={t("home.removeAttachedFile")} icon={<CloseOutlined />} onClick={() => setReferenceImages((current) => current.filter((item) => item !== path))} />
              </div>
            ))}
          </div>
        ) : null}
        {selectedDocumentType === "pptx" ? (
          <div className="home-intake__type-options" role="group" aria-label={t("home.pptxWorkflow")}>
            {([undefined, "design", "animation"] as const).map((workflow) => (
              <button type="button" key={workflow ?? "auto"} aria-pressed={pptxWorkflow === workflow} onClick={() => setPptxWorkflow(workflow)}>{t(`home.pptxWorkflow.${workflow ?? "auto"}`)}</button>
            ))}
          </div>
        ) : null}
        {selectedDocumentType === "img" ? (
          <div className="home-intake__type-options" role="group" aria-label={t("home.imageRatio")}>
            <span>{t("home.imageRatio")}</span>
            {(["square", "landscape", "portrait"] as const).map((ratio) => (
              <button type="button" aria-pressed={imageRatio === ratio} key={ratio} onClick={() => setImageRatio(ratio)}>{t(`home.imageRatio.${ratio}`)}</button>
            ))}
          </div>
        ) : null}
        {intakeError ? <div className="home-intake__error" role="alert">{intakeError}</div> : null}
        <div className="home-intake__footer">
          <div className="home-intake__footer-left">
            <Dropdown menu={referenceMenu} trigger={["click"]} placement="top">
              <button type="button" className="home-intake__add-trigger" aria-label={t("home.addReference")}>
                <PlusOutlined aria-hidden />
              </button>
            </Dropdown>
            <Dropdown menu={workspaceMenu} trigger={["click"]} placement="top">
              <button type="button" className="home-intake__workdir" aria-label={t("home.workdir.select")} title={activeWorkspace?.path}>
                <FolderOpenOutlined aria-hidden />
                <span>{activeWorkspace?.name ?? t("home.workdir.empty")}</span>
                <DownOutlined aria-hidden />
              </button>
            </Dropdown>
          </div>
          <label className="home-intake__advanced-mode" title={t("home.advancedMode.hint")}>
            <input type="checkbox" checked={advancedMode} onChange={(event) => {
              const enabled = event.target.checked;
              setAdvancedMode(enabled);
              toast.info({ key: "home-mode", content: t(enabled ? "home.advancedMode.enabled" : "home.advancedMode.disabled") });
            }} />
            <span>{t("home.advancedMode.label")}</span>
          </label>
          <div className="home-intake__types" role="group" aria-label={t("home.outputTypes")}>
            {HOME_CATEGORIES.map((category) => (
              <button
                key={category.type}
                type="button"
                className={`doc-type--${category.type}${selectedDocumentType === category.type ? " is-selected" : ""}`}
                aria-pressed={selectedDocumentType === category.type}
                onClick={() => {
                  setSelectedDocumentType(category.type);
                  setIntakeError(undefined);
                }}
              >
                <span className="home-intake__type-icon" aria-hidden="true"><DocTypeIcon type={category.type} /></span>
                <span>{t(`home.type.${category.type}`)}</span>
              </button>
            ))}
          </div>
          <Button className="od-button--circular-submit od-button--icon-submit" ariaLabel={t("home.startTask")} title={t("home.startTask")} htmlType="submit" variant="primary" icon={<ArrowUpOutlined />} loading={starting} disabled={starting} />
        </div>
      </form>

      {startingPrompt ? (
        <div className="home-starting" role="status" aria-live="polite">
          <Loading />
          <span>{t("home.starting")}</span>
          <span className="home-starting__prompt">{startingPrompt}</span>
        </div>
      ) : null}

      {actionableTasks.length > 0 ? (
        <section className="home-attention home-attention--compact" aria-labelledby="home-attention-title">
          <div className="home-section-header">
            <h2 id="home-attention-title">{t("home.attentionTitle")} <span>{actionableTasks.length}</span></h2>
            <span>{t("home.viewAll")}</span>
          </div>
          <div className="home-attention-list">
            {actionableTasks.map((task) => (
              <button className="home-attention-row" type="button" key={task.id} onClick={() => onOpenTask?.(task.id)}>
                <span className="home-attention-dot" aria-hidden="true" />
                <strong>{taskTitle(task, t("home.untitledTask"))}</strong>
                <span>{task.question?.question || t(task.status === "plan_review" ? "home.planReview" : "home.answerRequired")}</span>
                <em>{t(task.status === "plan_review" ? "home.review" : "home.respond")}</em>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="home-templates" aria-labelledby="home-templates-title">
        <div className="home-section-header">
          <h2 id="home-templates-title">{t("home.templates")}</h2>
        </div>
        <TemplateRail dependencies={[selectedDocumentType, visibleTemplates.length]}>
          {onReplayPptxDemo && selectedDocumentType === "pptx" ? (
            <button
              type="button"
              className="home-template-card home-template-card--demo"
              aria-label={t("home.template.nexaedgeDemo.title")}
              title={t("home.template.nexaedgeDemo.description")}
              disabled={replayPptxDemoLoading}
              onClick={() => void onReplayPptxDemo()}
            >
              <span className="home-template-card__preview" aria-hidden="true">
                <span className="home-template-card__demo-play">
                  {replayPptxDemoLoading ? <Loading /> : <PlayCircleOutlined aria-hidden />}
                </span>
              </span>
              <span className="home-template-card__copy">
                <strong>{t("home.template.nexaedgeDemo.title")}</strong>
                <small>{replayPptxDemoLoading ? t("home.template.nexaedgeDemo.loading") : t("home.template.nexaedgeDemo.meta")}</small>
              </span>
            </button>
          ) : null}
          {visibleTemplates.map((template) => {
            const title = t(`home.template.${template.id}.title`);
            const description = t(`home.template.${template.id}.description`);
            return (
              <button
                key={template.id}
                type="button"
                className="home-template-card"
                aria-label={title}
                title={description}
                onClick={() => {
                  setPrompt(description);
                  if (promptRef.current) promptRef.current.value = description;
                }}
              >
                <span className="home-template-card__preview" aria-hidden="true">
                  {template.cover ? <img src={template.cover} alt="" loading="lazy" /> : (
                    <span className={`home-template-card__sheet doc-type--${template.type}`}>
                      <span /><span /><span />
                      <MaterialSymbol name={template.icon} />
                    </span>
                  )}
                </span>
                <span className="home-template-card__copy">
                  <strong>{title}</strong>
                  <small>{template.pages
                    ? t("home.templateMeta.pages", { type: t(`home.type.${template.type}`), pages: template.pages })
                    : t("home.templateMeta.minutes", { type: t(`home.type.${template.type}`), minutes: template.minutes ?? 1 })}</small>
                </span>
              </button>
            );
          })}
        </TemplateRail>
      </section>

      {runtimePromptCount > 0 ? (
        <section className="home-attention" aria-labelledby="home-runtime-attention-title">
          <div className="home-section-header">
            <h2 id="home-runtime-attention-title">{t("home.attentionTitle")} <span>{runtimePromptCount}</span></h2>
          </div>
          <div className="home-attention-list">
            <RuntimePrompts onCountChange={setRuntimePromptCount} />
          </div>
        </section>
      ) : null}

      <section className="home-recents" aria-labelledby="home-recents-title">
        <div className="home-section-header">
          <h2 id="home-recents-title">{t("home.recentTitle")}</h2>
        </div>

        {loading ? <div className="home-recents-state"><Loading /><span>{t("home.loading")}</span></div> : null}
        {!loading && error ? (
          <div className="home-recents-state home-recents-state--error" role="alert">
            <span>{error}</span>
            {onRetryRecentFiles ? <Button size="small" onClick={onRetryRecentFiles}>{t("home.retry")}</Button> : null}
          </div>
        ) : null}
        {!loading && !error && visibleFiles.length === 0 ? <Empty description={t("home.empty")} /> : null}
        {!loading && !error && visibleFiles.length > 0 ? (
          <div className="home-recent-list">
            {visibleFiles.map((file) => (
              <div className="home-recent-row" key={file.filePath}>
                <button type="button" className="home-recent-open" aria-label={t("home.openFile", { name: file.fileName })} onClick={() => onOpenFile(file)}>
                  <DocTypeIcon type={file.documentType} chip />
                  <span className="home-recent-copy"><strong>{file.fileName}</strong><small>{file.documentType.toUpperCase()} · {t(`home.source.${file.source}`)} · {formatOpenedAt(file.lastOpenedAt)}</small></span>
                </button>
                <Button className="home-file-remove" variant="ghost-normal" size="small" ariaLabel={t("home.removeFile", { name: file.fileName })} icon={<CloseOutlined />} onClick={() => onRemoveFile(file.filePath)} />
              </div>
            ))}
          </div>
        ) : null}
      </section>
      {productOutputs.length > 0 ? <section className="home-recents" aria-labelledby="home-outputs-title"><h2 id="home-outputs-title">{t("ui.copy.Projectoutputs")}</h2><OfficeProductOutputsPanel outputs={productOutputs} /></section> : null}

    </section>
  );
}


/**
 * Horizontal shelf whose overflow is signalled by arrows rather than a
 * scrollbar: an arrow appears only while that direction has more to show, so
 * the control says "there is more this way" instead of leaving a grey bar
 * across the cards.
 */
function TemplateRail({ children, dependencies }: { children: ReactNode; dependencies: unknown[] }) {
  const t = useT();
  const railRef = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const rail = railRef.current;
    if (!rail) return;
    // Scroll snapping and the rail's own padding leave a couple of pixels of
    // residual offset at either end, which is not scroll the user can perceive
    // or act on. Only treat a visible amount as "there is more this way".
    const PERCEPTIBLE_SCROLL_PX = 8;
    setOverflow({
      left: rail.scrollLeft > PERCEPTIBLE_SCROLL_PX,
      right: rail.scrollLeft + rail.clientWidth < rail.scrollWidth - PERCEPTIBLE_SCROLL_PX,
    });
  }, []);

  useEffect(() => {
    const rail = railRef.current;
    // A different set of examples starts from its own beginning: keeping the
    // old offset drops the user into the middle of a list they never scrolled.
    if (rail) rail.scrollLeft = 0;
    measure();
    if (!rail) return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(rail);
    // Native listener rather than React's onScroll: scroll events do not
    // bubble, so delegated handlers miss scrolls that did not come from a
    // direct user gesture on this element (the arrow buttons' own scrollBy
    // among them).
    rail.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      rail.removeEventListener("scroll", measure);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measure, ...dependencies]);

  const scrollBy = (direction: -1 | 1) => {
    const rail = railRef.current;
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: "smooth" });
  };

  return (
    <div className="home-template-rail">
      <div className="home-template-grid" ref={railRef}>
        {children}
      </div>
      {overflow.left ? (
        <button type="button" className="home-template-rail__arrow home-template-rail__arrow--left" aria-label={t("home.templateScrollBack")} onClick={() => scrollBy(-1)}>
          <LeftOutlined aria-hidden />
        </button>
      ) : null}
      {overflow.right ? (
        <button type="button" className="home-template-rail__arrow home-template-rail__arrow--right" aria-label={t("home.templateScrollForward")} onClick={() => scrollBy(1)}>
          <RightOutlined aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

const RECENT_FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000;

// A failed task stays reachable from its production view only while the failure
// is still actionable. Undated failures are treated as old: the tasks page still
// lists them, but they should not be restored to the production view.
function isRecentFailure(task: DesktopTask): boolean {
  const ts = task.events.at(-1)?.ts;
  if (!ts) return false;
  const at = new Date(ts).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < RECENT_FAILURE_WINDOW_MS;
}

function formatOpenedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
