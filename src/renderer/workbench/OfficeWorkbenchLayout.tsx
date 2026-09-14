import { useId, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  ChevronLeft,
  ArrowUpRight,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Save,
  X,
} from "lucide-react";
import { AgentIcon } from "../components/AgentIcon";
import { DocTypeIcon } from "../components/DocTypeIcon";
import { Button, Tooltip } from "../ui";
import { useT } from "../i18n";
import "./workbench.css";

export type WorkbenchDocumentType = "pptx" | "docx" | "xlsx" | "pdf" | "html" | "htm" | "img";
export type WorkbenchSaveState = "unopened" | "saved" | "dirty" | "saving" | "error";

export interface WorkbenchZoom {
  /** 1 = 100%. */
  readonly value: number;
  readonly onZoomIn: () => void;
  readonly onZoomOut: () => void;
  /** Clicking the percentage resets; omit to make it a plain read-out. */
  readonly onReset?: () => void;
}

export interface WorkbenchPanel {
  readonly title: string;
  /** Where edits land. Truncated to one line under the title. */
  readonly target?: ReactNode;
  /** Tooltip for the target line — usually the full path. */
  readonly targetTitle?: string;
  /** What the next instruction applies to: a slide, a range, a selection. */
  readonly scope?: ReactNode;
  readonly onRefreshScope?: () => void;
  readonly refreshDisabled?: boolean;
  /** Extra header rows (live-drawing status, warnings). */
  readonly headerExtra?: ReactNode;
  readonly children: ReactNode;
}

/**
 * The file rail down the left edge. Same contract as `WorkbenchPanel`, which
 * now shares that edge: the host owns the slot and the button that reveals it,
 * the caller owns what goes in it. A workbench with no rail simply has no
 * toggle — it never draws a button onto an empty drawer.
 */
export interface WorkbenchRail {
  /** Accessible name of the `<aside>`; also the heading's fallback. */
  readonly label: string;
  readonly children: ReactNode;
}

export interface OfficeWorkbenchLayoutProps {
  readonly documentType: WorkbenchDocumentType;
  readonly fileName: string;
  /** Shown before the file name: the workspace or folder it belongs to. */
  readonly context?: string;
  readonly saveState?: WorkbenchSaveState;
  readonly onBack?: () => void;
  readonly backLabel?: string;
  readonly onSave?: () => void;
  readonly canSave?: boolean;
  readonly onOpenExternal?: () => void;
  /** Format-specific title-bar buttons, placed at the right of the bar. */
  readonly actions?: ReactNode;
  readonly rail?: WorkbenchRail;
  readonly railOpen?: boolean;
  readonly defaultRailOpen?: boolean;
  readonly onRailOpenChange?: (open: boolean) => void;
  readonly panel?: WorkbenchPanel;
  readonly panelOpen?: boolean;
  readonly defaultPanelOpen?: boolean;
  readonly onPanelOpenChange?: (open: boolean) => void;
  /** Left of the status bar. Nothing here means no status bar at all. */
  readonly status?: ReactNode;
  /** Right of the status bar, before the zoom cluster. */
  readonly statusActions?: ReactNode;
  readonly zoom?: WorkbenchZoom;
  /** Full-bleed strip under the title bar: fallbacks, degraded modes. */
  readonly notice?: ReactNode;
  /** Covers the stage and the panel — the app builder, a published app. */
  readonly overlay?: ReactNode;
  /** The embedded editor. It owns everything inside this box. */
  readonly children: ReactNode;
}

/**
 * Holds the frame at its origin, whatever tries to scroll it.
 *
 * `overflow: clip` in workbench.css already means the frame cannot scroll. This
 * is the same rule for engines that only have `hidden`, where the box stays a
 * scroll container and a descendant that sticks out lets the browser scroll the
 * whole frame sideways — which reads as a broken layout rather than a scroll.
 * Nothing in the frame is reachable by scrolling, so a non-zero offset can only
 * be that bug: put it back. Returns the unsubscribe.
 */
export function pinFrameToOrigin(frame: HTMLElement): () => void {
  const reset = () => {
    if (frame.scrollLeft !== 0) frame.scrollLeft = 0;
    if (frame.scrollTop !== 0) frame.scrollTop = 0;
  };
  frame.addEventListener("scroll", reset, { passive: true });
  reset();
  return () => frame.removeEventListener("scroll", reset);
}

