import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useT } from "../../renderer/i18n";
import type { Agent } from "../agent/AgentContext";
import { DexFace } from "../dex/DexFace";
import { formatDateTime, formatElapsed } from "../kit/format";
import { FileIcon, Icon, extensionOf, type IconName } from "../kit/Icon";
import { closeModal, openModal } from "../kit/layers";
import { useLibraryActions } from "../nav/useLibraryActions";
import { notBuiltYet } from "../port/reportPortFailure";
import { OUTLINE_GATE_KIND, type AgentOutlinePage, type AgentStep, type AgentTask, type FileMeta } from "../../shared/uiPort";
import { useComposerSettings } from "../composer/useComposerSettings";
import { useShell } from "../state/ShellContext";
import { RUN_DATA_STATUS, RUN_TITLE_KEY, isRunning, runStateOf, type RunState } from "./runState";
import { useReconnect } from "../pages/OfflineBanner";
import { useOnline } from "../state/useOnline";

type Translate = ReturnType<typeof useT>;

/**
 * Which disclosure the user opened or closed, by task. Module state, so a task
 * update — which re-renders the whole conversation — keeps the user's choice
 * instead of snapping Progress open again (AGENT-STATE-STANDARD §05).
 */
const progressChoice = new Map<string, boolean>();
const stepChoice = new Map<string, boolean>();

const STATUS_ICON: Record<RunState, IconName | "spinner"> = {
  queued: "Clock3",
  planning: "spinner",
  reading: "spinner",
  working: "spinner",
  checking: "spinner",
  input: "Clock3",
  review: "Clock3",
  complete: "CircleCheck",
  stopped: "Pause",
  failed: "CircleHelp",
  partial: "CircleHelp",
  offline: "CircleHelp",
};

function summaryOf(state: RunState, task: AgentTask, artifact: FileMeta | null, t: Translate): string {
  switch (state) {
    case "queued":
      return t("dx.run.summary.queued");
    case "input":
      return t("dx.run.summary.input");
    case "review":
      return t("dx.run.summary.review");
    case "complete":
      if (artifact) return t("dx.run.summary.fileReady");
      if (task.suggestion?.applied) return t("dx.run.summary.applied");
      return t("dx.run.summary.finished");
    case "failed":
    case "partial":
    case "offline":
    case "stopped":
      return (
        task.error ||
        t(
          state === "stopped"
            ? "dx.run.summary.stopped"
            : state === "offline"
              ? "dx.run.summary.offline"
              : state === "partial"
                ? "dx.run.summary.partial"
                : "dx.run.summary.attention",
        )
      );
    case "planning":
      return t("dx.run.summary.planning");
    case "reading":
      return t("dx.run.summary.reading");
    case "working":
      return t("dx.run.summary.working");
    case "checking":
      return t("dx.run.summary.checking");
  }
}

const isOutlineGate = (task: AgentTask): boolean => {
  if (task.documentType !== "pptx" || (task.outline?.length ?? 0) === 0 || !task.question) return false;
  if (task.question.kind === OUTLINE_GATE_KIND) return true;
  return task.question.allowFreeform === false && task.question.options.length === 1;
};

/**
 * One run, as the conversation shows it — AGENT-STATE-STANDARD §02.
 *
 * Author and elapsed time; the state in words with its symbol; one sentence of
 * what is being done; Progress (n of m steps, expandable); a question when the
 * run is blocked on one; the files it produced; then the actions that are
 * valid right now, and Details.
 *
 * Nothing here is a bare spinner, and nothing claims more than the task
 * reports: there is no percentage and no time remaining, because the runtime
 * gives neither (§05).
 */
