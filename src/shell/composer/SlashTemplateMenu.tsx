import { useEffect, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { useT } from "../../renderer/i18n";
import type { PptxTemplateAssetSummary } from "../../shared/pptxTemplates";
import { FileIcon, Icon } from "../kit/Icon";
import { isImeKeyEvent } from "./MentionMenu";

/**
 * The `/` list — 1.0.12 §五: Ready PPT templates whose name contains what was
 * typed after `/`, and a way to Skills to add or manage them.
 *
 * Like the `@` list it opens over its composer and typing carries on in the
 * textarea: Enter takes the first match, ArrowDown steps into the list, Escape
 * closes it. Only Ready templates are offered: one still learning, or failed,
 * cannot be used.
 */
export function SlashTemplateMenu({
  open,
  query,
  templates,
  selectedId,
  inputId,
  onPick,
  onManage,
  onClose,
}: {
  open: boolean;
  query: string;
  templates: readonly PptxTemplateAssetSummary[];
  selectedId: string | null;
  inputId: string;
  onPick: (template: PptxTemplateAssetSummary) => void;
  onManage: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const panel = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLocaleLowerCase();
  const options = templates.filter((template) => template.name.toLocaleLowerCase().includes(needle));

  useLayoutEffect(() => {
    if (!open) return;
    const element = panel.current;
    const input = document.getElementById(inputId);
    const composer = input?.closest(".dx-composer") ?? input;
    if (!element || !composer) return;
    const rect = composer.getBoundingClientRect();
    element.style.width = `${Math.min(360, window.innerWidth - 24)}px`;
    element.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - element.offsetWidth - 12))}px`;
    const above = rect.top - element.offsetHeight - 8;
    element.style.top = `${above >= 8 ? above : Math.min(rect.bottom + 8, window.innerHeight - element.offsetHeight - 8)}px`;
  }, [open, inputId, options.length, query]);

  useEffect(() => {
    if (!open) return;
    const input = document.getElementById(inputId);
    const onKeyDown = (event: KeyboardEvent) => {
      if (isImeKeyEvent(event)) return;
      const element = panel.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        input?.focus();
        return;
      }
      if (event.target === input && (event.key === "Enter" || event.key === "ArrowDown")) {
        const first = element?.querySelector<HTMLButtonElement>("[role=option]");
        if (!first) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.key === "Enter") first.click();
        else first.focus();
        return;
      }
      if (element?.contains(event.target as Node) && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const rows = [...element.querySelectorAll<HTMLButtonElement>("button")];
        const index = rows.indexOf(event.target as HTMLButtonElement);
        rows[(index + (event.key === "ArrowDown" ? 1 : -1) + rows.length) % rows.length]?.focus();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || input?.contains(target)) return;
      onClose();
    };
    // Capture: the composer's own Enter handler must not send the message.
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open, inputId, onClose]);

  if (!open || typeof document === "undefined") return null;
  const host = document.getElementById("dx-layers");
  if (!host) return null;

  return createPortal(
    <div ref={panel} className="dx-menu dx-skill-command-menu" role="listbox" aria-label={t("dx.composer.slashAria")}>
      <div className="dx-skill-command-heading">
        {t("dx.composer.skillsHeading")} <span>{t("dx.composer.skillsTemplates")}</span>
      </div>
      {options.length > 0 ? (
        options.map((template) => (
          <button
            key={template.id}
            type="button"
            role="option"
            aria-selected={template.id === selectedId}
            data-act="skill-select"
            data-id={template.id}
            onClick={() => onPick(template)}
          >
            <FileIcon ext="pptx" size={20} />
            <span>
              <strong>{template.name}</strong>
              <small>{t("dx.composer.createPresentation")}</small>
            </span>
            {template.id === selectedId ? <Icon name="Check" size={14} /> : null}
          </button>
        ))
      ) : (
        <p>{t(templates.length ? "dx.composer.slashNoMatch" : "dx.composer.slashEmpty")}</p>
      )}
      <button type="button" className="dx-skill-manage" data-act="skill-manage" onClick={onManage}>
        <Icon name="Plus" size={16} />
        {t(templates.length ? "dx.composer.manageTemplates" : "dx.composer.addTemplate")}
      </button>
    </div>,
    host,
  );
}
