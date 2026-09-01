import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { FileSpreadsheet, Sparkles } from "lucide-react";
import { officecli } from "../bridge";
import { SpreadsheetCanvas, type SpreadsheetCanvasHandle, type SpreadsheetCanvasState } from "./SpreadsheetCanvas";
import { SpreadsheetTopbar, type SpreadsheetSaveState } from "./SpreadsheetTopbar";
import type { SpreadsheetSessionState } from "./types";
import type { WorkbookAddChartRequest, WorkbookAddChartResult } from "./workbookClientTools";
import { useT } from "../i18n";
import { WorkbookAppBuilder } from "../appBuilder/WorkbookAppBuilder";
import { PublishedWorkbookAppPage } from "../appBuilder/PublishedWorkbookAppPage";
import type { PublishedWorkbookApp } from "../appBuilder/types";

export interface SpreadsheetWorkspaceHandle {
  [key: string]: any;
  save(): Promise<boolean>;
  focus(): void;
  addChart(request: WorkbookAddChartRequest): Promise<WorkbookAddChartResult>;
}

export interface SpreadsheetWorkspaceProps {
  session: SpreadsheetSessionState;
  workspaceName?: string;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCanvasStateChange?: (state: SpreadsheetCanvasState) => void;
  onCanvasError?: (error?: string) => void;
  onCanvasSaveError?: (error?: string) => void;
  onCanvasSessionClosed?: (previewToken: string) => void;
  agentPanel?: React.ReactNode;
}

function saveStateFor(session: SpreadsheetSessionState): SpreadsheetSaveState {
  if (!session.artifact) return "unopened";
  if (session.phase === "saving") return "saving";
  if (session.saveError) return "error";
  if (session.phase === "error") return "error";
  if (session.dirty || session.phase === "dirty") return "dirty";
  return "saved";
}

export const SpreadsheetWorkspace = forwardRef<SpreadsheetWorkspaceHandle, SpreadsheetWorkspaceProps>(
  function SpreadsheetWorkspace({ session, workspaceName, onBack, onDirtyChange, onCanvasStateChange, onCanvasError, onCanvasSaveError, onCanvasSessionClosed, agentPanel }, ref) {
    const canvasRef = useRef<SpreadsheetCanvasHandle>(null);
    const t = useT();
    const [agentOpen, setAgentOpen] = useState(true);
    const [appBuilderOpen, setAppBuilderOpen] = useState(false);
    const [publishedApp, setPublishedApp] = useState<PublishedWorkbookApp>();
    const [sourceRevision, setSourceRevision] = useState(0);
    const fileName = session.artifact?.fileName ?? t("spreadsheet.untitled");
    const saveState = saveStateFor(session);

    useEffect(() => {
      setAppBuilderOpen(false);
      setPublishedApp(undefined);
      setSourceRevision(0);
    }, [session.artifact?.filePath]);

    const save = useCallback(() => canvasRef.current?.save() ?? Promise.resolve(false), []);
    const addChart = useCallback((request: WorkbookAddChartRequest) => {
      const canvas = canvasRef.current;
      if (!canvas) return Promise.reject(new Error("The workbook is not open yet."));
      return canvas.addChart(request);
    }, []);
    useImperativeHandle(ref, () => ({
      save,
      focus: () => canvasRef.current?.focus(),
      addChart,
    }), [addChart, save]);

    return (
      <section className="spreadsheet-workspace" data-agent-open={agentOpen ? "true" : "false"}>
        <SpreadsheetTopbar
          fileName={fileName}
          workspaceName={workspaceName}
          saveState={saveState}
          canSave={Boolean(session.artifact && session.grant && session.dirty)}
          agentOpen={agentOpen}
          onBack={onBack}
          onSave={() => void save()}
          onOpenExternal={session.artifact ? () => void officecli.openPath(session.artifact!.filePath) : undefined}
          onOpenAppBuilder={session.artifact && session.grant ? () => setAppBuilderOpen(true) : undefined}
          onToggleAgent={() => setAgentOpen((open) => !open)}
        />
        <div className="spreadsheet-workspace__body">
          <main className="spreadsheet-workspace__canvas" role="region" aria-label={session.artifact ? t("spreadsheet.workbook.aria", { file: fileName }) : t("spreadsheet.workbook.untitledAria")}>
            {session.artifact && session.grant ? (
              <SpreadsheetCanvas
                ref={canvasRef}
                artifact={session.artifact}
                grant={session.grant}
                onDirtyChange={onDirtyChange}
                onStateChange={(state) => {
                  onCanvasStateChange?.(state);
                  if (state === "saved") setSourceRevision((current) => current + 1);
                }}
                onError={onCanvasError}
                onSaveError={onCanvasSaveError}
                onSessionClosed={onCanvasSessionClosed}
              />
            ) : (
              <div className="spreadsheet-workspace__empty">
                <FileSpreadsheet aria-hidden="true" />
                <strong>{t("spreadsheet.workbook.emptyTitle")}</strong>
                <span>{t("spreadsheet.workbook.emptyBody")}</span>
              </div>
            )}
          </main>
          {agentOpen ? (
            <aside className="spreadsheet-agent" aria-label={t("spreadsheet.agent.title")}>
              <header className="spreadsheet-agent__header"><Sparkles aria-hidden="true" /><strong>{t("spreadsheet.agent.title")}</strong></header>
              <div className="spreadsheet-agent__content">{agentPanel ?? <p>{t("spreadsheet.agent.empty")}</p>}</div>
            </aside>
          ) : null}
        </div>
        {publishedApp && session.grant ? (
          <div className="spreadsheet-workspace__app-layer">
            <PublishedWorkbookAppPage app={publishedApp} grant={session.grant} sourceRevision={sourceRevision} onBack={() => {
              setPublishedApp(undefined);
              setAppBuilderOpen(true);
            }} />
          </div>
        ) : appBuilderOpen && session.artifact && session.grant ? (
          <div className="spreadsheet-workspace__app-layer">
            <WorkbookAppBuilder
              artifact={session.artifact}
              grant={session.grant}
              sourceRevision={sourceRevision}
              onClose={() => setAppBuilderOpen(false)}
              onOpenPublished={(app) => {
                setPublishedApp(app);
                setAppBuilderOpen(false);
              }}
            />
          </div>
        ) : null}
      </section>
    );
  },
);
