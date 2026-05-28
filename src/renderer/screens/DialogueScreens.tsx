import { Button, Form, Image, Input, message, Modal, Progress, Radio, Space, Tag, Timeline, Tooltip } from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseCircleOutlined,
  CloudOutlined,
  CopyOutlined,
  DeleteOutlined,
  DisconnectOutlined,

  FileTextOutlined,
  FolderOpenOutlined,
  LinkOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { Artifact, BridgeEvent, DesktopTask, DocumentType, GenerateInput, ImagePromptTemplate, StageState } from "../../shared/types";
import { defaultGenerateInput } from "../defaults";
import { useSettings } from "../useSettings";
import { useAttachments } from "../useAttachments";
import { officecli } from "../bridge";
import { documentTypeOptions } from "../defaults";
import { FileGlyph, MaterialSymbol } from "../components/Shell";
import { TaskRuntimePanel } from "../components/TaskRuntimePanel";
import { acquireBlob, releaseBlob } from "../imageCache";
import { useT } from "../i18n";
import { useNow } from "../useNow";
import { useReportCapability } from "../useReportCapability";
import { ReportIssueDialog } from "../components/ReportIssueDialog";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export type FailureKind = "connection" | "auth" | "task" | "setup" | "other";

export interface NewGenerationDraft {
  documentType: DocumentType;
  topic: string;
  prompt: string;
  mode?: GenerateInput["mode"];
  sourceFile?: string;
  referenceImages?: string[];
}

interface DialogueProps {
  tasks: DesktopTask[];
  conversationId?: string;
  artifacts: Artifact[];
  newGenerationDraft?: NewGenerationDraft;
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
  onContinueGeneration?: (documentType: string, prompt: string, referenceImages?: string[]) => void;
}

const EMPTY_NEW_GENERATION_DRAFT: NewGenerationDraft = {
  documentType: "pptx",
  topic: "",
  prompt: "",
  mode: "fast",
};

export function DialogueScreen({ tasks, conversationId, artifacts, newGenerationDraft, busy, lastError, errorKind, errorDetails, bridgeStatus, onSubmit, onOpenSettings, onOpenLogin, onRetry, onPreview, onNewGenerationDraftChange, onForceCancel, onContinueGeneration }: DialogueProps) {
  if (lastError) {
    return <ConnectionFailure kind={errorKind} status={bridgeStatus} error={lastError} details={errorDetails} onOpenSettings={onOpenSettings} onOpenLogin={onOpenLogin} onRetry={onRetry} />;
  }
  // No tasks = fresh new generation prompt
  if (tasks.length === 0) {
    return <FluidNewGeneration draft={newGenerationDraft ?? EMPTY_NEW_GENERATION_DRAFT} busy={busy} onSubmit={onSubmit} onDraftChange={onNewGenerationDraftChange ?? (() => undefined)} />;
  }
  // Conversation view with all rounds
  return <ConversationView tasks={tasks} busy={busy} onPreview={onPreview} onForceCancel={onForceCancel} onContinueGeneration={onContinueGeneration} onOpenLogin={onOpenLogin} />;
}

