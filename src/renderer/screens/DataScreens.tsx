import { Button, Empty, Space, Table, Tag, Tooltip, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { MoreOutlined, PlusOutlined } from "@ant-design/icons";
import type { DesktopTask } from "../../shared/types";
import { MaterialSymbol } from "../components/Shell";
import { useT } from "../i18n";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

type CreditCellState = "empty" | "legacy" | "zero" | "value";

export interface CreditCellModel {
  state: CreditCellState;
  charged: number;
  mode: string;
}

interface TaskRow {
  id: string;
  title: string;
  type: string;
  status: DesktopTask["status"];
  runtime: string;
  updatedAt: string;
  artifacts: number;
  credit: CreditCellModel;
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
      title: t("tasks.column.credit"),
      dataIndex: "credit",
      render: (credit: CreditCellModel) => <CreditCell credit={credit} t={t} />,
    },
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
    credit: creditModel(task),
  };
}

export function creditModel(task: DesktopTask): CreditCellModel {
  if (task.status !== "completed" && task.status !== "failed") {
    return { state: "empty", charged: 0, mode: "" };
  }
  const charged = task.creditCharged;
  const mode = task.creditMode || "";
  if (typeof charged !== "number") {
    return { state: "legacy", charged: 0, mode };
  }
  if (charged === 0) {
    return { state: "zero", charged: 0, mode };
  }
  return { state: "value", charged, mode };
}

function CreditCell({ credit, t }: { credit: CreditCellModel; t: Translator }) {
  if (credit.state === "empty") return null;
  if (credit.state === "legacy") {
    return (
      <Tooltip title={t("tasks.credit.legacy")}>
        <span className="task-credit-cell task-credit-legacy">—</span>
      </Tooltip>
    );
  }
  if (credit.state === "zero") {
    return (
      <Tooltip title={t("tasks.credit.zero")}>
        <Space size={4}>
          <span className="task-credit-cell">0</span>
          {credit.mode ? <CreditModeBadge mode={credit.mode} t={t} /> : null}
        </Space>
      </Tooltip>
    );
  }
  return (
    <Space size={4}>
      <span className="task-credit-cell">
        {t("tasks.credit.unit", { count: credit.charged })}
      </span>
      {credit.mode ? <CreditModeBadge mode={credit.mode} t={t} /> : null}
    </Space>
  );
}

function CreditModeBadge({ mode, t }: { mode: string; t: Translator }) {
  const key = `tasks.credit.mode.${mode}`;
  const label = t(key);
  const display = label === key ? mode : label;
  return (
    <Tag className="task-credit-mode" color="default">
      {display}
    </Tag>
  );
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