export function AgentRun({ task, agent }: { task: AgentTask; agent: Agent }) {
  const t = useT();
  const { files, dispatch } = useShell();
  const library = useLibraryActions();
  const settings = useComposerSettings();
  const state = runStateOf(task);
  const running = isRunning(state);
  const [, tick] = useState(0);

  // The clock moves once a second while the run does, and not otherwise.
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  const artifact = useMemo(() => files.find((file) => file.artifactTaskId === task.id) ?? null, [files, task.id]);
  const reviewTarget = useMemo(
    () => (task.suggestion ? (files.find((file) => file.id === task.suggestion!.targetFileId) ?? null) : null),
    [files, task.suggestion],
  );

  if (!state) return null;

  const steps = task.steps;
  const done = steps.filter((step) => step.state === "done").length;
  const expanded = progressChoice.has(task.id) ? progressChoice.get(task.id)! : running;
  const icon = STATUS_ICON[state];
  const elapsed =
    task.startedAt !== undefined ? formatElapsed((task.finishedAt ?? Date.now()) - task.startedAt) : "";

  const retry = () => {
    if (task.recovery) {
      void agent.resumeFailed(task.id);
      return;
    }
    const request = [...task.messages].reverse().find((message) => message.role === "user");
    if (!request) return;
    void agent.send({
      text: request.text,
      folderId: task.folderId,
      mentions: [],
      attachments: [],
      activeFileId: null,
      ...(request.reference ? { reference: request.reference } : {}),
      ...(task.documentType ? { documentType: task.documentType } : {}),
    });
  };

  const review = () => {
    if (!task.suggestion) return;
    const suggestion = task.suggestion;
    openModal({
      title: t("dx.review.title"),
      className: "wide",
      render: () => (
        <>
          <p>{task.title}</p>
          <section className="dx-plan-card dx-review-card">
            <div className="dx-row">
              {reviewTarget ? <FileIcon ext={extensionOf(reviewTarget)} /> : null}
              <strong>{reviewTarget?.name ?? t("shell.task.theFile")}</strong>
              <span className="dx-pill dx-end">{t(suggestion.applied ? "dx.review.applied" : "dx.status.review")}</span>
            </div>
            <p className="dx-helper">{suggestion.summary}</p>
            <div className="dx-actions">
              {suggestion.applied ? (
                <button
                  type="button"
                  className="dx-btn"
                  data-act="undo-change"
                  disabled={!suggestion.undoable}
                  onClick={() => {
                    closeModal();
                    void agent.undoSuggestion(suggestion.id);
                  }}
                >
                  {t("dx.run.undo")}
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className="dx-btn"
                    data-act="reject-change"
                    onClick={() => notBuiltYet("agent.rejectSuggestion", t("dx.notBuilt.reject"))}
                  >
                    {t("dx.review.reject")}
                  </button>
                  <button
                    type="button"
                    className="dx-btn dx-primary"
                    data-act="apply-change"
                    onClick={() => {
                      closeModal();
                      void agent.applySuggestion(suggestion.id);
                    }}
                  >
                    {t("dx.review.apply")}
                  </button>
                </>
              )}
            </div>
          </section>
          <div className="dx-form-actions">
            <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
              {t("dx.action.close")}
            </button>
          </div>
        </>
      ),
    });
  };

  const details = () =>
    openModal({
      title: t("dx.run.detailsTitle"),
      render: () => (
        <>
          <dl className="dx-definition">
            <dt>{t("dx.file.status")}</dt>
            <dd>{t(RUN_TITLE_KEY[state])}</dd>
            <dt>{t("dx.composer.model")}</dt>
            <dd>
              {settings.models.find((model) => model.id === settings.value.selectedModelId)?.name ??
                t("settings.about.productName")}
            </dd>
            <dt>{t("dx.run.started")}</dt>
            <dd>{task.startedAt ? formatDateTime(task.startedAt) : "—"}</dd>
            <dt>{t("dx.run.attempts")}</dt>
            <dd>{task.attempt ?? 1}</dd>
            <dt>{t("dx.run.files")}</dt>
            <dd>{[artifact?.name, reviewTarget?.name].filter(Boolean).join(", ") || t("dx.run.newResult")}</dd>
          </dl>
          {task.error ? <p className="dx-error">{task.error}</p> : null}
          <div className="dx-actions">
            <button
              type="button"
              className="dx-btn"
              data-act="settings"
              onClick={() => {
                closeModal();
                dispatch({ type: "go", page: "settings", section: "models" });
              }}
            >
              {t("dx.run.models")}
            </button>
          </div>
        </>
      ),
    });

  const gate = task.question && isOutlineGate(task);
  const online = useOnline();
  const onReconnect = useReconnect();
  const canRetry = state === "failed" || state === "partial" || state === "offline" || state === "stopped";
  // The row is drawn only when it has something in it: an empty one still takes its gap.
  const hasActions =
    running || state === "queued" || canRetry || task.failureKind === "model" || Boolean(task.suggestion);

  return (
    <article
      className="dx-task-card dx-agent-run"
      data-task={task.id}
      data-status={RUN_DATA_STATUS[state]}
      aria-label={`${t(RUN_TITLE_KEY[state])}: ${task.title}`}
    >
      <div className="dx-agent-run-heading">
        <DexFace variant="tiny" />
        <strong>{t("settings.about.productName")}</strong>
        <span className="dx-agent-elapsed" data-elapsed={task.id} aria-hidden="true">
          {elapsed}
        </span>
      </div>
      <div className="dx-agent-run-status" role="status">
        {icon === "spinner" ? <span className="dx-spinner" /> : <Icon name={icon} />}
        <span>{t(RUN_TITLE_KEY[state])}</span>
        {(task.attempt ?? 1) > 1 ? <small>{t("dx.run.attempt", { count: task.attempt ?? 1 })}</small> : null}
      </div>
      <p className="dx-agent-summary">{summaryOf(state, task, artifact, t)}</p>

      {steps.length > 0 ? (
        <details
          className="dx-agent-process"
          data-agent-progress={task.id}
          open={expanded}
          onToggle={(event) => progressChoice.set(task.id, event.currentTarget.open)}
        >
          <summary>
            <Icon name="ChevronRight" size={14} />
            <span>{t("dx.run.progress")}</span>
            <small>{t("dx.run.stepCount", { done, total: steps.length })}</small>
          </summary>
          <ol className="dx-agent-steps" aria-busy={running}>
            {steps.map((step) => (
              <StepRow key={step.id} task={task} step={step} running={running} state={state} artifact={artifact} />
            ))}
          </ol>
        </details>
      ) : null}

      {task.outline && task.outline.length > 0 && !gate ? <Pages task={task} running={running} /> : null}

      {task.question ? (
        gate ? (
          <OutlineGate
            question={task.question}
            pages={task.outline ?? []}
            onApprove={(optionId, outline) => void agent.answer({ optionId, outline })}
            onStop={() => void agent.stop()}
          />
        ) : (
          <Question task={task} agent={agent} />
        )
      ) : null}

      {task.recovery ? <p className="dx-metadata">{recoveryNote(task, t)}</p> : null}

      {artifact || (task.suggestion && reviewTarget) ? (
        <div className="dx-agent-results" aria-label={t("dx.run.results")}>
          {task.suggestion && reviewTarget ? (
            <button type="button" className="dx-agent-result" data-act="review-task" data-id={task.id} onClick={review}>
              <FileIcon ext={extensionOf(reviewTarget)} size={24} />
              <span>
                <strong>{reviewTarget.name}</strong>
                <small>{t(task.suggestion.applied ? "dx.run.changesApplied" : "dx.run.changesReady")}</small>
              </span>
              <Icon name="ChevronRight" size={16} />
            </button>
          ) : null}
          {artifact ? (
            <button
              type="button"
              className="dx-agent-result"
              data-act="open-file"
              data-id={artifact.id}
              onClick={() => void library.openFile(artifact.id)}
            >
              <FileIcon ext={extensionOf(artifact)} size={24} />
              <span>
                <strong>{artifact.name}</strong>
                <small>{t("dx.run.readyToOpen")}</small>
              </span>
              <Icon name="ArrowUpRight" size={16} />
            </button>
          ) : null}
        </div>
      ) : null}

      {hasActions ? (
      <div className="dx-actions dx-agent-run-actions">
        {running || state === "queued" ? (
          <button type="button" className="dx-btn" data-act="task-stop" data-id={task.id} onClick={() => void agent.stop()}>
            {t(state === "queued" ? "dx.action.cancel" : "dx.run.stop")}
          </button>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            className="dx-btn dx-primary"
            data-act="task-retry"
            data-id={task.id}
            onClick={() => (task.status === "paused" ? void agent.resume() : retry())}
          >
            {t(state === "stopped" ? "dx.run.resume" : state === "partial" ? "dx.run.retryRemaining" : "dx.run.retry")}
          </button>
        ) : null}
        {state === "offline" && !online ? (
          <button type="button" className="dx-btn" data-act="reconnect" onClick={onReconnect}>
            {t("dx.offline.reconnect")}
          </button>
        ) : null}
        {task.failureKind === "model" ? (
          <button
            type="button"
            className="dx-btn"
            data-act="settings"
            data-id="models"
            onClick={() => dispatch({ type: "go", page: "settings", section: "models" })}
          >
            {t("dx.run.models")}
          </button>
        ) : null}
        {task.suggestion && !task.suggestion.applied ? (
          <button
            type="button"
            className={state === "review" ? "dx-btn dx-primary" : "dx-btn"}
            data-act="review-task"
            data-id={task.id}
            onClick={review}
          >
            {t("dx.run.reviewAction")}
          </button>
        ) : null}
        {task.suggestion?.applied ? (
          <button
            type="button"
            className="dx-btn"
            data-act="undo-task"
            data-id={task.id}
            disabled={!task.suggestion.undoable}
            onClick={() => void agent.undoSuggestion(task.suggestion!.id)}
          >
            {t("dx.run.undo")}
          </button>
        ) : null}
      </div>
      ) : null}
      <button type="button" className="dx-agent-details" data-act="task-details" data-id={task.id} onClick={details}>
        {t("dx.run.details")}
      </button>
    </article>
  );
}

