import { useCallback, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  FileType,
  Minus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Presentation,
  RefreshCw,
  Save,
  Sparkles,
  X,
} from "lucide-react";
import { Button, Tooltip } from "../ui";
import { useT } from "../i18n";
import "./workbench.css";

export type WorkbenchDocumentType = "pptx" | "docx" | "xlsx" | "pdf" | "html" | "htm";
export type WorkbenchSaveState = "unopened" | "saved" | "dirty" | "saving" | "error";

/**
 * One hue per format, taken from the document-identity tokens rather than the
 * Office brand palette: the badge has to sit on warm paper next to the file
 * name, and the vendor blues clash with it.
 */
const TYPE_CONFIG: Record<string, { icon: typeof FileText; token: string; label: string }> = {
  docx: { icon: FileText, token: "var(--od-doc-docx)", label: "DOC" },
  xlsx: { icon: FileSpreadsheet, token: "var(--od-doc-xlsx)", label: "XLS" },
  pptx: { icon: Presentation, token: "var(--od-doc-pptx)", label: "PPT" },
  pdf: { icon: FileType, token: "var(--od-doc-report)", label: "PDF" },
  html: { icon: FileCode2, token: "var(--od-doc-img)", label: "HTML" },
  htm: { icon: FileCode2, token: "var(--od-doc-img)", label: "HTML" },
};

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
  /** Format-specific title-bar buttons, placed before the panel toggle. */
  readonly actions?: ReactNode;
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
 * The frame every Office surface shares: title bar, editor stage, AI panel,
 * status bar. The stage is deliberately a plain box — Writer, the presentation
 * embed and the sheet SDK each draw their own ribbon, thumbnail rail and sheet
 * tabs inside it, so the host cannot own those and must not pretend to.
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
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultPanelOpen);
  const open = panelOpen ?? uncontrolledOpen;
  const showPanel = Boolean(panel) && open;

  const setOpen = useCallback(
    (next: boolean) => {
      if (panelOpen === undefined) setUncontrolledOpen(next);
      onPanelOpenChange?.(next);
    },
    [onPanelOpenChange, panelOpen],
  );

  const config = TYPE_CONFIG[documentType];
  const TypeIcon = config?.icon ?? FileText;
  const hasStatusBar = Boolean(status || statusActions || zoom);

  return (
    <div
      className="wb"
      data-type={documentType}
      data-panel={showPanel ? "open" : "closed"}
      data-save-state={saveState ?? "none"}
    >
      <header className="wb-titlebar">
        <div className="wb-titlebar__reserve" aria-hidden="true" />

        <div className="wb-titlebar__quick">
          {onBack && (
            <Button
              variant="ghost-normal"
              size="small"
              ariaLabel={backLabel ?? t("workbench.back")}
              icon={<ArrowLeft />}
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
        </div>

        <div className="wb-titlebar__doc">
          <span className="wb-doc__icon" style={config ? { color: config.token } : undefined}>
            <TypeIcon size={15} strokeWidth={1.8} />
          </span>
          {context && <span className="wb-doc__context">{context}</span>}
          <span className="wb-doc__name" title={fileName}>
            {fileName}
          </span>
          {config && (
            <span className="wb-doc__badge" style={{ background: config.token }}>
              {config.label}
            </span>
          )}
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
                ariaLabel={t("workbench.openExternal")}
                icon={<ExternalLink />}
                onClick={onOpenExternal}
              />
            </Tooltip>
          )}
          {panel && (
            <Button
              variant="ghost-normal"
              size="small"
              ariaLabel={showPanel ? t("workbench.hidePanel") : t("workbench.showPanel")}
              icon={showPanel ? <PanelRightClose /> : <PanelRightOpen />}
              onClick={() => setOpen(!showPanel)}
            />
          )}
        </div>
      </header>

      {notice}

      <div className="wb-body">
        <div className="wb-stage">{children}</div>

        {showPanel && panel && (
          <aside className="wb-panel" aria-label={panel.title}>
            <header className="wb-panel__header">
              <div className="wb-panel__titlerow">
                <span className="wb-panel__title">
                  <Sparkles size={16} aria-hidden="true" />
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
