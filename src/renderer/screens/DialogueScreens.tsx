import { Button, Form, Image, Input, message, Progress, Radio, Select, Space, Tag, Timeline, Tooltip, Typography } from "antd";
import {
  CheckCircleFilled,
  CloseCircleFilled,
  CloseCircleOutlined,
  CloudOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  LoadingOutlined,
  PaperClipOutlined,
  PlayCircleOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
  WarningFilled,
} from "@ant-design/icons";
import { useEffect, useRef, useState, type ClipboardEvent } from "react";
import type { Artifact, BridgeEvent, DesktopTask, DocumentType, GenerateInput, StageState } from "../../shared/types";
import { defaultGenerateInput } from "../defaults";
import { useSettings } from "../useSettings";
import { useAttachments } from "../useAttachments";
import { officecli } from "../bridge";
import { documentTypeOptions } from "../mockData";
import { FileGlyph, MaterialSymbol } from "../components/Shell";

export type FailureKind = "connection" | "auth" | "task" | "setup" | "other";

interface DialogueProps {
  task?: DesktopTask;
  artifacts: Artifact[];
  busy: boolean;
  lastError?: string;
  errorKind: FailureKind;
  errorDetails?: string;
  bridgeStatus: string;
  fluid: boolean;
  onSubmit: (values: GenerateInput) => Promise<void>;
  onOpenSettings: () => void;
  onOpenLogin: () => void;
  onRetry: () => void;
  onPreview: (artifact: Artifact) => void;
}

export function DialogueScreen({ task, artifacts, busy, lastError, errorKind, errorDetails, bridgeStatus, fluid, onSubmit, onOpenSettings, onOpenLogin, onRetry, onPreview }: DialogueProps) {
  if (lastError) {
    return <ConnectionFailure kind={errorKind} status={bridgeStatus} error={lastError} details={errorDetails} onOpenSettings={onOpenSettings} onOpenLogin={onOpenLogin} onRetry={onRetry} />;
  }
  if (task?.status === "question" && task.question) {
    return <QuestionDialogue task={task} />;
  }
  if (task?.status === "completed") {
    return <CompletedDialogue task={task} onPreview={onPreview} />;
  }
  if (task?.status === "failed" || task?.status === "cancelled") {
    return <TerminalDialogue task={task} />;
  }
  if (task?.status === "running" || task?.status === "starting") {
    return <RunningDialogue task={task} />;
  }
  if (fluid) {
    return <FluidNewGeneration busy={busy} onSubmit={onSubmit} />;
  }
  return <NewGeneration busy={busy} onSubmit={onSubmit} />;
}

