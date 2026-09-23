import { useT } from "../../renderer/i18n";
import { FileTypeIcon } from "../chrome/FileTypeIcon";
import "./newStart.css";

/**
 * Editor mode's New page: three blank templates, as the prototype draws them.
 *
 * Reached from the sidebar's "+". It used to open a three-item menu instead,
 * which made "New" the one sidebar entry that was not a place — and put the
 * choice in a small list when the prototype gives it a page of its own, with
 * a picture of what each blank file starts as.
 *
 * The previews are drawn, not rendered: a blank page, a ruled grid, an empty
 * slide with two placeholder boxes. That is exactly what each one opens as, so
 * nothing on the card promises content that will not be there.
 */

const TEMPLATES = [
  { type: "doc", labelKey: "shell.home.blankDocument" },
  { type: "sheet", labelKey: "shell.home.blankWorkbook" },
  { type: "slides", labelKey: "shell.home.blankPresentation" },
] as const;

export function NewStart({ onCreate }: { onCreate: (type: "doc" | "sheet" | "slides") => void }) {
  const t = useT();
  return (
    <div className="shell-new-start">
      <header className="shell-home-head">
        <h1>{t("shell.sidebar.new")}</h1>
      </header>
      <section className="shell-new-templates" aria-label={t("shell.sidebar.new")}>
        {TEMPLATES.map((template) => (
          <button
            key={template.type}
            type="button"
            className="shell-new-template"
            aria-label={t(template.labelKey)}
            onClick={() => onCreate(template.type)}
          >
            <span className="shell-new-preview" data-type={template.type} aria-hidden="true">
              <span className="shell-new-blank">
                {template.type === "slides" ? (
                  <>
                    <i />
                    <i />
                  </>
                ) : null}
              </span>
              <span className="shell-new-icon">
                <FileTypeIcon type={template.type} size={22} />
              </span>
            </span>
            <span className="shell-new-label">{t(template.labelKey)}</span>
          </button>
        ))}
      </section>
    </div>
  );
}
