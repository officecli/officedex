import { useT } from "../../i18n";
import type { HTMLAttributes, ReactNode } from "react";

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  readonly type?: "success" | "info" | "warning" | "error";
  readonly title?: ReactNode;
  readonly message?: ReactNode;
  readonly description?: ReactNode;
  readonly showIcon?: boolean;
  readonly closable?: boolean;
  readonly onClose?: () => void;
  readonly action?: ReactNode;
}

export function Alert({ type = "info", title, message, description, showIcon, closable, onClose, action, className, ...props }: AlertProps) {
  const t = useT();
  return (
    <div {...props} className={["od-alert", className].filter(Boolean).join(" ")} data-tone={type} role="alert">
      {showIcon ? <span className="od-alert__icon" aria-hidden="true">!</span> : null}
      <div className="od-alert__copy">
        {title ?? message ? <strong>{title ?? message}</strong> : null}
        {description ? <span>{description}</span> : null}
      </div>
      {action ? <div className="od-alert__action">{action}</div> : null}
      {closable ? <button type="button" aria-label={t("ui.copy.Closealert")} onClick={onClose}>×</button> : null}
    </div>
  );
}
