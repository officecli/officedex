import { Input, PasswordInput, TextArea, type InputProps, type PasswordInputProps, type TextAreaProps } from "../ui";
import { formValueEvent } from "../ui/formControl";
import { useEffect, useRef, useState, type ChangeEvent, type CompositionEvent, type TextareaHTMLAttributes } from "react";

type InputElement = HTMLInputElement | HTMLTextAreaElement;
type ImeValueProps<E extends InputElement> = {
  value?: string;
  onChange?: (event: ChangeEvent<E>) => void;
  onValueChange?: (value: string) => void;
};

function valueToString(value: unknown): string {
  return value == null ? "" : String(value);
}

function useImeValue<E extends InputElement>({
  value,
  onChange,
  onValueChange,
}: {
  value?: string;
  onChange?: (event: ChangeEvent<E>) => void;
  onValueChange?: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(() => valueToString(value));
  const composingRef = useRef(false);
  const lastCompositionCommitRef = useRef<string | null>(null);

  useEffect(() => {
    if (!composingRef.current) {
      setDraftValue(valueToString(value));
    }
  }, [value]);

  function emitChange(event: ChangeEvent<E>) {
    onChange?.(event);
    onValueChange?.(event.currentTarget.value);
  }

  function handleChange(event: ChangeEvent<E>) {
    const nextValue = event.currentTarget.value;
    setDraftValue(nextValue);
    if (composingRef.current) return;
    if (lastCompositionCommitRef.current === nextValue) {
      lastCompositionCommitRef.current = null;
      return;
    }
    emitChange(event);
  }

  function handleCompositionStart(event: CompositionEvent<E>, original?: (event: CompositionEvent<E>) => void) {
    composingRef.current = true;
    lastCompositionCommitRef.current = null;
    setDraftValue(event.currentTarget.value);
    original?.(event);
  }

  function handleCompositionEnd(event: CompositionEvent<E>, original?: (event: CompositionEvent<E>) => void) {
    const nextValue = event.currentTarget.value;
    composingRef.current = false;
    lastCompositionCommitRef.current = nextValue;
    setDraftValue(nextValue);
    original?.(event);
    onValueChange?.(nextValue);
    if (onChange) {
      onChange(event as unknown as ChangeEvent<E>);
    }
  }

  return {
    draftValue,
    handleChange,
    handleCompositionStart,
    handleCompositionEnd,
  };
}

export type ImeInputProps = Omit<InputProps, "onChange" | "value"> & ImeValueProps<HTMLInputElement>;

function ImeInputRoot({ value, onChange, onValueChange, onCompositionStart, onCompositionEnd, ...props }: ImeInputProps) {
  const ime = useImeValue<HTMLInputElement>({ value, onChange, onValueChange });
  return (
    <Input
      {...props}
      value={ime.draftValue}
      onChange={ime.handleChange}
      onCompositionStart={(event) => ime.handleCompositionStart(event, onCompositionStart)}
      onCompositionEnd={(event) => ime.handleCompositionEnd(event, onCompositionEnd)}
    />
  );
}

export const ImeInput = Object.assign(ImeInputRoot, { [formValueEvent]: "onValueChange" as const });

export type ImePasswordInputProps = Omit<PasswordInputProps, "onChange" | "value"> & ImeValueProps<HTMLInputElement>;

function ImePasswordInputRoot({ value, onChange, onValueChange, onCompositionStart, onCompositionEnd, ...props }: ImePasswordInputProps) {
  const ime = useImeValue<HTMLInputElement>({ value, onChange, onValueChange });
  return (
    <PasswordInput
      {...props}
      value={ime.draftValue}
      onChange={ime.handleChange}
      onCompositionStart={(event) => ime.handleCompositionStart(event, onCompositionStart)}
      onCompositionEnd={(event) => ime.handleCompositionEnd(event, onCompositionEnd)}
    />
  );
}

export const ImePasswordInput = Object.assign(ImePasswordInputRoot, { [formValueEvent]: "onValueChange" as const });

export type ImeTextAreaProps = Omit<TextAreaProps, "onChange" | "value"> & ImeValueProps<HTMLTextAreaElement>;

function ImeTextAreaRoot({ value, onChange, onValueChange, onCompositionStart, onCompositionEnd, ...props }: ImeTextAreaProps) {
  const ime = useImeValue<HTMLTextAreaElement>({ value, onChange, onValueChange });
  return (
    <TextArea
      {...props}
      value={ime.draftValue}
      onChange={ime.handleChange}
      onCompositionStart={(event) => ime.handleCompositionStart(event, onCompositionStart)}
      onCompositionEnd={(event) => ime.handleCompositionEnd(event, onCompositionEnd)}
    />
  );
}

export const ImeTextArea = Object.assign(ImeTextAreaRoot, { [formValueEvent]: "onValueChange" as const });

export type ImePlainTextAreaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange" | "value"> & ImeValueProps<HTMLTextAreaElement>;

export function ImePlainTextArea({ value, onChange, onValueChange, onCompositionStart, onCompositionEnd, className, ...props }: ImePlainTextAreaProps) {
  const ime = useImeValue<HTMLTextAreaElement>({ value, onChange, onValueChange });
  const mergedClassName = ["ui-textarea", className].filter(Boolean).join(" ");
  return (
    <textarea
      {...props}
      className={mergedClassName}
      value={ime.draftValue}
      onChange={ime.handleChange}
      onCompositionStart={(event) => ime.handleCompositionStart(event, onCompositionStart)}
      onCompositionEnd={(event) => ime.handleCompositionEnd(event, onCompositionEnd)}
    />
  );
}
