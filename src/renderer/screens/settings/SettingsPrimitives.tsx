import { Switch } from "../../ui";
import type { ReactNode } from "react";
import { type Locale } from "../../i18n";
export function settingsSectionId(section: string): string {
  return `settings-section-${section}`;
}

export function SettingsSection({
  id,
  title,
  variant = "standard",
  children,
}: {
  id: string;
  title: string;
  variant?: "standard" | "full" | "danger";
  children: ReactNode;
}) {
  const titleId = `${id}-title`;
  return (
    <section className="setting-group" id={id} data-variant={variant} aria-labelledby={titleId}>
      <h2 className="ui-sr-only" id={titleId}>{title}</h2>
      <div className="settings-section-body">{children}</div>
    </section>
  );
}

export function SettingsToggle({
  label,
  ariaLabel,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="settings-toggle-control">
      <span>{label}</span>
      <Switch aria-label={ariaLabel} checked={checked} disabled={disabled} onChange={onChange} />
    </div>
  );
}

export function toggleStatusLabel(checked: boolean, locale: Locale): string {
  if (locale === "zh") return checked ? "已开启" : "已关闭";
  return checked ? "On" : "Off";
}

export function SettingRow({
  title,
  desc,
  variant = "standard",
  children,
}: {
  title: string;
  desc: string;
  variant?: "standard" | "form" | "actions";
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row" data-variant={variant}>
      <div className="setting-copy">
        <h3>{title}</h3>
        <p>{desc}</p>
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}
