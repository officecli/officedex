import { Button, Empty, Input, Space, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  DownloadOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  PlusOutlined,
  SearchOutlined,
  StopOutlined,
  SyncOutlined,
} from "@ant-design/icons";
import type { Artifact, DesktopTask } from "../../shared/types";
import { officecli } from "../bridge";
import { templateCards } from "../mockData";
import { FileGlyph, MaterialSymbol } from "../components/Shell";

interface TaskRow {
  id: string;
  title: string;
  type: string;
  status: DesktopTask["status"];
  runtime: string;
  updatedAt: string;
  artifacts: number;
}

export function TasksScreen({ tasks, onSelectTask, onNewGeneration }: { tasks: DesktopTask[]; onSelectTask: (taskID: string) => void; onNewGeneration: () => void }) {
  const rows = tasks.map(taskToRow);
  const columns: ColumnsType<TaskRow> = [
    {
      title: "Title",
      dataIndex: "title",
      render: (title, record) => (
        <button className="table-title task-title-button" onClick={() => onSelectTask(record.id)}>
          <strong>{title}</strong>
          <span>{record.id}</span>
        </button>
      ),
    },
    { title: "Document Type", dataIndex: "type" },
    {
      title: "Status",
      dataIndex: "status",
      render: (status) => <Tag color={taskStatusColor(status)}>{taskStatusLabel(status)}</Tag>,
    },
    {
      title: "Runtime",
      dataIndex: "runtime",
      render: (runtime) => (
        <Space>
          <MaterialSymbol name="laptop_mac" />
          {runtime}
        </Space>
      ),
    },
    { title: "Updated At", dataIndex: "updatedAt" },
    { title: "Artifacts", dataIndex: "artifacts" },
    {
      title: "Actions",
      render: (_, record) => (
        <Space>
          {record.status === "running" || record.status === "starting" ? <Button icon={<StopOutlined />} /> : record.status === "failed" ? <Button icon={<SyncOutlined />} /> : <Button icon={<DownloadOutlined />} />}
          <Button icon={<MoreOutlined />} onClick={() => onSelectTask(record.id)} />
        </Space>
      ),
    },
  ];
  return (
    <div className="page-stack">
      <PageHeader title="Recent Tasks" description="View, resume, or retry all OfficeDex generation tasks." action="New Generation" onAction={onNewGeneration} />
      <div className="toolbar-row">
        <Tabs
          items={["All", "Running", "Completed", "Failed"].map((label) => ({ key: label, label }))}
          className="compact-tabs"
        />
        <Input prefix={<SearchOutlined />} placeholder="Search tasks..." className="toolbar-search" />
      </div>
      {rows.length > 0 ? (
        <Table
          rowKey="id"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 8, showSizeChanger: false }}
          className="flat-table"
          onRow={(record) => ({
            onDoubleClick: () => onSelectTask(record.id),
          })}
        />
      ) : (
        <div className="empty-card">
          <Empty description="No Bridge tasks yet" />
        </div>
      )}
    </div>
  );
}

export function ArtifactsScreen({ artifacts, fluid, onNewGeneration, onPreview }: { artifacts: Artifact[]; fluid: boolean; onNewGeneration: () => void; onPreview: (artifact: Artifact) => void }) {
  if (fluid) {
    return <FluidArtifacts artifacts={artifacts} onNewGeneration={onNewGeneration} onPreview={onPreview} />;
  }
  return (
    <div className="page-stack">
      <PageHeader title="Artifacts" description="Manage, view, and export all your AI-generated documents and presentations." action="New Generation" onAction={onNewGeneration} />
      {artifacts.length > 0 ? (
        <>
          <div className="toolbar-row">
            <Input prefix={<SearchOutlined />} placeholder="Search files, types, or tags..." className="toolbar-search" />
            <Tabs items={["All", "PPTX", "DOCX", "PDF"].map((label) => ({ key: label, label }))} className="compact-tabs" />
            <Button icon={<MaterialSymbol name="grid_view" />} />
            <Button icon={<MaterialSymbol name="view_list" />} />
          </div>
          <div className="artifact-grid">
            {artifacts.map((artifact) => (
              <ArtifactCard key={artifact.filePath} artifact={artifact} onPreview={onPreview} />
            ))}
          </div>
        </>
      ) : (
        <ArtifactEmptyState onNewGeneration={onNewGeneration} />
      )}
    </div>
  );
}

