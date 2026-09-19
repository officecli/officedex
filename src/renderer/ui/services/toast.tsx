import { useT } from "../../i18n";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { createPortal } from "react-dom";
import { overlayHost } from "../overlayHost";

export type ToastTone = "success" | "warning" | "error" | "info" | "loading";

export interface ToastOptions {
  /** Updates a related notification in place and restarts its countdown. */
  readonly key?: string;
  readonly content: ReactNode;
  readonly description?: ReactNode;
  readonly tone?: ToastTone;
  readonly duration?: number | null;
  readonly action?: { label: ReactNode; onClick: () => void };
}

interface ToastRecord extends ToastOptions {
  readonly id: string;
  readonly createdAt: number;
  readonly revision: number;
  readonly exiting?: boolean;
}

const EXIT_DURATION = 220;
const timers = new Map<string, number>();

const viewports = new Set<HTMLDivElement>();
let sequence = 0;
let records: ToastRecord[] = [];
const listeners = new Set<(items: ToastRecord[]) => void>();

function emit() {
  const snapshot = [...records];
  listeners.forEach((listener) => listener(snapshot));
}

function publishToast(options: ToastOptions) {
  const existing = options.key ? records.find((item) => item.key === options.key) : undefined;
  const id = existing?.id ?? `toast-${++sequence}`;
  const duration = options.duration === null ? null : Math.max(0, options.duration ?? 3000);
  const record: ToastRecord = { tone: "info", ...options, duration, id, createdAt: Date.now(), revision: (existing?.revision ?? 0) + 1 };
  window.clearTimeout(timers.get(id));
  timers.delete(id);
  records = existing ? records.map((item) => item.id === id ? record : item) : [...records, record];
  emit();
  if (duration !== null) {
    timers.set(id, window.setTimeout(() => dismissToast(id), duration));
  }
  return id;
}

function dismissToast(id: string) {
  if (!records.some((item) => item.id === id && !item.exiting)) return;
  window.clearTimeout(timers.get(id));
  records = records.map((item) => item.id === id ? { ...item, exiting: true } : item);
  emit();
  // Keep the DOM alive until the exit and stack-collapse transitions finish.
  timers.set(id, window.setTimeout(() => {
    records = records.filter((item) => item.id !== id);
    timers.delete(id);
    emit();
  }, EXIT_DURATION));
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
    timers.forEach((timer) => window.clearTimeout(timer));
    timers.clear();
    records = [];
    emit();
  },
};

const toneIcons = { success: CheckCircle2, warning: TriangleAlert, error: CircleAlert, info: Info, loading: LoaderCircle };

function ToastCard({ item }: { item: ToastRecord }) {
  const t = useT();
  // Capture the offset once: another toast must not restart this countdown.
  const [elapsed] = useState(() => Math.max(0, Date.now() - item.createdAt));
  const Icon = toneIcons[item.tone ?? "info"];
  return (
    <div className="od-toast-slot" data-exiting={item.exiting ? "true" : undefined} inert={item.exiting} aria-hidden={item.exiting}>
      <div className="od-toast-clip">
        <div className="od-toast" data-tone={item.tone} role="status">
          <Icon className="od-toast__icon" size={18} aria-hidden="true" />
          <div className="od-toast__content">
            <strong>{item.content}</strong>
            {item.description ? <span>{item.description}</span> : null}
          </div>
          {item.action ? <button className="od-toast__action" type="button" onClick={item.action.onClick}>{item.action.label}</button> : null}
          <button className="od-toast__close" type="button" aria-label={t("ui.copy.Close")} onClick={() => dismissToast(item.id)}><X size={16} aria-hidden="true" /></button>
          {item.duration != null && item.duration > 0 ? (
            <span className="od-toast__progress" aria-hidden="true">
              <span style={{ animationDuration: `${item.duration}ms`, animationDelay: `-${elapsed}ms` }} />
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Reserves notification space on surfaces whose heading must remain visible. */
export function ToastViewport({ className }: { className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    viewports.add(element);
    emit();
    return () => { viewports.delete(element); emit(); };
  }, []);
  return <div ref={ref} className={className} />;
}

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

  const viewport = [...viewports].at(-1);
  return createPortal(
    <div className={`od-toast-host${viewport ? " od-toast-host--anchored" : ""}`} aria-live="polite">
      {items.map((item) => <ToastCard key={`${item.id}:${item.revision}`} item={item} />)}
    </div>,
    viewport ?? overlayHost(),
  );
}