function NewGeneration({ busy, onSubmit }: { busy: boolean; onSubmit: (values: GenerateInput) => Promise<void> }) {
  const [form] = Form.useForm<GenerateInput>();
  const { settings } = useSettings();
  const initialValues = { ...defaultGenerateInput, ...settings.defaults };
  const docType = (Form.useWatch("documentType", form) ?? initialValues.documentType) as DocumentType;
  const attachments = useAttachments(docType);

  useEffect(() => {
    form.setFieldsValue({
      documentType: settings.defaults.documentType,
      mode: settings.defaults.mode,
      runtimeMode: settings.defaults.runtimeMode,
    });
  }, [form, settings.defaults.documentType, settings.defaults.mode, settings.defaults.runtimeMode]);

  return (
    <div className="document-workspace empty-workspace">
      <div className="workspace-titlebar">
        <div>
          <div className="eyebrow">Untitled Generation</div>
          <h1>Start building your professional documents here</h1>
          <p>Enter instructions below or choose a template. OfficeDex will use Bridge to generate artifacts.</p>
        </div>
        <Tag color="blue">Local Bridge</Tag>
      </div>
      <div className="empty-hero">
        <MaterialSymbol name="edit_document" />
        <h2>Target Artifact</h2>
        <div className="doc-type-grid">
          {documentTypeOptions.slice(0, 3).map((option) => (
            <button key={option.value} className={`doc-type-card ${docType === option.value ? "active" : ""}`} onClick={() => form.setFieldValue("documentType", option.value)}>
              <MaterialSymbol name={option.icon} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      </div>
      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={(values) => {
        const validation = attachments.validateForSubmit();
        if (!validation.ok) {
          message.warning(validation.reason);
          return;
        }
        onSubmit({ ...values, ...attachments.collect() });
      }} className="docked-composer">
        <div className="composer-options">
          <Form.Item name="documentType" noStyle>
            <Select
              className="compact-select"
              options={documentTypeOptions.map((item) => ({ value: item.value, label: item.label }))}
            />
          </Form.Item>
          <Form.Item name="mode" noStyle>
            <Radio.Group
              optionType="button"
              buttonStyle="solid"
              options={[
                { value: "fast", label: "Fast" },
                { value: "best", label: "Smart" },
              ]}
            />
          </Form.Item>
          <Form.Item name="runtimeMode" noStyle>
            <Select
              className="compact-select"
              options={[
                { value: "hosted", label: "Hosted" },
                { value: "external", label: "Local Bridge" },
              ]}
            />
          </Form.Item>
        </div>
        <Form.Item name="topic" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="prompt" rules={[{ required: true, message: "Please enter generation instructions" }]}>
          <Input.TextArea rows={3} placeholder="e.g.: Generate a Q3 marketing plan including multi-channel distribution, retention, and budget allocation." onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.submit(); } }} onPaste={makePasteHandler(attachments)} />
        </Form.Item>
        {attachments.sourceWorkbookSpec && attachments.sourceFile ? (
          <div className="attached-file">
            <PaperClipOutlined />
            <span title={attachments.sourceFile}>{attachments.sourceFile.split(/[/\\]/).pop()}</span>
            <Button type="text" size="small" icon={<DeleteOutlined />} onClick={attachments.clearSourceFile} />
          </div>
        ) : null}
        {attachments.referenceImagesSpec ? (
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
                    ? `${attachments.sourceWorkbookSpec.label} (required, .${attachments.sourceWorkbookSpec.extensions[0]})`
                    : attachments.sourceWorkbookSpec.label
                }
              >
                <Button icon={<PaperClipOutlined />} onClick={attachments.pickSourceFile} aria-label="Attach source file" />
              </Tooltip>
            ) : null}
            {attachments.referenceImagesSpec ? (
              <Tooltip title={`Attach reference images (up to ${attachments.referenceImagesSpec.maxCount})`}>
                <Button
                  icon={<MaterialSymbol name="image" />}
                  onClick={attachments.pickReferenceImages}
                  disabled={attachments.isReferenceLimitReached}
                  aria-label="Attach reference images"
                />
              </Tooltip>
            ) : (
              <Button icon={<MaterialSymbol name="auto_awesome_mosaic" />} />
            )}
            <Button icon={<MaterialSymbol name="temp_preferences_custom" />} />
          </Space>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={busy}>
            Generate
          </Button>
        </div>
      </Form>
    </div>
  );
}

