import { agentHistoryKey, useAgentHistory, type HistoryCodec } from "../workbench/useAgentHistory";
import { AgentMessage } from "../workbench/AgentMessage";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, ArrowUp, Sheet, Square } from "lucide-react";
import type { DesktopAPI, DesktopTask, GenerateInput, ModifyInput, TaskQuestionAnswer } from "../../shared/types";
import { Button, TextArea } from "../ui";
import "../workbench/agent-panel.css";
import { useT } from "../i18n";
import { QuickReplyQuestion } from "../components/QuickReplyQuestion";
import { MAX_NUMBERED_OPTIONS } from "../constants/limits";

interface SpreadsheetHistoryTurn {
  id: string;
  prompt: string;
  status: DesktopTask["status"];
  detail: string;
}
const spreadsheetHistoryCodec: HistoryCodec<SpreadsheetHistoryTurn> = {
  read: (value) => Array.isArray(value) ? value.filter((item) => item && typeof item.id === "string" && typeof item.prompt === "string" && typeof item.detail === "string" && typeof item.status === "string") : [],
  write: (items) => items,
};

type QuestionDraft = { optionId?: string; answer: string; freeform: string };
export type SpreadsheetAgentTool = string;

const spreadsheetQuestionDrafts = new Map<string, Record<string, QuestionDraft>>();

/** Options stay keyboard-addressable (1–n) only while the set is short enough to scan. */

function questionDraftKey(task: DesktopTask) {
  const questionSetKey = task.question?.questions?.map((item) => item.id || item.question).join("|") || task.question?.id || "question";
  return `${task.id}:${questionSetKey}`;
}

function draftsFromAnswers(answers?: TaskQuestionAnswer[]) {
  const drafts: Record<string, QuestionDraft> = {};
  for (const item of answers ?? []) {
    if (!item.questionId || !item.answer) continue;
    drafts[item.questionId] = {
      optionId: item.optionId,
      answer: item.answer,
      freeform: item.optionId ? "" : item.answer,
    };
  }
  return drafts;
}

export interface SpreadsheetAgentPanelProps {
  preferredTool?: SpreadsheetAgentTool;
  catalogPanel?: React.ReactNode;
  workspaceId?: string;
  artifactPath?: string;
  conversationId?: string;
  sourceTaskId?: string;
  task?: DesktopTask;
  error?: string;
  onGenerate: (input: GenerateInput) => Promise<unknown>;
  onModify: (input: ModifyInput) => Promise<unknown>;
  onRespond: DesktopAPI["respond"];
  onApprovePlan?: (task: DesktopTask) => Promise<unknown>;
  onCancel?: (taskId: string) => Promise<unknown>;
}

