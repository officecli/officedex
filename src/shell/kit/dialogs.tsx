/**
 * The two dialogs most actions need: "give this a name" and "are you sure".
 *
 * Both follow OD-UI-1.2 §08: the primary button is a specific verb rather than
 * "OK", Escape and Cancel are the same thing, a failed submit keeps what was
 * typed and says why next to the field, and a submit in flight cannot be
 * started twice.
 */
import { useState, type FormEvent, type ReactNode } from "react";

import { useT } from "../../renderer/i18n";
import { closeModal, openModal } from "./layers";

interface NameDialogOptions {
  title: string;
  label: string;
  initial?: string;
  /** The primary button: "Create", "Rename", "Save". */
  action: string;
  helper?: ReactNode;
  /**
   * Resolve to finish; throw (or return a string) to keep the dialog open with
   * that message under the field.
   */
  onSubmit: (name: string) => Promise<string | void> | string | void;
}

function NameForm({ label, initial = "", action, helper, onSubmit }: Omit<NameDialogOptions, "title">) {
  const t = useT();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const name = value.trim();
    if (!name) {
      setError(t("dx.form.nameRequired"));
      return;
    }
    setBusy(true);
    try {
      const refusal = await onSubmit(name);
      if (typeof refusal === "string" && refusal) {
        setError(refusal);
        return;
      }
      closeModal();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => void submit(event)}>
      <label className="dx-form-field">
        <span>{label}</span>
        <input
          name="name"
          type="text"
          value={value}
          required
          autoFocus
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            setValue(event.target.value);
            setError("");
          }}
        />
      </label>
      {helper ? <p className="dx-helper">{helper}</p> : null}
      <div className="dx-form-actions">
        <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
        <button type="submit" className="dx-btn dx-primary" disabled={busy}>
          {action}
        </button>
      </div>
      <p className="dx-error" role="alert">
        {error}
      </p>
    </form>
  );
}

export function openNameDialog({ title, ...form }: NameDialogOptions) {
  openModal({ title, render: () => <NameForm {...form} /> });
}

interface ConfirmDialogOptions {
  title: string;
  /** What will happen, to what, and what is kept. */
  body: ReactNode;
  action: string;
  onConfirm: () => Promise<void> | void;
}

function ConfirmBody({ body, action, onConfirm }: Omit<ConfirmDialogOptions, "title">) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
      closeModal();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {body}
      <div className="dx-form-actions">
        <button type="button" className="dx-btn" data-act="modal-close" onClick={closeModal}>
          {t("dx.action.cancel")}
        </button>
        <button type="button" className="dx-btn dx-primary" disabled={busy} onClick={() => void confirm()}>
          {action}
        </button>
      </div>
      {error ? (
        <p className="dx-error" role="alert">
          {error}
        </p>
      ) : null}
    </>
  );
}

export function openConfirmDialog({ title, ...rest }: ConfirmDialogOptions) {
  openModal({ title, render: () => <ConfirmBody {...rest} /> });
}