function FluidNewGeneration({ busy, onSubmit }: { busy: boolean; onSubmit: (values: GenerateInput) => Promise<void> }) {
  const [form] = Form.useForm<GenerateInput>();
  const { settings } = useSettings();
  const initialValues = { ...defaultGenerateInput, ...settings.defaults };
  const docType = (Form.useWatch("documentType", form) ?? initialValues.documentType) as DocumentType;
  const attachments = useAttachments(docType);

  useEffect(() => {
    form.setFieldsValue({
      documentType: settings.defaults.documentType,
      mode: settings.defaults.mode,
      runtimeMode: settings.defaults.runtimeMode,
    });
  }, [form, settings.defaults.documentType, settings.defaults.mode, settings.defaults.runtimeMode]);

  return (
    <div className="fluid-new-task">
      <div className="fluid-task-header">
        <Space>
          <Tag icon={<MaterialSymbol name="schedule" />}>Just Created</Tag>
          <Tag icon={<MaterialSymbol name="cloud_off" />}>Unsaved Draft</Tag>
          <Tag icon={<MaterialSymbol name="lock_open" />}>Personal Workspace</Tag>
        </Space>
      </div>
      <section className="fluid-start-card">
        <div className="fluid-spark">
          <MaterialSymbol name="auto_awesome" />
        </div>
        <h1>Start a New Generation</h1>
        <p>Choose a preset scenario or enter instructions to let OfficeDex AI generate documents, presentations, or data structures.</p>
        <div className="fluid-prompt-grid">
          <button onClick={() => form.setFieldsValue({ documentType: "report", topic: "Quarterly Analysis Report", prompt: "Generate a standardized business report framework with data insights and trend forecasts." })}>
            <MaterialSymbol name="analytics" />
            <strong>Quarterly Analysis Report</strong>
            <span>Generate a standardized business report framework with data insights and trend forecasts.</span>
          </button>
          <button onClick={() => form.setFieldsValue({ documentType: "pptx", topic: "Project Kickoff Presentation", prompt: "Create a 15-slide outline covering goals, timeline, and resource allocation." })}>
            <MaterialSymbol name="present_to_all" />
            <strong>Project Kickoff Presentation</strong>
            <span>Create a 15-slide outline covering goals, timeline, and resource allocation.</span>
          </button>
          <button onClick={() => form.setFieldsValue({ documentType: "xlsx", topic: "Competitive Analysis", prompt: "Build a data table structure with core features, pricing, and market share metrics." })}>
            <MaterialSymbol name="table_chart" />
            <strong>Competitive Analysis</strong>
            <span>Build a data table structure with core features, pricing, and market share metrics.</span>
          </button>
        </div>
      </section>
      <Form form={form} layout="vertical" initialValues={initialValues} onFinish={(values) => {
        const validation = attachments.validateForSubmit();
        if (!validation.ok) {
          message.warning(validation.reason);
          return;
        }
        onSubmit({ ...values, ...attachments.collect() });
      }} className="fluid-command-bar">
        <div className="format-row">
          <span>Generate:</span>
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
        <Form.Item name="prompt" rules={[{ required: true, message: "Please enter generation instructions" }]}>
          <Input.TextArea rows={3} placeholder="Enter what you want to generate, or choose a template above..." onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.submit(); } }} onPaste={makePasteHandler(attachments)} />
        </Form.Item>
        {attachments.sourceWorkbookSpec && attachments.sourceFile ? (
          <div className="attached-file">
            <PaperClipOutlined />
            <span title={attachments.sourceFile}>{attachments.sourceFile.split(/[/\\]/).pop()}</span>
            <Button type="text" size="small" icon={<DeleteOutlined />} onClick={attachments.clearSourceFile} />
          </div>
        ) : null}
        {attachments.referenceImagesSpec ? (
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
                    ? `${attachments.sourceWorkbookSpec.label} (required, .${attachments.sourceWorkbookSpec.extensions[0]})`
                    : attachments.sourceWorkbookSpec.label
                }
              >
                <Button icon={<PaperClipOutlined />} onClick={attachments.pickSourceFile} aria-label="Attach source file" />
              </Tooltip>
            ) : null}
            {attachments.referenceImagesSpec ? (
              <Tooltip title={`Attach reference images (up to ${attachments.referenceImagesSpec.maxCount})`}>
                <Button
                  icon={<MaterialSymbol name="image" />}
                  onClick={attachments.pickReferenceImages}
                  disabled={attachments.isReferenceLimitReached}
                  aria-label="Attach reference images"
                />
              </Tooltip>
            ) : null}
            <Tooltip title="Advanced options (coming soon)">
              <Button icon={<MaterialSymbol name="tune" />} disabled />
            </Tooltip>
          </Space>
          <Button type="primary" htmlType="submit" icon={<SendOutlined />} loading={busy}>
            Generate
          </Button>
        </div>
      </Form>
    </div>
  );
}

