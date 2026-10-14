import { useState } from "react";

import { useT } from "../../renderer/i18n";
import type { PptxTemplateAssetSummary } from "../../shared/pptxTemplates";
import type { PptxTemplateSource } from "../../shared/uiPort";
import { openConfirmDialog, openNameDialog } from "../kit/dialogs";
import { FileIcon, Icon } from "../kit/Icon";
import { closeModal, openMenu, openModal } from "../kit/layers";
import { usePort } from "../port/PortContext";
import { notBuiltYet, reportPortFailure } from "../port/reportPortFailure";
import {
  readyTemplates,
  requestTemplateUse,
  skillsReturnTarget,
  useTemplateLibrary,
  type TemplateJob,
  type TemplateLibrary,
  type TemplateLibrarySnapshot,
} from "../skills/templateLibrary";
import { useShell } from "../state/ShellContext";

/**
 * Skills — 1.0.12 §五, two levels.
 *
 *   Skills (the cards)  →  PPT Templates (the templates themselves)
 *
 * The first level lists skills, never template instances; PPT Templates is
 * one card that opens its own page. Learning lives outside this page
 * (`skills/templateLibrary.ts`), so going back, switching chats or leaving for
 * Home neither stops a file being learned nor clears a draft.
 */
export function SkillsPage() {
  const { state } = useShell();
  return state.skillsSection === "ppt-templates" ? <PptTemplatesPage /> : <SkillsLibrary />;
}

function SkillsLibrary() {
  const t = useT();
  const port = usePort();
  const { dispatch } = useShell();
  const { snapshot } = useTemplateLibrary(port);
  return (
    <section className="dx-page-scroll dx-skills-page" data-ui-scope="officedex">
      <header className="dx-page-header">
        <div>
          <h1>{t("dx.skills.title")}</h1>
          <p>{t("dx.skills.subtitle")}</p>
        </div>
      </header>
      <div className="dx-skills-library-grid">
        <button
          type="button"
          className="dx-skill-feature-card"
          data-act="skill-open-templates"
          aria-labelledby="dx-ppt-feature-title"
          aria-describedby="dx-ppt-feature-description"
          onClick={() => dispatch({ type: "go", page: "skills", skills: "ppt-templates" })}
        >
          <span className="dx-skill-feature-top">
            <span className="dx-skill-feature-icon">
              <FileIcon ext="pptx" size={32} />
            </span>
            <span className="dx-skill-feature-tag">{t("dx.skills.builtIn")}</span>
          </span>
          <strong id="dx-ppt-feature-title">{t("dx.skills.pptTemplates")}</strong>
          <span className="dx-skill-feature-description" id="dx-ppt-feature-description">
            {t("dx.skills.pptTemplatesDescription")}
          </span>
          <span className="dx-skill-feature-footer">
            <span>{libraryStatus(t, snapshot)}</span>
            <span className="dx-skill-feature-open">
              {t("dx.skills.open")}
              <Icon name="ArrowRight" />
            </span>
          </span>
        </button>
      </div>
    </section>
  );
}

function libraryStatus(t: ReturnType<typeof useT>, snapshot: TemplateLibrarySnapshot): string {
  const ready = readyTemplates(snapshot).length;
  const learning = snapshot.jobs.filter((job) => job.status === "learning").length;
  if (learning) return t("dx.skills.statusLearning", { ready, learning });
  if (ready) return t("dx.skills.statusReady", { count: ready });
  return t("dx.skills.statusEmpty");
}

/* ------------------------------------------------------------ PPT Templates */

