import { forwardRef } from "react";
import { Button as WdButton } from "weboffice-design/button";
import type { ButtonSize, ButtonVariant } from "weboffice-design/button";
import type { UiButtonProps, UiButtonSize, UiButtonType } from "../../types";

export { Input } from "weboffice-design/input";
export { Select } from "weboffice-design/select";
export { Switch } from "weboffice-design/switch";
export { RadioGroup } from "weboffice-design/radio-group";
export { Radio } from "weboffice-design/radio";
export { Loading } from "weboffice-design/loading";

export type { InputProps } from "weboffice-design/input";
export type { SelectOption, SelectProps, SelectValue } from "weboffice-design/select";
export type { SwitchProps } from "weboffice-design/switch";
export type { RadioGroupProps } from "weboffice-design/radio-group";
export type { LoadingProps } from "weboffice-design/loading";
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
  { type = "default", htmlType, size = "middle", danger, ...rest },
  ref,
) {
  const variant = danger ? DANGER_VARIANT_BY_TYPE[type] : VARIANT_BY_TYPE[type];
  return <WdButton {...rest} ref={ref} variant={variant} size={SIZE_BY_UI_SIZE[size]} type={htmlType} />;
});
