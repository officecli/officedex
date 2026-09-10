import { FileText } from "lucide-react";
import type { WriterSelectionSummary } from "../../shared/writerProtocol";
import { useT } from "../i18n";
import "./docxAgent.css";



/**
 * Says what an instruction would apply to, and what is still missing before one
 * can be sent. The editor already hands the agent runtime read_selection,
 * replace_text and save; what has no home yet is the workflow that calls them,
 * which lives in officecli rather than here. Until it ships the composer stays
 * disabled instead of accepting text nothing will act on.
 */
export function DocxAgentPanel() {
  const t = useT();

  return (
    <div className="docx-agent">
      <div className="docx-agent__body">
        <div className="docx-agent__pending">
          <FileText size={22} aria-hidden="true" />
          <strong>{t("docx.agent.pendingTitle")}</strong>
          <span>{t("docx.agent.pendingBody")}</span>
        </div>
      </div>

      <form className="docx-agent__composer" onSubmit={(event) => event.preventDefault()}>
        <textarea
          className="docx-agent__input"
          rows={3}
          disabled
          placeholder={t("docx.agent.placeholder")}
          aria-label={t("docx.agent.placeholder")}
        />
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
