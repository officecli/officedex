import { agentHistoryKey, messageHistoryCodec, useAgentHistory } from "../workbench/useAgentHistory";
import { AgentMessage } from "../workbench/AgentMessage";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, FileText, Square } from "lucide-react";
import { useDesktopApi } from "../services/desktopApi";
import { waitForAgentRun, unwrapAgentRunResult } from "../agentRuntime";
import { agentClientId } from "../agentClientIdentity";
import type { WriterAgentEditor } from "./WriterEditorFrame";
import { errorMessage } from "../utils/values";
import type { WriterSelectionSummary } from "../../shared/writerProtocol";
import { Button } from "../ui";
import "../workbench/agent-panel.css";
import { useLocale, useT } from "../i18n";
import "./docxAgent.css";



export function DocxAgentPanel({ scope, editor, selection, filePath }: {
  scope?: string; editor?: WriterAgentEditor | null; selection?: WriterSelectionSummary; filePath?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const api = useDesktopApi();
  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<"idle" | "planning" | "applying" | "saving">("idle");
  const [messages, setMessages] = useAgentHistory(agentHistoryKey("docx", filePath), messageHistoryCodec);
  const [error, setError] = useState("");
  const operation = useRef<{ cancelled: boolean; runId?: string } | null>(null);
  useEffect(() => {
    setPhase("idle");
    setError("");
    setPrompt("");
    return () => {
      const active = operation.current;
      if (active) {
        operation.current = null;
        active.cancelled = true;
        if (active.runId) void api.cancelAgentRun(active.runId).catch(() => {});
      }
    };
  }, [api, editor, filePath]);

  const submit = async () => {
    const value = prompt.trim();
    if (!value || !editor || operation.current) return;
    const active = { cancelled: false, runId: undefined as string | undefined };
    operation.current = active;
    setError("");
    setPhase("planning");
    setMessages((previous) => [...previous, { role: "user", text: value }]);
    let applied = false;
    try {
      const captured = await editor.capture(selection && !selection.empty && !selection.collapsed ? "selection" : "document");
      if (active.cancelled) return;
      const run = await api.startAgentRun({
        workflow: "office.docx.edit.v1",
        input: { parameters: { prompt: value, text: captured.text, scope: captured.scope, ui_locale: locale } },
        metadata: { surface: "docx-editor", origin_client_id: agentClientId(), ...(filePath ? { source_path: filePath } : {}) },
      });
      active.runId = run.id;
      if (active.cancelled) { await api.cancelAgentRun(run.id); return; }
      const outcome = await waitForAgentRun(run.id, { api, timeoutMs: 180_000, pollMs: 250 });
      if (active.cancelled) return;
      if (outcome.kind !== "completed") throw new Error(outcome.question);
      const plan = unwrapAgentRunResult<{ summary: string; edits: { query: string; replacement: string }[] }>(outcome.run);
      if (!plan || !Array.isArray(plan.edits) || typeof plan.summary !== "string") throw new Error(t("docx.agent.invalidPlan"));
      if (plan.edits.length) {
        setPhase("applying");
        await editor.apply(captured.id, plan.edits);
        applied = true;
        if (active.cancelled) return;
        setPhase("saving");
        await editor.save();
      }
      if (!active.cancelled) {
        setPrompt("");
        setMessages((previous) => [...previous, { role: "assistant", text: plan.summary + (applied ? `\n${t("docx.agent.saved")}` : "") }]);
      }
    } catch (reason) {
      if (!active.cancelled) {
        const text = (applied ? `${t("docx.agent.saveFailed")} ` : "") + errorMessage(reason);
        setError(text);
        setMessages((previous) => [...previous, { role: "assistant", text }]);
      }
    } finally {
      if (operation.current === active) operation.current = null;
      if (!active.cancelled) setPhase("idle");
    }
  };
  const cancel = async () => {
    const active = operation.current;
    if (!active || phase !== "planning") return;
    active.cancelled = true;
    try {
      if (active.runId) await api.cancelAgentRun(active.runId);
      setMessages((previous) => [...previous, { role: "assistant", text: t("docx.agent.cancelled") }]);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { if (operation.current === active) operation.current = null; setPhase("idle"); }
  };

  return (
    <div className="docx-agent agent-panel" data-has-messages={messages.length > 0}>
      <div className="docx-agent__body agent-panel__body" aria-live="polite">
        {!messages.length ? <div className="docx-agent__pending">
          <FileText size={22} aria-hidden="true" />
          <strong>{t("docx.agent.readyTitle")}</strong>
          <span>{t("docx.agent.readyBody")}</span>
        </div> : messages.map((message, index) => <AgentMessage key={index} role={message.role}>{message.text}</AgentMessage>)}
        {phase !== "idle" ? <p role="status">{t(`docx.agent.${phase}`)}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>

      <form className="docx-agent__composer agent-compose-box" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <textarea
          className="docx-agent__input"
          rows={3}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
            event.preventDefault();
            void submit();
          }}
          disabled={!editor || phase !== "idle"}
          placeholder={t("docx.agent.placeholder")}
          aria-label={t("docx.agent.placeholder")}
        />
        <div className="agent-composer-actions">
          <span className="agent-panel__scope" title={scope}><FileText size={14} aria-hidden="true" /><span>{scope ?? t("docx.agent.scopeWholeDocument")}</span></span>
          {phase === "planning" ? <Button ariaLabel={t("docx.agent.cancel")} icon={<Square />} onClick={() => void cancel()} /> :
          <Button className="od-button--icon-submit" type="primary" htmlType="submit" ariaLabel={t("pptx.agent.send")} icon={<ArrowUp />} disabled={!editor || !prompt.trim() || phase !== "idle"} />}
        </div>
      </form>
    </div>
  );
}

/** The scope chip in the panel header: what the next instruction would touch. */
export function describeDocxSelection(
  selection: WriterSelectionSummary,
  t: (key: string, vars?: Record<string, string | number>) => string,
): string {
  if (selection.empty || selection.collapsed) return t("docx.agent.scopeWholeDocument");
  if (selection.paragraphs === undefined) return t("docx.agent.scopeText");
  return t("docx.agent.scopeParagraphs", { count: selection.paragraphs });
}
