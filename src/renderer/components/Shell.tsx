import { Button, Progress, Space, Spin, Tooltip } from "../ui";
import { useEffect, useRef, useState } from "react";
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
  EyeInvisibleOutlined,
  EyeOutlined,
  FileDoneOutlined,
  FileImageOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FundProjectionScreenOutlined,
  HistoryOutlined,
  LineChartOutlined,
  MessageOutlined,
  NotificationOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  StarOutlined,
  TableOutlined,
  ThunderboltOutlined,
  UserOutlined,
  UnlockOutlined,
  UnorderedListOutlined,
} from "../ui/icons";
import { PanelLeft, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { notion } from "../designTokens";
import type { NavKey } from "../defaults";
import type { WorkspaceConversationSummary, WorkspaceSummary } from "../../shared/types";
import { useT } from "../i18n";
import { RuntimeChip } from "./RuntimeChip";
import { HistoryList } from "./HistoryList";
import { ProjectSidebar, type SidebarAccount } from "./ProjectSidebar";
import { SidebarUpdateRow, type SidebarUpdateRowProps } from "./SidebarUpdateRow";
import type { SidebarSignal } from "../taskSignals";

const HOME_SIDEBAR_COMPACT_KEY = "officedex.homeSidebarCompact";

export interface CreditInfo {
  // "quota" = bounded plan with a known cap (api_key burndown, anonymous device pool).
  //           Renders as remaining/total + percent + progress bar.
  // "balance" = open-ended wallet (hosted credits) with no meaningful cap.
  //             Renders as a single balance number, no bar.
  displayMode: "quota" | "balance";
  used: number;
  total: number;
  planLabel?: string;
}

const DEFAULT_CREDIT: CreditInfo = {
  displayMode: "quota",
  used: 0,
  total: 0,
  planLabel: "Credits",
};

interface ShellProps {
  activeNav: NavKey;
  failed: boolean;
  errorKind?: "connection" | "auth" | "task" | "setup" | "other";
  children: React.ReactNode;
  inspector?: React.ReactNode;
  autoCollapseSidebarKey?: string;
  credit?: CreditInfo;
  hasCustomProvider?: boolean;
  signal?: SidebarSignal;
  account?: SidebarAccount;
  update?: SidebarUpdateRowProps;
  workspaces: WorkspaceSummary[];
  chats: WorkspaceConversationSummary[];
  activeWorkspaceId: string | undefined;
  activeWorkspaceName: string | undefined;
  selectedConversationId: string | undefined;
  onNavChange: (key: NavKey) => void;
  onNewGeneration: (workspaceId?: string) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onSelectAllFiles: () => void;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void | Promise<void>;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
  onSelectTask: (taskId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
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
  failed,
  errorKind,
  children,
  inspector,
  autoCollapseSidebarKey,
  credit,
  hasCustomProvider,
  signal,
  account,
  update,
  workspaces,
  chats,
  activeWorkspaceId,
  activeWorkspaceName,
  selectedConversationId,
  onNavChange,
  onNewGeneration,
  onSelectWorkspace,
  onSelectAllFiles,
  onAddWorkspace,
  onRenameWorkspace,
  onRevealWorkspace,
  onRemoveWorkspace,
  onSelectTask,
  onDeleteConversation,
}: ShellProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [sidebarPreview, setSidebarPreview] = useState(false);
  const [sidebarToggleTooltipOpen, setSidebarToggleTooltipOpen] = useState(false);
  const [projectSidebarCompact, setProjectSidebarCompact] = useState(true);
  const [homeSidebarCompact, setHomeSidebarCompact] = useState(() => {
    try {
      return localStorage.getItem(HOME_SIDEBAR_COMPACT_KEY) === "1";
    } catch {
      return false;
    }
  });
  const changeHomeSidebarCompact = (next: boolean) => {
    setHomeSidebarCompact(next);
    try {
      localStorage.setItem(HOME_SIDEBAR_COMPACT_KEY, next ? "1" : "0");
    } catch {
      // preference persistence is best-effort
    }
  };
  const lastAutoCollapseSidebarKey = useRef<string | undefined>(undefined);
  const t = useT();
  const sidebarToggleLabel = collapsed ? t("shell.sidebar.expand") : t("shell.sidebar.collapse");
  const SidebarToggleIcon = collapsed ? (sidebarPreview ? PanelLeftClose : PanelLeftOpen) : PanelLeft;
  const sidebarContentsCollapsed = collapsed && !sidebarPreview;

  useEffect(() => {
    if (!autoCollapseSidebarKey) {
      lastAutoCollapseSidebarKey.current = undefined;
      return;
    }
    if (lastAutoCollapseSidebarKey.current === autoCollapseSidebarKey) return;
    lastAutoCollapseSidebarKey.current = autoCollapseSidebarKey;
    setCollapsed(true);
    setSidebarPreview(false);
  }, [autoCollapseSidebarKey]);

  const updateRow = update ? <SidebarUpdateRow {...update} /> : null;

  if (activeNav === "home" || activeNav === "spreadsheet") {
    const spreadsheetMode = activeNav === "spreadsheet";
    return (
      <div className={`home-shell ${spreadsheetMode ? "home-shell--spreadsheet" : ""}`}>
        <ProjectSidebar
          workspaces={workspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectAll={onSelectAllFiles}
          onSelectWorkspace={onSelectWorkspace}
          onAddWorkspace={onAddWorkspace}
          onRenameWorkspace={onRenameWorkspace}
          onRevealWorkspace={onRevealWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
          onOpenSettings={() => onNavChange("settings")}
          onOpenAccount={() => onNavChange("login")}
          signal={signal}
          credit={credit}
          hasCustomProvider={hasCustomProvider}
          account={account}
          updateRow={updateRow}
          compact={spreadsheetMode ? projectSidebarCompact : homeSidebarCompact}
          onCompactChange={spreadsheetMode ? setProjectSidebarCompact : changeHomeSidebarCompact}
        />
        <main className={`home-shell__main ${spreadsheetMode ? "home-shell__main--spreadsheet" : ""}`}>
          {!spreadsheetMode ? (
            <header className="home-shell__topbar">
              <Space size={12} className="breadcrumb">
                <span>{t("shell.brand")}</span>
                <span className="crumb-separator">/</span>
                <strong>{activeWorkspaceName || t("projectSidebar.allFiles")}</strong>
              </Space>
              <RuntimeChip onClick={() => onNavChange("settings")} />
            </header>
          ) : null}
          {spreadsheetMode ? children : (
            <div className={`home-shell__content ${inspector ? "with-preview" : ""}`}>
              <section className="home-shell__stage">{children}</section>
              {inspector ? <aside className="preview-panel">{inspector}</aside> : null}
            </div>
          )}
        </main>
      </div>
    );
  }

  return (
    <div
      className={`app-shell fluid-shell ${collapsed ? "sidebar-collapsed" : ""} ${sidebarPreview ? "sidebar-preview" : ""}`}
    >
      <div
        className="sidebar-hover-zone"
        aria-hidden="true"
        onMouseEnter={() => {
          if (collapsed) setSidebarPreview(true);
        }}
      />
      <aside
        className="sidebar"
        onMouseEnter={() => {
          if (collapsed) setSidebarPreview(true);
        }}
        onMouseLeave={() => setSidebarPreview(false)}
      >
        <div className="brand-block">
          <button type="button" className="brand-mark" aria-label={t("shell.nav.home")} onClick={() => onNavChange("home")}>
            <img src="./officedex-logo.png" alt="OfficeDex logo" />
          </button>
          <div className="brand-text">
            <div className="brand">{t("shell.brand")}</div>
            <div className={`bridge-pill ${failed ? "failed" : ""}`}>{t(pillLabelKey(failed, errorKind))}</div>
          </div>
        </div>
        <Tooltip title={sidebarContentsCollapsed ? t("shell.newGeneration") : ""} placement="right">
          <Button type="primary" icon={<EditOutlined />} block onClick={() => onNewGeneration()}>
            {t("shell.newGeneration")}
          </Button>
        </Tooltip>
        <HistoryList
          workspaces={workspaces}
          chats={chats}
          activeWorkspaceId={activeWorkspaceId}
          selectedConversationId={selectedConversationId}
          collapsed={sidebarContentsCollapsed}
          onSelect={onSelectTask}
          onDelete={onDeleteConversation}
          onSelectWorkspace={onSelectWorkspace}
          onNewConversation={onNewGeneration}
          onAddWorkspace={onAddWorkspace}
          onRevealWorkspace={onRevealWorkspace}
          onRemoveWorkspace={onRemoveWorkspace}
        />
        <div className="sidebar-footer">
          {updateRow}
          <CreditMeter info={credit} hasCustomProvider={hasCustomProvider} />
          <div className="sidebar-footer-nav">
            <Tooltip title={sidebarContentsCollapsed ? t("shell.nav.profile") : ""} placement="right">
              <button className={`nav-item profile-link ${activeNav === "login" ? "active" : ""}`} onClick={() => onNavChange("login")}>
                <UserOutlined />
                <span>{t("shell.nav.profile")}</span>
              </button>
            </Tooltip>
            <Tooltip title={sidebarContentsCollapsed ? t("shell.nav.settings") : ""} placement="right">
              <button
                className={`nav-item sidebar-settings ${activeNav === "settings" ? "active" : ""}`}
                onClick={() => onNavChange("settings")}
              >
                <SettingOutlined />
                <span>{t("shell.nav.settings")}</span>
              </button>
            </Tooltip>
          </div>
        </div>
      </aside>
      <main className="main-frame">
        <header className="topbar">
          <div className="topbar-sidebar-slot">
            <Tooltip
              title={sidebarToggleLabel}
              placement="bottom"
              open={sidebarToggleTooltipOpen}
              onOpenChange={setSidebarToggleTooltipOpen}
              destroyOnHidden
            >
              <button
                type="button"
                className={`topbar-sidebar-toggle ${collapsed ? "is-collapsed" : "is-expanded"} ${sidebarPreview ? "is-previewing" : ""}`}
                data-sidebar-icon-state={collapsed ? (sidebarPreview ? "preview" : "hidden") : "expanded"}
                aria-label={sidebarToggleLabel}
                onClick={() => {
                  setSidebarToggleTooltipOpen(false);
                  setCollapsed((c) => !c);
                  setSidebarPreview(false);
                }}
              >
                <SidebarToggleIcon aria-hidden="true" strokeWidth={1.8} />
                {collapsed ? <span className="sidebar-toggle-dot" aria-hidden="true" /> : null}
              </button>
            </Tooltip>
          </div>
          <Space size={12} className="breadcrumb">
            <span>{t("shell.brand")}</span>
            <span className="crumb-separator">/</span>
            <strong>{activeWorkspaceName || t("shell.workspace")}</strong>
          </Space>
          <div className="topbar-right">
            <RuntimeChip onClick={() => onNavChange("settings")} />
          </div>
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

const MASKED_VALUE = "••••";

function CreditMeter({ info, hasCustomProvider }: { info?: CreditInfo; hasCustomProvider?: boolean }) {
  const t = useT();
  const [hidden, setHidden] = useState(true);
  const loading = !info;
  const value = info ?? DEFAULT_CREDIT;
  const planLabel = value.planLabel || t("shell.creditMeter.label");
  const toggleLabel = hidden ? t("shell.creditMeter.show") : t("shell.creditMeter.hide");

  if (hasCustomProvider) {
    const tooltipBody = t("shell.creditMeter.freeTooltip");
    return (
      <div className="credit-meter credit-meter-balance credit-meter-free" role="group" aria-label={t("shell.creditMeter.aria", { tooltip: tooltipBody })}>
        <div className="credit-meter-row">
          <Tooltip title={tooltipBody} placement="top">
            <div className="credit-meter-row-main">
              <ThunderboltOutlined className="credit-meter-icon" aria-hidden />
              <span className="credit-meter-label">{planLabel}</span>
              <span className="credit-meter-balance-value">{t("shell.creditMeter.freeLabel")}</span>
            </div>
          </Tooltip>
        </div>
      </div>
    );
  }

  const toggleButton = (
    <button
      type="button"
      className="credit-meter-toggle"
      aria-label={toggleLabel}
      aria-pressed={!hidden}
      title={toggleLabel}
      onClick={(event) => {
        event.stopPropagation();
        setHidden((prev) => !prev);
      }}
    >
      {hidden ? <EyeInvisibleOutlined /> : <EyeOutlined />}
    </button>
  );

  if (!loading && value.displayMode === "balance") {
    const balance = Math.max(0, Math.floor(value.total));
    const balanceText = hidden
      ? MASKED_VALUE
      : t("shell.creditMeter.valueWithUnit", { value: formatNumber(balance) });
    const tooltipBody = hidden
      ? t("shell.creditMeter.hiddenTooltip")
      : value.planLabel
        ? t("shell.creditMeter.tooltipBalanceWithPlan", { balance: formatNumber(balance), plan: value.planLabel })
        : t("shell.creditMeter.tooltipBalance", { balance: formatNumber(balance) });
    return (
      <div className="credit-meter credit-meter-balance" role="group" aria-label={t("shell.creditMeter.aria", { tooltip: tooltipBody })}>
        <div className="credit-meter-row">
          <Tooltip title={tooltipBody} placement="top">
            <div className="credit-meter-row-main">
              <ThunderboltOutlined className="credit-meter-icon" aria-hidden />
              <span className="credit-meter-label">{planLabel}</span>
              <span className="credit-meter-balance-value">{balanceText}</span>
            </div>
          </Tooltip>
          {toggleButton}
        </div>
      </div>
    );
  }

  const total = Math.max(0, Math.floor(value.total));
  const used = Math.max(0, Math.floor(value.used));
  const clampedUsed = Math.min(used, total);
  const remaining = total - clampedUsed;
  const remainingRatio = total === 0 ? 1 : remaining / total;
  const percent = total === 0 ? 0 : Math.round(remainingRatio * 100);
  const tone = remainingRatio <= 0.1 ? "critical" : remainingRatio <= 0.25 ? "low" : "normal";
  const strokeColor = tone === "critical" ? notion.error : tone === "low" ? notion.warning : notion.primary;
  const tooltipBody = loading
    ? t("shell.creditMeter.loading")
    : hidden
      ? t("shell.creditMeter.hiddenTooltip")
      : value.planLabel
        ? t("shell.creditMeter.tooltipWithPlan", { remaining: formatNumber(remaining), total: formatNumber(total), plan: value.planLabel })
        : t("shell.creditMeter.tooltip", { remaining: formatNumber(remaining), total: formatNumber(total) });

  return (
    <div className={`credit-meter credit-meter-${tone}`} role="group" aria-label={t("shell.creditMeter.aria", { tooltip: tooltipBody })}>
      <div className="credit-meter-row">
        <Tooltip title={tooltipBody} placement="top">
          <div className="credit-meter-row-main">
            {loading ? <Spin size="small" /> : <ThunderboltOutlined className="credit-meter-icon" aria-hidden />}
            <span className="credit-meter-label">{loading ? t("shell.creditMeter.loading") : planLabel}</span>
            {!loading && (
              <>
                <span className="credit-meter-value">
                  {hidden ? MASKED_VALUE : `${formatNumber(remaining)} / ${formatNumber(total)}`}
                </span>
                {!hidden && <span className="credit-meter-percent">{percent}%</span>}
              </>
            )}
          </div>
        </Tooltip>
        {!loading && toggleButton}
      </div>
      {!loading && (
        <Progress
          className="credit-meter-bar"
          percent={hidden ? 100 : percent}
          showInfo={false}
          size="small"
          strokeColor={hidden ? notion.hairline : strokeColor}
          railColor={notion.hairline}
          aria-hidden
        />
      )}
    </div>
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