function recoveryNote(task: AgentTask, t: Translate): string {
  const { readyPages, totalPages } = task.recovery ?? {};
  return readyPages !== undefined && totalPages !== undefined
    ? t("shell.task.recoveryKept", { ready: readyPages, total: totalPages })
    : t("shell.task.recoveryKeptUnknown");
}

function StepRow({
  task,
  step,
  running,
  state,
  artifact,
}: {
  task: AgentTask;
  step: AgentStep;
  running: boolean;
  state: RunState;
  artifact: FileMeta | null;
}) {
  const t = useT();
  const library = useLibraryActions();
  const key = `${task.id}-${step.id}`;
  const active = step.state === "active";
  const isDone = step.state === "done";
  // An active step of a run that is no longer running did not finish.
  const halted = active && !running;
  const stepState = isDone ? "completed" : active ? (running ? "running" : state === "stopped" ? "stopped" : "failed") : "pending";
  const label = (() => {
    const translated = t(`shell.task.step.${step.id}`);
    return translated === `shell.task.step.${step.id}` ? step.label : translated;
  })();
  const note = isDone
    ? t("dx.run.stepDone")
    : active
      ? running
        ? task.phase && task.phase !== label
          ? task.phase
          : t("dx.run.stepRunning")
        : task.error || t("dx.run.stepHalted")
      : t("dx.run.stepPending");

  return (
    <li className="dx-agent-step" data-step-state={stepState}>
      <span
        className="dx-step-indicator"
        aria-label={t(
          active && running ? "dx.run.aria.inProgress" : isDone ? "dx.run.aria.complete" : halted ? "dx.run.aria.attention" : "dx.run.aria.pending",
        )}
      >
        {active && running ? <span className="dx-spinner" /> : <Icon name={isDone ? "Check" : halted ? "CircleHelp" : "Clock3"} />}
      </span>
      <details
        className="dx-agent-tool"
        data-agent-step={key}
        open={stepChoice.get(key) ?? false}
        onToggle={(event) => stepChoice.set(key, event.currentTarget.open)}
      >
        <summary>
          <span>{label}</span>
          <Icon name="ChevronRight" size={12} />
        </summary>
        <div className="dx-agent-tool-detail">
          <p>{note}</p>
          {isDone && artifact && step === task.steps.at(-1) ? (
            <button type="button" className="dx-agent-scope-file" data-act="open-file" data-id={artifact.id} onClick={() => void library.openFile(artifact.id)}>
              <FileIcon ext={extensionOf(artifact)} size={16} />
              <span>{artifact.name}</span>
              <Icon name="ArrowUpRight" size={12} />
            </button>
          ) : null}
        </div>
      </details>
    </li>
  );
}

