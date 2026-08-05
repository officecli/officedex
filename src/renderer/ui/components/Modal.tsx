import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { dialog, type DialogRequest } from "../services/dialog";
import { Button, type ButtonProps } from "./Button";

export interface ModalProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly open: boolean;
  readonly title?: ReactNode;
  readonly footer?: ReactNode;
  readonly okText?: string;
  readonly cancelText?: string;
  readonly onOk?: () => unknown | Promise<unknown>;
  readonly onCancel?: () => void;
  readonly okButtonProps?: ButtonProps;
  readonly cancelButtonProps?: ButtonProps;
  readonly destroyOnHidden?: boolean;
  readonly centered?: boolean;
  readonly width?: number | string;
  readonly styles?: { body?: CSSProperties };
}

function ModalRoot({ open, title, footer, okText = "OK", cancelText = "Cancel", onOk, onCancel, okButtonProps, cancelButtonProps, width, styles, children, className, destroyOnHidden: _destroyOnHidden, centered: _centered, ...props }: ModalProps) {
  const [submitting, setSubmitting] = useState(false);
  if (!open) return null;
  const confirm = async () => {
    setSubmitting(true);
    try { await onOk?.(); } finally { setSubmitting(false); }
  };
  return createPortal(
    <div className="ui-dialog-mask" role="presentation">
      <section {...props} aria-modal="true" className={["ui-dialog", className].filter(Boolean).join(" ")} role="dialog" style={{ width }}>
        {title ? <header className="ui-dialog__header"><h2>{title}</h2></header> : null}
        <div className="ui-dialog__content" style={styles?.body}>{children}</div>
        {footer === null ? null : footer ?? (
          <footer className="ui-dialog__footer">
            <Button {...cancelButtonProps} onClick={onCancel}>{cancelText}</Button>
            <Button {...okButtonProps} type="primary" loading={submitting || okButtonProps?.loading} onClick={() => void confirm()}>{okText}</Button>
          </footer>
        )}
      </section>
    </div>,
    document.body,
  );
}

function imperative(request: DialogRequest & { okButtonProps?: ButtonProps }) {
  dialog.confirm({ ...request, tone: request.tone ?? (request.okButtonProps?.danger ? "danger" : "default") });
}

export const Modal = Object.assign(ModalRoot, {
  confirm: imperative,
  info: (request: DialogRequest) => dialog.info(request),
  destroyAll: () => dialog.destroy(),
});
