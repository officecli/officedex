import { ArrowUpRight, Check, CircleCheck, Clock3, Pause, PanelLeft, Play, SquareDashed, Undo2 } from "lucide-react";

import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Composer } from "../composer/Composer";
import type { AgentStep, AgentTask } from "../port/types";
import { useShell } from "../state/ShellContext";
import { canDock, effectivePlacement } from "../state/shellReducer";
import { PresenceFace, statusLabel } from "./PresenceFace";
import type { useAgentTask } from "./useAgentTask";

export interface TaskPanelProps {
  agent: ReturnType<typeof useAgentTask>;
  /** Docked shows a plain heading; floating shows the face and a drag grip. */
  placement: "docked" | "floating";
  dragHandleProps?: Record<string, unknown>;
}

/**
 * The conversation. One component for both placements — the docked column and
 * the floating panel differ in their header and their padding, not in what
 * they can do. That is the point of decision 1: there is one conversation, and
 * placement is where it happens to sit.
 */
export function TaskPanel({ agent, placement, dragHandleProps }: TaskPanelProps) {
  const { state, folders, files, activeFile, scopeFolderId, dispatch } = useShell();
  const { task } = agent;
  const scope = folders.find((folder) => folder.id === scopeFolderId);
  const status = task?.status ?? "idle";
  const dockable = canDock(state);
  const docked = effectivePlacement(state) === "docked";

  return (
    <div className="shell-task" data-placement={placement}>
      <header
        className={`shell-task-head${placement === "floating" ? " is-grip" : ""}`}
        {...(placement === "floating" ? dragHandleProps : {})}
        {...(placement === "floating"
          ? {
              tabIndex: 0,
              role: "group",
              "aria-label": "Move the Agent panel. Drag, or use the arrow keys.",
            }
          : {})}
      >
        {placement === "floating" ? <PresenceFace status={status} size={40} /> : null}

        <div className="shell-task-title">
          <b>{task?.title ?? "Work with Agent"}</b>
          <small>{task ? statusLabel(status) : (scope?.name ?? "No folder")}</small>
        </div>

        {dockable ? (
          <button
            type="button"
            className="shell-icon-button"
            aria-pressed={!docked}
            aria-label={docked ? "Float the Agent panel" : "Dock the Agent panel"}
            title={docked ? "Float the Agent panel" : "Dock the Agent panel"}
            onClick={() =>
              dispatch({ type: "set-placement", placement: docked ? "floating" : "docked" })
            }
          >
            {docked ? <SquareDashed size={16} strokeWidth={1.7} /> : <PanelLeft size={16} strokeWidth={1.7} />}
          </button>
        ) : null}
      </header>

      <div className="shell-task-scroll">
        {task ? (
          <>
            {task.messages.map((message) =>
              message.role === "user" ? (
                <div key={message.id} className="shell-task-user">
                  {message.reference ? (
                    <blockquote>
                      <cite>{message.reference.label}</cite>
                      {message.reference.text}
                    </blockquote>
                  ) : null}
                  {message.text}
                </div>
              ) : (
                <div key={message.id} className="shell-task-reply">
                  <div className="shell-task-reply-label">
                    <PresenceFace status="idle" size={18} />
                    OfficeDex
                  </div>
                  <p>{message.text}</p>
                </div>
              ),
            )}

            {task.steps.length > 0 ? (
              <ol className="shell-task-steps">
                {task.steps.map((step) => (
                  <li key={step.id} className={`shell-task-step is-${step.state}`}>
                    <StepIcon step={step} paused={status === "paused"} />
                    <span>{step.state === "active" && task.phase ? task.phase : step.label}</span>
                  </li>
                ))}
              </ol>
            ) : null}

            <div className="shell-task-actions">
              {status === "paused" ? (
                <button type="button" className="shell-task-button" onClick={() => void agent.resume()}>
                  <Play size={14} strokeWidth={1.8} aria-hidden="true" />
                  Resume
                </button>
              ) : (
                <button
                  type="button"
                  className="shell-task-button"
                  disabled={status === "done" || status === "idle"}
                  onClick={() => void agent.pause()}
                >
                  <Pause size={14} strokeWidth={1.8} aria-hidden="true" />
                  Pause
                </button>
              )}
              <button
                type="button"
                className="shell-task-button"
                disabled={status === "done"}
                onClick={() => void agent.finish()}
              >
                <Check size={14} strokeWidth={1.8} aria-hidden="true" />
                Finish task
              </button>
            </div>

            {task.suggestion ? (
              <SuggestionCard
                suggestion={task.suggestion}
                fileName={
                  files.find((file) => file.id === task.suggestion?.targetFileId)?.name ?? "the file"
                }
                onApply={() => void agent.applySuggestion(task.suggestion!.id)}
                onUndo={() => void agent.undoSuggestion(task.suggestion!.id)}
              />
            ) : null}
          </>
        ) : (
          <div className="shell-task-empty">
            <PresenceFace status="idle" size={44} />
            <strong>What should we work on?</strong>
            <p>
              Describe a task for {scope?.name ?? "this folder"}. You can keep editing while it runs.
            </p>
          </div>
        )}

        {activeFile ? (
          <div className="shell-task-artifact">
            <div className="shell-task-artifact-head">
              <FileTypeIcon type={activeFile.type} size={20} />
              <div>
                <strong>{activeFile.name}</strong>
                <small>
                  {activeFile.dirty ? "Unsaved changes" : "Saved on this computer"}
                </small>
              </div>
            </div>
            <button
              type="button"
              className="shell-task-button"
              onClick={() => dispatch({ type: "set-mode", mode: "editor" })}
            >
              Open in Editor
              <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      <div className="shell-task-composer">
        <Composer
          placement={placement === "docked" ? "task" : "floating"}
          busy={agent.busy}
          onSend={agent.send}
          onStop={agent.stop}
        />
      </div>
    </div>
  );
}

function StepIcon({ step, paused }: { step: AgentStep; paused: boolean }) {
  if (step.state === "done") return <CircleCheck size={15} strokeWidth={1.7} aria-hidden="true" />;
  if (step.state === "pending") return <Clock3 size={15} strokeWidth={1.7} aria-hidden="true" />;
  if (paused) return <Pause size={15} strokeWidth={1.7} aria-hidden="true" />;
  return <span className="shell-task-spinner" aria-hidden="true" />;
}

function SuggestionCard({
  suggestion,
  fileName,
  onApply,
  onUndo,
}: {
  suggestion: NonNullable<AgentTask["suggestion"]>;
  fileName: string;
  onApply: () => void;
  onUndo: () => void;
}) {
  return (
    <div className="shell-task-suggestion" data-applied={String(suggestion.applied)}>
      <strong>{suggestion.applied ? "Changes applied" : "Suggested changes are ready"}</strong>
      <p>{suggestion.summary}</p>
      <small>{fileName}</small>
      {suggestion.applied ? (
        <button
          type="button"
          className="shell-task-button"
          disabled={!suggestion.undoable}
          title={
            suggestion.undoable
              ? "Undo this change"
              : "The file changed after applying, so this can no longer be undone"
          }
          onClick={onUndo}
        >
          <Undo2 size={14} strokeWidth={1.8} aria-hidden="true" />
          Undo
        </button>
      ) : (
        <button type="button" className="shell-task-button is-primary" onClick={onApply}>
          <Check size={14} strokeWidth={1.8} aria-hidden="true" />
          Review and apply
        </button>
      )}
    </div>
  );
}