/**
 * The pages a deck run is writing, as a second Progress list. The runtime
 * reports a state per page; the list says which page and how it is doing, and
 * the deck itself is in the content region to read.
 */
function Pages({ task, running }: { task: AgentTask; running: boolean }) {
  const t = useT();
  const pages = task.outline ?? [];
  const key = `${task.id}:pages`;
  const ready = pages.filter((page) => page.state === "ready").length;
  return (
    <details
      className="dx-agent-process"
      data-agent-progress={key}
      open={progressChoice.get(key) ?? false}
      onToggle={(event) => progressChoice.set(key, event.currentTarget.open)}
    >
      <summary>
        <Icon name="ChevronRight" size={14} />
        <span>{t("dx.run.pages")}</span>
        <small>{t("dx.run.pageCount", { done: ready, total: pages.length })}</small>
      </summary>
      <ol className="dx-agent-steps" aria-busy={running} aria-label={t("shell.task.outlineAria")}>
        {pages.map((page) => (
          <li key={page.slide} className="dx-agent-step" data-step-state={pageStepState(page)}>
            <span className="dx-step-indicator" aria-label={t(pageAria(page))}>
              {page.state === "generating" || page.state === "repairing" ? (
                <span className="dx-spinner" />
              ) : (
                <Icon name={page.state === "ready" ? "Check" : page.state === "failed" || page.state === "canceled" ? "CircleHelp" : "Clock3"} />
              )}
            </span>
            <div className="dx-agent-tool dx-agent-page">
              <span>
                {String(page.slide).padStart(2, "0")} · {page.title}
              </span>
            </div>
          </li>
        ))}
      </ol>
    </details>
  );
}

