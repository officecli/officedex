import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ToastTone = "success" | "warning" | "error" | "info" | "loading";

export interface ToastOptions {
  readonly content: ReactNode;
  readonly description?: ReactNode;
  readonly tone?: ToastTone;
  readonly duration?: number | null;
  readonly action?: { label: ReactNode; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  readonly id: string;
}

let sequence = 0;
let records: ToastRecord[] = [];
const listeners = new Set<(items: ToastRecord[]) => void>();

function emit() {
  const snapshot = [...records];
  listeners.forEach((listener) => listener(snapshot));
}

function publishToast(options: ToastOptions) {
  const id = `toast-${++sequence}`;
  records = [...records, { duration: 3000, tone: "info", ...options, id }];
  emit();
  if (options.duration !== null) {
    window.setTimeout(() => dismissToast(id), options.duration ?? 3000);
  }
  return id;
}

function dismissToast(id: string) {
  records = records.filter((record) => record.id !== id);
  emit();
}

function normalizeToastInput(input: ReactNode | Omit<ToastOptions, "tone">): Omit<ToastOptions, "tone"> {
  return typeof input === "object" && input !== null && "content" in input
    ? input as Omit<ToastOptions, "tone">
    : { content: input };
}

function show(tone: ToastTone, input: ReactNode | Omit<ToastOptions, "tone">) {
  return publishToast({ ...normalizeToastInput(input), tone });
}

export const toast = {
  success: (input: ReactNode | Omit<ToastOptions, "tone">) => show("success", input),
  warning: (input: ReactNode | Omit<ToastOptions, "tone">) => show("warning", input),
  error: (input: ReactNode | Omit<ToastOptions, "tone">) => show("error", input),
  info: (input: ReactNode | Omit<ToastOptions, "tone">) => show("info", input),
  loading: (input: ReactNode | Omit<ToastOptions, "tone">) => show("loading", { duration: null, ...normalizeToastInput(input) }),
  dismiss: dismissToast,
  destroy: () => {
    records = [];
    emit();
  },
};

export function ToastHost() {
  const [items, setItems] = useState<ToastRecord[]>(() => [...records]);

  useEffect(() => {
    listeners.add(setItems);
    setItems([...records]);
    return () => {
      listeners.delete(setItems);
    };
  }, []);

  if (items.length === 0) return null;

  return createPortal(
    <div className="ui-toast-host" aria-live="polite">
      {items.map((item) => (
        <div className="ui-toast" data-tone={item.tone} key={item.id} role="status">
          <div className="ui-toast__content">
            <strong>{item.content}</strong>
            {item.description ? <span>{item.description}</span> : null}
          </div>
          {item.action ? <button type="button" onClick={item.action.onClick}>{item.action.label}</button> : null}
          <button type="button" aria-label="Close" onClick={() => dismissToast(item.id)}>×</button>
        </div>
      ))}
    </div>,
    document.body,
  );
}
