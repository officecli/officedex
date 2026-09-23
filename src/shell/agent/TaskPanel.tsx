import { ArrowUpRight, Check, CircleAlert, CircleCheck, CircleSlash, Clock3, Pause, PanelLeft, Play, RotateCcw, SquareDashed, Undo2, X } from "lucide-react";
import { useState } from "react";

import { useT } from "../../renderer/i18n";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import { Composer } from "../composer/Composer";
import type { AgentOutlinePage, AgentStep, AgentTask } from "../../shared/uiPort";
import { ImageEditTargetBar, ImageTranscript } from "../image/ImageTranscript";
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
  /**
   * A picture run reads nothing like a document run, so it gets its own
   * transcript rather than a banner on top of this one.
   *
   * The generic column is steps, an outline, a suggestion to apply and one
   * artifact card at the bottom. An image run has none of those: it has a list
   * of versions, and every message is a change to one of them. What used to be
   * here was a stub saying "Image generation" above a message list that then
   * showed the same prompts again — see `ImageTranscript` for what replaced it.
   */
  const imageTask = task?.documentType === "img";
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
        {task && imageTask ? <ImageTranscript agent={agent} /> : null}

        {task && !imageTask ? (
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

            {task.outline && task.outline.length > 0 && !isOutlineGate(task) ? (
              <OutlineList pages={task.outline} />
            ) : null}

            {task.question ? (
              isOutlineGate(task) ? (
                <OutlineGateCard
                  question={task.question}
                  pages={task.outline ?? []}
                  onApprove={(optionId, outline) => void agent.answer({ optionId, outline })}
                />
              ) : (
                <QuestionCard
                  question={task.question}
                  onPick={(optionId) => void agent.answer({ optionId })}
                />
              )
            ) : null}

            {task.recovery ? <RecoveryNote recovery={task.recovery} t={t} /> : null}

            <div className="shell-task-actions">
              {task.recovery ? (
                <button
                  type="button"
                  className="shell-task-button is-primary"
                  onClick={() => void agent.resumeFailed(task.id)}
                >
                  <RotateCcw size={14} strokeWidth={1.8} aria-hidden="true" />
                  {recoveryLabel(task.recovery, t)}
                </button>
              ) : null}
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
        ) : null}

        {task ? null : (
          <div className="shell-task-empty">
            <PresenceFace status="idle" size={44} tracks />
            <strong>{t("shell.task.emptyTitle")}</strong>
            <p>
              {t("shell.task.emptyBody", { folder: scope?.name ?? t("shell.task.thisFolder") })}
            </p>
          </div>
        )}

        {/* The generic artifact card is the document column's. An image run's
            results are its versions, and the transcript already lists them. */}
        {artifact && !imageTask ? (
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

      {/* What the next message changes, stated where it is typed. The composer
          carries the same fact as `baseFileId`; this is its visible half. */}
      {imageTask ? <ImageEditTargetBar /> : null}

      <div className="shell-task-composer">
        <Composer
          placement={placement === "docked" ? "task" : "floating"}
          busy={agent.busy}
          imageTask={imageTask}
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
 * Is this the run's one blocking stop, rather than an ordinary question?
 *
 * The gate arrives as a question like any other, so it is recognised by shape:
 * a deck, a page list to decide about, and a single approval with no freeform
 * — the runtime wants a decision on the plan, not a sentence.
 */
function isOutlineGate(task: AgentTask): boolean {
  return (
    task.documentType === "pptx" &&
    (task.outline?.length ?? 0) > 0 &&
    task.question?.allowFreeform === false &&
    task.question.options.length === 1
  );
}

/**
 * The outline, while it is still free to change.
 *
 * This is the whole argument for stopping here. The gate is the last point
 * where fixing the plan costs nothing — every stage after it rewrites whole
 * pages, and by then a wrong title is three minutes and a regeneration. A gate
 * that can only be approved spends the interruption and buys nothing back,
 * which is what this used to be: three read-only lines and one button.
 *
 * Renaming and dropping are the two edits that pay for the pause. Order is the
 * third and is left for now: it needs a second interaction to be worth having
 * (drag, or a pair of buttons per row in a 320px column), and these two cover
 * what a wrong outline is usually wrong about.
 *
 * Nothing is sent until the approval. Dropping every page is refused rather
 * than silently approved — an empty deck is not a plan, and the runtime reads
 * an empty list as "unchanged", which is the opposite of what the gesture meant.
 */
function OutlineGateCard({
  question,
  pages,
  onApprove,
}: {
  question: NonNullable<AgentTask["question"]>;
  pages: readonly AgentOutlinePage[];
  onApprove: (optionId: string, outline: readonly AgentOutlinePage[]) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<AgentOutlinePage[]>(() => pages.map((page) => ({ ...page })));

  const rename = (slide: number, title: string) =>
    setDraft((current) => current.map((page) => (page.slide === slide ? { ...page, title } : page)));
  const drop = (slide: number) =>
    setDraft((current) => current.filter((page) => page.slide !== slide));

  const option = question.options[0];
  const emptied = draft.length === 0;

  return (
    <div className="shell-task-question" role="group" aria-label={t("shell.task.questionAria")}>
      <strong>{question.text || t("shell.task.questionFallback")}</strong>

      <ol className="shell-task-outline shell-task-outline--editable" aria-label={t("shell.task.gateOutlineAria")}>
        {draft.map((page, index) => (
          <li key={page.slide} className="shell-task-outline-row">
            <span className="shell-task-outline-index">{String(index + 1).padStart(2, "0")}</span>
            <input
              className="shell-task-outline-input"
              value={page.title}
              aria-label={t("shell.task.gateRenameAria", { slide: String(index + 1) })}
              onChange={(event) => rename(page.slide, event.target.value)}
            />
            <button
              type="button"
              className="shell-task-outline-drop"
              aria-label={t("shell.task.gateDropAria", { title: page.title })}
              title={t("shell.task.gateDrop")}
              onClick={() => drop(page.slide)}
            >
              <X size={13} strokeWidth={1.7} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ol>

      {emptied ? <small>{t("shell.task.gateEmpty")}</small> : null}

      <div className="shell-task-question-options">
        <button
          type="button"
          className="shell-task-button is-primary"
          disabled={emptied}
          onClick={() => onApprove(option.id, draft)}
        >
          {option.label}
        </button>
      </div>
    </div>
  );
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

type Translate = ReturnType<typeof useT>;

/** Unfinished pages, when the runtime said enough to count them. */
function unfinishedPages(recovery: NonNullable<AgentTask["recovery"]>): number | null {
  const { readyPages, totalPages } = recovery;
  return readyPages !== undefined && totalPages !== undefined && totalPages > readyPages ? totalPages - readyPages : null;
}

function recoveryLabel(recovery: NonNullable<AgentTask["recovery"]>, t: Translate): string {
  const count = unfinishedPages(recovery);
  return count === null ? t("shell.task.recoveryRetryUnknown") : t("shell.task.recoveryRetry", { count });
}

function RecoveryNote({ recovery, t }: { recovery: NonNullable<AgentTask["recovery"]>; t: Translate }) {
  const { readyPages, totalPages } = recovery;
  // Only a count the runtime reported goes in the sentence.
  const text = readyPages !== undefined && totalPages !== undefined
    ? t("shell.task.recoveryKept", { ready: readyPages, total: totalPages })
    : t("shell.task.recoveryKeptUnknown");
  return <p className="shell-task-recovery">{text}</p>;
}
