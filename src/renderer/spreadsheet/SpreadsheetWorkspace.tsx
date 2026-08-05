import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { FileSpreadsheet, Sparkles } from "lucide-react";
import { officecli } from "../bridge";
import { SpreadsheetCanvas, type SpreadsheetCanvasHandle, type SpreadsheetCanvasState } from "./SpreadsheetCanvas";
import { SpreadsheetTopbar, type SpreadsheetSaveState } from "./SpreadsheetTopbar";
import type { SpreadsheetSessionState } from "./types";

export interface SpreadsheetWorkspaceHandle {
  save(): Promise<boolean>;
  focus(): void;
}

export interface SpreadsheetWorkspaceProps {
  session: SpreadsheetSessionState;
  workspaceName?: string;
  onBack: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  onCanvasStateChange?: (state: SpreadsheetCanvasState) => void;
  onCanvasError?: (error?: string) => void;
  onCanvasSessionClosed?: (previewToken: string) => void;
  agentPanel?: React.ReactNode;
}

function saveStateFor(session: SpreadsheetSessionState): SpreadsheetSaveState {
  if (!session.artifact) return "unopened";
  if (session.phase === "saving") return "saving";
  if (session.phase === "error") return "error";
  if (session.dirty || session.phase === "dirty") return "dirty";
  return "saved";
}

export const SpreadsheetWorkspace = forwardRef<SpreadsheetWorkspaceHandle, SpreadsheetWorkspaceProps>(
  function SpreadsheetWorkspace({ session, workspaceName, onBack, onDirtyChange, onCanvasStateChange, onCanvasError, onCanvasSessionClosed, agentPanel }, ref) {
    const canvasRef = useRef<SpreadsheetCanvasHandle>(null);
    const [agentOpen, setAgentOpen] = useState(true);
    const fileName = session.artifact?.fileName ?? "Untitled.xlsx";
    const saveState = saveStateFor(session);

    const save = useCallback(() => canvasRef.current?.save() ?? Promise.resolve(false), []);
    useImperativeHandle(ref, () => ({
      save,
      focus: () => canvasRef.current?.focus(),
    }), [save]);

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
          onToggleAgent={() => setAgentOpen((open) => !open)}
        />
        <div className="spreadsheet-workspace__body">
          <main className="spreadsheet-workspace__canvas" role="region" aria-label={session.artifact ? `${fileName} workbook` : "Untitled workbook"}>
            {session.artifact && session.grant ? (
              <SpreadsheetCanvas
                ref={canvasRef}
                artifact={session.artifact}
                grant={session.grant}
                onDirtyChange={onDirtyChange}
                onStateChange={onCanvasStateChange}
                onError={onCanvasError}
                onSessionClosed={onCanvasSessionClosed}
              />
            ) : (
              <div className="spreadsheet-workspace__empty">
                <FileSpreadsheet aria-hidden="true" />
                <strong>Your spreadsheet will appear here</strong>
                <span>Describe what you need in the AI assistant to create a workbook.</span>
              </div>
            )}
          </main>
          {agentOpen ? (
            <aside className="spreadsheet-agent" aria-label="AI Assistant">
              <header className="spreadsheet-agent__header"><Sparkles aria-hidden="true" /><strong>AI Assistant</strong></header>
              <div className="spreadsheet-agent__content">{agentPanel ?? <p>Describe the spreadsheet you want to create.</p>}</div>
            </aside>
          ) : null}
        </div>
      </section>
    );
  },
);
