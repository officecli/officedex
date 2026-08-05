import { useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, Send, Square } from "lucide-react";
import type { DesktopTask, GenerateInput, ModifyInput } from "../../shared/types";
import { Button, TextArea } from "../ui";

export interface SpreadsheetAgentPanelProps {
  workspaceId?: string;
  artifactPath?: string;
  conversationId?: string;
  sourceTaskId?: string;
  task?: DesktopTask;
  error?: string;
  onGenerate: (input: GenerateInput) => Promise<unknown>;
  onModify: (input: ModifyInput) => Promise<unknown>;
  onCancel?: (taskId: string) => Promise<unknown>;
}

export function SpreadsheetAgentPanel({ workspaceId, artifactPath, conversationId, sourceTaskId, task, error, onGenerate, onModify, onCancel }: SpreadsheetAgentPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const running = submitting || task?.status === "starting" || task?.status === "running";
  const failure = error || task?.error;

  const submit = async () => {
    const value = prompt.trim();
    if (!value || running) return;
    setSubmitting(true);
    try {
      if (artifactPath) {
        await onModify({
          documentType: "xlsx",
          sourceFile: artifactPath,
          prompt: value,
          ...(workspaceId ? { workspaceId } : { noProject: true }),
          ...(conversationId ? { conversationId } : {}),
          ...(sourceTaskId ? { parentTaskId: sourceTaskId } : {}),
        });
      } else {
        await onGenerate({
          documentType: "xlsx",
          generationMode: "plan",
          topic: value.slice(0, 80),
          prompt: value,
          ...(workspaceId ? { workspaceId } : { noProject: true }),
          enableImages: true,
        });
      }
      setPrompt("");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="spreadsheet-agent-panel">
      <div className="spreadsheet-agent-panel__timeline" aria-live="polite">
        {!task ? (
          <div className="spreadsheet-agent-panel__welcome">
            <strong>{artifactPath ? "Continue editing with AI" : "Create a spreadsheet"}</strong>
            <p>{artifactPath ? "Ask for formulas, formatting, charts, or structural changes." : "Describe the workbook, data, formulas, and charts you need."}</p>
          </div>
        ) : (
          <div className="spreadsheet-agent-panel__task" data-status={task.status}>
            {running ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : task.status === "completed" ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            <div>
              <strong>{task.topic || "Spreadsheet task"}</strong>
              <span>{task.status === "completed" ? "Workbook ready" : task.status === "failed" ? "Generation failed" : "Working on your workbook…"}</span>
            </div>
          </div>
        )}
        {task?.stages?.length ? (
          <ol className="spreadsheet-agent-panel__stages">
            {task.stages.map((stage) => <li key={stage.id} data-status={stage.status}>{stage.label}</li>)}
          </ol>
        ) : null}
        {failure ? <div className="spreadsheet-agent-panel__error" role="alert">{failure}</div> : null}
      </div>
      <div className="spreadsheet-agent-panel__composer">
        <TextArea
          aria-label={artifactPath ? "Spreadsheet modification request" : "Spreadsheet generation request"}
          value={prompt}
          rows={4}
          placeholder={artifactPath ? "e.g. Add a monthly trend chart and highlight negative growth" : "e.g. Build a quarterly sales forecast with formulas and charts"}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <div className="spreadsheet-agent-panel__composer-actions">
          {running && task?.id && onCancel ? <Button size="small" variant="secondary" icon={<Square />} onClick={() => void onCancel(task.id)}>Cancel</Button> : null}
          <Button size="small" variant="primary" icon={<Send />} loading={submitting} disabled={!prompt.trim() || running} onClick={() => void submit()}>
            {artifactPath ? "Modify" : "Generate"}
          </Button>
        </div>
      </div>
    </div>
  );
}
