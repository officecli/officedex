import { Space } from "../ui";
import { useState } from "react";
import {
  AppstoreOutlined, AudioOutlined, BgColorsOutlined, ClockCircleOutlined,
  CloseOutlined, CloudOutlined, CodeOutlined, ControlOutlined, DesktopOutlined,
  EditOutlined, FileDoneOutlined, FileImageOutlined, FileTextOutlined,
  FolderOpenOutlined, FundProjectionScreenOutlined, HistoryOutlined,
  LineChartOutlined, NotificationOutlined, PlusOutlined,
  RobotOutlined, SafetyCertificateOutlined, StarOutlined, TableOutlined,
  UnlockOutlined, UnorderedListOutlined, UserOutlined,
} from "../ui/icons";
import type { NavKey } from "../defaults";
import type { WorkspaceSummary } from "../../shared/types";
import { useT } from "../i18n";
import { RuntimeChip } from "./RuntimeChip";
import { ProjectSidebar, type SidebarAccount, type SidebarDocument } from "./ProjectSidebar";
import { SidebarUpdateRow, type SidebarUpdateRowProps } from "./SidebarUpdateRow";
import type { SidebarSignal } from "../taskSignals";
import { usePointerDotField } from "../usePointerDotField";

const SIDEBAR_COMPACT_KEY = "officedex.homeSidebarCompact";

export interface CreditInfo {
  displayMode: "quota" | "balance";
  used: number;
  total: number;
  planLabel?: string;
}

interface ShellProps {
  activeNav: NavKey;
  children: React.ReactNode;
  inspector?: React.ReactNode;
  signal?: SidebarSignal;
  account?: SidebarAccount;
  update?: SidebarUpdateRowProps;
  workspaces: WorkspaceSummary[];
  documents?: SidebarDocument[];
  activeDocumentId?: string;
  activeWorkspaceId: string | undefined;
  activeWorkspaceName: string | undefined;
  onNavChange: (key: NavKey) => void;
  onSelectWorkspace: (workspaceId: string) => void;
  onOpenDocument?: (document: SidebarDocument) => void;
  onDeleteDocument?: (document: SidebarDocument) => void | Promise<void>;
  onSelectAllFiles: () => void;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void | Promise<void>;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
}

export function Shell({ activeNav, children, inspector, signal, account, update, workspaces, documents, activeDocumentId, activeWorkspaceId, activeWorkspaceName, onNavChange, onSelectWorkspace, onOpenDocument, onDeleteDocument, onSelectAllFiles, onAddWorkspace, onRenameWorkspace, onRevealWorkspace, onRemoveWorkspace }: ShellProps) {
  const [spreadsheetCompact, setSpreadsheetCompact] = useState(true);
  const [defaultCompact, setDefaultCompact] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COMPACT_KEY) === "1"; } catch { return false; }
  });
  const t = useT();
  const spreadsheetMode = activeNav === "spreadsheet";
  const texturedStage = activeNav === "home" || activeNav === "settings";
  const pointerDotField = usePointerDotField<HTMLElement>(texturedStage);
  const compact = spreadsheetMode ? spreadsheetCompact : defaultCompact;
  const setCompact = (next: boolean) => {
    if (spreadsheetMode) {
      setSpreadsheetCompact(next);
      return;
    }
    setDefaultCompact(next);
    try { localStorage.setItem(SIDEBAR_COMPACT_KEY, next ? "1" : "0"); } catch { /* best effort */ }
  };
  const updateRow = update ? <SidebarUpdateRow {...update} /> : null;

  return (
    <div className={`home-shell home-shell--${activeNav} ${spreadsheetMode ? "home-shell--spreadsheet" : ""}`}>
      <ProjectSidebar
        workspaces={workspaces}
        documents={documents}
        activeDocumentId={activeDocumentId}
        activeWorkspaceId={activeWorkspaceId}
        onSelectAll={() => {
          onNavChange("home");
          onSelectAllFiles();
        }}
        onSelectWorkspace={(workspaceId) => {
          onSelectWorkspace(workspaceId);
          if (!spreadsheetMode) onNavChange("home");
        }}
        onOpenDocument={onOpenDocument}
        onDeleteDocument={onDeleteDocument}
        onAddWorkspace={onAddWorkspace}
        onRenameWorkspace={onRenameWorkspace}
        onRevealWorkspace={onRevealWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
        onOpenSettings={() => onNavChange("settings")}
        onOpenAccount={() => onNavChange("login")}
        signal={signal}
        account={account}
        updateRow={updateRow}
        compact={compact}
        onCompactChange={setCompact}
      />
      <main className={`home-shell__main ${spreadsheetMode ? "home-shell__main--spreadsheet" : ""}`}>
        {!spreadsheetMode ? (
          <header className="home-shell__topbar">
            <Space size={12} className="breadcrumb">
              <span>{t("shell.brand")}</span><span className="crumb-separator">/</span>
              <strong>{activeWorkspaceName || t("shell.scope.allContent")}</strong>
            </Space>
            <RuntimeChip onClick={() => onNavChange("settings")} />
          </header>
        ) : null}
        {spreadsheetMode ? children : (
          <div className={`home-shell__content ${inspector ? "with-preview" : ""}`}>
            <section
              ref={pointerDotField.hostRef}
              className={`home-shell__stage ${texturedStage ? "home-shell__stage--textured" : ""}`}
              onPointerEnter={pointerDotField.movePointer}
              onPointerMove={pointerDotField.movePointer}
              onPointerLeave={pointerDotField.hidePointer}
            >
              {texturedStage ? <canvas className="home-shell__pointer-field" ref={pointerDotField.canvasRef} aria-hidden="true" /> : null}
              {children}
            </section>
            {inspector ? <aside className="preview-panel">{inspector}</aside> : null}
          </div>
        )}
      </main>
    </div>
  );
}