function PptTemplatesPage() {
  const t = useT();
  const port = usePort();
  const { dispatch } = useShell();
  const { library, snapshot } = useTemplateLibrary(port);
  const use = useUseTemplate();
  const ready = readyTemplates(snapshot).length;
  const any = snapshot.templates.length > 0 || snapshot.jobs.length > 0;

  return (
    <section className="dx-page-scroll dx-skills-page" data-ui-scope="officedex">
      <nav className="dx-skills-breadcrumb" aria-label={t("dx.skills.breadcrumb")}>
        <button type="button" data-act="skill-library" onClick={() => dispatch({ type: "go", page: "skills" })}>
          <Icon name="ArrowLeft" />
          {t("dx.skills.title")}
        </button>
        <Icon name="ChevronRight" size={14} />
        <span aria-current="page">{t("dx.skills.pptTemplates")}</span>
      </nav>
      <header className="dx-page-header dx-skills-manager-header">
        <div>
          <h1>{t("dx.skills.pptTemplates")}</h1>
          <p>{t("dx.skills.templatesHelp")}</p>
        </div>
        {any && library ? (
          <button type="button" className="dx-btn" data-act="skill-upload" onClick={() => openUploadDialog(t, library)}>
            <Icon name="Plus" />
            {t("dx.skills.upload")}
          </button>
        ) : null}
      </header>
      <div className="dx-skills-template-heading">
        <h2>{t("dx.skills.yourTemplates")}</h2>
        <span>{t("dx.skills.readyCount", { count: ready })}</span>
      </div>
      {!library ? (
        <p className="dx-metadata" role="status">
          {t("pptTemplate.unavailable")}
        </p>
      ) : !snapshot.loaded ? (
        <p className="dx-metadata" role="status">
          {t("pptTemplate.loading")}
        </p>
      ) : any ? (
        <div className="dx-skill-grid">
          {snapshot.jobs.map((job) => (
            <JobCard key={job.key} job={job} library={library} />
          ))}
          {snapshot.templates.map((template) => (
            <TemplateCard key={template.id} template={template} library={library} onUse={() => use(template)} />
          ))}
        </div>
      ) : (
        <div className="dx-skills-empty">
          <FileIcon ext="pptx" size={48} />
          <h3>{t("dx.skills.emptyTitle")}</h3>
          <p>{t("dx.skills.emptyBody")}</p>
          <button type="button" className="dx-btn dx-primary" data-act="skill-upload" onClick={() => openUploadDialog(t, library)}>
            {t("dx.skills.uploadFile")}
          </button>
          <div className="dx-skills-empty-steps">
            <span>{t("dx.skills.stepUpload")}</span>
            <Icon name="ChevronRight" size={14} />
            <span>{t("dx.skills.stepLearn")}</span>
            <Icon name="ChevronRight" size={14} />
            <span>{t("dx.skills.stepUse")}</span>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Use: back where Skills was opened from — the conversation, or the draft chat
 * Home was writing into, else Home — with `/name` put at the composer's caret.
 */
function useUseTemplate() {
  const { dispatch } = useShell();
  return (template: PptxTemplateAssetSummary) => {
    if (template.status !== "ready") return;
    closeModal();
    const from = skillsReturnTarget();
    if (from.chat) dispatch({ type: "open-chat", chat: from.chat });
    else dispatch({ type: "open-home-draft", chat: from.homeChat });
    requestTemplateUse(template);
  };
}

/** The three steps the card shows, from the desktop's five stages. */
const STEP_OF_STAGE: Record<string, number> = { copy: 0, convert: 0, extract: 1, analyze: 1, skill: 2, ready: 3, imported: 3 };

function LearningSteps({ job }: { job: TemplateJob }) {
  const t = useT();
  const labels = [t("dx.skills.stepRead"), t("dx.skills.stepStyle"), t("dx.skills.stepSave")];
  const current = job.progress ? (STEP_OF_STAGE[job.progress.stage] ?? 0) : 0;
  return (
    <ol className="dx-skill-progress" aria-label={t("dx.skills.progressAria")}>
      {labels.map((label, index) => {
        const done = index < current;
        const active = index === current && job.status === "learning";
        return (
          <li key={label} className={active ? "dx-current" : undefined} data-done={done || undefined}>
            {done ? (
              <Icon name="Check" size={14} />
            ) : active ? (
              <span className="dx-spinner" />
            ) : (
              <span className="dx-skill-step-number">{index + 1}</span>
            )}
            <span>{label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function SamplePreview({ name }: { name: string }) {
  const t = useT();
  return (
    <div className="dx-skill-preview" aria-label={t("dx.skills.sampleAria")}>
      <div className="dx-skill-preview-cover">
        <span>{t("dx.skills.sampleCover")}</span>
        <strong>{name}</strong>
        <i />
      </div>
      <div className="dx-skill-preview-pages" aria-hidden="true">
        <span>
          <b />
          <i />
          <i />
        </span>
        <span>
          <b />
          <em />
        </span>
      </div>
      <small>{t("dx.skills.sampleLayout")}</small>
    </div>
  );
}

function TemplateCard({
  template,
  library,
  onUse,
}: {
  template: PptxTemplateAssetSummary;
  library: TemplateLibrary;
  onUse: () => void;
}) {
  const t = useT();
  const ready = template.status === "ready";
  const replacing = useReplacing(template.id);
  return (
    <article className="dx-skill-card" data-skill={template.id}>
      {ready ? (
        <SamplePreview name={template.name} />
      ) : (
        <div className="dx-skill-learning-preview">
          <FileIcon ext="pptx" size={48} />
        </div>
      )}
      <div className="dx-skill-card-body">
        <div className="dx-skill-card-title">
          <h3 title={template.name}>{template.name}</h3>
          <button
            type="button"
            className="dx-ib"
            data-act="skill-menu"
            data-id={template.id}
            aria-label={t("dx.skills.optionsFor", { name: template.name })}
            title={t("dx.skills.optionsFor", { name: template.name })}
            onClick={(event) =>
              openMenu(event.currentTarget, [
                { label: t("dx.skills.details"), onSelect: () => openDetails(t, template, onUse) },
                { label: t("dx.menu.rename"), onSelect: () => renameTemplate(t, library, template) },
                { label: t("dx.skills.remove"), onSelect: () => removeTemplate(t, library, template) },
              ])
            }
          >
            <Icon name="MoreHorizontal" />
          </button>
        </div>
        <p className="dx-skill-source dx-ellipsis" title={template.sourceFileName}>
          {template.sourceFileName}
        </p>
        <div className="dx-skill-card-status" role="status">
          <Icon name={ready ? "Check" : "CircleHelp"} size={14} />
          <span>{t(ready ? "dx.skills.ready" : "dx.skills.notReady")}</span>
        </div>
        {replacing ? <p className="dx-metadata">{t("dx.skills.replacing")}</p> : null}
        <div className="dx-skill-card-actions">
          {ready ? (
            <>
              <button type="button" className="dx-btn dx-primary" data-act="skill-use" data-id={template.id} onClick={onUse}>
                {t("dx.skills.use")}
              </button>
              <button type="button" className="dx-btn" data-act="skill-details" onClick={() => openDetails(t, template, onUse)}>
                {t("dx.skills.details")}
              </button>
            </>
          ) : (
            <button type="button" className="dx-btn" data-act="skill-replace" onClick={() => openUploadDialog(t, library, template)}>
              {t("dx.skills.replace")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Whether a replacement for this template is being learned right now. */
function useReplacing(id: string): boolean {
  const port = usePort();
  const { snapshot } = useTemplateLibrary(port);
  return snapshot.jobs.some((job) => job.replaceId === id && job.status === "learning");
}

function JobCard({ job, library }: { job: TemplateJob; library: TemplateLibrary }) {
  const t = useT();
  const learning = job.status === "learning";
  return (
    <article className="dx-skill-card" data-skill={job.key} data-status={job.status}>
      <div className="dx-skill-learning-preview">
        <FileIcon ext="pptx" size={48} />
        <LearningSteps job={job} />
      </div>
      <div className="dx-skill-card-body">
        <div className="dx-skill-card-title">
          <h3 title={job.name}>{job.name}</h3>
          {learning ? null : (
            <button
              type="button"
              className="dx-ib"
              data-act="skill-menu"
              aria-label={t("dx.skills.optionsFor", { name: job.name })}
              title={t("dx.skills.optionsFor", { name: job.name })}
              onClick={(event) =>
                openMenu(event.currentTarget, [{ label: t("dx.skills.remove"), onSelect: () => library.dismiss(job.key) }])
              }
            >
              <Icon name="MoreHorizontal" />
            </button>
          )}
        </div>
        <p className="dx-skill-source dx-ellipsis" title={job.sourceFileName}>
          {job.sourceFileName}
        </p>
        <div className="dx-skill-card-status" role="status">
          {learning ? <span className="dx-spinner" /> : <Icon name="CircleHelp" size={14} />}
          <span>{t(learning ? "dx.skills.learning" : "dx.skills.needsAttention")}</span>
        </div>
        {job.error ? <p className="dx-skill-error">{job.error}</p> : null}
        <div className="dx-skill-card-actions">
          {learning ? (
            <button
              type="button"
              className="dx-btn"
              data-act="skill-stop"
              onClick={() => notBuiltYet("skills.stopLearning", t("dx.skills.stopUnavailable"))}
            >
              {t("dx.skills.stop")}
            </button>
          ) : (
            <>
              <button type="button" className="dx-btn dx-primary" data-act="skill-retry" onClick={() => void library.retry(job.key)}>
                {t("dx.skills.retry")}
              </button>
              <button
                type="button"
                className="dx-btn"
                data-act="skill-replace"
                onClick={() => {
                  library.dismiss(job.key);
                  openUploadDialog(t, library, undefined, job.name);
                }}
              >
                {t("dx.skills.replace")}
              </button>
            </>
          )}
        </div>
      </div>
    </article>
  );
}

/* ----------------------------------------------------------------- dialogs */

/**
 * Choose a file, confirm the name, then Learn — nothing is learned until the
 * user says so (§五). Replace keeps the template's name and swaps its source.
 */
function openUploadDialog(t: ReturnType<typeof useT>, library: TemplateLibrary, replacing?: PptxTemplateAssetSummary, name?: string) {
  openModal({
    title: t(replacing ? "dx.skills.replaceTitle" : "dx.skills.uploadTitle"),
    className: "skill-upload-dialog",
    render: (close) => <UploadForm library={library} replacing={replacing} initialName={name} close={close} />,
  });
}

function UploadForm({
  library,
  replacing,
  initialName,
  close,
}: {
  library: TemplateLibrary;
  replacing?: PptxTemplateAssetSummary;
  initialName?: string;
  close: () => void;
}) {
  const t = useT();
  const [source, setSource] = useState<PptxTemplateSource | null>(null);
  const [name, setName] = useState(replacing?.name ?? initialName ?? "");
  const [error, setError] = useState("");

  const choose = async () => {
    try {
      const picked = await library.pick();
      if (!picked) return;
      if (!/\.pptx$/i.test(picked.fileName)) {
        setError(t("dx.skills.wrongType"));
        return;
      }
      setSource(picked);
      setError("");
      setName((current) => current || picked.fileName.replace(/\.[^.]+$/, ""));
    } catch (reason) {
      reportPortFailure(reason);
    }
  };

  const learn = () => {
    const trimmed = name.trim();
    if (!source) {
      setError(t("dx.skills.chooseFirst"));
      return;
    }
    if (!trimmed) {
      setError(t("dx.skills.nameRequired"));
      return;
    }
    if (library.nameTaken(trimmed, replacing?.id)) {
      setError(t("dx.skills.nameTaken"));
      return;
    }
    close();
    void library.learn({
      sourcePath: source.path,
      sourceFileName: source.fileName,
      name: trimmed,
      ...(replacing ? { replaceId: replacing.id } : {}),
    });
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        learn();
      }}
    >
      <p className="dx-skill-dialog-intro">{t("dx.skills.uploadIntro")}</p>
      <div className="dx-skill-dropzone" data-has-file={source ? "true" : undefined}>
        <FileIcon ext="pptx" size={40} />
        <strong>{source ? source.fileName : t("dx.skills.chooseTitle")}</strong>
        <span>{t("dx.skills.fileKinds")}</span>
        <button type="button" className="dx-btn" data-act="skill-pick" onClick={() => void choose()}>
          {t(source ? "dx.skills.change" : "dx.skills.chooseFile")}
        </button>
      </div>
      <div className="dx-skill-upload-error" role="alert">
        {error}
      </div>
      <label className="dx-skill-name-field">
        {t("dx.skills.nameLabel")}
        <input
          name="template-name"
          maxLength={80}
          value={name}
          disabled={!source}
          placeholder={t("dx.skills.namePlaceholder")}
          onChange={(event) => {
            setName(event.target.value);
            setError("");
          }}
        />
      </label>
      <p className="dx-helper">{t("dx.skills.uploadHelper")}</p>
      <div className="dx-form-actions">
        <button type="button" className="dx-btn" data-act="modal-close" onClick={close}>
          {t("dx.action.cancel")}
        </button>
        <button type="submit" className="dx-btn dx-primary" data-act="skill-learn" disabled={!source || !name.trim()}>
          {t("dx.skills.learn")}
        </button>
      </div>
    </form>
  );
}

function openDetails(t: ReturnType<typeof useT>, template: PptxTemplateAssetSummary, onUse: () => void) {
  const ready = template.status === "ready";
  openModal({
    title: template.name,
    className: "skill-details-dialog",
    render: (close) => (
      <section data-skill-detail={template.id}>
        {ready ? <SamplePreview name={template.name} /> : null}
        <dl className="dx-skill-definition">
          <dt>{t("dx.skills.status")}</dt>
          <dd>{t(ready ? "dx.skills.ready" : "dx.skills.notReady")}</dd>
          <dt>{t("dx.skills.source")}</dt>
          <dd>{template.sourceFileName}</dd>
          <dt>{t("dx.skills.pages")}</dt>
          <dd>{template.pageCount ?? 0}</dd>
          <dt>{t("dx.skills.availableIn")}</dt>
          <dd>{t("dx.skills.everywhere")}</dd>
        </dl>
        {template.warnings.length ? (
          <ul className="dx-metadata">
            {template.warnings.map((warning, index) => (
              <li key={index}>{warning}</li>
            ))}
          </ul>
        ) : null}
        <p>{t("dx.skills.templatesHelp")}</p>
        <div className="dx-form-actions">
          <button type="button" className="dx-btn" data-act="modal-close" onClick={close}>
            {t("dx.action.close")}
          </button>
          {ready ? (
            <button type="button" className="dx-btn dx-primary" data-act="skill-use" onClick={onUse}>
              {t("dx.skills.use")}
            </button>
          ) : null}
        </div>
      </section>
    ),
  });
}

function renameTemplate(t: ReturnType<typeof useT>, library: TemplateLibrary, template: PptxTemplateAssetSummary) {
  openNameDialog({
    title: t("dx.menu.rename"),
    label: t("dx.skills.nameLabel"),
    initial: template.name,
    action: t("dx.menu.rename"),
    onSubmit: async (name) => {
      if (library.nameTaken(name, template.id)) return t("dx.skills.nameTaken");
      await library.rename(template.id, name);
    },
  });
}

function removeTemplate(t: ReturnType<typeof useT>, library: TemplateLibrary, template: PptxTemplateAssetSummary) {
  openConfirmDialog({
    title: t("dx.skills.removeTitle"),
    body: <p>{t("dx.skills.removeBody", { name: template.name })}</p>,
    action: t("dx.skills.remove"),
    onConfirm: () => library.remove(template.id),
  });
}
