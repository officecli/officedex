import { useEffect, useState, type FormEvent } from "react";
import { useT } from "../../renderer/i18n";
import { errorMessage } from "../../renderer/utils/values";
import type { PptxTemplateAssetSummary } from "../../shared/pptxTemplates";
import type { PptxTemplateProgress } from "../../shared/types";
import { useCanvas } from "../canvas/CanvasContext";
import { useComposerSettings } from "../composer/useComposerSettings";
import { openModal, retitleModal } from "../kit/layers";
import { usePort } from "../port/PortContext";
import { useShell } from "../state/ShellContext";
import "./pptxTemplates.css";

export function PptxTemplatesButton() {
  const t = useT();
  return <button type="button" className="dx-btn" data-act="pptx-templates" onClick={() => openModal({
    title: t("home.localTemplates"), className: "wide", render: close => <PptxTemplates close={close} />,
  })}>{t("home.localTemplates")}</button>;
}

function PptxTemplates({ close }: { close: () => void }) {
  const t = useT();
  const port = usePort();
  const library = port.pptxTemplates;
  const { dispatch, defaultFolderId } = useShell();
  const canvas = useCanvas();
  const settings = useComposerSettings();
  const [templates, setTemplates] = useState<PptxTemplateAssetSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"fast" | "plan">("fast");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<PptxTemplateProgress | null>(null);
  const [error, setError] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const selected = templates.find(item => item.id === selectedId);

  useEffect(() => {
    let live = true;
    if (!library) { setLoading(false); return; }
    library.list().then(items => { if (live) setTemplates(items); })
      .catch(reason => { if (live) setError(errorMessage(reason)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [library]);
  useEffect(() => { retitleModal(t("home.localTemplates"), busy); }, [busy, t]);

  const importTemplate = async () => {
    if (!library || busy) return;
    setBusy(true); setError(""); setProgress(null);
    try {
      const result = await library.import(setProgress);
      if (result) {
        setTemplates(await library.list());
        if (result.status === "ready") setSelectedId(result.id);
      }
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const removeTemplate = async (id: string) => {
    if (!library || busy) return;
    setBusy(true); setError("");
    try {
      await library.remove(id);
      setTemplates(await library.list());
      if (selectedId === id) setSelectedId("");
      setDeleteId(null);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };
  const generate = async (event: FormEvent) => {
    event.preventDefault();
    if (!selected || selected.status !== "ready" || !prompt.trim() || busy) return;
    setBusy(true); setError("");
    try {
      dispatch({ type: "open-chat", chat: { folderId: defaultFolderId, conversationId: null } });
      if (canvas) dispatch({ type: "enter-stage" });
      await port.agent.send({
        text: prompt.trim(), folderId: defaultFolderId, newConversation: true,
        mentions: [], attachments: [], activeFileId: null, documentType: "pptx",
        modelId: settings.value.selectedModelId, permission: settings.value.permission,
        generationMode: mode,
        pptxTemplate: { id: selected.id, version: selected.version, localAssetDir: selected.localAssetDir },
      });
      close();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  };

  return <form className="dx-ppt-templates" onSubmit={generate}>
    <p>{t("pptTemplate.intro")}</p>
    <button type="button" className="dx-btn" disabled={!library || busy || loading} onClick={() => void importTemplate()}>{t("home.importPptxTemplate")}</button>
    {!library ? <p role="status">{t("pptTemplate.unavailable")}</p> : null}
    {progress ? <div role="status" aria-live="polite">
      <p>{progress.name} · {t(`home.templateProgress.${progress.stage}`)}</p>
      {busy && progress.stage !== "failed" ? <progress value={progress.step} max={progress.steps} /> : null}
    </div> : null}
    {error ? <p className="dx-ppt-template-error" role="alert">{error}</p> : null}
    <div className="dx-ppt-template-list" aria-label={t("home.localTemplates")}>
      {loading ? <p role="status">{t("pptTemplate.loading")}</p> : templates.length === 0 ? <p>{t("home.localTemplatesEmpty")}</p> : null}
      {templates.map(template => <div className="dx-ppt-template-row" key={template.id}>
        <label>
          <input type="radio" name="ppt-template" value={template.id} checked={selectedId === template.id} disabled={busy || template.status !== "ready"} onChange={() => setSelectedId(template.id)} />
          <span><strong>{template.name}</strong><small>{template.pageCount ?? 0} {t("home.templatePages")} · {t(template.status === "ready" ? "home.templateReady" : "pptTemplate.notReady")}</small></span>
        </label>
        {deleteId === template.id ? <div className="dx-ppt-template-delete">
          <span>{t("home.deleteTemplateBody")}</span>
          <button type="button" className="dx-btn" disabled={busy} onClick={() => void removeTemplate(template.id)}>{t("home.deleteTemplateConfirm")}</button>
          <button type="button" className="dx-btn" disabled={busy} onClick={() => setDeleteId(null)}>{t("pptTemplate.cancel")}</button>
        </div> : <button type="button" className="dx-btn" disabled={busy} onClick={() => setDeleteId(template.id)} aria-label={t("home.deleteTemplate", { name: template.name })}>{t("home.deleteTemplateConfirm")}</button>}
      </div>)}
    </div>
    {selected?.warnings.length ? <details><summary>{t("pptTemplate.warnings")}</summary><ul>{selected.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></details> : null}
    <label className="dx-ppt-template-prompt">{t("pptTemplate.prompt")}
      <textarea value={prompt} onChange={event => setPrompt(event.target.value)} disabled={busy} placeholder={t("pptTemplate.placeholder")} rows={4} />
    </label>
    <fieldset disabled={busy}>
      <legend>{t("pptTemplate.mode")}</legend>
      <label><input type="radio" name="ppt-mode" checked={mode === "fast"} onChange={() => setMode("fast")} />{t("pptTemplate.fast")}</label>
      <label><input type="radio" name="ppt-mode" checked={mode === "plan"} onChange={() => setMode("plan")} />{t("pptTemplate.plan")}</label>
    </fieldset>
    <p className="dx-metadata">{t("pptTemplate.modeHint")}</p>
    <button type="submit" className="dx-btn dx-primary" disabled={busy || !selected || selected.status !== "ready" || !prompt.trim()}>{t("pptTemplate.generate")}</button>
  </form>;
}
