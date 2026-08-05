import { useState } from "react";
import { formValueEvent } from "../formControl";
import { Input, type InputProps } from "./Input";

export interface PasswordInputProps extends Omit<InputProps, "type"> {
  readonly visibilityLabels?: { show: string; hide: string };
}

function PasswordInputRoot({ visibilityLabels = { show: "Show password", hide: "Hide password" }, disabled, className, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <span className={["ui-password-input", className].filter(Boolean).join(" ")}>
      <Input {...props} className="ui-password-input__field" disabled={disabled} type={visible ? "text" : "password"} />
      <button
        type="button"
        aria-label={visible ? visibilityLabels.hide : visibilityLabels.show}
        className="ui-password-input__toggle"
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? "−" : "•"}
      </button>
    </span>
  );
}

export const PasswordInput = Object.assign(PasswordInputRoot, { [formValueEvent]: "onChange" as const });