export function TemplatesScreen({ onNewGeneration }: { onNewGeneration: () => void }) {
  return (
    <div className="page-stack">
      <PageHeader title="Template Center" description="Choose preset structures to quickly generate professional documents with AI." action="New Generation" onAction={onNewGeneration} />
      <Tabs items={["All", "Reports", "Plans", "Dev & PM"].map((label) => ({ key: label, label }))} />
      <div className="template-grid">
        {templateCards.map((template) => (
          <div key={template.title} className="template-card">
            <MaterialSymbol name={template.icon} />
            <Tag>{template.category}</Tag>
            <h3>{template.title}</h3>
            <p>{template.desc}</p>
            <Button block>Use Template</Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function FluidArtifacts({ artifacts, onNewGeneration, onPreview }: { artifacts: Artifact[]; onNewGeneration: () => void; onPreview: (artifact: Artifact) => void }) {
  const selected = artifacts.at(0);
  if (!selected) {
    return (
      <div className="fluid-artifacts">
        <div className="artifact-list-pane">
          <PageHeader title="Content Library" description="Manage and browse all AI-generated documents, code, and media files." action="New Generation" onAction={onNewGeneration} />
          <ArtifactEmptyState onNewGeneration={onNewGeneration} />
        </div>
      </div>
    );
  }
  return (
    <div className="fluid-artifacts">
      <div className="artifact-list-pane">
        <PageHeader title="Content Library" description="Manage and browse all AI-generated documents, code, and media files." action="New Generation" onAction={onNewGeneration} />
        <div className="toolbar-row">
          <Tabs items={["All Files", "Docs", "Images", "Code", "Data"].map((label) => ({ key: label, label }))} className="compact-tabs" />
          <Input prefix={<SearchOutlined />} placeholder="Search artifacts..." className="toolbar-search" />
        </div>
        <div className="file-list">
          {artifacts.map((artifact, index) => (
            <div key={artifact.filePath} className={`file-list-row ${index === 0 ? "active" : ""}`}>
              <FileGlyph type={artifact.documentType} />
              <div>
                <strong>{artifact.fileName}</strong>
                <span>{artifact.documentType.toUpperCase()}</span>
              </div>
              <span>{artifactTime(artifact)}</span>
              <Button icon={<DownloadOutlined />} />
            </div>
          ))}
        </div>
      </div>
      <aside className="file-detail-pane">
        <Button className="close-button">close</Button>
        <FileGlyph type={selected?.documentType} />
        <h3>{selected?.fileName}</h3>
        <p>{selected?.documentType.toUpperCase()}</p>
        <Space>
          <Button type="primary" onClick={() => selected && officecli.openPath(selected.filePath)}>
            Open
          </Button>
          {supportsOfflinePreview(selected) ? <Button onClick={() => onPreview(selected)}>Preview</Button> : null}
          <Button icon={<DownloadOutlined />}>Download</Button>
        </Space>
        <Metadata label="File Name" value={selected.fileName} />
        <Metadata label="File Type" value={selected.documentType.toUpperCase()} />
        <Metadata label="Synced At" value={artifactTime(selected)} />
      </aside>
    </div>
  );
}

function ArtifactCard({ artifact, onPreview }: { artifact: Artifact; onPreview: (artifact: Artifact) => void }) {
  return (
    <div className="artifact-card">
      <div className="artifact-card-top">
        <FileGlyph type={artifact.documentType} />
        <Button icon={<MoreOutlined />} />
      </div>
      <h3>{artifact.fileName}</h3>
      <div className="artifact-meta">
        <Tag>{artifact.documentType.toUpperCase()}</Tag>
        <span>{artifactTime(artifact)}</span>
      </div>
      <Space>
        {supportsOfflinePreview(artifact) ? <Button onClick={() => onPreview(artifact)}>Preview</Button> : null}
        <Button icon={<DownloadOutlined />}>Download</Button>
        <Button icon={<FolderOpenOutlined />} onClick={() => officecli.showItemInFolder(artifact.filePath)} />
      </Space>
    </div>
  );
}

function ArtifactEmptyState({ onNewGeneration }: { onNewGeneration: () => void }) {
  return (
    <div className="empty-card compact">
      <MaterialSymbol name="inventory_2" />
      <strong>No files generated yet</strong>
      <Button type="primary" icon={<PlusOutlined />} onClick={onNewGeneration}>
        Generate Now
      </Button>
    </div>
  );
}

function PageHeader({ title, description, action, onAction }: { title: string; description: string; action: string; onAction: () => void }) {
  return (
    <div className="page-header">
      <div>
        <Typography.Title level={2}>{title}</Typography.Title>
        <p>{description}</p>
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={onAction}>
        {action}
      </Button>
    </div>
  );
}

function Metadata({ label, value }: { label: string; value: string }) {
  return (
    <div className="metadata-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function artifactTime(artifact: Artifact) {
  return artifact.syncedAt || "Sync time unknown";
}

function supportsOfflinePreview(artifact: Artifact) {
  const type = artifact.documentType.toLowerCase();
  const extension = artifact.fileName.split(".").pop()?.toLowerCase() || "";
  const supported = ["docx", "xlsx", "pptx", "pdf", "html", "htm"];
  return supported.includes(type) || supported.includes(extension);
}

function taskToRow(task: DesktopTask): TaskRow {
  const latestEvent = task.events.at(-1);
  return {
    id: task.id,
    title: task.topic || task.artifact?.fileName || task.id,
    type: task.documentType || task.artifact?.documentType || "-",
    status: task.status,
    runtime: "Local Bridge",
    updatedAt: latestEvent?.ts || "Update time unknown",
    artifacts: task.artifact ? 1 : 0,
  };
}

function taskStatusLabel(status: DesktopTask["status"]) {
  const labels: Record<DesktopTask["status"], string> = {
    starting: "Starting",
    running: "Running",
    question: "Awaiting Confirmation",
    completed: "Completed",
    failed: "Failed",
    cancelled: "Cancelled",
  };
  return labels[status];
}

function taskStatusColor(status: DesktopTask["status"]) {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "cancelled") return "default";
  if (status === "question") return "gold";
  return "processing";
}
