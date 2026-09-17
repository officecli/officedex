import { useEffect, useRef, useState } from "react";
import { PanelLeft } from "lucide-react";
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
  editingDocument?: boolean;
  /** Changes only after a file has been successfully opened. */
  documentOpenRevision?: number;
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
  onDeleteDocuments?: (documents: SidebarDocument[]) => void | Promise<void>;
  onSelectAllFiles: () => void;
  onAddWorkspace: () => void;
  onRenameWorkspace: (workspaceId: string, name: string) => void | Promise<void>;
  onRevealWorkspace: (workspacePath: string) => void;
  onRemoveWorkspace: (workspaceId: string) => void;
}

export function Shell({ activeNav, children, inspector, editingDocument = false, documentOpenRevision = 0, signal, account, update, workspaces, documents, activeDocumentId, activeWorkspaceId, onNavChange, onSelectWorkspace, onOpenDocument, onDeleteDocument, onDeleteDocuments, onSelectAllFiles, onAddWorkspace, onRenameWorkspace, onRevealWorkspace, onRemoveWorkspace }: ShellProps) {
  const t = useT();
  const [spreadsheetCompact, setSpreadsheetCompact] = useState(true);
  const [defaultCompact, setDefaultCompact] = useState(() => {
    try { return localStorage.getItem(SIDEBAR_COMPACT_KEY) === "1"; } catch { return false; }
  });
  const spreadsheetMode = activeNav === "spreadsheet";
  const editorMode = spreadsheetMode || editingDocument;
  const texturedStage = activeNav === "home" || activeNav === "settings";
  const pointerDotField = usePointerDotField<HTMLElement>(texturedStage);
  const previousEditorMode = useRef(editorMode);
  const enteringEditor = editorMode && !previousEditorMode.current;
  // Carry the homepage navigation state into the editor without a collapsed frame.
  const compact = editorMode ? (enteringEditor ? defaultCompact : spreadsheetCompact) : defaultCompact;
  const setCompact = (next: boolean) => {
    if (editorMode) {
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
  // The slide is a layout animation: for as long as it runs, the main column —
  // and every workbench inside it — is mid-resize. `shut` cannot describe that
  // window, because it flips the moment the geometry is handed to CSS and it is
  // already false while an expand is still travelling. The slide therefore gets
  // its own flag, so the corner reserve can be held for its whole duration.
  const [railMoving, setRailMoving] = useState(false);
  const movingTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(peekTimer.current);
    window.clearTimeout(movingTimer.current);
  }, []);

  // Keep navigation visible while opening; the success revision below closes
  // it. Returning home restores the file list.
  useEffect(() => {
    const returningHome = previousEditorMode.current && !editorMode && activeNav === "home";
    if (editorMode && !previousEditorMode.current) setSpreadsheetCompact(defaultCompact);
    previousEditorMode.current = editorMode;
    if (returningHome) {
      setDefaultCompact(false);
      try { localStorage.setItem(SIDEBAR_COMPACT_KEY, "0"); } catch { /* best effort */ }
    }
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(peekTimer.current);
    setClosing(false);
    setPeeking(false);
    setShut(returningHome ? false : compact);
  }, [editorMode]);

  const markRailMoving = () => {
    window.clearTimeout(movingTimer.current);
    setRailMoving(true);
    movingTimer.current = window.setTimeout(() => setRailMoving(false), RAIL_ANIM_MS);
  };

  const openRail = () => {
    markRailMoving();
    setShut(true);
    // Mount shut, then open on the next painted frame so the rail has two
    // distinct positions to transition between.
    requestAnimationFrame(() => requestAnimationFrame(() => setShut(false)));
  };

  const collapseRail = () => {
    window.clearTimeout(closeTimer.current);
    window.clearTimeout(peekTimer.current);
    markRailMoving();
    setShut(true);
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      setCompact(true);
      setPeeking(false);
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

  const lastOpenedRevision = useRef(documentOpenRevision);
  useEffect(() => {
    if (lastOpenedRevision.current === documentOpenRevision) return;
    lastOpenedRevision.current = documentOpenRevision;
    if (editorMode && (!compact || peeking)) {
      collapseRail();
    }
  }, [documentOpenRevision, editorMode]);

  const railDocked = !compact || closing;
  const railPeeking = compact && !closing && peeking;
  const railMounted = railDocked || railPeeking;
  const updateRow = update ? <SidebarUpdateRow {...update} /> : null;

  return (
    <div className={`home-shell home-shell--${activeNav} ${spreadsheetMode ? "home-shell--spreadsheet" : ""} ${railDocked ? "" : "home-shell--railless"} ${railPeeking ? "home-shell--rail-peek" : ""} ${shut ? "home-shell--rail-shut" : ""} ${railMoving ? "home-shell--rail-moving" : ""}`}>
      {/* The one control for the rail, in the band at the window's top-left
          whichever way it points — the rail itself carries no collapse button,
          so the button never moves out from under the pointer that hid it. */}
      <button
        type="button"
        className="home-shell__rail-toggle"
        aria-label={railDocked ? t("shell.sidebar.collapse") : t("shell.sidebar.expand")}
        title={railDocked ? t("shell.sidebar.collapse") : t("shell.sidebar.expand")}
        aria-expanded={railDocked}
        onClick={railDocked ? collapseRail : expandRail}
        onPointerEnter={railDocked ? undefined : openPeek}
        onPointerLeave={railDocked ? undefined : closePeek}
      >
        <PanelLeft aria-hidden="true" />
      </button>
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
        onDeleteDocuments={onDeleteDocuments}
        onAddWorkspace={onAddWorkspace}
        onRenameWorkspace={onRenameWorkspace}
        onRevealWorkspace={onRevealWorkspace}
        onRemoveWorkspace={onRemoveWorkspace}
        onOpenSettings={() => onNavChange("settings")}
        onOpenAccount={() => onNavChange("login")}
        signal={signal}
        account={account}
        updateRow={updateRow}
      />
      ) : null}
      <main className="home-shell__main">
        {railDocked ? null : (
          /* With the rail gone the corner belongs to the window again: nothing
             but the toggle reaches it, so the rest of it drags the window. */
          <div className="home-shell__drag" aria-hidden="true" />
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
              {/* The rail's traffic-light band stops at its own right edge, so
                  the stage carries the rest of the title-bar strip. */}
              <div className="home-shell__stage-drag" aria-hidden="true" />
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
