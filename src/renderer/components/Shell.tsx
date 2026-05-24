import { Button, Progress, Space, Spin, Tooltip } from "antd";
import { useState } from "react";
import {
  AppstoreOutlined,
  AudioOutlined,
  BgColorsOutlined,
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
  LeftOutlined,
  LineChartOutlined,
  MessageOutlined,
  NotificationOutlined,
  PlusOutlined,
  RightOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  StarOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UserOutlined,
  UnlockOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { notion } from "../designTokens";
import type { NavKey } from "../defaults";
import { useT } from "../i18n";

export interface CreditInfo {
  used: number;
  total: number;
  planLabel?: string;
}

const DEFAULT_CREDIT: CreditInfo = {
  used: 0,
  total: 0,
  planLabel: "Credits",
};

interface ShellProps {
  activeNav: NavKey;
  bridgeStatus: string;
  failed: boolean;
  errorKind?: "connection" | "auth" | "task" | "setup" | "other";
  children: React.ReactNode;
  inspector?: React.ReactNode;
  credit?: CreditInfo;
  onNavChange: (key: NavKey) => void;
  onNewGeneration: () => void;
}

function pillLabelKey(failed: boolean, errorKind: ShellProps["errorKind"]): string {
  if (!failed) return "shell.brandPill.connected";
  switch (errorKind) {
    case "auth":
      return "shell.brandPill.signInRequired";
    case "task":
      return "shell.brandPill.lastTaskFailed";
    case "connection":
      return "shell.brandPill.bridgeDisconnected";
    case "setup":
      return "shell.brandPill.setupRequired";
    default:
      return "shell.brandPill.connectionFailed";
  }
}

export function Shell({
  activeNav,
  bridgeStatus,
  failed,
  errorKind,
  children,
  inspector,
  credit,
  onNavChange,
  onNewGeneration,
}: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const t = useT();
  const navItems: Array<{ key: NavKey; label: string; icon: React.ReactNode }> = [
    { key: "dialogue", label: t("shell.nav.dialogue"), icon: <MessageOutlined /> },
    { key: "tasks", label: t("shell.nav.tasks"), icon: <HistoryOutlined /> },
  ];

  return (
    <div className={`app-shell fluid-shell ${inspector ? "preview-active sidebar-collapsed" : ""} ${collapsed ? "sidebar-collapsed" : ""}`}>
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-mark"><AppstoreOutlined /></div>
          <div className="brand-text">
            <div className="brand">{t("shell.brand")}</div>
            <div className={`bridge-pill ${failed ? "failed" : ""}`}>{t(pillLabelKey(failed, errorKind))}</div>
          </div>
        </div>
        <Tooltip title={collapsed ? t("shell.newGeneration") : ""} placement="right">
          <Button type="primary" icon={<PlusOutlined />} block onClick={onNewGeneration}>
            {t("shell.newGeneration")}
          </Button>
        </Tooltip>
        <nav className="side-nav">
          {navItems.map((item) => (
            <Tooltip key={item.key} title={collapsed ? item.label : ""} placement="right">
              <button className={`nav-item ${activeNav === item.key ? "active" : ""}`} onClick={() => onNavChange(item.key)}>
                {item.icon}
                <span>{item.label}</span>
              </button>
            </Tooltip>
          ))}
        </nav>
        <Tooltip title={collapsed ? t("shell.nav.profile") : ""} placement="right">
          <button className={`nav-item profile-link ${activeNav === "login" ? "active" : ""}`} onClick={() => onNavChange("login")}>
            <UserOutlined />
            <span>{t("shell.nav.profile")}</span>
          </button>
        </Tooltip>
        <Tooltip title={collapsed ? t("shell.nav.settings") : ""} placement="right">
          <button
            className={`nav-item sidebar-settings ${activeNav === "settings" ? "active" : ""}`}
            onClick={() => onNavChange("settings")}
          >
            <SettingOutlined />
            <span>{t("shell.nav.settings")}</span>
          </button>
        </Tooltip>
        <Tooltip title={collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")} placement="right">
          <button
            type="button"
            className="sidebar-divider-toggle"
            aria-label={collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse")}
            onClick={() => setCollapsed((c) => !c)}
          >
            {collapsed ? <RightOutlined /> : <LeftOutlined />}
          </button>
        </Tooltip>
      </aside>
      <main className="main-frame">
        <header className="topbar">
          <Space size={12} className="breadcrumb">
            <span>{t("shell.brand")}</span>
            <span className="crumb-separator">/</span>
            <strong>{t("shell.workspace")}</strong>
          </Space>
        </header>
        <div className={`content-grid ${inspector ? "with-preview" : ""}`}>
          <section className="stage">{children}</section>
          {inspector ? <aside className="preview-panel">{inspector}</aside> : null}
        </div>
        <CreditMeter info={credit} />
      </main>
    </div>
  );
}

export function MaterialSymbol({ name }: { name: string }) {
  const icon = symbolIcons[name] ?? <AppstoreOutlined />;
  return <span className="material-symbol">{icon}</span>;
}

export function CreditMeter({ info }: { info?: CreditInfo }) {
  const t = useT();
  const loading = !info;
  const value = info ?? DEFAULT_CREDIT;
  const total = Math.max(0, Math.floor(value.total));
  const used = Math.max(0, Math.floor(value.used));
  const clampedUsed = Math.min(used, total);
  const remaining = total - clampedUsed;
  const remainingRatio = total === 0 ? 1 : remaining / total;
  const percent = total === 0 ? 0 : Math.round(remainingRatio * 100);
  const tone = remainingRatio <= 0.1 ? "critical" : remainingRatio <= 0.25 ? "low" : "normal";
  const strokeColor = tone === "critical" ? notion.error : tone === "low" ? notion.warning : notion.primary;
  const planLabel = value.planLabel || t("shell.creditMeter.label");
  const tooltipBody = loading
    ? t("shell.creditMeter.loading")
    : value.planLabel
      ? t("shell.creditMeter.tooltipWithPlan", { remaining: formatNumber(remaining), total: formatNumber(total), plan: value.planLabel })
      : t("shell.creditMeter.tooltip", { remaining: formatNumber(remaining), total: formatNumber(total) });

  return (
    <Tooltip title={tooltipBody} placement="top">
      <div className={`credit-meter credit-meter-${tone}`} role="group" aria-label={t("shell.creditMeter.aria", { tooltip: tooltipBody })}>
        <div className="credit-meter-row">
          {loading ? <Spin size="small" /> : <ThunderboltOutlined className="credit-meter-icon" aria-hidden />}
          <span className="credit-meter-label">{loading ? t("shell.creditMeter.loading") : planLabel}</span>
          {!loading && (
            <>
              <span className="credit-meter-value">
                {formatNumber(remaining)} / {formatNumber(total)}
              </span>
              <span className="credit-meter-percent">{percent}%</span>
            </>
          )}
        </div>
        {!loading && (
          <Progress
            className="credit-meter-bar"
            percent={percent}
            showInfo={false}
            size="small"
            strokeColor={strokeColor}
            railColor={notion.hairline}
            aria-hidden
          />
        )}
      </div>
    </Tooltip>
  );
}

function formatNumber(value: number): string {
  return value.toLocaleString("en-US");
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
