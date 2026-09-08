import { useEffect, useRef, useState } from "react";
import { PanelLeftOpen } from "lucide-react";
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
import { ProjectSidebar, type SidebarAccount, type SidebarDocument } from "./ProjectSidebar";
import { SidebarUpdateRow, type SidebarUpdateRowProps } from "./SidebarUpdateRow";
import type { SidebarSignal } from "../taskSignals";
import { useT } from "../i18n";
import { usePointerDotField } from "../usePointerDotField";

const SIDEBAR_COMPACT_KEY = "officedex.homeSidebarCompact";
/** Matches the rail transition in home.css; the rail outlives the collapse by
 *  this much so it has something to animate out with before it unmounts. */
const RAIL_ANIM_MS = 160;

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

export function Shell({ activeNav, children, inspector, signal, account, update, workspaces, documents, activeDocumentId, activeWorkspaceId, onNavChange, onSelectWorkspace, onOpenDocument, onDeleteDocument, onSelectAllFiles, onAddWorkspace, onRenameWorkspace, onRevealWorkspace, onRemoveWorkspace }: ShellProps) {
  const t = useT();
  const [spreadsheetCompact, setSpreadsheetCompact] = useState(true);
  const [defaultCompact, setDefaultCompact] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COMPACT_KEY) === "1"; } catch { return false; }
  });
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

  // The rail unmounts when collapsed, and an unmounted element cannot animate.
  // `shut` drives the geometry (column width, slide-out) and `closing` keeps the
  // rail mounted long enough to play that geometry before it goes.
  const [shut, setShut] = useState(compact);
  const [closing, setClosing] = useState(false);
  // Hovering the corner control peeks the rail open without committing to it.
  const [peeking, setPeeking] = useState(false);
  const closeTimer = useRef<number | undefined>(undefined);
  const peekTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(peekTimer.current);
  }, []);

  const openRail = () => {
    setShut(true);
    // Mount shut, then open on the next painted frame so the rail has two
    // distinct positions to transition between.
    requestAnimationFrame(() => requestAnimationFrame(() => setShut(false)));
  };

  const collapseRail = () => {
    setShut(true);
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setCompact(true);
      setClosing(false);
    }, RAIL_ANIM_MS);
  };

  // Pins the peeked rail: it is already on screen, so it only has to stop
  // floating over the content and take a grid track instead.
  const expandRail = () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(peekTimer.current);
    setClosing(false);
    setCompact(false);
    if (peeking) {
      setPeeking(false);
      return;
    }
    openRail();
  };

  const openPeek = () => {
    if (!compact) return;
    window.clearTimeout(peekTimer.current);
    if (peeking) return;
    setPeeking(true);
    openRail();
  };

  // A grace period so the pointer can cross the gap from the control into the
  // rail without the rail sliding away underneath it.
  const closePeek = () => {
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => {
      setShut(true);
      peekTimer.current = window.setTimeout(() => setPeeking(false), RAIL_ANIM_MS);
    }, 120);
  };

  const railDocked = !compact || closing;
  const railPeeking = compact && !closing && peeking;
  const railMounted = railDocked || railPeeking;
  const updateRow = update ? <SidebarUpdateRow {...update} /> : null;

  return (
    <div className={`home-shell home-shell--${activeNav} ${spreadsheetMode ? "home-shell--spreadsheet" : ""} ${railDocked ? "" : "home-shell--railless"} ${railPeeking ? "home-shell--rail-peek" : ""} ${shut ? "home-shell--rail-shut" : ""}`}>
      {railMounted ? (
      <ProjectSidebar
        onPointerEnter={railPeeking ? openPeek : undefined}
        onPointerLeave={railPeeking ? closePeek : undefined}
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
        onCollapse={collapseRail}
      />
      ) : null}
      <main className="home-shell__main">
        {railDocked ? null : (
          <>
            {/* Nothing else reaches this corner once the rail is hidden, so it
                is free to drag the window. */}
            <div className="home-shell__drag" aria-hidden="true" />
            <button
              type="button"
              className="home-shell__expand"
              aria-label={t("shell.sidebar.expand")}
              title={t("shell.sidebar.expand")}
              onClick={expandRail}
              onPointerEnter={openPeek}
              onPointerLeave={closePeek}
            >
              <PanelLeftOpen aria-hidden="true" />
            </button>
          </>
        )}
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