/**
 * The frame every Office surface shares: title bar, AI panel, editor stage,
 * status bar. The assistant sits on the left and the document beside it — the
 * conversation is the thing being worked in, the stage is what it produces.
 * The stage is deliberately a plain box — Writer, the presentation embed and
 * the sheet SDK each draw their own ribbon, thumbnail rail and sheet tabs
 * inside it, so the host cannot own those and must not pretend to.
 */
export function OfficeWorkbenchLayout({
  documentType,
  fileName,
  context,
  saveState,
  onBack,
  backLabel,
  onSave,
  canSave = true,
  onOpenExternal,
  actions,
  rail,
  railOpen,
  defaultRailOpen = false,
  onRailOpenChange,
  panel,
  panelOpen,
  defaultPanelOpen = true,
  onPanelOpenChange,
  status,
  statusActions,
  zoom,
  notice,
  overlay,
  children,
}: OfficeWorkbenchLayoutProps) {
  const t = useT();
  const panelId = useId();

  // Closed by default: the file list is a detour from the document, and the
  // stage is the reason the window is open.
  const [uncontrolledRailOpen, setUncontrolledRailOpen] = useState(defaultRailOpen);
  const railIsOpen = railOpen ?? uncontrolledRailOpen;
  const showRail = Boolean(rail) && railIsOpen;

  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultPanelOpen);
  const open = panelOpen ?? uncontrolledOpen;
  const showPanel = Boolean(panel) && open;

  const setRailOpen = useCallback(
    (next: boolean) => {
      // One drawer at a time, and now doubly so: both live on the left edge,
      // and the assistant alone already takes half the body. Stacking the file
      // list on top of it would leave the document a strip.
      if (next) {
        if (panelOpen === undefined) setUncontrolledOpen(false);
        onPanelOpenChange?.(false);
      }
      if (railOpen === undefined) setUncontrolledRailOpen(next);
      onRailOpenChange?.(next);
    },
    [onPanelOpenChange, panelOpen, onRailOpenChange, railOpen, panelId],
  );

  const setOpen = useCallback(
    (next: boolean) => {
      // The other half of that rule: whichever side is being opened wins, and
      // the one already out goes back in.
      if (next) {
        if (railOpen === undefined) setUncontrolledRailOpen(false);
        onRailOpenChange?.(false);
      }
      if (!next && document.getElementById(panelId)?.contains(document.activeElement)) {
        document.getElementById(`${panelId}-toggle`)?.focus();
      }
      if (panelOpen === undefined) setUncontrolledOpen(next);
      onPanelOpenChange?.(next);
    },
    [onPanelOpenChange, panelOpen, onRailOpenChange, railOpen, panelId],
  );

  const hasStatusBar = Boolean(status || statusActions || zoom);

  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage?.animate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // Animate the existing stage rather than remounting the editor or its session.
    const animation = stage.animate(
      [{ opacity: 0.35, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
    );
    return () => animation.cancel();
  }, [fileName, documentType]);

  const frameRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = frameRef.current;
    return frame ? pinFrameToOrigin(frame) : undefined;
  }, []);

  return (
    <div
      ref={frameRef}
      className="wb"
      data-type={documentType}
      data-rail={showRail ? "open" : "closed"}
      data-panel={showPanel ? "open" : "closed"}
      data-save-state={saveState ?? "none"}
    >
      <header className="wb-titlebar">
        <div className="wb-titlebar__reserve" aria-hidden="true" />

        <div className="wb-titlebar__quick">
          {/* One control per direction, and the rail's toggle outranks the back
              button: with the rail open the way back to the files is the first
              thing in it, so two controls doing the same trip would just be a
              choice the user has to make. Surfaces without a rail keep their
              back button unconditionally. */}
          {rail ? (
            <Button
              variant="ghost-normal"
              size="small"
              ariaLabel={showRail ? t("workbench.hideRail") : t("workbench.showRail")}
              icon={showRail ? <PanelLeftClose /> : <PanelLeftOpen />}
              onClick={() => setRailOpen(!showRail)}
            />
          ) : null}
          {onBack && !showRail && (
            <Button
              variant="ghost-normal"
              size="small"
              ariaLabel={backLabel ?? t("workbench.back")}
              icon={<ChevronLeft />}
              onClick={onBack}
            />
          )}
          {onSave && (
            <Tooltip title={t("workbench.save")}>
              <Button
                variant="ghost-normal"
                size="small"
                ariaLabel={t("workbench.save")}
                icon={<Save />}
                disabled={!canSave || saveState === "saving"}
                loading={saveState === "saving"}
                onClick={onSave}
              />
            </Tooltip>
          )}
          {/* Use an explicit Agent disclosure in the titlebar. */}
          {panel && (
            <Tooltip title={showPanel ? t("workbench.hidePanel") : t("workbench.showPanel")}>
              <Button
                id={`${panelId}-toggle`}
                className="wb-titlebar__ai"
                aria-expanded={showPanel}
                aria-controls={panelId}
                variant="ghost-normal"
                size="small"
                ariaLabel={showPanel ? t("workbench.hidePanel") : t("workbench.showPanel")}
                icon={<AgentIcon className="wb-agent-icon" />}
                onClick={() => setOpen(!showPanel)}
              />
            </Tooltip>
          )}
        </div>

        <div className="wb-titlebar__doc">
          {/* The one way a format is drawn anywhere in the app — same tinted
              line icon the sidebar uses, no per-surface badge of our own. */}
          <DocTypeIcon type={documentType} />
          {context && <span className="wb-doc__context">{context}</span>}
          <span className="wb-doc__name" title={fileName}>
            {fileName}
          </span>
          {saveState && (
            <span className="wb-doc__state" data-state={saveState}>
              {t(`workbench.state.${saveState}`)}
            </span>
          )}
        </div>

        <div className="wb-titlebar__actions">
          {actions}
          {onOpenExternal && (
            <Tooltip title={t("workbench.openExternal")}>
              <Button
                variant="ghost-normal"
                size="small"
                className="wb-titlebar__external"
                ariaLabel={t("workbench.openExternal")}
                icon={<ArrowUpRight />}
                onClick={onOpenExternal}
              />
            </Tooltip>
          )}
        </div>
      </header>

      {notice}

      <div className="wb-body">
        {showRail && rail && (
          <aside className="wb-rail" aria-label={rail.label}>
            {rail.children}
          </aside>
        )}

        {/* Ahead of the stage, not after it: the conversation drives the
            document, so it reads first and the result sits beside it. */}
        {panel && (
          <aside id={panelId} className="wb-panel" aria-label={panel.title} aria-hidden={!showPanel} inert={!showPanel}>
            <header className="wb-panel__header">
              <div className="wb-panel__titlerow">
                <span className="wb-panel__title">
                  <AgentIcon className="wb-agent-icon" />
                  <span>{panel.title}</span>
                </span>
                {panel.onRefreshScope && (
                  <Button
                    variant="ghost-normal"
                    size="small"
                    ariaLabel={t("workbench.refreshScope")}
                    icon={<RefreshCw size={13} />}
                    disabled={panel.refreshDisabled}
                    onClick={panel.onRefreshScope}
                  />
                )}
                <Button
                  variant="ghost-normal"
                  size="small"
                  ariaLabel={t("workbench.panelClose")}
                  icon={<X size={14} />}
                  onClick={() => setOpen(false)}
                />
              </div>
              {panel.target && (
                <div className="wb-panel__target" title={panel.targetTitle}>
                  {panel.target}
                </div>
              )}
              {panel.scope && <span className="wb-panel__scope">{panel.scope}</span>}
              {panel.headerExtra}
            </header>
            <div className="wb-panel__content">{panel.children}</div>
          </aside>
        )}

        <div ref={stageRef} className="wb-stage">{children}</div>

        {overlay && <div className="wb-overlay">{overlay}</div>}
      </div>

      {hasStatusBar && (
        <footer className="wb-statusbar">
          {status}
          <span className="wb-statusbar__spacer" />
          {statusActions}
          {zoom && (
            <div className="wb-zoom">
              <button
                type="button"
                className="wb-zoom__step"
                onClick={zoom.onZoomOut}
                aria-label={t("workbench.zoomOut")}
                title={t("workbench.zoomOut")}
              >
                <Minus size={13} strokeWidth={2} />
              </button>
              <button
                type="button"
                className="wb-zoom__pct"
                onClick={zoom.onReset}
                disabled={!zoom.onReset}
                aria-label={t("workbench.zoom")}
              >
                {Math.round(zoom.value * 100)}%
              </button>
              <button
                type="button"
                className="wb-zoom__step"
                onClick={zoom.onZoomIn}
                aria-label={t("workbench.zoomIn")}
                title={t("workbench.zoomIn")}
              >
                <Plus size={13} strokeWidth={2} />
              </button>
            </div>
          )}
        </footer>
      )}
    </div>
  );
}
