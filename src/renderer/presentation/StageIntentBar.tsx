import { useT } from "../i18n";
import { useState } from "react";
import { ArrowUpOutlined } from "../ui/icons";
import { Button, Input } from "../ui";

export interface StageIntentBarProps {
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onSubmit: (instruction: string) => void | Promise<void>;
  readonly onPause?: () => void | Promise<void>;
  readonly onResume?: () => void | Promise<void>;
}

// Retry is deliberately not a control here. It is a terminal action owned by
// the failure panel, which knows what a retry would discard; parked next to a
// text input it read as "resend this instruction" and competed with the real
// one, so a stopped run showed two buttons named Retry and neither of them
// resumed anything.
export function StageIntentBar({ disabled = false, placeholder, onSubmit, onPause, onResume }: StageIntentBarProps) {
  const t = useT();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    const instruction = value.trim();
    if (!instruction || disabled || busy) return;
    setBusy(true);
    try { await onSubmit(instruction); setValue(""); } finally { setBusy(false); }
  };
  const action = async (callback?: () => void | Promise<void>) => {
    if (!callback || disabled || busy) return;
    setBusy(true);
    try { await callback(); } finally { setBusy(false); }
  };
  return <div className="stage-intent-bar" aria-label={t("ui.copy.Stagecommandbar")}>
    <Input aria-label={t("ui.copy.Stageinstruction")} value={value} placeholder={placeholder ?? t("ui.copy.Describethenextchange")} disabled={disabled || busy} onChange={(event) => setValue(event.target.value)} onPressEnter={() => void submit()} />
    <Button className="od-button--icon-submit" type="primary" size="small" ariaLabel={t("ui.copy.Apply")} title={t("ui.copy.Apply")} icon={<ArrowUpOutlined />} loading={busy} disabled={disabled || !value.trim()} onClick={() => void submit()} />
    {onPause ? <Button type="text" size="small" disabled={disabled || busy} onClick={() => void action(onPause)}>{t("ui.copy.Pause")}</Button> : null}
    {onResume ? <Button type="text" size="small" disabled={disabled || busy} onClick={() => void action(onResume)}>{t("ui.copy.Resume")}</Button> : null}
  </div>;
}
