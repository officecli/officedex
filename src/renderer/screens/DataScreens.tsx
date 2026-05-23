import { Button, Empty, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import type { DesktopTask } from "../../shared/types";
import { MaterialSymbol } from "../components/Shell";
import { useT } from "../i18n";

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
  const t = useT();
  const rows = tasks.map((task) => taskToRow(task, t));
  const columns: ColumnsType<TaskRow> = [
    {
      title: t("tasks.column.title"),
      dataIndex: "title",
      render: (title, record) => (
        <button className="table-title task-title-button" onClick={() => onSelectTask(record.id)}>
          <strong>{title}</strong>
          <span>{record.id}</span>
        </button>
      ),
    },
    { title: t("tasks.column.documentType"), dataIndex: "type" },
    {
      title: t("tasks.column.status"),
      dataIndex: "status",
      render: (status) => <Tag color={taskStatusColor(status)}>{taskStatusLabel(status, t)}</Tag>,
    },
    {
      title: t("tasks.column.runtime"),
      dataIndex: "runtime",
      render: (runtime) => (
        <Space>
          <MaterialSymbol name="laptop_mac" />
          {runtime}
        </Space>
      ),
    },
    { title: t("tasks.column.updatedAt"), dataIndex: "updatedAt" },
    { title: t("tasks.column.artifacts"), dataIndex: "artifacts" },
    {
      title: t("tasks.column.actions"),
      render: (_, record) => (
        <Button icon={<MoreOutlined />} onClick={() => onSelectTask(record.id)} />
      ),
    },
  ];
  return (
    <div className="page-stack">
      <PageHeader title={t("tasks.page.title")} description={t("tasks.page.subtitle")} action={t("tasks.action.newGeneration")} onAction={onNewGeneration} />
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
          <Empty description={t("tasks.empty")} />
        </div>
      )}
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

function taskToRow(task: DesktopTask, t: (key: string) => string): TaskRow {
  const latestEvent = task.events.at(-1);
  return {
    id: task.id,
    title: task.topic || task.artifact?.fileName || task.id,
    type: task.documentType || task.artifact?.documentType || t("tasks.documentType.empty"),
    status: task.status,
    runtime: t("tasks.runtime.localBridge"),
    updatedAt: latestEvent?.ts || t("tasks.updatedAtUnknown"),
    artifacts: task.artifact ? 1 : 0,
  };
}

function taskStatusLabel(status: DesktopTask["status"], t: (key: string) => string) {
  return t(`tasks.status.${status}`);
}

function taskStatusColor(status: DesktopTask["status"]) {
  if (status === "completed") return "green";
  if (status === "failed") return "red";
  if (status === "cancelled") return "default";
  if (status === "question") return "gold";
  return "purple";
}
