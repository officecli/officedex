import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type FormEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import type { DesktopTask, DocumentType, RecentFile, WorkspaceSummary } from "../../shared/types";
import { Button, Dropdown, Empty, Loading, TextArea, toast, type MenuProps } from "../ui";
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
  PlusOutlined,
  RightOutlined,
} from "../ui/icons";
import { useT } from "../i18n";
import { fileNameFromPath } from "../utils/path";
import { MaterialSymbol } from "../components/Shell";
import { DocTypeIcon, docTypeFromPath } from "../components/DocTypeIcon";
import { RuntimePrompts } from "../components/RuntimePrompts";

type HomeDocumentType = Extract<DocumentType, "pptx" | "img" | "docx" | "xlsx">;

export interface HomeScreenProps {
  files: RecentFile[];
  attentionTasks?: DesktopTask[];
  loading: boolean;
  error?: string;
  activeWorkspaceId?: string;
  workspaces?: WorkspaceSummary[];
  onCreate: (documentType: HomeDocumentType) => void | Promise<void>;
  onOpenFile: (file: RecentFile) => void;
  onRemoveFile: (filePath: string) => void;
  onPickTaskFile?: () => Promise<string | undefined>;
  onPickTaskDirectory?: () => Promise<string | undefined>;
  droppedTaskPaths?: { paths: string[]; seq: number };
  onSelectWorkspace?: (workspaceId: string) => void | Promise<void>;
  onSelectAllWorkspaces?: () => void;
  onAddWorkspace?: () => void;
  onAnalyzeTask?: (input: HomeTaskIntake) => HomeTaskAnalysis | Promise<HomeTaskAnalysis>;
  onStartTask?: (input: HomeTaskIntake) => void | Promise<void>;
  onOpenTask?: (taskId: string) => void;
  onRetryTask?: (task: DesktopTask) => void;
  onOpenTasks?: () => void;
  onRetryRecentFiles?: () => void;
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

export function HomeScreen({ files, attentionTasks = [], loading, error, activeWorkspaceId, workspaces = [], onOpenFile, onRemoveFile, onPickTaskFile, onPickTaskDirectory, droppedTaskPaths, onSelectWorkspace, onSelectAllWorkspaces, onAddWorkspace, onAnalyzeTask, onStartTask, onOpenTask, onRetryTask, onOpenTasks, onRetryRecentFiles }: HomeScreenProps) {
  const t = useT();
  const homeScreenRef = useRef<HTMLElement>(null);
  const pointerFieldRef = useRef<HTMLCanvasElement>(null);
  const pointerMotionRef = useRef({ x: 0, y: 0, targetX: 0, targetY: 0, strength: 0, targetStrength: 0, activity: 0 });
  const [prompt, setPrompt] = useState("");
  const [animatedPlaceholder, setAnimatedPlaceholder] = useState("");
  const [selectedDocumentType, setSelectedDocumentType] = useState<HomeDocumentType>("pptx");
  const [sourceFile, setSourceFile] = useState<string>();
  const [referenceDirectory, setReferenceDirectory] = useState<string>();
  const [intakeError, setIntakeError] = useState<string>();
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<HomeTaskAnalysis>();
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
  // Work in flight belongs where its result will land: running and failed tasks
  // ride at the top of Recent and turn into (or give way to) the file card when
  // they settle, so the user never has to leave home to see how it is going.
  // Failures age out: a week-old failure is history for the tasks page, not
  // something to greet the user with every time they open the app.
  const liveTasks = useMemo(() => attentionTasks
    .filter((task) => task.status === "starting" || task.status === "running"
      || (task.status === "failed" && isRecentFailure(task)))
    .filter((task) => !activeWorkspaceId || task.workspaceId === activeWorkspaceId)
    .filter((task) => !dismissedTaskIds.includes(task.id))
    .slice(0, 4), [attentionTasks, activeWorkspaceId, dismissedTaskIds]);

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
    const [path] = droppedTaskPaths.paths;
    const name = fileNameFromPath(path);
    // No fs access here: a trailing extension is the best available signal for
    // file-vs-directory, and a wrong guess is one chip removal away.
    if (/\.[A-Za-z0-9]{1,8}$/.test(name)) {
      setSourceFile(path);
    } else {
      setReferenceDirectory(path);
    }
    setAnalysis(undefined);
    setIntakeError(undefined);
    setDropActive(false);
    toast.success(t("home.dropAttached", { name }));
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

  const startAnalyzedTask = async (next: HomeTaskAnalysis) => {
    if (!onStartTask || starting) return;
    setIntakeError(undefined);
    setStartingPrompt(next.prompt);
    setStarting(true);
    try {
      await onStartTask({ prompt: next.prompt, sourceFile: next.sourceFile, referenceDirectory: next.referenceDirectory, documentType: next.documentType });
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    } finally {
      setStarting(false);
      setStartingPrompt(undefined);
    }
  };

  const analyzeTask = async () => {
    const value = prompt.trim();
    if (!value || !onAnalyzeTask || analyzing) return;
    setIntakeError(undefined);
    setAnalyzing(true);
    try {
      const next = await onAnalyzeTask({ prompt: value, sourceFile, referenceDirectory, documentType: selectedDocumentType });
      if (next.nextStep === "execute") {
        // Clear, low-risk generation requests go straight to the stage. Keep
        // the full review card only for tasks that genuinely need setup or a
        // plan approval.
        setAnalysis(undefined);
        void startAnalyzedTask(next);
      } else {
        setAnalysis(next);
      }
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    } finally {
      setAnalyzing(false);
    }
  };

  const submitTask = (event: FormEvent) => {
    event.preventDefault();
    void analyzeTask();
  };

  const confirmTask = async () => {
    if (!analysis || !onStartTask || starting) return;
    await startAnalyzedTask(analysis);
  };

  const invalidateAnalysis = () => {
    setAnalysis(undefined);
    setIntakeError(undefined);
  };

  const pickTaskFile = async () => {
    if (!onPickTaskFile) return;
    setIntakeError(undefined);
    try {
      const selected = await onPickTaskFile();
      if (selected) {
        setSourceFile(selected);
        setAnalysis(undefined);
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
        setAnalysis(undefined);
      }
    } catch (error) {
      setIntakeError(error instanceof Error ? error.message : String(error));
    }
  };

  const referenceMenu: MenuProps = {
    items: [
      { key: "file", label: t("home.referenceFile"), description: t("home.referenceFile.hint"), icon: <FileTextOutlined aria-hidden /> },
      { key: "directory", label: t("home.referenceDirectory"), description: t("home.referenceDirectory.hint"), icon: <FolderOpenOutlined aria-hidden /> },
    ],
    onClick: ({ key }) => {
      if (key === "file") void pickTaskFile();
      if (key === "directory") void pickTaskDirectory();
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

  const movePointerGlow = (event: ReactPointerEvent<HTMLElement>) => {
    const screen = homeScreenRef.current;
    if (!screen || event.pointerType === "touch") return;
    const bounds = screen.getBoundingClientRect();
    const motion = pointerMotionRef.current;
    const nextX = event.clientX - bounds.left;
    const nextY = event.clientY - bounds.top;
    const travel = Math.hypot(nextX - motion.targetX, nextY - motion.targetY);
    motion.targetX = nextX;
    motion.targetY = nextY;
    motion.activity = Math.min(1, Math.max(motion.activity, 0.32 + travel / 24));
    if (motion.strength < 0.01) {
      motion.x = motion.targetX;
      motion.y = motion.targetY;
    }
    motion.targetStrength = 1;
  };

  const hidePointerGlow = () => {
    pointerMotionRef.current.targetStrength = 0;
  };

  useEffect(() => {
    const screen = homeScreenRef.current;
    const canvas = pointerFieldRef.current;
    if (!screen || !canvas) return undefined;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarsePointer = window.matchMedia("(hover: none), (pointer: coarse)");
    if (reducedMotion.matches || coarsePointer.matches) return undefined;
    const context = canvas.getContext("2d");
    if (!context) return undefined;

    let width = 0;
    let height = 0;
    let pixelRatio = 1;
    let animationFrame = 0;
    let lastFrameTime = 0;
    let animatedPhase = 0;
    const spacing = 22;
    const radius = 230;

    const resize = () => {
      const bounds = screen.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(width * pixelRatio);
      canvas.height = Math.round(height * pixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    };

    const draw = (time: number) => {
      const motion = pointerMotionRef.current;
      const elapsed = lastFrameTime === 0 ? 16 : Math.min(40, time - lastFrameTime);
      lastFrameTime = time;
      motion.x += (motion.targetX - motion.x) * 0.42;
      motion.y += (motion.targetY - motion.y) * 0.42;
      motion.strength += (motion.targetStrength - motion.strength) * 0.09;
      animatedPhase += elapsed * motion.activity;
      motion.activity *= 0.76;
      if (motion.activity < 0.006) motion.activity = 0;
      context.clearRect(0, 0, width, height);

      if (motion.strength > 0.008) {
        const minColumn = Math.floor((motion.x - radius) / spacing);
        const maxColumn = Math.ceil((motion.x + radius) / spacing);
        const minRow = Math.floor((motion.y - radius) / spacing);
        const maxRow = Math.ceil((motion.y + radius) / spacing);

        for (let column = minColumn; column <= maxColumn; column += 1) {
          const baseX = column * spacing + 1;
          if (baseX < 0 || baseX > width) continue;
          for (let row = minRow; row <= maxRow; row += 1) {
            const baseY = row * spacing + 1;
            if (baseY < 0 || baseY > height) continue;
            const deltaX = baseX - motion.x;
            const deltaY = baseY - motion.y;
            const distance = Math.hypot(deltaX, deltaY);
            if (distance >= radius) continue;

            const normalized = 1 - distance / radius;
            const influence = normalized * normalized * (3 - 2 * normalized) * motion.strength;
            const safeDistance = Math.max(distance, 0.001);
            const radialX = deltaX / safeDistance;
            const radialY = deltaY / safeDistance;
            const wave = Math.sin(distance * 0.054 - animatedPhase * 0.0046) * 7.2 * influence;
            const crawl = Math.sin(animatedPhase * 0.0024 + column * 0.72 + row * 0.43) * 2.8 * influence;
            const drawX = baseX + radialX * wave - radialY * crawl;
            const drawY = baseY + radialY * wave + radialX * crawl;
            const pulse = (Math.sin(animatedPhase * 0.005 + distance * 0.08) + 1) * 0.16;
            const dotRadius = 0.72 + influence * (0.9 + pulse);
            const alpha = (0.08 + influence * 0.34) * motion.strength;

            context.beginPath();
            context.arc(drawX, drawY, dotRadius, 0, Math.PI * 2);
            context.fillStyle = `rgba(48, 53, 60, ${alpha})`;
            context.fill();
          }
        }
      }
      animationFrame = window.requestAnimationFrame(draw);
    };

    resize();
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(screen);
    animationFrame = window.requestAnimationFrame(draw);
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return (
    <section
      className="home-screen"
      aria-labelledby="home-title"
      ref={homeScreenRef}
      onPointerEnter={movePointerGlow}
      onPointerMove={movePointerGlow}
      onPointerLeave={hidePointerGlow}
    >
      <canvas className="home-pointer-field" ref={pointerFieldRef} aria-hidden="true" />
      <header className="home-hero">
        <div className="home-hero__copy">
          <h1 id="home-title">{t("home.title")}</h1>
          <p>{t("home.subtitle")}</p>
        </div>
      </header>

      <form
        className={`home-intake ${dropActive ? "is-drop-active" : ""}`}
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
          aria-label={t("home.promptLabel")}
          autoSize={{ minRows: 3, maxRows: 6 }}
          placeholder={animatedPlaceholder}
          value={prompt}
          onChange={(event) => {
            setPrompt(event.target.value);
            invalidateAnalysis();
          }}
          onSubmit={() => void analyzeTask()}
        />
        {sourceFile || referenceDirectory ? (
          <div className="home-intake__references" aria-label={t("home.references")}>
            {sourceFile ? (
              <div className="home-intake__attachment" aria-label={t("home.attachedFile")}>
                <DocTypeIcon type={docTypeFromPath(sourceFile)} />
                <span title={sourceFile}>{fileNameFromPath(sourceFile)}</span>
                <Button variant="ghost-normal" size="small" ariaLabel={t("home.removeAttachedFile")} icon={<CloseOutlined />} onClick={() => {
                  setSourceFile(undefined);
                  invalidateAnalysis();
                }} />
              </div>
            ) : null}
            {referenceDirectory ? (
              <div className="home-intake__attachment" aria-label={t("home.attachedDirectory")}>
                <FolderOpenOutlined aria-hidden />
                <span title={referenceDirectory}>{fileNameFromPath(referenceDirectory)}</span>
                <Button variant="ghost-normal" size="small" ariaLabel={t("home.removeAttachedDirectory")} icon={<CloseOutlined />} onClick={() => {
                  setReferenceDirectory(undefined);
                  invalidateAnalysis();
                }} />
              </div>
            ) : null}
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
          <div className="home-intake__types" role="group" aria-label={t("home.outputTypes")}>
            {HOME_CATEGORIES.map((category) => (
              <button
                key={category.type}
                type="button"
                className={`doc-type--${category.type}${selectedDocumentType === category.type ? " is-selected" : ""}`}
                aria-pressed={selectedDocumentType === category.type}
                onClick={() => {
                  setSelectedDocumentType(category.type);
                  invalidateAnalysis();
                }}
              >
                {selectedDocumentType === category.type ? <DocTypeIcon type={category.type} /> : null}
                <span>{t(`home.type.${category.type}`)}</span>
              </button>
            ))}
          </div>
          <Button htmlType="submit" variant="primary" icon={<ArrowUpOutlined />} loading={analyzing} disabled={!prompt.trim()}>{t("home.analyze")}</Button>
        </div>
      </form>

      {startingPrompt ? (
        <div className="home-starting" role="status" aria-live="polite">
          <Loading />
          <span>{t("home.starting")}</span>
          <span className="home-starting__prompt">{startingPrompt}</span>
        </div>
      ) : null}

      {analysis ? (
        <section className="home-analysis" aria-labelledby="home-analysis-title">
          <div className="home-analysis__header">
            <div>
              <p>{t("home.analysis.eyebrow")}</p>
              <h2 id="home-analysis-title">{t("home.analysis.title")}</h2>
            </div>
            <span>
              {starting ? `${t("tasks.status.starting")}…` : t("home.analysis.notStarted")}
            </span>
          </div>
          <p className="home-analysis__description">{t(`home.analysis.description.${analysis.nextStep}`)}</p>
          <dl className="home-analysis__details">
            <div><dt>{t("home.analysis.goal")}</dt><dd>{analysis.prompt}</dd></div>
            <div><dt>{t("home.analysis.deliverable")}</dt><dd>{homeDeliverableLabel(analysis.documentType, t)}</dd></div>
            <div><dt>{t("home.analysis.source")}</dt><dd>{[analysis.sourceFile && fileNameFromPath(analysis.sourceFile), analysis.referenceDirectory && fileNameFromPath(analysis.referenceDirectory)].filter(Boolean).join(" · ") || t("home.analysis.noSource")}</dd></div>
            <div><dt>{t("home.analysis.credit")}</dt><dd>{t("home.analysis.creditUnavailable")}</dd></div>
          </dl>
          <div className="home-analysis__actions">
            <Button variant="ghost-normal" onClick={invalidateAnalysis}>{t("home.analysis.edit")}</Button>
            <Button variant="primary" icon={<RightOutlined />} loading={starting} onClick={() => void confirmTask()}>{t(analysis.nextStep === "configure" ? "home.analysis.configureJob" : analysis.nextStep === "plan" ? "home.analysis.createPlan" : "home.analysis.start")}</Button>
          </div>
        </section>
      ) : null}

      <section className="home-templates" aria-labelledby="home-templates-title">
        <div className="home-section-header">
          <h2 id="home-templates-title">{t("home.templates")}</h2>
        </div>
        <TemplateRail dependencies={[selectedDocumentType, visibleTemplates.length]}>
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
                  invalidateAnalysis();
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

      {actionableTasks.length > 0 || runtimePromptCount > 0 ? (
        <section className="home-attention" aria-labelledby="home-attention-title">
          <div className="home-section-header">
            <h2 id="home-attention-title">{t("home.attentionTitle")} <span>{actionableTasks.length + runtimePromptCount}</span></h2>
          </div>
          <div className="home-attention-list">
            {actionableTasks.map((task) => (
              <button className="home-attention-row" type="button" key={task.id} onClick={() => onOpenTask?.(task.id)}>
                <span className="home-attention-dot" aria-hidden="true" />
                <strong>{task.topic || task.artifact?.fileName || t("home.untitledTask")}</strong>
                <span>{task.question?.question || t(task.status === "plan_review" ? "home.planReview" : "home.answerRequired")}</span>
                <em>{t(task.status === "plan_review" ? "home.review" : "home.respond")}</em>
              </button>
            ))}
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
        {!loading && !error && visibleFiles.length === 0 && liveTasks.length === 0 ? <Empty description={t("home.empty")} /> : null}
        {!loading && !error && (visibleFiles.length > 0 || liveTasks.length > 0) ? (
          <div className="home-recent-list">
            {liveTasks.map((task) => (
              <HomeTaskCard
                key={task.id}
                task={task}
                onOpen={() => onOpenTask?.(task.id)}
                onRetry={onRetryTask ? () => onRetryTask(task) : undefined}
                onDismiss={() => setDismissedTaskIds((current) => [...current, task.id])}
              />
            ))}
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

// A failure is worth interrupting home for only while it is still actionable.
// Undated failures are treated as old: better to under-surface on home (the
// tasks page still lists them) than to pin ancient errors to the front door.
function isRecentFailure(task: DesktopTask): boolean {
  const ts = task.events.at(-1)?.ts;
  if (!ts) return false;
  const at = new Date(ts).getTime();
  if (Number.isNaN(at)) return false;
  return Date.now() - at < RECENT_FAILURE_WINDOW_MS;
}

function HomeTaskCard({ task, onOpen, onRetry, onDismiss }: {
  task: DesktopTask;
  onOpen: () => void;
  onRetry?: () => void;
  onDismiss: () => void;
}) {
  const t = useT();
  const failed = task.status === "failed";
  const stages = task.stages ?? [];
  const done = stages.filter((stage) => stage.status === "completed").length;
  const activeStage = stages.find((stage) => stage.id === task.activeStageId);
  const percent = stages.length > 0 ? Math.round((done / stages.length) * 100) : undefined;
  const title = task.topic || task.artifact?.fileName || task.userInput?.prompt || t("tasks.untitled");
  const meta = failed
    ? (task.error || t("home.task.failed"))
    : (activeStage?.label || t("home.task.running")) + (stages.length > 0 ? ` · ${done}/${stages.length}` : "");

  return (
    <div className={`home-recent-row home-task-row ${failed ? "home-task-row--failed" : "home-task-row--running"}`}>
      <button type="button" className="home-recent-open" aria-label={t("home.openTask", { name: title })} onClick={onOpen}>
        <span className="home-task-icon" aria-hidden="true">
          <DocTypeIcon type={task.documentType || task.artifact?.documentType} chip />
          {!failed ? <span className="home-task-icon__spinner" /> : null}
        </span>
        <span className="home-recent-copy">
          <strong>{title}</strong>
          <small title={failed ? task.error : undefined}>{meta}</small>
          {!failed && percent !== undefined ? (
            <span className="home-task-progress" aria-hidden="true"><i style={{ width: `${percent}%` }} /></span>
          ) : null}
        </span>
      </button>
      <div className="home-task-actions">
        {failed && onRetry ? (
          <Button variant="ghost-guidance" size="small" onClick={onRetry}>{t("home.task.retry")}</Button>
        ) : null}
        {failed ? (
          <Button className="home-file-remove" variant="ghost-normal" size="small" ariaLabel={t("home.task.dismiss", { name: title })} icon={<CloseOutlined />} onClick={onDismiss} />
        ) : null}
      </div>
    </div>
  );
}

function formatOpenedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function homeDeliverableLabel(documentType: DocumentType, t: ReturnType<typeof useT>) {
  const key = documentType === "pptx" ? "home.analysis.output.pptx"
    : documentType === "docx" ? "home.analysis.output.docx"
      : documentType === "xlsx" ? "home.analysis.output.xlsx"
        : documentType === "report" ? "home.analysis.output.report"
          : documentType === "gif" ? "home.analysis.output.gif"
            : "home.analysis.output.img";
  return t(key);
}