function RunningDialogue({ task }: { task: DesktopTask }) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [task.events.length]);

  return (
    <div className="conversation-layout">
      <div className="chat-thread">
        <GenerationHistoryThread task={task} />
        <div ref={bottomRef} />
      </div>
      <div className="docked-composer readonly">
        <Input prefix={<PaperClipOutlined />} suffix={<LoadingOutlined />} placeholder="OfficeDex is processing, please wait..." disabled />
        <Button danger icon={<StopOutlined />} onClick={() => officecli.cancel(task.id)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function GenerationHistoryThread({ task, hideLatestText }: { task: DesktopTask; hideLatestText?: boolean }) {
  const latestEvent = task.events.at(-1);
  const latestText = eventText(latestEvent);
  const subject = taskSubject(task);
  const documentType = task.documentType || task.artifact?.documentType || "Target Document";
  const isRunning = task.status === "running" || task.status === "starting" || task.status === "question";
  const timeMarker = latestEvent?.ts || (isRunning ? "Task in Progress" : "Generation History");
  return (
    <>
      <div className="time-marker">{timeMarker}</div>
      <div className="message user-message">{subject}</div>
      <div className="message ai-message">
        <div className="message-author">
          <MaterialSymbol name="smart_toy" />
          <strong>OfficeDex AI</strong>
        </div>
        <ul className="ai-checks">
          <li>
            <CheckCircleFilled /> Task received: {subject}
          </li>
          <li>
            <CheckCircleFilled /> Target type: {documentType.toUpperCase()}
          </li>
          {!hideLatestText ? (
            <li className={isRunning ? "active" : ""}>
              {isRunning ? <LoadingOutlined /> : <CheckCircleFilled />}{" "}
              {latestText ? <span>{latestText}</span> : "Waiting for Bridge event updates"}
            </li>
          ) : null}
          <li className="muted">Task ID: {task.id}</li>
        </ul>
      </div>
      <FluidProgressPanel task={task} />
    </>
  );
}

function QuestionDialogue({ task }: { task: DesktopTask }) {
  const [form] = Form.useForm<{ answer: string }>();
  const question = task.question;
  if (!question) return null;
  const currentQuestion = question;
  async function answer(optionId?: string, value?: string) {
    await officecli.respond({ taskId: task.id, questionId: currentQuestion.id, optionId, answer: value });
  }
  return (
    <div className="conversation-layout">
      <div className="chat-thread">
        <div className="time-marker">Today 10:23 AM</div>
        <div className="message ai-message warning">
          <div className="message-author">
            <WarningFilled />
            <strong>Confirmation Required</strong>
          </div>
          <p>{question.question || "Would you like to include last quarter's financial comparison data?"}</p>
          <Space wrap>
            {(question.options.length ? question.options : [{ id: "include", label: "Include" }, { id: "skip", label: "Exclude" }]).map((option) => (
              <Button key={option.id} onClick={() => answer(option.id, option.label)}>
                {option.label}
              </Button>
            ))}
          </Space>
          {question.allowFreeform ? (
            <Form form={form} className="inline-answer" onFinish={(values) => answer(undefined, values.answer)}>
              <Form.Item name="answer" noStyle>
                <Input placeholder="Or add other instructions" />
              </Form.Item>
              <Button type="primary" htmlType="submit" icon={<SendOutlined />} />
            </Form>
          ) : null}
        </div>
      </div>
      <div className="context-note">OfficeDex AI may produce inaccurate information. Please verify important content.</div>
    </div>
  );
}

function CompletedDialogue({ task, onPreview }: { task: DesktopTask; onPreview: (artifact: Artifact) => void }) {
  const artifact = task.artifact;
  const latestEvent = task.events.at(-1);
  const completionMessage = eventText(latestEvent);
  const subject = taskSubject(task);
  const duration = taskDurationLabel(task.events);
  const completedAt = artifact?.syncedAt || latestEvent?.ts || "Completion time unknown";
  return (
    <div className="conversation-layout">
      <div className="chat-thread">
        <GenerationHistoryThread task={task} hideLatestText />
        <div className="message ai-message success">
          <div className="message-author">
            <CheckCircleFilled />
            <strong>Generation Complete</strong>
            <Tag color="green">{duration}</Tag>
          </div>
          <p>{completionMessage || "Completed"}</p>
          {artifact ? (
            isImageArtifact(artifact) ? (
              <div className="result-image-card">
                <InlineImagePreview artifact={artifact} />
                <div className="result-image-meta">
                  <strong>{artifact.fileName}</strong>
                  <span>
                    {artifact.documentType.toUpperCase()} · {completedAt}
                  </span>
                </div>
                <Space>
                  <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => officecli.openPath(artifact.filePath)}>
                    Open
                  </Button>
                  <Button icon={<FolderOpenOutlined />} onClick={() => officecli.showItemInFolder(artifact.filePath)}>
                    Show in folder
                  </Button>
                </Space>
              </div>
            ) : (
              <div className="result-card">
                <FileGlyph type={artifact.documentType} />
                <div>
                  <strong>{artifact.fileName}</strong>
                  <span>
                    {artifact.documentType.toUpperCase()} Document · {completedAt}
                  </span>
                </div>
                <Space>
                  <Button type="primary" icon={<PlayCircleOutlined />} onClick={() => officecli.openPath(artifact.filePath)}>
                    Open
                  </Button>
                  {supportsOfflinePreview(artifact) ? <Button onClick={() => onPreview(artifact)}>Preview</Button> : null}
                  <Button icon={<FolderOpenOutlined />} onClick={() => officecli.showItemInFolder(artifact.filePath)}>
                    Show in folder
                  </Button>
                </Space>
              </div>
            )
          ) : null}
        </div>
      </div>
      <div className="docked-composer readonly">
        <Input suffix={<SendOutlined />} placeholder="Ask a message or command..." />
      </div>
    </div>
  );
}

function TerminalDialogue({ task }: { task: DesktopTask }) {
  const failed = task.status === "failed";
  const latestEvent = task.events.at(-1);
  const title = failed ? "Generation Failed" : "Task Cancelled";
  const description = failed ? task.error || eventText(latestEvent) || "Bridge reported task.failed." : eventText(latestEvent) || "Bridge reported task.cancelled.";
  return (
    <div className="conversation-layout">
      <div className="chat-thread">
        <GenerationHistoryThread task={task} hideLatestText />
        <div className={`message ai-message terminal ${failed ? "failed" : "cancelled"}`}>
          <div className="message-author">
            {failed ? <CloseCircleOutlined /> : <StopOutlined />}
            <strong>{title}</strong>
            <Tag color={failed ? "red" : "default"}>{task.status}</Tag>
          </div>
          <p>{description}</p>
          <div className="terminal-event-card">
            <span>Task ID</span>
            <strong>{task.id}</strong>
          </div>
          <div className="terminal-events">
            <h3>Bridge event context</h3>
            <Timeline
              items={eventsForTimeline(task.events).map((event) => ({
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
        </div>
      </div>
      <div className="docked-composer readonly">
        <Input placeholder={failed ? "Fix instructions and click New Generation to restart" : "Task cancelled. Click New Generation to create a new task"} disabled />
      </div>
    </div>
  );
}

function ConnectionFailure({ kind, status, error, details, onOpenSettings, onRetry, onOpenLogin }: { kind: FailureKind; status: string; error: string; details?: string; onOpenSettings: () => void; onRetry: () => void; onOpenLogin: () => void }) {
  const copy = failureCopy(kind);
  const isSetup = kind === "setup";
  return (
    <div className="failure-workspace">
      <div className="failure-banner">
        <WarningFilled />
        <span>{copy.banner}</span>
        {kind === "auth" ? (
          <Button size="small" onClick={onOpenLogin}>
            Login
          </Button>
        ) : (
          <Button size="small" onClick={onOpenSettings}>
            Settings
          </Button>
        )}
        {isSetup ? null : (
          <Button size="small" type="primary" onClick={onRetry}>
            Retry
          </Button>
        )}
      </div>
      <div className="failure-center">
        {kind === "connection" ? <DisconnectOutlined /> : <WarningFilled />}
        <h1>{copy.title}</h1>
        <p>{error || status}</p>
        {details ? <pre className="failure-details">{details}</pre> : null}
        <Space>
          {kind === "auth" ? (
            <Button type="primary" icon={<UserOutlined />} onClick={onOpenLogin}>
              Sign In
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
              Retry
            </Button>
          ) : (
            <Button icon={<FileTextOutlined />} onClick={onOpenSettings}>
              Open Settings
            </Button>
          )}
        </Space>
      </div>
    </div>
  );
}

function failureCopy(kind: FailureKind): { banner: string; title: string; primaryAction: string } {
  switch (kind) {
    case "auth":
      return {
        banner: "OfficeCLI is not signed in. Sign in to enable generation.",
        title: "Sign-in Required",
        primaryAction: "Sign In",
      };
    case "task":
      return {
        banner: "The last generation failed. The bridge is still connected; try again or adjust your inputs.",
        title: "Generation Failed",
        primaryAction: "Try Again",
      };
    case "connection":
      return {
        banner: "OfficeCLI bridge service is not connected. Some features are unavailable.",
        title: "Connection Lost",
        primaryAction: "Restart CLI Service",
      };
    case "setup":
      return {
        banner: "OfficeCLI is not installed yet. Finish setup in Settings to enable generation.",
        title: "Setup Required",
        primaryAction: "Open Settings",
      };
    default:
      return {
        banner: "Something went wrong. See details below.",
        title: "Unexpected Error",
        primaryAction: "Retry",
      };
  }
}

function FluidProgressPanel({ task }: { task: DesktopTask }) {
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
  const header = headerForStatus(status);
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
          <span>{isRunning ? "Preparing…" : "No stage details recorded"}</span>
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

function headerForStatus(status: DesktopTask["status"]) {
  switch (status) {
    case "completed":
      return { icon: <CheckCircleFilled />, title: "Generation complete", tagColor: "green", tagText: "Done" };
    case "failed":
      return { icon: <CloseCircleFilled />, title: "Generation failed", tagColor: "red", tagText: "Failed" };
    case "cancelled":
      return { icon: <StopOutlined />, title: "Generation cancelled", tagColor: "default", tagText: "Cancelled" };
    case "question":
      return { icon: <LoadingOutlined />, title: "Waiting for your input", tagColor: "processing", tagText: "Awaiting" };
    default:
      return { icon: <LoadingOutlined />, title: "Processing your request...", tagColor: "processing", tagText: "Generating" };
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
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 200);
    return () => window.clearInterval(id);
  }, [startedAt]);
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

function eventsForTimeline(events: BridgeEvent[]) {
  const fallback = [
    { title: "Waiting for Bridge events", meta: "No progress events", color: "gray" },
  ];
  if (events.length === 0) return fallback;
  return events.map((event) => ({
    title: event.type,
    meta: eventMeta(event),
    color: event.type === "task.failed" ? "red" : event.type === "task.completed" ? "green" : "blue",
  }));
}

function eventText(event?: BridgeEvent): string {
  const payload = event?.payload || {};
  return String(payload.message || payload.stage || payload.status || payload.question || "");
}

function eventMeta(event: BridgeEvent): string {
  const text = eventText(event) || "Bridge Event";
  return event.ts ? `${event.ts} · ${text}` : text;
}

function taskSubject(task: DesktopTask): string {
  return task.topic || task.artifact?.fileName || task.documentType || "Current generation task";
}

function taskDurationLabel(events: BridgeEvent[]): string {
  const firstTs = events.find((event) => event.ts)?.ts;
  const lastTs = [...events].reverse().find((event) => event.ts)?.ts;
  if (!firstTs || !lastTs || firstTs === lastTs) {
    return "Completed";
  }
  const start = Date.parse(firstTs);
  const end = Date.parse(lastTs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "Completed";
  }
  const seconds = Math.round((end - start) / 1000);
  return seconds > 0 ? `${seconds}s elapsed` : "Completed";
}

function supportsOfflinePreview(artifact: Artifact) {
  const type = artifact.documentType.toLowerCase();
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  const supported = ["docx", "xlsx", "pptx", "pdf", "html", "htm"];
  return supported.includes(type) || supported.includes(extension);
}

function makePasteHandler(attachments: ReturnType<typeof useAttachments>) {
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
      message.warning(`Reference images limit reached (${attachments.referenceImagesSpec?.maxCount ?? 0}).`);
      return;
    }
    void attachments.handlePastedFiles(images).then((added) => {
      const max = attachments.referenceImagesSpec?.maxCount;
      if (added === 0) {
        if (max !== undefined) {
          message.warning(`Reference images limit reached (${max}).`);
        }
        return;
      }
      message.success(added === 1 ? "Pasted image attached" : `Attached ${added} pasted images`);
    }).catch((error) => {
      message.error(`Failed to attach pasted image: ${(error as Error).message}`);
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
  return (
    <div className="reference-image-strip" aria-label="Reference images">
      {items.map((path) => (
        <ReferenceImageChip key={path} path={path} onRemove={() => onRemove(path)} />
      ))}
      {items.length < maxCount ? (
        <button type="button" className="reference-image-add" onClick={onAdd} aria-label="Add reference image">
          <MaterialSymbol name="add_photo_alternate" />
          <span>{items.length === 0 ? "Add reference images" : "Add more"}</span>
        </button>
      ) : null}
    </div>
  );
}

function ReferenceImageChip({ path, onRemove }: { path: string; onRemove: () => void }) {
  const fileName = path.split(/[/\\]/).pop() || path;
  return (
    <div className="reference-image-chip" title={path}>
      <MaterialSymbol name="image" />
      <span className="reference-image-name">{fileName}</span>
      <button type="button" className="reference-image-remove" onClick={onRemove} aria-label={`Remove ${fileName}`}>
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

function InlineImagePreview({ artifact }: { artifact: Artifact }) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const grant = await officecli.issuePreviewToken(artifact);
        if (cancelled) {
          officecli.revokePreviewToken(grant.token).catch(() => {});
          return;
        }
        tokenRef.current = grant.token;
        const { data } = await officecli.readArtifactFile(grant.token);
        const arrayBuf = data instanceof ArrayBuffer ? data : new Uint8Array(data as Uint8Array).buffer;
        const mime = IMAGE_MIME_BY_EXT[imageExtensionFor(artifact)] || "application/octet-stream";
        const blob = new Blob([new Uint8Array(arrayBuf as ArrayBuffer)], { type: mime });
        const url = URL.createObjectURL(blob);
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        blobUrlRef.current = url;
        setSrc(url);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
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
      <Image src={src} alt={artifact.fileName} preview={{ mask: "Click to enlarge" }} />
    </div>
  );
}
