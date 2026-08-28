import { forwardRef, useState, type ButtonHTMLAttributes, type CSSProperties, type HTMLAttributes, type InputHTMLAttributes, type ReactNode } from "react";
import type { UiButtonProps, UiButtonSize, UiButtonType } from "../../types";

export type TooltipPlacement = string;
export type LoadingSize = "mini" | "small" | "medium" | "large";

const buttonVariant: Record<UiButtonType, string> = {
  primary: "ui-button-primary",
  default: "ui-button-secondary",
  text: "ui-button-ghost",
  link: "ui-button-link",
};

const buttonSize: Record<UiButtonSize, string> = {
  small: "ui-button-sm",
  middle: "ui-button-md",
  large: "ui-button-lg",
};

export const Button = forwardRef<HTMLButtonElement, UiButtonProps>(function Button(
  { type = "default", htmlType, size = "middle", danger, block, loading, icon, children, className = "", style, disabled, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      type={htmlType ?? "button"}
      disabled={disabled || loading}
      data-variant={type}
      className={`ui-button ${buttonVariant[type]} ${buttonSize[size]} ${danger ? "ui-button-danger" : ""} ${block ? "ui-button-block" : ""} ${loading ? "ui-button-loading" : ""} ${className}`.trim()}
      style={block ? { width: "100%", ...style } : style}
    >
      {loading ? <span className="ui-spinner ui-spinner-inline" aria-hidden="true" /> : icon ? <span className="ui-button-icon" aria-hidden="true">{icon}</span> : null}
      {children ? <span className="ui-button-label">{children}</span> : null}
    </button>
  );
});

export interface UiTooltipProps extends Omit<HTMLAttributes<HTMLSpanElement>, "title" | "content"> {
  title?: ReactNode;
  content?: ReactNode;
  placement?: TooltipPlacement;
  children: ReactNode;
}

export function Tooltip({ title, content, children, className = "", onMouseEnter, onMouseLeave, ...rest }: UiTooltipProps) {
  const label = content ?? title;
  const [visible, setVisible] = useState(false);
  return <span {...rest} className={`ui-tooltip ${className}`.trim()} data-tooltip={typeof label === "string" ? label : undefined} onMouseEnter={(event) => { setVisible(true); onMouseEnter?.(event); }} onMouseLeave={(event) => { setVisible(false); onMouseLeave?.(event); }}>{children}{visible && label ? <span className="ui-tooltip-content" role="tooltip">{label}</span> : null}</span>;
}

