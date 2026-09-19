import { ArrowUpRight, Check, CircleAlert, CircleCheck, CircleSlash, Clock3, Pause, PanelLeft, Play, SquareDashed, Undo2 } from "lucide-react";

import { useT } from "../../renderer/i18n";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Composer } from "../composer/Composer";
import type { AgentOutlinePage, AgentStep, AgentTask } from "../../shared/uiPort";
import { useShell } from "../state/ShellContext";
import { useLibraryActions } from "../nav/useLibraryActions";
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
  const t = useT();
  const { state, folders, files, scopeFolderId, dispatch } = useShell();
  const actions = useLibraryActions();
  const { task } = agent;

  /**
   * The file this run produced — not the file that happens to be open.
   *
   * This card used to render `activeFile`, so asking for a brand new deck put
   * an unrelated document's name inside the task panel, under the task's own
   * title, while the run was still working on something else entirely. The
   * label was changed to say "Current file" first, which stopped it lying
   * without stopping it confusing: in a panel about one task, a filename reads
   * as that task's output no matter what the caption says.
   *
   * `FileMeta.artifactTaskId` is the link the library already keeps for
   * exactly this question, and `ShellContext` opens the match when a run
   * finishes. Until there is a match there is nothing truthful to show — a run
   * mid-flight has produced no file, and a failed one produced none either —
   * so the card stays away. The open document remains one click away in the
   * tab bar, which is what a tab bar is for.
   */
  const artifact = task ? (files.find((file) => file.artifactTaskId === task.id) ?? null) : null;
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
              "aria-label": t("shell.task.dragAria"),
            }
          : {})}
      >
        {/*
          The companion heads the panel in both placements. It used to appear
          only when floating, which left Agent mode — the mode that *is* the
          companion — without the character anywhere on screen once a task was
          running, since the docked column suppresses the floating presence.
        */}
        <PresenceFace status={status} size={placement === "floating" ? 40 : 34} tracks />

        <div className="shell-task-title">
          <b>{task?.title ?? t("shell.task.defaultTitle")}</b>
          <small>{task ? statusLabel(status) : (scope?.name ?? t("shell.task.noFolder"))}</small>
        </div>

        {dockable ? (
          <button
            type="button"
            className="shell-icon-button"
            aria-pressed={!docked}
            aria-label={t(docked ? "shell.task.float" : "shell.task.dock")}
            title={t(docked ? "shell.task.float" : "shell.task.dock")}
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
                    {t("settings.about.productName")}
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

            {task.outline && task.outline.length > 0 ? (
              <OutlineList pages={task.outline} />
            ) : null}

            {task.question ? (
              <QuestionCard
                question={task.question}
                onPick={(optionId) => void agent.answer({ optionId })}
              />
            ) : null}

            <div className="shell-task-actions">
              {task.documentType !== "docx" && task.documentType !== "xlsx"
                ? status === "paused" ? (
                    <button type="button" className="shell-task-button" onClick={() => void agent.resume()}>
                      <Play size={14} strokeWidth={1.8} aria-hidden="true" />
                      {t("shell.task.resume")}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="shell-task-button"
                      disabled={status === "done" || status === "idle"}
                      onClick={() => void agent.pause()}
                    >
                      <Pause size={14} strokeWidth={1.8} aria-hidden="true" />
                      {t("shell.task.pause")}
                    </button>
                  )
                : null}
              <button
                type="button"
                className="shell-task-button"
                disabled={status === "done"}
                onClick={() => void agent.finish()}
              >
                <Check size={14} strokeWidth={1.8} aria-hidden="true" />
                {t("shell.task.finish")}
              </button>
            </div>

            {task.suggestion ? (
              <SuggestionCard
                suggestion={task.suggestion}
                fileName={
                  files.find((file) => file.id === task.suggestion?.targetFileId)?.name ??
                  t("shell.task.theFile")
                }
                onApply={() => void agent.applySuggestion(task.suggestion!.id)}
                onUndo={() => void agent.undoSuggestion(task.suggestion!.id)}
              />
            ) : null}
          </>
        ) : (
          <div className="shell-task-empty">
            <PresenceFace status="idle" size={44} tracks />
            <strong>{t("shell.task.emptyTitle")}</strong>
            <p>
              {t("shell.task.emptyBody", { folder: scope?.name ?? t("shell.task.thisFolder") })}
            </p>
          </div>
        )}

        {artifact ? (
          <div className="shell-task-artifact">
            <div className="shell-task-artifact-head">
              <FileTypeIcon type={artifact.type} size={20} />
              <div>
                <strong>{artifact.name}</strong>
                <small>
                  {t(artifact.dirty ? "workbench.state.dirty" : "shell.task.artifactSaved")}
                </small>
              </div>
            </div>
            <button
              type="button"
              className="shell-task-button"
              onClick={() => {
                void actions.openFile(artifact.id);
                dispatch({ type: "set-mode", mode: "editor" });
              }}
            >
              {t("shell.task.openInEditor")}
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

/**
 * The pages the run is writing, beside the conversation rather than on the
 * canvas.
 *
 * The canvas used to carry all of this — the outline, the per-page status, the
 * request echoed back — and the deck being written was nowhere on screen. That
 * is backwards: a plan is something to read and talk about, which is what this
 * column is for, and the document is what the canvas is for.
 *
 * Titles and status only. The runtime writes a sentence of intent per page and
 * it reads well at full width, but eight of them in a 320px column stop being a
 * list of pages and become a wall. The title says which page, the mark says how
 * it is doing, and the deck itself is right there to read.
 */
function OutlineList({ pages }: { pages: NonNullable<AgentTask["outline"]> }) {
  const t = useT();
  return (
    <ol className="shell-task-outline" aria-label={t("shell.task.outlineAria")}>
      {pages.map((page) => (
        <li key={page.slide} className="shell-task-outline-row" data-state={page.state ?? "planned"}>
          <span className="shell-task-outline-index">{String(page.slide).padStart(2, "0")}</span>
          <span className="shell-task-outline-title">{page.title}</span>
          <PageMark state={page.state} />
        </li>
      ))}
    </ol>
  );
}

/**
 * One mark per page, in the same vocabulary the step list already uses: a tick
 * for done, a spinner for working, a clock for not yet. A reader should not
 * have to learn a second set of symbols halfway down the same column.
 */
function PageMark({ state }: { state: AgentOutlinePage["state"] }) {
  const t = useT();
  if (state === "ready") {
    return <CircleCheck size={14} strokeWidth={1.7} aria-label={t("shell.task.pageReady")} />;
  }
  if (state === "generating" || state === "repairing") {
    return (
      <span
        className="shell-task-spinner"
        aria-label={t(state === "repairing" ? "shell.task.pageRetrying" : "shell.task.pageWriting")}
      />
    );
  }
  if (state === "failed") {
    return <CircleAlert size={14} strokeWidth={1.7} aria-label={t("shell.task.pageFailed")} />;
  }
  if (state === "canceled") {
    return <CircleSlash size={14} strokeWidth={1.7} aria-label={t("shell.task.pageStopped")} />;
  }
  return <Clock3 size={14} strokeWidth={1.7} aria-label={t("shell.task.pageQueued")} />;
}

/**
 * The run is waiting on an answer, and this is the way through.
 *
 * It sits above the actions rather than among the messages because it is not
 * something the agent said — it is a door. Rendered as a reply with no controls
 * it read as commentary, and the only text box on screen (the composer) started
 * a second run instead of answering, leaving the first blocked with nothing on
 * screen to say so.
 *
 * The composer stays live underneath for a typed answer when the runtime takes
 * one; when it does not, `agent.send` says so rather than silently starting
 * something else.
 */
function QuestionCard({
  question,
  onPick,
}: {
  question: NonNullable<AgentTask["question"]>;
  onPick: (optionId: string) => void;
}) {
  const t = useT();
  return (
    <div className="shell-task-question" role="group" aria-label={t("shell.task.questionAria")}>
      <strong>{question.text || t("shell.task.questionFallback")}</strong>
      {question.options.length > 0 ? (
        <div className="shell-task-question-options">
          {question.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className={`shell-task-button${option.recommended ? " is-primary" : ""}`}
              title={option.description ?? option.label}
              onClick={() => onPick(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {question.allowFreeform ? (
        <small>{t("shell.task.questionFreeform")}</small>
      ) : question.options.length === 0 ? (
        <small>{t("shell.task.questionNoOptions")}</small>
      ) : null}
    </div>
  );
}

function StepIcon({ step, paused }: { step: AgentStep; paused: boolean }) {  if (step.state === "done") return <CircleCheck size={15} strokeWidth={1.7} aria-hidden="true" />;
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
  const t = useT();
  return (
    <div className="shell-task-suggestion" data-applied={String(suggestion.applied)}>
      <strong>
        {t(suggestion.applied ? "shell.task.suggestionApplied" : "shell.task.suggestionReady")}
      </strong>
      <p>{suggestion.summary}</p>
      <small>{fileName}</small>
      {suggestion.applied ? (
        <button
          type="button"
          className="shell-task-button"
          disabled={!suggestion.undoable}
          title={t(suggestion.undoable ? "shell.task.undoTitle" : "shell.task.undoBlocked")}
          onClick={onUndo}
        >
          <Undo2 size={14} strokeWidth={1.8} aria-hidden="true" />
          {t("shell.task.undo")}
        </button>
      ) : (
        <button type="button" className="shell-task-button is-primary" onClick={onApply}>
          <Check size={14} strokeWidth={1.8} aria-hidden="true" />
          {t("shell.task.reviewApply")}
        </button>
      )}
    </div>
  );
}