export function SpreadsheetAgentPanel({ workspaceId, artifactPath, conversationId, sourceTaskId, task, error, onGenerate, onModify, onRespond, onApprovePlan, onCancel }: SpreadsheetAgentPanelProps) {
  const t = useT();
  const historyKey = agentHistoryKey("xlsx", artifactPath);
  const [history, setHistory] = useAgentHistory(historyKey, spreadsheetHistoryCodec);
  useEffect(() => {
    if (!task) return;
    const turn: SpreadsheetHistoryTurn = {
      id: task.id,
      prompt: task.userInput?.prompt || task.topic || t("spreadsheet.agent.taskTitle"),
      status: task.status,
      detail: [task.plan?.markdown, task.question?.question,
        ...(task.question?.answers ?? []).map((answer) => answer.answer),
        ...(task.stages ?? []).map((stage) => stage.label), task.error].filter(Boolean).join("\n"),
    };
    setHistory((previous) => {
      const existing = previous.find((item) => item.id === turn.id);
      const next = existing ? previous.map((item) => item.id === turn.id ? turn : item) : [...previous, turn];
      // Generated modifications can produce a new file. Carry the transcript to it.
      const outputKey = task.status === "completed" ? agentHistoryKey("xlsx", task.artifact?.filePath) : undefined;
      if (outputKey && outputKey !== historyKey) {
        try {
          const saved = spreadsheetHistoryCodec.read(JSON.parse(localStorage.getItem(outputKey) ?? "[]"));
          const merged = new Map([...saved, ...next].map((item) => [item.id, item]));
          localStorage.setItem(outputKey, JSON.stringify([...merged.values()]));
        }
        catch (error) { console.warn("Could not save Agent history", error); }
      }
      return next;
    });
  }, [task, historyKey, setHistory, t]);
  const previousTurns = history.filter((turn) => turn.id !== task?.id);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [responding, setResponding] = useState(false);
  const [approving, setApproving] = useState(false);
  const [responseError, setResponseError] = useState<string>();
  const [viewedQuestionIndex, setViewedQuestionIndex] = useState(0);
  const [freeformValue, setFreeformValue] = useState("");
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, QuestionDraft>>({});
  const working = task?.status === "starting" || task?.status === "running";
  const needsInput = task?.status === "question";
  const planReview = task?.status === "plan_review";
  const busy = submitting || responding || approving || working || needsInput || planReview;
  const failure = responseError || error || task?.error;
  const questionSet = useMemo(() => {
    if (!task?.question) return [];
    return task.question.questions?.length ? task.question.questions : [task.question];
  }, [task?.question]);
  const activeQuestionIndex = questionSet.length > 0
    ? Math.max(0, Math.min(task?.question?.currentIndex ?? 0, questionSet.length - 1))
    : 0;
  const currentQuestion = questionSet[viewedQuestionIndex];
  const currentDraft = currentQuestion ? questionDrafts[currentQuestion.id] : undefined;
  const viewingActiveQuestion = viewedQuestionIndex === activeQuestionIndex;
  // The one footer composer doubles as the custom-answer field during a question gate.
  const answeringFreeform = needsInput && Boolean(currentQuestion) && currentQuestion?.allowFreeform !== false && viewingActiveQuestion;
  const numberedOptions = Boolean(needsInput && viewingActiveQuestion && currentQuestion && currentQuestion.options.length > 0 && currentQuestion.options.length <= MAX_NUMBERED_OPTIONS);

  useEffect(() => {
    if (!task?.question) return;
    const key = questionDraftKey(task);
    const persisted = draftsFromAnswers(task.question.answers);
    const merged = { ...(spreadsheetQuestionDrafts.get(key) ?? {}), ...persisted };
    spreadsheetQuestionDrafts.set(key, merged);
    setQuestionDrafts(merged);
  }, [task?.id, task?.question?.answers, task?.question?.questions]);

  useEffect(() => {
    if (!task?.question || questionSet.length === 0) return;
    setViewedQuestionIndex(Math.max(0, Math.min(task.question.currentIndex ?? 0, questionSet.length - 1)));
  }, [task?.id, task?.question?.id, task?.question?.currentIndex, questionSet.length]);

  useEffect(() => {
    setFreeformValue(currentDraft?.freeform ?? "");
  }, [currentQuestion?.id, currentDraft?.freeform]);

  const submit = async () => {
    const value = prompt.trim();
    if (!value || busy) return;
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

  const saveQuestionDraft = (questionId: string, draft: QuestionDraft) => {
    if (!task) return questionDrafts;
    const next = { ...questionDrafts, [questionId]: draft };
    spreadsheetQuestionDrafts.set(questionDraftKey(task), next);
    setQuestionDrafts(next);
    return next;
  };

  const answerQuestion = async (optionId?: string, freeformAnswer?: string) => {
    if (!task?.question || !currentQuestion || responding || !viewingActiveQuestion) return;
    const answer = freeformAnswer?.trim() || currentQuestion.options.find((option) => option.id === optionId)?.label || "";
    if (!answer) return;
    const responseQuestionId = task.question.questions?.length ? task.question.id : currentQuestion.id;
    const nextDrafts = saveQuestionDraft(currentQuestion.id, {
      optionId,
      answer,
      freeform: optionId ? "" : answer,
    });
    const answers = questionSet.flatMap((question, index) => {
      const draft = nextDrafts[question.id];
      if (!draft?.answer) return [];
      return [{
        questionGroupId: responseQuestionId,
        questionId: question.id,
        ...(draft.optionId ? { optionId: draft.optionId } : {}),
        answer: draft.answer,
        questionIndex: index,
      }];
    });
    setResponding(true);
    setResponseError(undefined);
    try {
      await onRespond({
        taskId: task.id,
        questionId: responseQuestionId,
        ...(optionId ? { optionId, answer } : { answer }),
        ...(task.question.questions?.length ? { answers } : {}),
      });
    } catch (err) {
      setResponseError(t("spreadsheet.agent.responseFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setResponding(false);
    }
  };

  const submitFreeform = () => void answerQuestion(undefined, freeformValue);

  // Number keys answer from anywhere in the panel except the text fields, so a
  // user reading the question never has to reach for the mouse.
  const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || !numberedOptions || !currentQuestion || responding) return;
    const tag = (event.target as HTMLElement | null)?.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return;
    const index = Number.parseInt(event.key, 10);
    if (!Number.isInteger(index) || index < 1 || index > currentQuestion.options.length) return;
    event.preventDefault();
    void answerQuestion(currentQuestion.options[index - 1].id);
  };

  const approvePlan = async () => {
    if (!task || !onApprovePlan || approving) return;
    setApproving(true);
    setResponseError(undefined);
    try {
      await onApprovePlan(task);
    } catch (err) {
      setResponseError(t("spreadsheet.agent.planApprovalFailed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setApproving(false);
    }
  };

  return (
    <div className="spreadsheet-agent-panel agent-panel" data-has-messages={Boolean(task) || history.length > 0} onKeyDown={handlePanelKeyDown}>
      <div className="spreadsheet-agent-panel__timeline agent-panel__body" aria-live="polite">
        {previousTurns.map((turn) => <div key={turn.id}>
          <AgentMessage role="user">{turn.prompt}</AgentMessage>
          <AgentMessage role="assistant">
            <p>{t(turn.status === "completed" ? "spreadsheet.agent.ready" : turn.status === "failed" ? "spreadsheet.agent.failed" : "spreadsheet.agent.historyRecorded")}</p>
            {turn.detail && <div style={{ whiteSpace: "pre-wrap" }}>{turn.detail}</div>}
          </AgentMessage>
        </div>)}
        {!task && history.length === 0 ? (
          <div className="spreadsheet-agent-panel__welcome">
            <strong>{artifactPath ? t("spreadsheet.agent.modifyTitle") : t("spreadsheet.agent.createTitle")}</strong>
            <p>{artifactPath ? t("spreadsheet.agent.modifyBody") : t("spreadsheet.agent.createBody")}</p>
          </div>
        ) : task ? (
          <AgentMessage role="user">{task.userInput?.prompt || task.topic || t("spreadsheet.agent.taskTitle")}</AgentMessage>
        ) : null}
        {task && <AgentMessage role="assistant">
          <div className="spreadsheet-agent-panel__task" data-status={task.status}>
            {working ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : task.status === "completed" ? <CheckCircle2 aria-hidden="true" /> : <AlertCircle aria-hidden="true" />}
            <div>
              <span>{task.status === "completed" ? t("spreadsheet.agent.ready") : task.status === "failed" ? t("spreadsheet.agent.failed") : needsInput ? t("spreadsheet.agent.needsInput") : planReview ? t("spreadsheet.agent.planReview") : t("spreadsheet.agent.running")}</span>
            </div>
          </div>
        {needsInput && currentQuestion ? (
          <QuickReplyQuestion
            key={currentQuestion.id}
            className="spreadsheet-agent-panel__question"
            question={currentQuestion.question}
            options={currentQuestion.options}
            selectedOptionId={currentDraft?.optionId}
            freeformDraft={viewingActiveQuestion ? freeformValue : ""}
            allowFreeform={currentQuestion.allowFreeform !== false}
            responding={responding}
            readOnly={!viewingActiveQuestion}
            navigation={questionSet.length > 1 ? {
              progress: t("spreadsheet.agent.questionProgress", { current: viewedQuestionIndex + 1, total: questionSet.length }),
              previousLabel: t("spreadsheet.agent.previousQuestion"),
              nextLabel: t("spreadsheet.agent.nextQuestion"),
              previousDisabled: viewedQuestionIndex === 0 || responding,
              nextDisabled: viewedQuestionIndex >= activeQuestionIndex || responding,
              onPrevious: () => setViewedQuestionIndex((index) => Math.max(0, index - 1)),
              onNext: () => setViewedQuestionIndex((index) => Math.min(activeQuestionIndex, index + 1)),
            } : undefined}
            onSelect={(optionId) => void answerQuestion(optionId)}
          />
        ) : planReview ? (
          <section className="spreadsheet-agent-panel__plan" aria-label={t("spreadsheet.agent.planReview")}>
            <span>{t("spreadsheet.agent.planReview")}</span>
            <strong>{t("spreadsheet.agent.planTitle")}</strong>
            <pre>{task?.plan?.markdown || t("spreadsheet.agent.planFallback")}</pre>
            <div className="spreadsheet-agent-panel__plan-actions">
              {onCancel && task?.id ? (
                <Button size="small" variant="secondary" icon={<Square />} disabled={approving} onClick={() => void onCancel(task.id)}>
                  {t("spreadsheet.agent.cancel")}
                </Button>
              ) : null}
              <Button size="small" variant="primary" loading={approving} disabled={!onApprovePlan} onClick={() => void approvePlan()}>
                {t("spreadsheet.agent.approvePlan")}
              </Button>
            </div>
          </section>
        ) : task?.stages?.length ? (
          <ol className="spreadsheet-agent-panel__stages">
            {task.stages.map((stage) => <li key={stage.id} data-status={stage.status}>{stage.label}</li>)}
          </ol>
        ) : null}
        {failure ? <div className="spreadsheet-agent-panel__error" role="alert">{failure}</div> : null}
        </AgentMessage>}
        {!task && failure ? <div className="spreadsheet-agent-panel__error" role="alert">{failure}</div> : null}
      </div>
      {!planReview ? <div className={["spreadsheet-agent-panel__composer agent-compose-box", needsInput ? "spreadsheet-agent-panel__composer--answer" : ""].filter(Boolean).join(" ")}>
        {needsInput ? (
          <TextArea
            aria-label={t("spreadsheet.agent.customAnswerAria")}
            value={freeformValue}
            rows={2}
            placeholder={answeringFreeform ? t("spreadsheet.agent.customAnswerPlaceholder") : t("spreadsheet.agent.pickOptionPlaceholder")}
            disabled={!answeringFreeform || responding}
            onChange={(event) => {
              const value = event.target.value;
              setFreeformValue(value);
              if (currentQuestion) saveQuestionDraft(currentQuestion.id, { answer: value.trim(), freeform: value });
            }}
            onSubmit={submitFreeform}
          />
        ) : (
          <TextArea
            aria-label={artifactPath ? t("spreadsheet.agent.modifyAria") : t("spreadsheet.agent.generateAria")}
            value={prompt}
            rows={3}
            placeholder={artifactPath ? t("spreadsheet.agent.modifyPlaceholder") : t("spreadsheet.agent.generatePlaceholder")}
            onChange={(event) => setPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                event.preventDefault();
                void submit();
              }
            }}
          />
        )}
        <div className="spreadsheet-agent-panel__composer-actions agent-composer-actions">
          {!needsInput && <span className="agent-panel__scope"><Sheet size={14} aria-hidden="true" /><span>{t(artifactPath ? "spreadsheet.agent.scopeWorkbook" : "spreadsheet.agent.scopeNewWorkbook")}</span></span>}
          {numberedOptions && currentQuestion ? <span className="spreadsheet-agent-panel__composer-hint">{t(answeringFreeform ? "spreadsheet.agent.answerHint" : "spreadsheet.agent.answerHintKeysOnly", { n: currentQuestion.options.length })}</span> : null}
          {(working || needsInput) && task?.id && onCancel ? (
            <Button size="small" variant={needsInput ? "ghost-normal" : "secondary"} icon={needsInput ? undefined : <Square />} disabled={responding} onClick={() => void onCancel(task.id)}>
              {t("spreadsheet.agent.cancel")}
            </Button>
          ) : null}
          {needsInput ? (
            <Button className="od-button--icon-submit" size="small" variant="primary" ariaLabel={t("spreadsheet.agent.submitAnswer")} title={t("spreadsheet.agent.submitAnswer")} icon={<ArrowUp />} loading={responding} disabled={!answeringFreeform || !freeformValue.trim()} onClick={submitFreeform} />
          ) : (
            <Button className="od-button--icon-submit" size="small" variant="primary" ariaLabel={artifactPath ? t("spreadsheet.agent.modify") : t("spreadsheet.agent.generate")} title={artifactPath ? t("spreadsheet.agent.modify") : t("spreadsheet.agent.generate")} icon={<ArrowUp />} loading={submitting} disabled={!prompt.trim() || busy} onClick={() => void submit()} />
          )}
        </div>
      </div> : null}
    </div>
  );
}