function FluidNewGeneration({ draft, busy, onSubmit, onDraftChange }: {
  draft: NewGenerationDraft;
  busy: boolean;
  onSubmit: (values: GenerateInput) => Promise<void>;
  onDraftChange: (patch: Partial<NewGenerationDraft>) => void;
}) {
  const [form] = Form.useForm<GenerateInput>();
  const { settings } = useSettings();
  const t = useT();
  const initialValues = { ...defaultGenerateInput, ...settings.defaults, ...draft };
  const docType = (Form.useWatch("documentType", form) ?? initialValues.documentType) as DocumentType;
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | undefined>();
  const [imageTemplates, setImageTemplates] = useState<ImagePromptTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState("");
  const attachments = useAttachments(docType, {
    sourceFile: draft.sourceFile ?? null,
    referenceImages: draft.referenceImages ?? [],
    onChange: (next) => onDraftChange(next),
  });

  useEffect(() => {
    form.setFieldsValue({
      documentType: draft.documentType,
      topic: draft.topic,
      prompt: draft.prompt,
      mode: draft.mode,
    });
  }, [form, draft.documentType, draft.topic, draft.prompt, draft.mode]);

  useEffect(() => {
    if (docType !== "img") {
      form.setFieldValue("promptTemplateId", undefined);
      setSelectedTemplateId(undefined);
      setTemplatesError("");
      return;
    }
    let cancelled = false;
    setTemplatesLoading(true);
    officecli.listImageTemplates()
      .then((items) => {
        if (cancelled) return;
        setImageTemplates(items.filter((item) => item.enabled));
        setTemplatesError("");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setTemplatesError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setTemplatesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [docType, form]);

  function applyDraftPatch(patch: Partial<NewGenerationDraft>) {
    form.setFieldsValue(patch);
    onDraftChange(patch);
  }

  function applyImageTemplate(template: ImagePromptTemplate) {
    const nextPrompt = template.promptPreset.trim();
    const currentPrompt = String(form.getFieldValue("prompt") ?? "");
    const apply = () => {
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

  return (
    <div className="fluid-new-task">
      <section className="fluid-start-card">
        <div className="fluid-spark">
          <MaterialSymbol name="auto_awesome" />
        </div>
        <h1>{t("dialogue.startTitle")}</h1>
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
      </section>
      <Form form={form} layout="vertical" initialValues={initialValues} onValuesChange={(_, values) => {
        onDraftChange({
          documentType: (values.documentType ?? draft.documentType) as DocumentType,
          topic: values.topic ?? "",
          prompt: values.prompt ?? "",
          mode: values.mode,
        });
      }} onFinish={(values) => {
        const validation = attachments.validateForSubmit();
        if (!validation.ok) {
          message.warning(validation.reason);
          return;
        }
        const { promptTemplateId: _promptTemplateId, ...submitValues } = values;
        void _promptTemplateId;
        onSubmit({ ...submitValues, ...attachments.collect() });
      }} className="fluid-command-bar">
        <div className="format-row">
          <span>{t("dialogue.format.label")}</span>
          <Form.Item name="documentType" noStyle>
            <Radio.Group
              optionType="button"
              options={documentTypeOptions.map((option) => ({ value: option.value, label: option.label }))}
            />
          </Form.Item>
        </div>
        <Form.Item name="topic" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="promptTemplateId" hidden>
          <Input />
        </Form.Item>
        {docType === "img" ? (
          <ImageTemplatePicker
            templates={imageTemplates}
            selectedId={selectedTemplateId}
            loading={templatesLoading}
            error={templatesError}
            onSelect={applyImageTemplate}
            onClear={() => setSelectedTemplateId(undefined)}
            t={t}
          />
        ) : null}
        {docType === "img" && selectedTemplateId ? (
          <div className="image-template-replace-hint">{t("dialogue.imageTemplates.replaceHint")}</div>
        ) : null}
        <Form.Item name="prompt" rules={[{ required: true, message: t("dialogue.prompt.required") }]}>
          <Input.TextArea autoSize={{ minRows: 4, maxRows: 8 }} placeholder={t("dialogue.prompt.placeholder")} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) { e.preventDefault(); form.submit(); } }} onPaste={makePasteHandler(attachments, t)} />
        </Form.Item>
        {attachments.sourceWorkbookSpec && attachments.sourceFile ? (
          <div className="attached-file">
            <PaperClipOutlined />
            <span title={attachments.sourceFile}>{attachments.sourceFile.split(/[/\\]/).pop()}</span>
            <Button type="text" size="small" icon={<DeleteOutlined />} onClick={attachments.clearSourceFile} />
          </div>
        ) : null}
        {attachments.referenceImagesSpec && attachments.referenceImages.length > 0 ? (
          <ReferenceImageStrip
            items={attachments.referenceImages}
            maxCount={attachments.referenceImagesSpec.maxCount}
            onRemove={attachments.removeReferenceImage}
            onAdd={attachments.pickReferenceImages}
          />
        ) : null}
        <div className="composer-actions">
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
                  icon={<MaterialSymbol name="image" />}
                  onClick={attachments.pickReferenceImages}
                  disabled={attachments.isReferenceLimitReached}
                  aria-label={t("dialogue.attach.referenceImages.attach")}
                />
              </Tooltip>
            ) : null}
            <Tooltip title={t("dialogue.attach.advancedOptions")}>
              <Button icon={<MaterialSymbol name="tune" />} disabled />
            </Tooltip>
          </Space>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={busy}>
            {t("dialogue.generate")}
          </Button>
        </div>
      </Form>
    </div>
  );
}