export interface UiSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  defaultChecked?: boolean;
  ariaLabel?: string;
  "aria-label"?: string;
  onChange?: (checked: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
  onCheckedChange?: (checked: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
}

export function Switch({ checked, defaultChecked, ariaLabel, "aria-label": nativeLabel, onChange, onCheckedChange, ...rest }: UiSwitchProps) {
  const [internal, setInternal] = useState(Boolean(defaultChecked));
  const value = checked ?? internal;
  return <button {...rest} type="button" role="switch" aria-checked={value} aria-label={ariaLabel ?? nativeLabel} className={`ui-switch ${value ? "is-checked" : ""} ${rest.className ?? ""}`.trim()} onClick={(event) => { const next = !value; if (checked === undefined) setInternal(next); onCheckedChange?.(next, event); onChange?.(next, event); }}><span className="ui-switch-thumb" /></button>;
}

export interface UiLoadingProps { size?: string; ariaLabel?: string; "aria-label"?: string; className?: string; }
export function Loading({ size, ariaLabel, "aria-label": nativeLabel, className = "" }: UiLoadingProps) {
  const resolved = size === "small" ? "small" : size === "large" ? "large" : "medium";
  return <span className={`ui-loading ui-loading-${resolved} ${className}`.trim()} role="status" aria-label={ariaLabel ?? nativeLabel}><span className="ui-spinner" /></span>;
}
export const Spin = Loading;
export function toLoadingSize(size?: string): LoadingSize { return size === "small" || size === "large" || size === "mini" ? size : "medium"; }

export interface UiSelectOption<T = string> { value: T; label: ReactNode; disabled?: boolean; }
export interface UiSelectProps<T = string> {
  value?: T | null;
  defaultValue?: T | null;
  options: readonly UiSelectOption<T>[];
  ariaLabel?: string;
  "aria-label"?: string;
  placeholder?: ReactNode;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  onChange?: (value: T, option: UiSelectOption<T>, event: React.MouseEvent<HTMLButtonElement>) => void;
  onValueChange?: (value: T, option: UiSelectOption<T>, event: React.MouseEvent<HTMLButtonElement>) => void;
}
export function Select<T extends string | number>({ value, defaultValue, options, ariaLabel, "aria-label": nativeLabel, placeholder = "Select…", disabled, className = "", style, onChange, onValueChange }: UiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [internal, setInternal] = useState<T | null>(defaultValue ?? null);
  const selected = value ?? internal;
  const current = options.find((option) => option.value === selected);
  const label = current?.label ?? placeholder;
  return <span className={`ui-select ${open ? "is-open" : ""} ${className}`.trim()} style={style} data-size="medium">
    <button type="button" className="ui-select-trigger" aria-label={ariaLabel ?? nativeLabel} aria-haspopup="listbox" aria-expanded={open} disabled={disabled} onClick={() => setOpen((state) => !state)}><span>{label}</span><span className="ui-select-chevron">⌄</span></button>
    {open ? <span className="ui-select-menu" role="listbox">{options.map((option) => <button type="button" role="menuitemradio" aria-checked={option.value === selected} disabled={option.disabled} key={String(option.value)} className={`ui-select-option ${option.value === selected ? "is-selected" : ""}`} onClick={(event) => { if (value === undefined) setInternal(option.value); setOpen(false); onValueChange?.(option.value, option, event); onChange?.(option.value, option, event); }}>{option.label}</button>)}</span> : null}
  </span>;
}

export interface UiInputProps extends InputHTMLAttributes<HTMLInputElement> { ariaLabel?: string; }
export const Input = forwardRef<HTMLInputElement, UiInputProps>(function Input({ ariaLabel, className = "", ...rest }, ref) { return <input {...rest} ref={ref} aria-label={rest["aria-label"] ?? ariaLabel} className={`ui-input ${className}`.trim()} />; });

export interface InputNumberProps extends Omit<UiInputProps, "value" | "defaultValue" | "onChange"> { value?: number | null; defaultValue?: number; min?: number; max?: number; step?: number; onChange?: (value: number | null) => void; }
export function InputNumber({ value, defaultValue, min, max, step, onChange, ...rest }: InputNumberProps) { return <input {...rest} type="number" className={`ui-input ui-input-number ${rest.className ?? ""}`.trim()} value={value ?? ""} defaultValue={defaultValue} min={min} max={max} step={step} onChange={(event) => onChange?.(event.target.value === "" ? null : Number(event.target.value))} />; }

export interface CheckboxProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> { checked?: boolean; defaultChecked?: boolean; ariaLabel?: string; label?: ReactNode; onChange?: (checked: boolean) => void; }
export function Checkbox({ checked, defaultChecked, ariaLabel, label, onChange, ...rest }: CheckboxProps) { const [internal, setInternal] = useState(Boolean(defaultChecked)); const value = checked ?? internal; return <button {...rest} type="button" role="checkbox" aria-checked={value} aria-label={ariaLabel ?? rest["aria-label"]} className={`ui-checkbox ${value ? "is-checked" : ""} ${rest.className ?? ""}`.trim()} onClick={() => { const next = !value; if (checked === undefined) setInternal(next); onChange?.(next); }}><span className="ui-checkbox-box">{value ? "✓" : ""}</span>{label ? <span>{label}</span> : null}</button>; }

export function RadioGroup({ children, value, onValueChange, ariaLabel, className = "", ...rest }: HTMLAttributes<HTMLDivElement> & { value?: string; onValueChange?: (value: string) => void; ariaLabel?: string }) { return <div {...rest} role="radiogroup" aria-label={ariaLabel ?? rest["aria-label"]} className={`ui-radio-group ${className}`.trim()} data-value={value} onClick={(event) => { const target = (event.target as HTMLElement).closest<HTMLElement>("[data-radio-value]"); if (target) onValueChange?.(target.dataset.radioValue ?? ""); }}>{children}</div>; }
export function Radio({ value, children, checked, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { value?: string; checked?: boolean }) { return <button {...rest} type="button" role="radio" aria-checked={checked} data-radio-value={value} className={`ui-radio ${checked ? "is-checked" : ""} ${className}`.trim()}>{children}</button>; }

export function Empty({ title = "No data", description, className = "", ...rest }: HTMLAttributes<HTMLDivElement> & { title?: ReactNode; description?: ReactNode }) { return <div {...rest} className={`ui-empty ${className}`.trim()}><span className="ui-empty-mark">○</span><strong>{title}</strong>{description ? <span>{description}</span> : null}</div>; }
export function MessageBar({ children, className = "", ...rest }: HTMLAttributes<HTMLDivElement>) { return <div {...rest} className={`ui-message-bar ${className}`.trim()} role="status">{children}</div>; }
export function Toast({ title, description, children, className = "", ...rest }: HTMLAttributes<HTMLDivElement> & { title?: ReactNode; description?: ReactNode }) { return <div {...rest} className={`ui-toast ${className}`.trim()} role="status"><strong>{title ?? children}</strong>{description ? <span>{description}</span> : null}</div>; }

export interface DialogProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> { open?: boolean; title?: ReactNode; children?: ReactNode; onClose?: () => void; size?: string; type?: string; }
export function Dialog({ open = false, title, children, onClose, className = "", ...rest }: DialogProps) { if (!open) return null; return <div className="ui-dialog-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose?.(); }}><div {...rest} role="dialog" aria-modal="true" className={`ui-dialog ${className}`.trim()}><div className="ui-dialog-header"><strong>{title}</strong>{onClose ? <button type="button" aria-label="Close" className="ui-dialog-close" onClick={onClose}>×</button> : null}</div><div className="ui-dialog-body">{children}</div></div></div>; }

export interface DropdownProps { open?: boolean; menu?: Array<{ key: string; label: ReactNode; onClick?: () => void }>; children: ReactNode; }
export function Dropdown({ open, menu = [], children }: DropdownProps) { const [internal, setInternal] = useState(false); const visible = open ?? internal; return <span className="ui-dropdown"><span onClick={() => setInternal((state) => !state)}>{children}</span>{visible ? <span className="ui-dropdown-menu" role="menu">{menu.map((item) => <button type="button" role="menuitem" key={item.key} onClick={() => { item.onClick?.(); setInternal(false); }}>{item.label}</button>)}</span> : null}</span>; }
export function Menu({ items = [], className = "", ...rest }: HTMLAttributes<HTMLDivElement> & { items?: Array<{ key: string; label: ReactNode }> }) { return <div {...rest} className={`ui-menu ${className}`.trim()}>{items.map((item) => <button type="button" role="menuitem" key={item.key}>{item.label}</button>)}</div>; }
export function Tabs({ items = [], activeKey, onChange, className = "", ...rest }: HTMLAttributes<HTMLDivElement> & { items?: Array<{ key: string; label: ReactNode; content?: ReactNode }>; activeKey?: string; onChange?: (key: string) => void }) { const [internal, setInternal] = useState(items[0]?.key); const active = activeKey ?? internal; const current = items.find((item) => item.key === active) ?? items[0]; return <div {...rest} className={`ui-tabs ${className}`.trim()}><div className="ui-tabs-list">{items.map((item) => <button type="button" role="tab" aria-selected={item.key === active} key={item.key} className={item.key === active ? "is-active" : ""} onClick={() => { setInternal(item.key); onChange?.(item.key); }}>{item.label}</button>)}</div><div className="ui-tabs-panel">{current?.content}</div></div>; }

export function toTooltipPlacement(placement?: string): string | undefined {
  if (!placement) return undefined;
  return ({ top: "topCenter", bottom: "bottomCenter", left: "leftCenter", right: "rightCenter" } as Record<string, string>)[placement] ?? placement;
}
export type { UiButtonProps };
