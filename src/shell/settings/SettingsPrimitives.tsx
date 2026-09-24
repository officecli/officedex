import type { ReactNode } from "react";

/**
 * The settings page's three layout primitives.
 *
 * They are deliberately smaller than the legacy page's equivalents
 * (`renderer/screens/settings/SettingsPrimitives.tsx`): the shell draws a
 * section as a titled card and a setting as a copy/control pair, and neither
 * needs a `variant` vocabulary beyond "this one is dangerous". The state label
 * legacy showed beside each switch is gone on purpose — the shell's `Switch` is
 * a `role="switch"` with `aria-checked`, so an adjacent "On"/"Off" would say
 * the same thing twice and would have to be translated twice.
 *
 * Importing the legacy primitives instead was the other option and is the wrong
 * one: their class names (`setting-row`, `setting-group`) resolve to
 * `renderer/styles/settings.css`, which the shell does not load, so they would
 * arrive unstyled — the exact failure `scripts/verify-shell-styles.mjs` exists
 * to catch.
 */

export function settingsSectionId(section: string): string {
  return `shell-settings-section-${section}`;
}

export function SettingsSection({
  id,
  title,
  variant = "standard",
  children,
}: {
  id: string;
  title: string;
  variant?: "standard" | "danger";
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section id={id} className="shell-settings-group" data-variant={variant} aria-labelledby={titleId}>
      <h2 className="shell-settings-group-title" id={titleId}>
        {title}
      </h2>
      <div className="shell-settings-group-body">{children}</div>
    </section>
  );
}

export function SettingRow({
  title,
  desc,
  variant = "standard",
  children,
}: {
  title: string;
  desc: string;
  /** `form` gives the control the full width and stacks it under the copy. */
  variant?: "standard" | "form";
  children: ReactNode;
}) {
  return (
    <div className="shell-settings-row" data-variant={variant}>
      <div className="shell-settings-copy">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="shell-settings-control">{children}</div>
    </div>
  );
}

/**
 * A full-width block inside a section, for content that brings its own
 * headings — the diagnostics row of buttons, the runtime runs table, the
 * activity list. It is not a `SettingRow` because there is no single control
 * opposite the copy.
 */
export function SettingsBlock({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="shell-settings-block">
      {title ? <h3 className="shell-settings-subhead">{title}</h3> : null}
      {children}
    </div>
  );
}
