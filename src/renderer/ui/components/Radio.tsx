import { useId, useState, type HTMLAttributes, type ReactNode } from "react";
import { formValueEvent } from "../formControl";

export interface RadioOption { readonly value: string; readonly label: ReactNode; readonly disabled?: boolean }
export interface RadioGroupCompatProps extends Omit<HTMLAttributes<HTMLDivElement>, "defaultValue" | "onChange"> {
  readonly value?: string;
  readonly defaultValue?: string;
  readonly options: readonly RadioOption[];
  readonly optionType?: "button";
  readonly onChange?: (event: { target: { value: string } }) => void;
}

function GroupRoot({ value, defaultValue, options, optionType: _optionType, onChange, className, ...props }: RadioGroupCompatProps) {
  const generatedId = useId();
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const current = value ?? uncontrolledValue;
  return (
    <div {...props} className={["ui-radio-group", className].filter(Boolean).join(" ")} role="radiogroup">
      {options.map((option, index) => {
        const optionId = `${generatedId}-${index}`;
        const selected = current === option.value;
        return (
          <label className="ui-radio-group__item" data-selected={selected ? "true" : "false"} htmlFor={optionId} key={option.value}>
            <input
              checked={selected}
              disabled={option.disabled}
              id={optionId}
              name={generatedId}
              type="radio"
              value={option.value}
              onChange={() => {
                if (value === undefined) setUncontrolledValue(option.value);
                onChange?.({ target: { value: option.value } });
              }}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}

const Group = Object.assign(GroupRoot, { [formValueEvent]: "onChange" as const });
export const Radio = { Group };