function ImageTemplatePicker({ templates, selectedId, loading, error, onSelect, onClear, t }: {
  templates: ImagePromptTemplate[];
  selectedId?: string;
  loading: boolean;
  error: string;
  onSelect: (template: ImagePromptTemplate) => void;
  onClear: () => void;
  t: Translator;
}) {
  if (loading) {
    return <div className="image-template-status">{t("dialogue.imageTemplates.loading")}</div>;
  }
  if (error) {
    return <div className="image-template-status image-template-status-error">{t("dialogue.imageTemplates.error", { error })}</div>;
  }
  if (templates.length === 0) {
    return <div className="image-template-status">{t("dialogue.imageTemplates.empty")}</div>;
  }
  return (
    <div className="image-template-picker" aria-label={t("dialogue.imageTemplates.label")}>
      <div className="image-template-picker-head">
        <span>{t("dialogue.imageTemplates.label")}</span>
        {selectedId ? <button type="button" onClick={() => onClear()}>{t("dialogue.imageTemplates.clear")}</button> : null}
      </div>
      <div className="image-template-grid">
        {templates.map((template) => {
          const id = String(template.id);
          const selected = selectedId === id;
          return (
            <button
              key={id}
              type="button"
              className={`image-template-card ${selected ? "image-template-card-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onSelect(template)}
            >
              <div className="image-template-thumb">
                {template.thumbnailUrl ? <img src={template.thumbnailUrl} alt="" /> : <MaterialSymbol name="image" />}
              </div>
              <strong>{template.title}</strong>
              {template.description ? <span>{template.description}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Conversation View ─── */

function ConversationView({ tasks, busy, onPreview, onForceCancel, onContinueGeneration, onOpenLogin }: {
  tasks: DesktopTask[];
  busy: boolean;
  onPreview: (artifact: Artifact) => void;
  onForceCancel?: (taskId: string) => void;
  onContinueGeneration?: (documentType: string, prompt: string, referenceImages?: string[]) => void;
  onOpenLogin: () => void;
}) {
  const latestTask = tasks[tasks.length - 1];
  const bottomRef = useRef<HTMLDivElement>(null);
  const t = useT();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [latestTask.events.length]);

  const isActive = ["running", "starting", "question"].includes(latestTask.status);

  return (
    <div className="conversation-layout">
      <div className="chat-thread">
        {tasks.map((task) => {
          const isLatest = task.id === latestTask.id;
          // Past rounds: always show as completed/failed/cancelled
          if (!isLatest || !isActive) {
            return <ConversationRound key={task.id} task={task} onPreview={onPreview} onOpenLogin={onOpenLogin} />;
          }
          // Latest + active: show as active round
          return <ActiveTaskRound key={task.id} task={task} onForceCancel={onForceCancel} />;
        })}
        <div ref={bottomRef} />
      </div>
      <ConversationFooter
        latestTask={latestTask}
        busy={busy}
        onContinueGeneration={onContinueGeneration}
        onForceCancel={onForceCancel}
        onOpenLogin={onOpenLogin}
      />
    </div>
  );
}

/* ─── Conversation Round (completed / failed / cancelled) ─── */

function ConversationRound({ task, onPreview, onOpenLogin }: {
  task: DesktopTask;
  onPreview: (artifact: Artifact) => void;
  onOpenLogin: () => void;
}) {
  const t = useT();
  const subject = taskSubject(task, t);
  const timeMarker = formatLocalTimestamp(task.events[0]?.ts) || t("dialogue.history.generationHistory");

  return (
    <>
      <div className="time-marker">{timeMarker}</div>
      <UserMessage task={task} fallback={subject} />
      <TaskResultMessage task={task} onPreview={onPreview} onOpenLogin={onOpenLogin} />
    </>
  );
}

/* ─── Active Task Round (running / starting / question) ─── */

function ActiveTaskRound({ task, onForceCancel }: {
  task: DesktopTask;
  onForceCancel?: (taskId: string) => void;
}) {
  const t = useT();
  const capability = useReportCapability();
  const [reportOpen, setReportOpen] = useState(false);
  const [stalledRequestId, setStalledRequestId] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const subject = taskSubject(task, t);
  const documentType = task.documentType || task.artifact?.documentType || t("dialogue.history.targetTypeDefault");
  const isRunning = task.status === "running" || task.status === "starting";
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
  const latestText = eventText(latestEvent);

  return (
    <>
      <div className="time-marker">{timeMarker}</div>
      <UserMessage task={task} fallback={subject} />
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
          <li className={isRunning || task.status === "question" ? "active" : ""}>
            {isRunning ? <LoadingOutlined /> : <CheckCircleFilled />}{" "}
            {latestText ? <span>{latestText}</span> : t("dialogue.history.waitingEvents")}
          </li>
          <li className="muted">{t("dialogue.history.taskId", { id: task.id })}</li>
        </ul>
      </div>
      <TaskRuntimePanel task={task} />
      <FluidProgressPanel task={task} />
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

/* ─── Task Result Message (completed / failed / cancelled) ─── */

function TaskResultMessage({ task, onPreview, onOpenLogin }: {
  task: DesktopTask;
  onPreview: (artifact: Artifact) => void;
  onOpenLogin: () => void;
}) {
  const t = useT();
  const capability = useReportCapability();
  const [reportOpen, setReportOpen] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const failed = task.status === "failed";
  const cancelled = task.status === "cancelled";
  const completed = task.status === "completed";
  const artifact = task.artifact;
  const latestEvent = task.events.at(-1);
  const creditTag = renderCreditTag(task, t);

  useEffect(() => {
    if (capability?.enabled || completed) return;
    let c = false;
    officecli.peekReportContext(task.id).then((ctx) => {
      if (!c) setRequestId(ctx.requestId || null);
    }).catch(() => {});
    return () => { c = true; };
  }, [task.id, capability?.enabled, completed]);

  if (completed) {
    const completionMessage = eventText(latestEvent);
    const duration = taskDurationLabel(task.events, t);
    const completedAt = formatLocalTimestamp(artifact?.syncedAt) || formatLocalTimestamp(latestEvent?.ts) || t("dialogue.completed.completionTimeUnknown");
    return (
      <div className="message ai-message success">
        <div className="message-author">
          <CheckCircleFilled />
          <strong>{t("dialogue.completed.title")}</strong>
          <Tag color="green">{duration}</Tag>
          {creditTag}
        </div>
        <p>{completionMessage || t("dialogue.completed.completionFallback")}</p>
        {artifact ? (
          isImageArtifact(artifact) ? (
            <div className="result-image-card">
              <InlineImagePreview artifact={artifact} />
              <div className="result-image-meta">
                <strong>{artifact.fileName}</strong>
                <span>{t("dialogue.completed.imageMeta", { type: artifact.documentType.toUpperCase(), time: completedAt })}</span>
              </div>
              <Space>
                <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => officecli.openPath(artifact.filePath)}>
                  {t("dialogue.completed.open")}
                </Button>
                <Button icon={<FolderOpenOutlined />} onClick={() => officecli.showItemInFolder(artifact.filePath)}>
                  {t("dialogue.completed.showInFolder")}
                </Button>
              </Space>
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
    <div className={`message ai-message terminal ${failed ? "failed" : "cancelled"}`}>
      <div className="message-author">
        {failed ? <CloseCircleOutlined /> : <StopOutlined />}
        <strong>{title}</strong>
        <Tag color={failed ? "red" : "default"}>{task.status}</Tag>
        {creditTag}
      </div>
      <p>{description}</p>
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
      <div className="terminal-event-card">
        <span>{t("dialogue.history.taskIdLabel")}</span>
        <strong>{task.id}</strong>
      </div>
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
      <ReportIssueDialog open={reportOpen} taskId={task.id} onClose={() => setReportOpen(false)} />
    </div>
  );
}

/* ─── Conversation Footer ─── */

function ConversationFooter({ latestTask, busy, onContinueGeneration, onForceCancel, onOpenLogin }: {
  latestTask: DesktopTask;
  busy: boolean;
  onContinueGeneration?: (documentType: string, prompt: string, referenceImages?: string[]) => void;
  onForceCancel?: (taskId: string) => void;
  onOpenLogin: () => void;
}) {
  const t = useT();
  const status = latestTask.status;
  const [continuationPrompt, setContinuationPrompt] = useState("");
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [cancelling, setCancelling] = useState(false);
  const artifact = latestTask.artifact;

  // Running / Starting / Question: readonly composer with cancel
  if (status === "running" || status === "starting") {
    return (
      <div className="docked-composer readonly">
        <Input prefix={<PaperClipOutlined />} suffix={<LoadingOutlined />} placeholder={t("dialogue.running.placeholder")} disabled />
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

  // Question: show answer form
  if (status === "question" && latestTask.question) {
    const question = latestTask.question;
    const [form] = Form.useForm<{ answer: string }>();
    async function answer(optionId?: string, value?: string) {
      await officecli.respond({ taskId: latestTask.id, questionId: question.id, optionId, answer: value });
    }
    return (
      <div className="docked-composer readonly">
        <Space wrap>
          {(question.options.length ? question.options : [
            { id: "include", label: t("dialogue.question.option.include") },
            { id: "skip", label: t("dialogue.question.option.skip") },
          ]).map((option) => (
            <Button key={option.id} onClick={() => answer(option.id, option.label)}>
              {option.label}
            </Button>
          ))}
        </Space>
        {question.allowFreeform ? (
          <Form form={form} className="inline-answer" onFinish={(values) => answer(undefined, values.answer)}>
            <Form.Item name="answer" noStyle>
              <Input placeholder={t("dialogue.question.inputPlaceholder")} />
            </Form.Item>
            <Button type="primary" htmlType="submit" icon={<SendOutlined />} />
          </Form>
        ) : null}
      </div>
    );
  }

  // Completed / Failed / Cancelled: show continuation composer for ALL types
  if (status === "completed" || status === "failed" || status === "cancelled") {
    // Get document type from artifact or task
    const docType = latestTask.documentType || latestTask.artifact?.documentType || "docx";

    // Only image type allows continuation editing when there's already an artifact
    const inputDisabled = artifact && !isImageArtifact(artifact);

    return (
      <div className="docked-composer" data-testid="continuation-composer">
        {referenceImages.length > 0 ? (
          <ReferenceImageStrip
            items={referenceImages}
            maxCount={referenceImages.length}
            onRemove={(path) => setReferenceImages((prev) => prev.filter((p) => p !== path))}
            onAdd={() => {
              // Fallback for non-image types that don't support image attachment
              officecli.openMultiFileDialog({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] }] }).then((paths) => {
                if (paths) setReferenceImages((prev) => [...prev, ...paths]);
              }).catch(() => {});
            }}
          />
        ) : null}
        <div className="composer-row">
          <Input.TextArea
            autoSize={{ minRows: 1, maxRows: 4 }}
            placeholder={artifact && isImageArtifact(artifact) ? t("dialogue.completed.continuationPlaceholder") : t("dialogue.completed.askPlaceholder")}
            value={continuationPrompt}
            onChange={(e) => setContinuationPrompt(e.target.value)}
            disabled={inputDisabled}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                e.preventDefault();
                if (!inputDisabled && continuationPrompt.trim() && onContinueGeneration) {
                  onContinueGeneration(docType, continuationPrompt.trim(), referenceImages.length > 0 ? referenceImages : undefined);
                  setContinuationPrompt("");
                  setReferenceImages([]);
                }
              }
            }}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            disabled={inputDisabled || !continuationPrompt.trim()}
            onClick={() => {
              if (!inputDisabled && continuationPrompt.trim() && onContinueGeneration) {
                onContinueGeneration(docType, continuationPrompt.trim(), referenceImages.length > 0 ? referenceImages : undefined);
                setContinuationPrompt("");
                setReferenceImages([]);
              }
            }}
          />
        </div>
      </div>
    );
  }

  // Fallback: readonly composer
  return (
    <div className="docked-composer readonly">
      <Input disabled suffix={<SendOutlined />} placeholder={t("dialogue.completed.askPlaceholder")} />
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
  const isRunning = status === "running" || status === "starting" || status === "question";
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

// Recognises the officecli error emitted when the device's anonymous credit
// pool is depleted (e.g. "Anonymous credits are exhausted. Run `officecli
// login`, then buy hosted credits for your account."). The wording can shift
// across CLI versions, so we match the durable phrase plus the login hint.
export function isCreditsExhaustedError(text: string | undefined): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  if (!lower.includes("credit")) return false;
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
  return (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = event.clipboardData?.files;
    if (!items || items.length === 0) return;
    const images: File[] = [];
    for (const file of Array.from(items)) {
      if (file.type.startsWith("image/")) images.push(file);
    }
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
}: {
  items: string[];
  maxCount: number;
  onRemove: (path: string) => void;
  onAdd: () => void;
}) {
  const t = useT();
  return (
    <div className="reference-image-strip" aria-label={t("dialogue.attach.referenceImages.aria.strip")}>
      {items.map((path) => (
        <ReferenceImageChip key={path} path={path} onRemove={() => onRemove(path)} />
      ))}
      {items.length < maxCount ? (
        <button type="button" className="reference-image-add" onClick={onAdd} aria-label={t("dialogue.attach.referenceImages.aria")}>
          <MaterialSymbol name="add_photo_alternate" />
          <span>{items.length === 0 ? t("dialogue.attach.referenceImages.add") : t("dialogue.attach.referenceImages.addMore")}</span>
        </button>
      ) : null}
    </div>
  );
}

function ReferenceImageChip({ path, onRemove }: { path: string; onRemove: () => void }) {
  const t = useT();
  const fileName = path.split(/[/\\]/).pop() || path;
  return (
    <div className="reference-image-chip" title={path}>
      <MaterialSymbol name="image" />
      <span className="reference-image-name">{fileName}</span>
      <button type="button" className="reference-image-remove" onClick={onRemove} aria-label={t("dialogue.attach.referenceImages.remove", { name: fileName })}>
        <CloseCircleFilled />
      </button>
    </div>
  );
}

function isImageArtifact(artifact: Artifact): boolean {
  const type = (artifact.documentType || "").toLowerCase();
  if (type === "img" || IMAGE_EXTENSIONS.includes(type)) return true;
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.includes(extension);
}

function imageExtensionFor(artifact: Artifact): string {
  const type = (artifact.documentType || "").toLowerCase();
  if (IMAGE_EXTENSIONS.includes(type)) return type;
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  return IMAGE_EXTENSIONS.includes(extension) ? extension : "png";
}

function UserMessage({ task, fallback }: { task: DesktopTask; fallback: string }) {
  const input = task.userInput;
  const prompt = input?.prompt?.trim();
  const referenceImages = input?.referenceImages ?? [];
  const sourceFile = input?.sourceFile;
  const hasAttachments = referenceImages.length > 0 || Boolean(sourceFile);
  const displayText = prompt || (hasAttachments ? "" : fallback);

  return (
    <div className="message user-message">
      {displayText ? <div className="user-message-prompt">{displayText}</div> : null}
      {referenceImages.length > 0 ? (
        <div className="user-message-images">
          <Image.PreviewGroup>
            {referenceImages.map((path) => (
              <UserReferenceImage key={path} filePath={path} />
            ))}
          </Image.PreviewGroup>
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
    <div className="user-message-image-thumb">
      <Image src={src} alt={fileName} preview={{ mask: t("dialogue.userMessage.imagePreviewMask") }} />
    </div>
  );
}

function InlineImagePreview({ artifact }: { artifact: Artifact }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
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
    <div className="result-image-thumb">
      <Image src={src} alt={artifact.fileName} preview={{ mask: t("dialogue.completed.imagePreviewMask") }} />
    </div>
  );
}
