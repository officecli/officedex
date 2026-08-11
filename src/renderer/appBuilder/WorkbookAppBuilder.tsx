import { AlertCircle, ArrowLeft, Check, ChevronRight, ExternalLink, FileSpreadsheet, LoaderCircle, RefreshCw, Rocket, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Artifact, PreviewGrant } from "../../shared/types";
import { Button, Input, TextArea } from "../ui";
import { useT } from "../i18n";
import { savePublishedWorkbookApp, slugifyAppName } from "./appStore";
import type { PublishedWorkbookApp, WorkbookAppConfig } from "./types";
import { defaultSelectedFieldIds } from "./workbookData";
import { useWorkbookDataSource } from "./useWorkbookDataSource";
import { WorkbookAppPreview } from "./WorkbookAppPreview";

type BuilderStep = "configure" | "preview" | "publish";

export interface WorkbookAppBuilderProps {
  artifact: Artifact;
  grant: PreviewGrant;
  sourceRevision?: number;
  onClose: () => void;
  onOpenPublished: (app: PublishedWorkbookApp) => void;
}

export function WorkbookAppBuilder({ artifact, grant, sourceRevision = 0, onClose, onOpenPublished }: WorkbookAppBuilderProps) {
  const t = useT();
  const { snapshot, loading, error, refresh } = useWorkbookDataSource(grant.token, sourceRevision);
  const [step, setStep] = useState<BuilderStep>("configure");
  const [sheetName, setSheetName] = useState("");
  const [fieldIds, setFieldIds] = useState<string[]>([]);
  const [prompt, setPrompt] = useState(t("appBuilder.defaultPrompt"));
  const [appName, setAppName] = useState(() => artifact.fileName.replace(/\.xlsx?$/i, "") || t("appBuilder.defaultName"));
  const [slug, setSlug] = useState(() => slugifyAppName(artifact.fileName.replace(/\.xlsx?$/i, "")));
  const [access, setAccess] = useState<WorkbookAppConfig["access"]>("private");
  const [allowCreate, setAllowCreate] = useState(true);
  const [allowUpdate, setAllowUpdate] = useState(true);
  const [published, setPublished] = useState<PublishedWorkbookApp>();
  const [revisionPrompt, setRevisionPrompt] = useState("");
  const sheet = snapshot?.sheets.find((item) => item.name === sheetName) ?? snapshot?.sheets[0];

  useEffect(() => {
    if (!snapshot?.sheets.length || sheetName) return;
    const first = snapshot.sheets[0];
    setSheetName(first.name);
    setFieldIds(defaultSelectedFieldIds(first));
  }, [sheetName, snapshot]);

  const config = useMemo<WorkbookAppConfig>(() => ({
    name: appName.trim() || t("appBuilder.defaultName"),
    slug: slugifyAppName(slug),
    prompt: prompt.trim(),
    sheetName: sheet?.name ?? sheetName,
    fieldIds,
    access,
    allowCreate,
    allowUpdate,
  }), [access, allowCreate, allowUpdate, appName, fieldIds, prompt, sheet?.name, sheetName, slug, t]);

  const publish = () => {
    const app: PublishedWorkbookApp = {
      id: published?.id ?? `workbook-app-${Date.now().toString(36)}`,
      sourceFileName: artifact.fileName,
      config,
      publishedAt: new Date().toISOString(),
    };
    savePublishedWorkbookApp(app);
    setPublished(app);
  };

  return (
    <section className="app-builder" aria-label={t("appBuilder.title")}>
      <header className="app-builder__topbar">
        <div className="app-builder__identity">
          <Button variant="ghost-normal" size="small" ariaLabel={t("appBuilder.close")} icon={<ArrowLeft />} onClick={onClose} />
          <span className="app-builder__mark"><Sparkles aria-hidden="true" /></span>
          <div><strong>{t("appBuilder.title")}</strong><span>{artifact.fileName}</span></div>
        </div>
        <div className="app-builder__top-actions">
          {snapshot ? <span className="app-builder__connection"><i />{t("appBuilder.connected")}</span> : null}
          <Button size="small" icon={<RefreshCw />} onClick={() => void refresh()}>{t("appBuilder.refresh")}</Button>
          {step === "configure" ? <Button variant="primary" size="small" icon={<Sparkles />} disabled={!sheet || !fieldIds.length || !prompt.trim()} onClick={() => setStep("preview")}>{t("appBuilder.generate")}</Button> : null}
          {step === "preview" ? <Button variant="primary" size="small" icon={<Rocket />} onClick={() => setStep("publish")}>{t("appBuilder.publishAction")}</Button> : null}
        </div>
      </header>
      <nav className="app-builder__steps" aria-label={t("appBuilder.steps.aria")}>
        {(["configure", "preview", "publish"] as BuilderStep[]).map((item, index) => (
          <button key={item} type="button" data-active={step === item} onClick={() => setStep(item)}><span>{index + 1}</span>{t(`appBuilder.steps.${item}`)}</button>
        ))}
      </nav>

      {loading && !snapshot ? <div className="app-builder__state"><LoaderCircle className="is-spinning" /><strong>{t("appBuilder.loading")}</strong></div> : null}
      {error && !snapshot ? <div className="app-builder__state app-builder__state--error"><AlertCircle /><strong>{t("appBuilder.loadError")}</strong><span>{error}</span><Button onClick={() => void refresh()}>{t("appBuilder.retry")}</Button></div> : null}

      {snapshot && step === "configure" ? (
        <div className="app-builder__configure">
          <main className="app-builder__source">
            <header><div><span>{t("appBuilder.source.eyebrow")}</span><h2>{sheet?.name}</h2><p>{t("appBuilder.source.summary", { fields: sheet?.fields.length ?? 0, rows: sheet?.rows.length ?? 0 })}</p></div><FileSpreadsheet aria-hidden="true" /></header>
            <div className="app-builder__sample">
              <table><thead><tr>{sheet?.fields.slice(0, 6).map((field) => <th key={field.id}>{field.label}</th>)}</tr></thead><tbody>{sheet?.rows.slice(0, 8).map((row) => <tr key={row.id}>{sheet.fields.slice(0, 6).map((field) => <td key={field.id}>{String(row.values[field.id] ?? "")}</td>)}</tr>)}</tbody></table>
            </div>
          </main>
          <aside className="app-builder__config-panel">
            <div><h2>{t("appBuilder.configure.title")}</h2><p>{t("appBuilder.configure.subtitle")}</p></div>
            <label><span>{t("appBuilder.configure.sheet")}</span><select value={sheet?.name ?? ""} onChange={(event) => { const next = snapshot.sheets.find((item) => item.name === event.target.value); setSheetName(event.target.value); setFieldIds(defaultSelectedFieldIds(next)); }}>{snapshot.sheets.map((item) => <option value={item.name} key={item.name}>{item.name}</option>)}</select></label>
            <fieldset><legend>{t("appBuilder.configure.fields")}</legend><div className="app-builder__field-list">{sheet?.fields.map((field) => <label key={field.id}><input type="checkbox" checked={fieldIds.includes(field.id)} onChange={(event) => setFieldIds((current) => event.target.checked ? [...current, field.id] : current.filter((id) => id !== field.id))} /><span>{field.label}</span><small>{field.kind}</small></label>)}</div></fieldset>
            <label><span>{t("appBuilder.configure.prompt")}</span><TextArea value={prompt} rows={5} onChange={(event) => setPrompt(event.target.value)} /></label>
            <Button block variant="primary" icon={<Sparkles />} disabled={!fieldIds.length || !prompt.trim()} onClick={() => setStep("preview")}>{t("appBuilder.generate")}</Button>
          </aside>
        </div>
      ) : null}

      {snapshot && sheet && step === "preview" ? (
        <div className="app-builder__preview-stage">
          <aside className="app-builder__chat">
            <header><Sparkles /><div><strong>{t("appBuilder.chat.title")}</strong><span>{t("appBuilder.chat.source", { sheet: sheet.name })}</span></div></header>
            <div className="app-builder__message app-builder__message--user">{prompt}</div>
            <div className="app-builder__message"><strong>{t("appBuilder.chat.ready")}</strong><ul><li><Check />{t("appBuilder.chat.schema", { fields: fieldIds.length })}</li><li><Check />{t("appBuilder.chat.bound")}</li><li><Check />{t("appBuilder.chat.realtime")}</li></ul></div>
            <div className="app-builder__chat-compose"><TextArea rows={3} value={revisionPrompt} placeholder={t("appBuilder.chat.placeholder")} onChange={(event) => setRevisionPrompt(event.target.value)} /><Button variant="primary" size="small" icon={<ChevronRight />} disabled={!revisionPrompt.trim()} onClick={() => { setPrompt((current) => `${current}\n${revisionPrompt.trim()}`); setRevisionPrompt(""); }}>{t("appBuilder.chat.apply")}</Button></div>
          </aside>
          <main className="app-builder__preview-shell"><div className="app-builder__preview-toolbar"><span>{t("appBuilder.preview.desktop")}</span><span>{t("appBuilder.preview.savedBoundary")}</span></div><WorkbookAppPreview config={config} sheet={sheet} live lastSyncedAt={snapshot.loadedAt} /></main>
        </div>
      ) : null}

      {snapshot && sheet && step === "publish" ? (
        <div className="app-builder__publish">
          <main><div className="app-builder__publish-card"><Rocket aria-hidden="true" /><h2>{published ? t("appBuilder.publish.doneTitle") : t("appBuilder.publish.title")}</h2><p>{published ? t("appBuilder.publish.doneBody") : t("appBuilder.publish.subtitle")}</p>
            <label><span>{t("appBuilder.publish.name")}</span><Input value={appName} onChange={(event) => { setAppName(event.target.value); if (!published) setSlug(slugifyAppName(event.target.value)); }} /></label>
            <label><span>{t("appBuilder.publish.url")}</span><div className="app-builder__url"><span>app.officedex.local/</span><Input value={slug} onChange={(event) => setSlug(event.target.value)} /></div></label>
            <label><span>{t("appBuilder.publish.access")}</span><select value={access} onChange={(event) => setAccess(event.target.value as WorkbookAppConfig["access"])}><option value="private">{t("appBuilder.access.private")}</option><option value="workspace">{t("appBuilder.access.workspace")}</option><option value="organization">{t("appBuilder.access.organization")}</option></select></label>
            {published ? <Button block variant="primary" icon={<ExternalLink />} onClick={() => onOpenPublished(published)}>{t("appBuilder.publish.open")}</Button> : <Button block variant="primary" icon={<Rocket />} onClick={publish}>{t("appBuilder.publish.confirm")}</Button>}
          </div></main>
          <aside><h2>{t("appBuilder.permissions.title")}</h2><p>{t("appBuilder.permissions.subtitle")}</p><label><input type="checkbox" checked readOnly /><span><strong>{t("appBuilder.permissions.read")}</strong>{fieldIds.length} {t("appBuilder.permissions.fieldUnit")}</span></label><label><input type="checkbox" checked={allowCreate} onChange={(event) => setAllowCreate(event.target.checked)} /><span><strong>{t("appBuilder.permissions.create")}</strong>{t("appBuilder.permissions.createBody")}</span></label><label><input type="checkbox" checked={allowUpdate} onChange={(event) => setAllowUpdate(event.target.checked)} /><span><strong>{t("appBuilder.permissions.update")}</strong>{t("appBuilder.permissions.updateBody")}</span></label></aside>
        </div>
      ) : null}
    </section>
  );
}
