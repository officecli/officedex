import * as Lucide from "lucide-react";
import { ChevronDown, MessageSquare, Pencil, type LucideIcon } from "lucide-react";
import { useState } from "react";

import type { FileType } from "../../shared/uiPort";
import { ribbonTabs, STYLE_TILES, type RibbonTool } from "./ribbonSpec";
import "./ribbon.css";

/**
 * Resolves a spec's icon name against Lucide, falling back to a neutral glyph.
 * Keeping the lookup here means `ribbonSpec.ts` stays plain data and can be
 * edited without touching components.
 */
function icon(name: string | undefined): LucideIcon {
  if (!name) return Lucide.Circle;
  const found = (Lucide as unknown as Record<string, LucideIcon | undefined>)[name];
  return found ?? Lucide.Circle;
}

export interface RibbonProps {
  type: FileType;
}

export function Ribbon({ type }: RibbonProps) {
  const tabs = ribbonTabs(type);
  const [activeByType, setActiveByType] = useState<Partial<Record<FileType, string>>>({});
  // Each document type remembers its own tab, so switching files does not
  // silently reset the user to Home.
  const active = tabs.find((tab) => tab.id === activeByType[type]) ?? tabs[0];
  const setActiveId = (id: string) => setActiveByType((current) => ({ ...current, [type]: id }));

  return (
    <div className="shell-ribbon shell-region" data-file-type={type}>
      <div className="shell-ribbon-tabs">
        <div className="shell-ribbon-tablist" role="tablist" aria-label="Ribbon tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === active.id}
              tabIndex={tab.id === active.id ? 0 : -1}
              className={`shell-ribbon-tab${tab.id === active.id ? " is-active" : ""}`}
              onClick={() => setActiveId(tab.id)}
              onKeyDown={(event) => {
                if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                event.preventDefault();
                const index = tabs.findIndex((entry) => entry.id === active.id);
                const next = (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
                setActiveId(tabs[next].id);
                // Move focus with the selection, as a tablist should.
                const strip = event.currentTarget.parentElement;
                (strip?.children[next] as HTMLElement | undefined)?.focus();
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Pinned: the document-level actions must not be pushed out by a long
            tab set on a narrow workspace. */}
        <div className="shell-ribbon-tabs-end">
          <button type="button" className="shell-ribbon-meta">
            <MessageSquare size={14} strokeWidth={1.7} aria-hidden="true" />
            <span>Comments</span>
          </button>
          <button type="button" className="shell-ribbon-meta">
            <Pencil size={14} strokeWidth={1.7} aria-hidden="true" />
            <span>Editing</span>
            <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="shell-ribbon-tools" role="tabpanel" aria-label={`${active.label} tools`}>
        {active.groups.map((group) => (
          <section key={group.id} className="shell-ribbon-group">
            <div className="shell-ribbon-group-body">
              {group.rows.map((row, index) => (
                <div key={index} className="shell-ribbon-row">
                  {row.map((tool) => (
                    <Tool key={tool.id} tool={tool} />
                  ))}
                </div>
              ))}
            </div>
            <div className="shell-ribbon-group-label">{group.label}</div>
          </section>
        ))}
      </div>
    </div>
  );
}

function Tool({ tool }: { tool: RibbonTool }) {
  const Glyph = icon(tool.icon);

  if (tool.kind === "select") {
    return (
      <label className="shell-ribbon-select" style={{ width: tool.width }}>
        <span className="shell-visually-hidden">{tool.id.replace(/-/g, " ")}</span>
        <select defaultValue={tool.options?.[0]}>
          {tool.options?.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown size={12} strokeWidth={1.8} aria-hidden="true" />
      </label>
    );
  }

  if (tool.kind === "gallery") {
    return (
      <div className="shell-ribbon-gallery" role="group" aria-label="Text styles">
        {STYLE_TILES.map((tile, index) => (
          <button
            key={tile}
            type="button"
            className={`shell-ribbon-tile${index === 0 ? " is-active" : ""}`}
            data-tile={tile}
          >
            {tile}
          </button>
        ))}
      </div>
    );
  }

  if (tool.kind === "big") {
    return (
      <button type="button" className="shell-ribbon-button is-big" title={tool.label}>
        <Glyph size={22} strokeWidth={1.6} aria-hidden="true" />
        <span>{tool.label}</span>
      </button>
    );
  }

  const label = tool.label ?? tool.id.replace(/-/g, " ");
  return (
    <button
      type="button"
      className="shell-ribbon-button"
      aria-label={tool.label ? undefined : label}
      aria-pressed={tool.kind === "toggle" ? Boolean(tool.pressed) : undefined}
      title={label}
    >
      <Glyph size={17} strokeWidth={1.7} aria-hidden="true" />
      {tool.kind === "label" && tool.label ? <span>{tool.label}</span> : null}
    </button>
  );
}
