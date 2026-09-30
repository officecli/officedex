import type { InputHTMLAttributes, ReactNode } from "react";

/**
 * The three things a Settings section is made of — OD-UI-1.2 §12.
 *
 * A row is a title, one sentence, and one control. The title is plain text in
 * the row and the sentence is its paragraph, which is how the stylesheet finds
 * them; neither is a heading, because a section already has one.
 */
export function Row({ title, desc, children }: { title: string; desc: ReactNode; children?: ReactNode }) {
  return (
    <div className="dx-setting-row">
      <div className="dx-grow">
        {title}
        <p>{desc}</p>
      </div>
      {children}
    </div>
  );
}

/** A preference that is on or off. It takes effect when pressed; there is no Save. */
export function Toggle({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="dx-switch"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      data-act="preference-toggle"
      data-id={id}
      onClick={() => onChange(!checked)}
    />
  );
}

/** A labelled field in a dialog's form. */
export function Field({
  label,
  invalid,
  ...input
}: { label: string; invalid?: boolean } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="dx-form-field">
      <span>{label}</span>
      <input {...input} aria-invalid={invalid ? true : undefined} />
    </label>
  );
}
