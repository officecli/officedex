import { useState, type CSSProperties, type HTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "../../i18n";
import { overlayHost } from "../overlayHost";
import { useModalBehaviour } from "../useModalBehaviour";
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
  /** A click on the mask cancels. Default true. */
  readonly maskClosable?: boolean;
  /** Escape cancels. Default true. */
  readonly keyboard?: boolean;
}

function ModalRoot({ open, title, footer, okText, cancelText, onOk, onCancel, okButtonProps, cancelButtonProps, width, styles, children, className, maskClosable = true, keyboard = true, destroyOnHidden: _destroyOnHidden, centered: _centered, ...props }: ModalProps) {
  const [submitting, setSubmitting] = useState(false);
  const t = useT();
  // Escape, mask click, focus trap and focus return — see useModalBehaviour for
  // why `aria-modal` below is otherwise a claim with nothing behind it.
  const { panelRef, onMaskClick } = useModalBehaviour({
    open,
    onDismiss: submitting ? undefined : onCancel,
    keyboard,
  });
  if (!open) return null;
  const confirm = async () => {
    setSubmitting(true);
    try { await onOk?.(); } finally { setSubmitting(false); }
  };
  return createPortal(
    <div className="od-dialog-mask" role="presentation" onClick={maskClosable ? onMaskClick : undefined}>
      <section {...props} ref={panelRef} aria-modal="true" className={["od-dialog", className].filter(Boolean).join(" ")} role="dialog" style={{ width }} tabIndex={-1}>
        {title ? <header className="od-dialog__header"><h2>{title}</h2></header> : null}
        <div className="od-dialog__content" style={styles?.body}>{children}</div>
        {footer === null ? null : footer ?? (
          <footer className="od-dialog__footer">
            <Button {...cancelButtonProps} onClick={onCancel}>{cancelText ?? t("ui.text.Cancel")}</Button>
            <Button {...okButtonProps} type="primary" loading={submitting || okButtonProps?.loading} onClick={() => void confirm()}>{okText ?? t("ui.text.OK")}</Button>
          </footer>
        )}
      </section>
    </div>,
    overlayHost(),
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
