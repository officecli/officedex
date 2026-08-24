import { forwardRef } from "react";
import { Button as WdButton } from "weboffice-design/button";
import { Tooltip as WdTooltip } from "weboffice-design/tooltip";
import { Switch as WdSwitch } from "weboffice-design/switch";
import { Loading as WdLoading } from "weboffice-design/loading";
import type { ButtonSize, ButtonVariant } from "weboffice-design/button";
import type { TooltipPlacement, TooltipProps as WdTooltipProps } from "weboffice-design/tooltip";
import type { SwitchProps as WdSwitchProps } from "weboffice-design/switch";
import type { LoadingProps as WdLoadingProps, LoadingSize } from "weboffice-design/loading";
import type { UiButtonProps, UiButtonSize, UiButtonType } from "../../types";

export { Checkbox } from "weboffice-design/checkbox";
export { Dialog } from "weboffice-design/dialog";
export { Dropdown } from "weboffice-design/dropdown";
export { Empty } from "weboffice-design/empty";
export { Input } from "weboffice-design/input";
export { InputNumber } from "weboffice-design/input-number";
export { Menu } from "weboffice-design/menu";
export { MessageBar } from "weboffice-design/message-bar";
export { Select } from "weboffice-design/select";
export { RadioGroup } from "weboffice-design/radio-group";
export { Radio } from "weboffice-design/radio";
export { Tabs } from "weboffice-design/tabs";
export { Toast } from "weboffice-design/toast";

export type { InputProps } from "weboffice-design/input";
export type { SelectOption, SelectProps, SelectValue } from "weboffice-design/select";
export type { SwitchProps } from "weboffice-design/switch";
export type { RadioGroupProps } from "weboffice-design/radio-group";
export type { LoadingProps } from "weboffice-design/loading";
export type { TooltipPlacement } from "weboffice-design/tooltip";
export type { CheckboxProps } from "weboffice-design/checkbox";
export type { DialogProps } from "weboffice-design/dialog";
export type { DropdownProps } from "weboffice-design/dropdown";
export type { EmptyProps } from "weboffice-design/empty";
export type { InputNumberProps } from "weboffice-design/input-number";
export type { MenuProps } from "weboffice-design/menu";
export type { MessageBarProps } from "weboffice-design/message-bar";
export type { TabsProps } from "weboffice-design/tabs";
export type { ToastProps } from "weboffice-design/toast";
export type { TooltipProps } from "weboffice-design/tooltip";
export type { UiButtonProps };

const VARIANT_BY_TYPE: Record<UiButtonType, ButtonVariant> = {
  primary: "primary",
  default: "secondary",
  text: "ghost-normal",
  link: "ghost-guidance",
};

const DANGER_VARIANT_BY_TYPE: Record<UiButtonType, ButtonVariant> = {
  primary: "danger",
  default: "danger",
  text: "ghost-danger",
  link: "ghost-danger",
};

const SIZE_BY_UI_SIZE: Record<UiButtonSize, ButtonSize> = {
  small: "small",
  middle: "medium",
  large: "large",
};

/**
 * Adapts the legacy AntD-shaped button contract used across the app onto the
 * weboffice-design button. New call sites may use the design-system props
 * directly; the mapping exists so existing screens keep compiling.
 */
export const Button = forwardRef<HTMLButtonElement, UiButtonProps>(function Button(
  { type = "default", htmlType, size = "middle", danger, block, style, "aria-label": ariaLabel, ...rest },
  ref,
) {
  const variant = danger ? DANGER_VARIANT_BY_TYPE[type] : VARIANT_BY_TYPE[type];
  // weboffice-design has no full-width variant, so `block` is applied as layout.
  const resolvedStyle = block ? { width: "100%", ...style } : style;
  return (
    <WdButton
      {...rest}
      ref={ref}
      variant={variant}
      size={SIZE_BY_UI_SIZE[size]}
      type={htmlType}
      style={resolvedStyle}
      // the design system drops the native attribute in favour of `ariaLabel`
      ariaLabel={ariaLabel}
    />
  );
});

/**
 * AntD names the four cardinal placements `top`/`bottom`/`left`/`right`;
 * weboffice-design spells the same alignments `topCenter` and friends. Corner
 * placements already share a name.
 */
const TOOLTIP_PLACEMENT_ALIASES: Record<string, TooltipPlacement> = {
  top: "topCenter",
  bottom: "bottomCenter",
  left: "leftCenter",
  right: "rightCenter",
};

export function toTooltipPlacement(placement?: string): TooltipPlacement | undefined {
  if (!placement) return undefined;
  return TOOLTIP_PLACEMENT_ALIASES[placement] ?? (placement as TooltipPlacement);
}

export interface UiTooltipProps extends Omit<WdTooltipProps, "content" | "placement"> {
  /** AntD's name for the tooltip body. */
  readonly title?: WdTooltipProps["content"];
  readonly content?: WdTooltipProps["content"];
  readonly placement?: string;
}

export function Tooltip({ title, content, placement, children, ...rest }: UiTooltipProps) {
  const body = content ?? title ?? "";
  return (
    <WdTooltip {...rest} content={body} placement={toTooltipPlacement(placement)}>
      {children}
    </WdTooltip>
  );
}

export interface UiSwitchProps extends Omit<WdSwitchProps, "ariaLabel"> {
  readonly ariaLabel?: string;
  /** AntD's callback shape; the design system omits the native attribute too. */
  readonly onChange?: WdSwitchProps["onCheckedChange"];
  readonly "aria-label"?: string;
}

export function Switch({ ariaLabel, onChange, onCheckedChange, "aria-label": nativeLabel, ...rest }: UiSwitchProps) {
  return (
    <WdSwitch
      {...rest}
      ariaLabel={ariaLabel ?? nativeLabel}
      onCheckedChange={onCheckedChange ?? onChange}
    />
  );
}

/** AntD spinners are `small | default | large`; the design system adds `mini`. */
export function toLoadingSize(size?: string): LoadingSize {
  if (size === "small" || size === "large" || size === "mini") return size;
  return "medium";
}

export interface UiLoadingProps extends Omit<WdLoadingProps, "size"> {
  readonly size?: string;
}

export function Loading({ size, ...rest }: UiLoadingProps) {
  return <WdLoading {...rest} size={toLoadingSize(size)} />;
}

/** AntD's spinner name, kept so call sites migrate by import alone. */
export const Spin = Loading;
