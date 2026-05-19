import React, { useEffect, useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import { Alert, Button, Form, Input, Layout, Select, Space, Splitter, Tag, Timeline, Typography, message } from "antd";
import { FileText, FolderOpen, Play, RefreshCw, Square, UploadCloud } from "lucide-react";
import type { Artifact, BridgeEvent, DesktopAPI, DocumentType, GenerateInput } from "../shared/types";
import { defaultGenerateInput } from "./defaults";
import { applyTaskEvent, createInitialTaskState, type TaskState } from "./taskState";
import "./styles.css";

const documentTypeOptions: Array<{ value: DocumentType; label: string }> = [
  { value: "pptx", label: "PPTX" },
  { value: "docx", label: "DOCX" },
  { value: "xlsx", label: "XLSX" },
  { value: "report", label: "Report" },
  { value: "img", label: "Image" },
];

const officecli: DesktopAPI = window.officecli || createBrowserPreviewAPI();

function App() {
  const [form] = Form.useForm<GenerateInput>();
  const [state, setState] = useState<TaskState>(() => createInitialTaskState());
  const [selectedTaskID, setSelectedTaskID] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [capabilityStatus, setCapabilityStatus] = useState("Not connected");
  const [lastError, setLastError] = useState<string>();

  useEffect(() => {
    const off = officecli.onBridgeEvent((event: BridgeEvent) => {
      setState((current) => {
        const next = applyTaskEvent(current, event);
        if (event.task_id) {
          setSelectedTaskID((currentTaskID) => currentTaskID || event.task_id);
        }
        return next;
      });
    });
    officecli
      .initialize()
      .then(() => officecli.getCapabilities())
      .then((capabilities) => {
        const preview = typeof capabilities === "object" && capabilities !== null && "browserPreview" in capabilities;
        setCapabilityStatus(preview ? "Browser preview; bridge IPC requires Electron" : "Connected to officecli agent-bridge");
      })
      .catch((error) => {
        const text = errorMessage(error);
        setCapabilityStatus(text);
        setLastError(text);
      });
    return off;
  }, []);

  const selectedTask = selectedTaskID ? state.tasks[selectedTaskID] : state.taskOrder.length > 0 ? state.tasks[state.taskOrder[0]] : undefined;

  async function submit(values: GenerateInput) {
    setBusy(true);
    setLastError(undefined);
    try {
      const result = await officecli.generate(values);
      setSelectedTaskID(result.taskId);
      message.success("Task started");
    } catch (error) {
      const text = errorMessage(error);
      setLastError(text);
      message.error(text);
    } finally {
      setBusy(false);
    }
  }

  const timelineItems = useMemo(
    () =>
      (selectedTask?.events || []).map((event) => ({
        color: event.type === "task.failed" ? "red" : event.type === "task.completed" ? "green" : "blue",
        children: (
          <div>
            <strong>{event.type}</strong>
            <p>{eventText(event)}</p>
          </div>
        ),
      })),
    [selectedTask],
  );

  return (
    <Layout className="app-shell">
      <Layout.Sider width={278} theme="light" className="sidebar">
        <div className="brand">OfficeDex</div>
        <div className="status-line">{capabilityStatus}</div>
        <div className="task-list">
          {state.taskOrder.length === 0 ? <div className="empty">No tasks yet</div> : null}
          {state.taskOrder.map((taskID) => {
            const task = state.tasks[taskID];
            return (
              <button key={taskID} className={`task-row ${selectedTaskID === taskID ? "active" : ""}`} onClick={() => setSelectedTaskID(taskID)}>
                <span>{task.topic || task.id}</span>
                <Tag color={tagColor(task.status)}>{task.status}</Tag>
              </button>
            );
          })}
        </div>
      </Layout.Sider>
      <Layout.Content>
        <Splitter className="workspace">
          <Splitter.Panel defaultSize="58%" min="420px">
            <section className="composer">
              <Typography.Title level={3}>Generate office artifacts</Typography.Title>
              <Form form={form} layout="vertical" initialValues={defaultGenerateInput} onFinish={submit}>
                {lastError ? <Alert className="error-alert" type="error" showIcon message="OfficeDex bridge error" description={lastError} /> : null}
                <Space.Compact className="inline-controls">
                  <Form.Item name="documentType" noStyle>
                    <Select options={documentTypeOptions} className="type-select" />
                  </Form.Item>
                  <Form.Item name="mode" noStyle>
                    <Select
                      className="mode-select"
                      options={[
                        { value: "fast", label: "Fast" },
                        { value: "best", label: "Best" },
                      ]}
                    />
                  </Form.Item>
                  <Form.Item name="runtimeMode" noStyle>
                    <Select
                      className="mode-select"
                      options={[
                        { value: "external", label: "External" },
                        { value: "hosted", label: "Hosted" },
                      ]}
                    />
                  </Form.Item>
                </Space.Compact>
                <Form.Item name="topic" label="Title" rules={[{ required: true, message: "Enter a title" }]}>
                  <Input placeholder="Q3 Business Review" />
                </Form.Item>
                <Form.Item name="prompt" label="Prompt" rules={[{ required: true, message: "Describe the artifact" }]}>
                  <Input.TextArea rows={7} placeholder="Create an executive-ready deck with growth, retention, risks, and next actions." />
                </Form.Item>
                <Button type="primary" htmlType="submit" icon={<Play size={16} />} loading={busy}>
                  Start
                </Button>
              </Form>
            </section>
            <section className="timeline-pane">
              <div className="pane-header">
                <Typography.Title level={4}>Task timeline</Typography.Title>
                {selectedTask && selectedTask.status !== "completed" ? (
                  <Button icon={<Square size={15} />} onClick={() => officecli.cancel(selectedTask.id)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
              {selectedTask?.question ? <QuestionBox taskId={selectedTask.id} question={selectedTask.question} /> : null}
              {timelineItems.length > 0 ? <Timeline items={timelineItems} /> : <div className="empty">Task events will appear here.</div>}
            </section>
          </Splitter.Panel>
          <Splitter.Panel min="360px">
            <section className="artifact-pane">
              <Typography.Title level={4}>Artifacts</Typography.Title>
              {state.artifacts.length === 0 ? <div className="empty">Generated files will appear here.</div> : null}
              {state.artifacts.map((artifact) => (
                <ArtifactRow key={artifact.filePath} artifact={artifact} />
              ))}
            </section>
          </Splitter.Panel>
        </Splitter>
      </Layout.Content>
    </Layout>
  );
}

function QuestionBox({ taskId, question }: { taskId: string; question: NonNullable<TaskState["tasks"][string]["question"]> }) {
  const [answer, setAnswer] = useState("");
  return (
    <div className="question-box">
      <strong>{question.question}</strong>
      <Space wrap>
        {question.options.map((option) => (
          <Button key={option.id} onClick={() => officecli.respond({ taskId, questionId: question.id, optionId: option.id, answer: option.label })}>
            {option.label}
          </Button>
        ))}
      </Space>
      {question.allowFreeform ? (
        <Space.Compact className="question-answer">
          <Input value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="Custom answer" />
          <Button onClick={() => officecli.respond({ taskId, questionId: question.id, answer })}>Send</Button>
        </Space.Compact>
      ) : null}
    </div>
  );
}

function ArtifactRow({ artifact }: { artifact: Artifact }) {
  return (
    <div className="artifact-row">
      <div className="artifact-icon">
        <FileText size={18} />
      </div>
      <div className="artifact-body">
        <strong>{artifact.fileName}</strong>
        <span>{artifact.documentType.toUpperCase()}</span>
      </div>
      <Space>
        <Button icon={<FolderOpen size={15} />} onClick={() => officecli.openPath(artifact.filePath)} />
        {artifact.previewUrl ? <Button icon={<RefreshCw size={15} />} onClick={() => officecli.openExternal(artifact.previewUrl!)} /> : null}
        <Button icon={<UploadCloud size={15} />} disabled={!artifact.fileID} onClick={() => openOnlyOfficeEditor(artifact)} title="Open in ONLYOFFICE" />
      </Space>
    </div>
  );
}

function openOnlyOfficeEditor(artifact: Artifact) {
  if (!artifact.fileID) {
    return;
  }
  const base = artifact.previewUrl ? new URL(artifact.previewUrl).origin : "https://platform.officecli.io";
  officecli.openExternal(`${base}/onlyoffice/editor?file_id=${encodeURIComponent(artifact.fileID)}`);
}

function createBrowserPreviewAPI(): DesktopAPI {
  return {
    initialize: async () => ({ browserPreview: true }),
    getCapabilities: async () => ({ browserPreview: true }),
    generate: async () => {
      throw new Error("Bridge IPC is only available inside Electron.");
    },
    respond: async () => undefined,
    cancel: async () => undefined,
    openPath: async () => undefined,
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onBridgeEvent: () => () => undefined,
  };
}

function eventText(event: BridgeEvent): string {
  const payload = event.payload || {};
  return String(payload.message || payload.stage || payload.status || payload.question || "");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function tagColor(status: string) {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "question") return "gold";
  if (status === "cancelled") return "default";
  return "blue";
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