const pageStepState = (page: AgentOutlinePage) =>
  page.state === "ready"
    ? "completed"
    : page.state === "generating" || page.state === "repairing"
      ? "running"
      : page.state === "failed"
        ? "failed"
        : page.state === "canceled"
          ? "stopped"
          : "pending";

const pageAria = (page: AgentOutlinePage) =>
  page.state === "ready"
    ? "shell.task.pageReady"
    : page.state === "generating"
      ? "shell.task.pageWriting"
      : page.state === "repairing"
        ? "shell.task.pageRetrying"
        : page.state === "failed"
          ? "shell.task.pageFailed"
          : page.state === "canceled"
            ? "shell.task.pageStopped"
            : "shell.task.pageQueued";

/**
 * Needs input — AGENT-STATE-STANDARD §06.
 *
 * One question, the one that is actually blocking. The suggested answers fill
 * the field and can still be edited; Continue is what submits, and an empty
 * answer does not. The answer goes to the run that asked, not to a new one.
 */
function Question({ task, agent }: { task: AgentTask; agent: Agent }) {
  const t = useT();
  const question = task.question!;
  // The answer the runtime recommends starts picked, which is how it is shown:
  // on a plan that would overwrite something that answer is "cancel", and the
  // user should have to move off it on purpose.
  const recommended = question.options.find((option) => option.recommended) ?? null;
  const [answer, setAnswer] = useState(recommended?.label ?? "");
  const [picked, setPicked] = useState<string | null>(recommended?.id ?? null);
  const [error, setError] = useState("");
  const inputId = `dx-agent-answer-${task.id}`;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = answer.trim();
    const option = picked ? question.options.find((entry) => entry.id === picked) : undefined;
    if (option && (!question.allowFreeform || text === option.label)) {
      void agent.answer({ optionId: option.id });
      return;
    }
    if (!text) {
      setError(t("dx.run.answerRequired"));
      return;
    }
    if (!question.allowFreeform) {
      setError(t("shell.service.question.pickOption"));
      return;
    }
    void agent.answer({ text });
  };

  return (
    <form className="dx-agent-question" data-form="task-input" data-id={task.id} onSubmit={submit}>
      <label htmlFor={inputId}>{question.text || t("shell.task.questionFallback")}</label>
      {question.options.length > 0 ? (
        <div className="dx-agent-answer-options" role="group" aria-label={t("dx.run.suggestedAnswers")}>
          {question.options.map((option) => (
            <button
              key={option.id}
              type="button"
              data-act="agent-answer"
              aria-pressed={picked === option.id}
              title={option.description ?? option.label}
              onClick={() => {
                setPicked(option.id);
                setAnswer(option.label);
                setError("");
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
      {question.allowFreeform ? (
        <input
          id={inputId}
          name="answer"
          data-agent-answer={task.id}
          value={answer}
          placeholder={t(question.options.length > 0 ? "dx.run.answerPlaceholderOr" : "dx.run.answerPlaceholder")}
          maxLength={500}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setAnswer(event.target.value);
            setPicked(null);
            setError("");
          }}
        />
      ) : (
        <input id={inputId} type="hidden" name="answer" value={answer} readOnly />
      )}
      {error ? (
        <p className="dx-status-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dx-actions">
        <button type="submit" className="dx-btn dx-primary">
          {t("dx.run.continue")}
        </button>
        <button type="button" className="dx-btn" data-act="task-stop" data-id={task.id} onClick={() => void agent.stop()}>
          {t("dx.run.stop")}
        </button>
      </div>
    </form>
  );
}

/**
 * The deck's outline, while it is still free to change.
 *
 * The one blocking stop a presentation run makes. It is the last point where
 * fixing the plan costs nothing, so the pages can be renamed and dropped here
 * and nothing is sent until the approval. Dropping every page is refused: an
 * empty list is not a plan.
 */
function OutlineGate({
  question,
  pages,
  onApprove,
  onStop,
}: {
  question: NonNullable<AgentTask["question"]>;
  pages: readonly AgentOutlinePage[];
  onApprove: (optionId: string, outline: readonly AgentOutlinePage[]) => void;
  onStop: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<AgentOutlinePage[]>(() => pages.map((page) => ({ ...page })));
  const option = question.options[0];
  const emptied = draft.length === 0;

  return (
    <form
      className="dx-agent-question"
      data-gate="outline"
      aria-label={t("shell.task.questionAria")}
      onSubmit={(event) => {
        event.preventDefault();
        if (!emptied && option) onApprove(option.id, draft);
      }}
    >
      <label>{question.text || t("shell.task.questionFallback")}</label>
      <ol className="dx-agent-outline" aria-label={t("shell.task.gateOutlineAria")}>
        {draft.map((page, index) => (
          <li key={page.slide}>
            <span className="dx-metadata">{String(index + 1).padStart(2, "0")}</span>
            <input
              value={page.title}
              aria-label={t("shell.task.gateRenameAria", { slide: String(index + 1) })}
              onChange={(event) =>
                setDraft((current) =>
                  current.map((entry) => (entry.slide === page.slide ? { ...entry, title: event.target.value } : entry)),
                )
              }
            />
            <button
              type="button"
              className="dx-ib"
              aria-label={t("shell.task.gateDropAria", { title: page.title })}
              title={t("shell.task.gateDrop")}
              onClick={() => setDraft((current) => current.filter((entry) => entry.slide !== page.slide))}
            >
              <Icon name="X" />
            </button>
          </li>
        ))}
      </ol>
      {emptied ? <p className="dx-status-error">{t("shell.task.gateEmpty")}</p> : null}
      <div className="dx-actions">
        <button type="submit" className="dx-btn dx-primary" disabled={emptied}>
          {option?.label ?? t("dx.run.continue")}
        </button>
        <button type="button" className="dx-btn" data-act="task-stop" onClick={onStop}>
          {t("dx.run.stop")}
        </button>
      </div>
    </form>
  );
}
