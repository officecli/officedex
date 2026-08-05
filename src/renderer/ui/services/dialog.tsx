import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "../components/Button";

export interface DialogRequest {
  readonly title: ReactNode;
  readonly content?: ReactNode;
  readonly okText?: string;
  readonly cancelText?: string;
  readonly tone?: "default" | "danger";
  readonly kind?: "confirm" | "info";
  readonly onOk?: () => void | Promise<void>;
  readonly onCancel?: () => void;
}

let request: DialogRequest | null = null;
const listeners = new Set<(next: DialogRequest | null) => void>();

function emit(next: DialogRequest | null) {
  request = next;
  listeners.forEach((listener) => listener(next));
}

export const dialog = {
  confirm: (next: DialogRequest) => emit({ ...next, kind: "confirm" }),
  info: (next: DialogRequest) => emit({ ...next, kind: "info" }),
  destroy: () => emit(null),
};

export function DialogHost() {
  const [active, setActive] = useState<DialogRequest | null>(() => request);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listeners.add(setActive);
    setActive(request);
    return () => {
      listeners.delete(setActive);
    };
  }, []);

  useEffect(() => {
    if (!active) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || submitting) return;
      active.onCancel?.();
      emit(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [active, submitting]);

  if (!active) return null;

  const cancel = () => {
    active.onCancel?.();
    emit(null);
  };
  const confirm = async () => {
    setSubmitting(true);
    try {
      await active.onOk?.();
      emit(null);
    } finally {
      setSubmitting(false);
    }
  };

  return createPortal(
    <div className="ui-dialog-mask" role="presentation">
      <section aria-modal="true" className="ui-dialog" role="dialog">
        <header className="ui-dialog__header"><h2>{active.title}</h2></header>
        {active.content ? <div className="ui-dialog__content">{active.content}</div> : null}
        <footer className="ui-dialog__footer">
          {active.kind !== "info" ? <Button onClick={cancel}>{active.cancelText ?? "Cancel"}</Button> : null}
          <Button variant={active.tone === "danger" ? "danger" : "primary"} loading={submitting} onClick={() => void confirm()}>
            {active.okText ?? "OK"}
          </Button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
