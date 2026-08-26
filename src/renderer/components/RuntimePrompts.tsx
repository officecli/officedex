import { useCallback, useEffect, useState } from "react";
import { Button, Input } from "../ui";
import type { AgentRun } from "../../shared/types";
import { officecli } from "../bridge";
import { isClientToolForThisHost, pendingAgentClientToolEvents, resumeAgentClientTools } from "../AgentClientToolHost";
import { agentClientId } from "../agentClientIdentity";
import { useT } from "../i18n";
import { isWaitingOnUser } from "../runtimeRuns";
import { recordValue, trimmedStringValue as stringValue } from "../utils/values";

const AGENT_RUN_FETCH_LIMIT = 500;

interface PendingRuntimeAction { requestId: string }
interface PendingRuntimeInput extends PendingRuntimeAction { question: string; defaultValue: string; options: string[] }
interface PendingRuntimeApproval extends PendingRuntimeAction { details: Array<[string, string]> }

type RuntimeInteraction =
  | { kind: "input"; run: AgentRun; pending: PendingRuntimeInput }
  | { kind: "approval"; run: AgentRun; pending: PendingRuntimeApproval; approved: boolean };

export function pendingRuntimeInput(run: AgentRun): PendingRuntimeInput | undefined {
  const event = [...(run.events || [])].reverse().find((candidate) => candidate.type === "input.requested");
  const payload = recordValue(event?.payload);
  const request = recordValue(payload.request);
  const requestId = stringValue(payload.request_id) || event?.request_id || "";
  if (!requestId) return undefined;
  const question = stringValue(request.question) || "Runtime needs more information.";
  const rawOptions = Array.isArray(request.options) ? request.options.map(stringValue).filter(Boolean) : [];
  const current = recordValue(request.current);
  const currentOptions = Array.isArray(current.Options) ? current.Options.map(recordValue) : [];
  const recommended = currentOptions.find((option) => option.Recommended === true) || currentOptions[0];
  const options = currentOptions.map((option) => stringValue(option.Label)).filter(Boolean);
  const displayOptions = options.length > 0 ? options : rawOptions;
  const defaultValue = stringValue(recommended?.Label) || displayOptions[0] || "";
  return { requestId, question, defaultValue, options: displayOptions };
}

export function pendingRuntimeApproval(run: AgentRun): PendingRuntimeApproval | undefined {
  const event = [...(run.events || [])].reverse().find((candidate) => candidate.type === "approval.requested");
  const payload = recordValue(event?.payload);
  const requestId = stringValue(payload.request_id) || event?.request_id || "";
  if (!requestId) return undefined;
  const request = recordValue(payload.request);
  const details = [["Tool", stringValue(request.tool)], ["Risk", stringValue(request.risk)], ["Resource", stringValue(request.resource_ref)]]
    .filter((entry): entry is [string, string] => Boolean(entry[1]));
  return { requestId, details };
}

/**
 * Workflow runs blocked on the user, rendered wherever the user's inbox lives.
 * A run waiting on an answer is the same kind of work as a task question, so it
 * must not be reachable only from a diagnostics surface.
 */
