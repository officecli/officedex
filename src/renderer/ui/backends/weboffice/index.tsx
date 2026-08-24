import { forwardRef } from "react";
import { Button as WdButton } from "weboffice-design/button";
import type { ButtonSize, ButtonVariant } from "weboffice-design/button";
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
export { Switch } from "weboffice-design/switch";
export { RadioGroup } from "weboffice-design/radio-group";
export { Radio } from "weboffice-design/radio";
export { Loading } from "weboffice-design/loading";
export { Tabs } from "weboffice-design/tabs";
export { Toast } from "weboffice-design/toast";
export { Tooltip } from "weboffice-design/tooltip";

export type { InputProps } from "weboffice-design/input";
export type { SelectOption, SelectProps, SelectValue } from "weboffice-design/select";
export type { SwitchProps } from "weboffice-design/switch";
export type { RadioGroupProps } from "weboffice-design/radio-group";
export type { LoadingProps } from "weboffice-design/loading";
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
  { type = "default", htmlType, size = "middle", danger, ...rest },
  ref,
) {
  const variant = danger ? DANGER_VARIANT_BY_TYPE[type] : VARIANT_BY_TYPE[type];
  return <WdButton {...rest} ref={ref} variant={variant} size={SIZE_BY_UI_SIZE[size]} type={htmlType} />;
});
