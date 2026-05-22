import { Badge, Button, Dropdown, Input, Space, Tooltip } from "antd";
import type { MenuProps } from "antd";
import { useState } from "react";
import {
  AppstoreOutlined,
  AudioOutlined,
  BgColorsOutlined,
  BellOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CloudOutlined,
  CodeOutlined,
  ControlOutlined,
  DesktopOutlined,
  EditOutlined,
  FileDoneOutlined,
  FileImageOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FundProjectionScreenOutlined,
  HistoryOutlined,
  LoginOutlined,
  LineChartOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MessageOutlined,
  NotificationOutlined,
  PlusOutlined,
  QuestionCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SettingOutlined,
  StarOutlined,
  TableOutlined,
  UserOutlined,
  UnlockOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import type { NavKey } from "../mockData";

interface ShellProps {
  activeNav: NavKey;
  bridgeStatus: string;
  failed: boolean;
  errorKind?: "connection" | "auth" | "task" | "setup" | "other";
  children: React.ReactNode;
  inspector?: React.ReactNode;
  onNavChange: (key: NavKey) => void;
  onNewGeneration: () => void;
}

const navItems: Array<{ key: NavKey; label: string; fluidLabel: string; icon: React.ReactNode }> = [
  { key: "dialogue", label: "Dialogue", fluidLabel: "Dialogue", icon: <MessageOutlined /> },
  { key: "tasks", label: "Tasks", fluidLabel: "Tasks", icon: <HistoryOutlined /> },
  { key: "artifacts", label: "Artifacts", fluidLabel: "Artifacts", icon: <FolderOpenOutlined /> },
  { key: "templates", label: "Templates", fluidLabel: "Templates", icon: <FileTextOutlined /> },
  { key: "settings", label: "Settings", fluidLabel: "Settings", icon: <SettingOutlined /> },
];

function pillLabel(failed: boolean, errorKind: ShellProps["errorKind"], fluid: boolean): string {
  if (!failed) return fluid ? "Connected" : "AI Bridge Connected";
  switch (errorKind) {
    case "auth":
      return "Sign-in Required";
    case "task":
      return "Last Task Failed";
    case "connection":
      return "Bridge Disconnected";
    case "setup":
      return "Setup Required";
    default:
      return "Connection Failed";
  }
}

export function Shell({
  activeNav,
  bridgeStatus,
  failed,
  errorKind,
  children,
  inspector,
  onNavChange,
  onNewGeneration,
}: ShellProps) {
  const fluid = true;
  const [collapsed, setCollapsed] = useState(false);
  const menuItems: MenuProps["items"] = [
    { key: "login", label: "Profile", icon: <LoginOutlined /> },
    { key: "settings", label: "Settings", icon: <SettingOutlined /> },
  ];

  return (
    <div className={`app-shell ${fluid ? "fluid-shell" : "classic-shell"} ${inspector ? "preview-active sidebar-collapsed" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark">{fluid ? <AppstoreOutlined /> : "O"}</div>
          <div className="brand-text">
            <div className="brand">OfficeDex</div>
            <div className={`bridge-pill ${failed ? "failed" : ""}`}>{pillLabel(failed, errorKind, fluid)}</div>
          </div>
        </div>
        <Button type="primary" icon={<PlusOutlined />} block onClick={onNewGeneration}>
          {fluid ? "New Generation" : "New Task"}
        </Button>
        <nav className="side-nav">
          {navItems.map((item) => (
            <button key={item.key} className={`nav-item ${activeNav === item.key ? "active" : ""}`} onClick={() => onNavChange(item.key)}>
              {item.icon}
              <span>{fluid ? item.fluidLabel : item.label}</span>
            </button>
          ))}
        </nav>
        <button className={`nav-item profile-link ${activeNav === "login" ? "active" : ""}`} onClick={() => onNavChange("login")}>
          <UserOutlined />
          <span>{fluid ? "Profile" : "Help Center"}</span>
        </button>
        <button className="nav-item sidebar-toggle" onClick={() => setCollapsed((c) => !c)}>
          {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
          <span>{fluid ? "Collapse" : "Collapse"}</span>
        </button>
      </aside>
      <main className="main-frame">
        <header className="topbar">
          <Space size={12} className="breadcrumb">
            <span>OfficeDex</span>
            <span className="crumb-separator">/</span>
            <strong>{fluid ? "OfficeDex Workspace" : "Default Workspace"}</strong>
          </Space>
          <Input className="global-search" prefix={<SearchOutlined />} placeholder={fluid ? "Search workspace..." : "Search tasks, artifacts, templates..."} allowClear />
          <Tooltip title={bridgeStatus}>
            <Badge status={failed ? "error" : "success"} />
          </Tooltip>
          <Button icon={<BellOutlined />} />
          <Button icon={<QuestionCircleOutlined />} />
          <Dropdown
            menu={{
              items: menuItems,
              onClick: ({ key }) => onNavChange(key as NavKey),
            }}
          >
            <Button icon={<UserOutlined />} />
          </Dropdown>
          <Button type="primary" icon={<PlusOutlined />} onClick={onNewGeneration}>
            {fluid ? "New Generation" : "New Generation"}
          </Button>
        </header>
        <div className={`content-grid ${inspector ? "with-preview" : ""}`}>
          <section className="stage">{children}</section>
          {inspector ? <aside className="preview-panel">{inspector}</aside> : null}
        </div>
      </main>
    </div>
  );
}

export function MaterialSymbol({ name }: { name: string }) {
  const icon = symbolIcons[name] ?? <AppstoreOutlined />;
  return <span className="material-symbol">{icon}</span>;
}

export function StatusDot({ tone = "blue" }: { tone?: "blue" | "green" | "orange" | "red" | "gray" }) {
  return <span className={`status-dot ${tone}`} />;
}

export function FileGlyph({ type }: { type?: string }) {
  const normalized = (type || "").toLowerCase();
  if (normalized.includes("ppt")) return <FileDoneOutlined />;
  if (normalized.includes("xls") || normalized.includes("csv")) return <AppstoreOutlined />;
  if (normalized.includes("img") || normalized.includes("png")) return <FileTextOutlined />;
  return <FileTextOutlined />;
}

const symbolIcons: Record<string, React.ReactNode> = {
  add: <PlusOutlined />,
  analytics: <LineChartOutlined />,
  article: <FileTextOutlined />,
  auto_awesome: <StarOutlined />,
  auto_awesome_mosaic: <StarOutlined />,
  campaign: <NotificationOutlined />,
  chat: <MessageOutlined />,
  chat_bubble: <MessageOutlined />,
  check_circle: <FileDoneOutlined />,
  close: <CloseOutlined />,
  cloud_off: <CloudOutlined />,
  code: <CodeOutlined />,
  description: <FileTextOutlined />,
  drive_presentation: <FundProjectionScreenOutlined />,
  edit_document: <EditOutlined />,
  folder_open: <FolderOpenOutlined />,
  folder_special: <FolderOpenOutlined />,
  grid_view: <AppstoreOutlined />,
  history_edu: <HistoryOutlined />,
  image: <FileImageOutlined />,
  inventory_2: <AppstoreOutlined />,
  laptop_mac: <DesktopOutlined />,
  lock_open: <UnlockOutlined />,
  palette: <BgColorsOutlined />,
  person: <UserOutlined />,
  present_to_all: <FundProjectionScreenOutlined />,
  query_stats: <LineChartOutlined />,
  record_voice_over: <AudioOutlined />,
  schedule: <ClockCircleOutlined />,
  shield_lock: <SafetyCertificateOutlined />,
  slideshow: <FundProjectionScreenOutlined />,
  smart_toy: <RobotOutlined />,
  summarize: <FileTextOutlined />,
  table: <TableOutlined />,
  table_chart: <TableOutlined />,
  temp_preferences_custom: <ControlOutlined />,
  terminal: <CodeOutlined />,
  tune: <ControlOutlined />,
  view_list: <UnorderedListOutlined />,
  widgets: <AppstoreOutlined />,
  workspaces: <AppstoreOutlined />,
};