export function RuntimePrompts({ onCountChange }: { onCountChange?: (count: number) => void }) {
  const t = useT();
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [error, setError] = useState<string>();
  const [busyRun, setBusyRun] = useState<string>();
  const [interaction, setInteraction] = useState<RuntimeInteraction>();
  const [inputValue, setInputValue] = useState("");

  const refresh = useCallback(async () => {
    try {
      setRuns(await officecli.listAgentRuns(AGENT_RUN_FETCH_LIMIT));
      setError(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 4_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const waiting = runs.filter(isWaitingOnUser);
  useEffect(() => { onCountChange?.(waiting.length); }, [waiting.length, onCountChange]);

  const openInput = (run: AgentRun) => {
    const pending = pendingRuntimeInput(run);
    if (!pending) { setError(t("tasks.runtime.input.missing")); return; }
    setError(undefined);
    setInputValue(pending.defaultValue);
    setInteraction({ kind: "input", run, pending });
  };

  const openApproval = (run: AgentRun, approved: boolean) => {
    const pending = pendingRuntimeApproval(run);
    if (!pending) { setError(t("tasks.runtime.approval.missing")); return; }
    setError(undefined);
    setInteraction({ kind: "approval", run, pending, approved });
  };

  // Take over a call whose original page is gone. Reassignment stays explicit
  // and user-initiated: automatic fallback to "whichever page is listening" is
  // what let a write land in a stale tab's workbook.
  const takeOverClientTools = async (run: AgentRun) => {
    setBusyRun(run.id);
    setError(undefined);
    try {
      for (const event of pendingAgentClientToolEvents(run)) {
        const callId = String((event.payload as Record<string, unknown> | undefined)?.call_id ?? "").trim();
        if (!callId || isClientToolForThisHost(run, callId)) continue;
        await officecli.reassignAgentClientTool({ run_id: run.id, call_id: callId, to_client_id: agentClientId(), reason: "Taken over from the home inbox" });
      }
      const refreshed = await officecli.getAgentRun(run.id);
      if (!await resumeAgentClientTools(refreshed)) setError(t("tasks.runtime.clientTool.deferred"));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRun(undefined);
    }
  };

  const resumeClientTools = async (run: AgentRun) => {
    setBusyRun(run.id);
    setError(undefined);
    try {
      if (!await resumeAgentClientTools(run)) setError(t("tasks.runtime.clientTool.deferred"));
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRun(undefined);
    }
  };

  const submit = async () => {
    if (!interaction) return;
    if (interaction.kind === "input" && !inputValue.trim()) return;
    setBusyRun(interaction.run.id);
    setError(undefined);
    try {
      if (interaction.kind === "input") {
        await officecli.respondAgentRun({ run_id: interaction.run.id, request_id: interaction.pending.requestId, value: inputValue.trim() });
      } else {
        await officecli.approveAgentRun({
          run_id: interaction.run.id,
          request_id: interaction.pending.requestId,
          approved: interaction.approved,
          reason: interaction.approved ? "Approved in OfficeDex" : "Rejected in OfficeDex",
        });
      }
      setInteraction(undefined);
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusyRun(undefined);
    }
  };

  if (waiting.length === 0 && !error) return null;

  return (
    <>
      {waiting.map((run) => {
        const input = run.status === "waiting_input" ? pendingRuntimeInput(run) : undefined;
        const approval = run.status === "waiting_approval" ? pendingRuntimeApproval(run) : undefined;
        const tool = approval?.details.find(([label]) => label === "Tool")?.[1];
        const title = input?.question ?? (tool ? t("tasks.attention.approveTool", { tool }) : t("tasks.attention.needsTool"));
        const forAnotherHost = pendingAgentClientToolEvents(run).some((event) => {
          const callId = String((event.payload as Record<string, unknown> | undefined)?.call_id ?? "").trim();
          return callId !== "" && !isClientToolForThisHost(run, callId);
        });
        return (
          <div className="home-attention-row home-attention-row--runtime" key={run.id}>
            <span className="home-attention-dot" aria-hidden="true" />
            <strong>{title}</strong>
            <span title={run.id}>{run.workflow}</span>
            <span className="home-attention-actions">
              {run.status === "waiting_input" ? (
                <Button size="small" type="primary" loading={busyRun === run.id} onClick={() => openInput(run)}>{t("tasks.runtime.continue")}</Button>
              ) : null}
              {run.status === "waiting_approval" ? (
                <>
                  <Button size="small" type="primary" loading={busyRun === run.id} onClick={() => openApproval(run, true)}>{t("tasks.runtime.approve")}</Button>
                  <Button size="small" variant="ghost-normal" loading={busyRun === run.id} onClick={() => openApproval(run, false)}>{t("tasks.runtime.reject")}</Button>
                </>
              ) : null}
              {run.status === "waiting_client_tool" ? (
                forAnotherHost
                  ? <Button size="small" type="primary" loading={busyRun === run.id} onClick={() => void takeOverClientTools(run)}>{t("tasks.runtime.takeOverTool")}</Button>
                  : <Button size="small" type="primary" loading={busyRun === run.id} onClick={() => void resumeClientTools(run)}>{t("tasks.runtime.resumeTool")}</Button>
              ) : null}
            </span>
          </div>
        );
      })}
      {interaction ? (
        <section className="runtime-interaction" aria-label={interaction.kind === "input" ? t("tasks.runtime.input.title") : t("tasks.runtime.approval.title")}>
          <div className="runtime-interaction__heading">
            <strong>{interaction.kind === "input" ? t("tasks.runtime.input.title") : t("tasks.runtime.approval.title")}</strong>
            <small>{interaction.run.workflow}</small>
          </div>
          {interaction.kind === "input" ? (
            <>
              <p>{interaction.pending.question}</p>
              {interaction.pending.options.length > 0 ? (
                <div className="runtime-interaction__options">
                  {interaction.pending.options.map((option) => (
                    <Button key={option} size="small" variant={inputValue === option ? "primary" : "secondary"} onClick={() => setInputValue(option)}>{option}</Button>
                  ))}
                </div>
              ) : null}
              <Input aria-label={t("tasks.runtime.input.answer")} value={inputValue} onChange={(event) => setInputValue(event.target.value)} onPressEnter={() => void submit()} />
            </>
          ) : (
            <>
              <p>{interaction.approved ? t("tasks.runtime.approval.confirm") : t("tasks.runtime.approval.rejectConfirm")}</p>
              {interaction.pending.details.length > 0 ? (
                <dl>{interaction.pending.details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              ) : null}
            </>
          )}
          <div className="runtime-interaction__actions">
            <Button size="small" variant="secondary" onClick={() => setInteraction(undefined)}>{t("tasks.runtime.interaction.cancel")}</Button>
            <Button
              size="small"
              type="primary"
              danger={interaction.kind === "approval" && !interaction.approved}
              loading={busyRun === interaction.run.id}
              disabled={interaction.kind === "input" && !inputValue.trim()}
              onClick={() => void submit()}
            >
              {interaction.kind === "input" ? t("tasks.runtime.input.submit") : interaction.approved ? t("tasks.runtime.approval.submitApprove") : t("tasks.runtime.approval.submitReject")}
            </Button>
          </div>
        </section>
      ) : null}
      {error ? <div className="runtime-runs__error" role="alert">{error}</div> : null}
    </>
  );
}