export function MaterialSymbol({ name }: { name: string }) {
  return <span className="material-symbol">{symbolIcons[name] ?? <AppstoreOutlined />}</span>;
}

export function StatusDot({ tone = "blue" }: { tone?: "blue" | "green" | "orange" | "red" | "gray" }) {
  return <span className={`status-dot ${tone}`} />;
}

export function FileGlyph({ type }: { type?: string }) {
  const normalized = (type || "").toLowerCase();
  if (normalized.includes("ppt")) return <FileDoneOutlined />;
  if (normalized.includes("xls") || normalized.includes("csv")) return <AppstoreOutlined />;
  if (normalized.includes("img") || normalized.includes("png")) return <FileImageOutlined />;
  return <FileTextOutlined />;
}

const symbolIcons: Record<string, React.ReactNode> = {
  add: <PlusOutlined />, analytics: <LineChartOutlined />, article: <FileTextOutlined />,
  auto_awesome: <StarOutlined />, auto_awesome_mosaic: <StarOutlined />, campaign: <NotificationOutlined />,
  check_circle: <FileDoneOutlined />,
  close: <CloseOutlined />, cloud_off: <CloudOutlined />, code: <CodeOutlined />,
  description: <FileTextOutlined />, drive_presentation: <FundProjectionScreenOutlined />,
  edit_document: <EditOutlined />, folder_open: <FolderOpenOutlined />, folder_special: <FolderOpenOutlined />,
  grid_view: <AppstoreOutlined />, history_edu: <HistoryOutlined />, image: <FileImageOutlined />,
  inventory_2: <AppstoreOutlined />, laptop_mac: <DesktopOutlined />, lock_open: <UnlockOutlined />,
  palette: <BgColorsOutlined />, person: <UserOutlined />, present_to_all: <FundProjectionScreenOutlined />,
  query_stats: <LineChartOutlined />, record_voice_over: <AudioOutlined />, schedule: <ClockCircleOutlined />,
  shield_lock: <SafetyCertificateOutlined />, slideshow: <FundProjectionScreenOutlined />,
  smart_toy: <RobotOutlined />, summarize: <FileTextOutlined />, table: <TableOutlined />,
  table_chart: <TableOutlined />, temp_preferences_custom: <ControlOutlined />, terminal: <CodeOutlined />,
  tune: <ControlOutlined />, view_list: <UnorderedListOutlined />, widgets: <AppstoreOutlined />,
  workspaces: <AppstoreOutlined />,
};
