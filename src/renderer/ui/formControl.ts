export const formValueEvent = Symbol("formValueEvent");

export type FormValueEventName = "onChange" | "onValueChange" | "onCheckedChange";

export interface FormAwareComponent {
  readonly [formValueEvent]?: FormValueEventName;
}
