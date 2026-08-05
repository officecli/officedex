import { Children, cloneElement, createContext, isValidElement, useContext, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { formValueEvent, type FormAwareComponent, type FormValueEventName } from "../formControl";

type FormValues = object;

export interface FormRule {
  readonly required?: boolean;
  readonly min?: number;
  readonly max?: number;
  readonly type?: "email";
  readonly message?: string;
  readonly validator?: (value: unknown) => void | Promise<void>;
}

export interface FormInstance<T extends FormValues = FormValues> {
  getFieldValue<K extends keyof T>(name: K): T[K] | undefined;
  getFieldsValue(): Partial<T>;
  setFieldValue<K extends keyof T>(name: K, value: T[K] | undefined): void;
  setFieldsValue(values: Partial<T>): void;
  resetFields(): void;
  submit(): void;
}

interface FormController<T extends FormValues> {
  getValues: () => Partial<T>;
  setValues: (values: Partial<T>) => void;
  reset: () => void;
  submit: () => void;
}

function createFormInstance<T extends FormValues>(): FormInstance<T> & { bind(controller: FormController<T> | null): void } {
  let controller: FormController<T> | null = null;
  return {
    bind: (next) => { controller = next; },
    getFieldValue: (name) => controller?.getValues()[name],
    getFieldsValue: () => controller?.getValues() ?? {},
    setFieldValue: (name, value) => controller?.setValues({ [name]: value } as Partial<T>),
    setFieldsValue: (values) => controller?.setValues(values),
    resetFields: () => controller?.reset(),
    submit: () => controller?.submit(),
  };
}

export function useForm<T extends FormValues>(): [FormInstance<T>] {
  const ref = useRef<ReturnType<typeof createFormInstance<T>> | null>(null);
  if (!ref.current) ref.current = createFormInstance<T>();
  return [ref.current];
}

interface RegisteredField {
  readonly name: string;
  readonly rules: readonly FormRule[];
  readonly element: HTMLElement | null;
}

interface FormContextValue {
  readonly values: Record<string, unknown>;
  readonly errors: Record<string, string>;
  readonly setField: (name: string, value: unknown) => void;
  readonly register: (field: RegisteredField) => () => void;
}

const FormContext = createContext<FormContextValue | null>(null);

export interface FormProps<T extends FormValues> extends Omit<React.FormHTMLAttributes<HTMLFormElement>, "onSubmit"> {
  readonly form?: FormInstance<T>;
  readonly initialValues?: Partial<T>;
  readonly onFinish: (values: T) => void | Promise<void>;
  readonly onValuesChange?: (changed: Partial<T>, values: T) => void;
  readonly layout?: "vertical" | "horizontal";
  readonly children?: ReactNode;
}

function valueFromArgs(args: unknown[]): unknown {
  const first = args[0];
  if (first && typeof first === "object" && ("currentTarget" in first || "target" in first)) {
    const event = first as { currentTarget?: { value?: unknown; checked?: boolean; type?: string }; target?: { value?: unknown; checked?: boolean; type?: string } };
    const target = event.currentTarget ?? event.target;
    return target?.type === "checkbox" ? target.checked : target?.value;
  }
  return first;
}

function validationMessage(value: unknown, rule: FormRule): string | null {
  const empty = value == null || value === "" || (Array.isArray(value) && value.length === 0);
  if (rule.required && empty) return rule.message ?? "Required";
  if (empty) return null;
  const measured = typeof value === "number" ? value : String(value).length;
  if (rule.min != null && measured < rule.min) return rule.message ?? `Must be at least ${rule.min}`;
  if (rule.max != null && measured > rule.max) return rule.message ?? `Must be at most ${rule.max}`;
  if (rule.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) return rule.message ?? "Invalid email";
  return null;
}

function FormRoot<T extends FormValues>({ form, initialValues, onFinish, onValuesChange, layout = "vertical", children, className, ...props }: FormProps<T>) {
  const internalForm = useMemo(() => createFormInstance<T>(), []);
  const activeForm = (form ?? internalForm) as ReturnType<typeof createFormInstance<T>>;
  const initialRef = useRef<Partial<T>>({ ...(initialValues ?? {}) } as Partial<T>);
  const [values, setValuesState] = useState<Partial<T>>(() => ({ ...initialRef.current }));
  const valuesRef = useRef(values);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fields = useRef(new Map<string, RegisteredField>());
  const formRef = useRef<HTMLFormElement | null>(null);

  const setValues = (patch: Partial<T>) => {
    const next = { ...valuesRef.current, ...patch };
    valuesRef.current = next;
    setValuesState(next);
    onValuesChange?.(patch, next as T);
  };

  const submit = async () => {
    const nextErrors: Record<string, string> = {};
    for (const field of fields.current.values()) {
      const value = valuesRef.current[field.name as keyof T];
      for (const rule of field.rules) {
        const message = validationMessage(value, rule);
        if (message) {
          nextErrors[field.name] = message;
          break;
        }
        if (rule.validator) {
          try {
            await rule.validator(value);
          } catch (error) {
            nextErrors[field.name] = error instanceof Error ? error.message : (rule.message ?? "Invalid value");
            break;
          }
        }
      }
    }
    setErrors(nextErrors);
    const firstInvalid = Object.keys(nextErrors)[0];
    if (firstInvalid) {
      fields.current.get(firstInvalid)?.element?.querySelector<HTMLElement>("input, textarea, select, button")?.focus();
      return;
    }
    await onFinish(valuesRef.current as T);
  };

  useEffect(() => {
    activeForm.bind({
      getValues: () => valuesRef.current,
      setValues,
      reset: () => {
        const next = { ...initialRef.current };
        valuesRef.current = next;
        setValuesState(next);
        setErrors({});
      },
      submit: () => { void submit(); },
    });
    return () => activeForm.bind(null);
  });

  const context = useMemo<FormContextValue>(() => ({
    values: values as Record<string, unknown>,
    errors,
    setField: (name, value) => {
      if (Object.is(valuesRef.current[name as keyof T], value)) return;
      setValues({ [name]: value } as Partial<T>);
      setErrors((current) => {
        if (!current[name]) return current;
        const next = { ...current };
        delete next[name];
        return next;
      });
    },
    register: (field) => {
      fields.current.set(field.name, field);
      return () => fields.current.delete(field.name);
    },
  }), [errors, values]);

  return (
    <FormContext.Provider value={context}>
      <form
        {...props}
        ref={formRef}
        className={["ui-form", className].filter(Boolean).join(" ")}
        data-layout={layout}
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          void submit();
        }}
      >
        {children}
      </form>
    </FormContext.Provider>
  );
}

export interface FormItemProps {
  readonly name?: string;
  readonly label?: ReactNode;
  readonly rules?: readonly FormRule[];
  readonly hidden?: boolean;
  readonly noStyle?: boolean;
  readonly extra?: ReactNode;
  readonly required?: boolean;
  readonly validateStatus?: "success" | "warning" | "error" | "validating";
  readonly help?: ReactNode;
  readonly children: ReactElement;
}

function FormItem({ name, label, rules = [], hidden, noStyle, extra, required, validateStatus, help, children }: FormItemProps) {
  const context = useContext(FormContext);
  const id = useId();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  if (!context) throw new Error("Form.Item must be rendered inside Form");

  useEffect(() => name ? context.register({ name, rules, element: wrapperRef.current }) : undefined, [context, name, rules]);

  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const component = child.type as FormAwareComponent;
  const trigger: FormValueEventName = component[formValueEvent] ?? "onChange";
  const original = (child.props as Record<string, unknown>)[trigger];
  const error = name ? context.errors[name] : undefined;
  const control = name ? cloneElement(child, {
    id: (child.props as { id?: string }).id ?? id,
    value: context.values[name] ?? "",
    [trigger]: (...args: unknown[]) => {
      if (typeof original === "function") (original as (...values: unknown[]) => void)(...args);
      context.setField(name, valueFromArgs(args));
    },
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? id : undefined,
  } as Record<string, unknown>) : child;

  return (
    <div ref={wrapperRef} className={noStyle ? "ui-form-item ui-form-item--no-style" : "ui-form-item"} hidden={hidden}>
      {label && !noStyle ? <label className="ui-form-item__label" htmlFor={name ? ((child.props as { id?: string }).id ?? id) : undefined}>{label}{required ? <span aria-hidden="true"> *</span> : null}</label> : null}
      {control}
      {extra ? <div className="ui-form-item__extra">{extra}</div> : null}
      {error || help ? <div className="ui-form-item__error" data-status={validateStatus} id={id} role="alert">{error ?? help}</div> : null}
    </div>
  );
}

export const Form = Object.assign(FormRoot, { Item: FormItem, useForm });
