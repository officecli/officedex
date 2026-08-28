import { useState } from "react";
import { Button, Input } from "../ui";

export interface StageIntentBarProps {
  readonly disabled?: boolean;
  readonly placeholder?: string;
  readonly onSubmit: (instruction: string) => void | Promise<void>;
  readonly onPause?: () => void | Promise<void>;
  readonly onResume?: () => void | Promise<void>;
  readonly onRetry?: () => void | Promise<void>;
  readonly onContinueFromNode?: () => void | Promise<void>;
}

export function StageIntentBar({ disabled = false, placeholder = "Describe the next change", onSubmit, onPause, onResume, onRetry, onContinueFromNode }: StageIntentBarProps) {
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
  return <div className="stage-intent-bar" aria-label="Stage command bar">
    <Input aria-label="Stage instruction" value={value} placeholder={placeholder} disabled={disabled || busy} onChange={(event) => setValue(event.target.value)} onPressEnter={() => void submit()} />
    <Button type="primary" size="small" loading={busy} disabled={disabled || !value.trim()} onClick={() => void submit()}>Apply</Button>
    {onPause ? <Button type="text" size="small" disabled={disabled || busy} onClick={() => void action(onPause)}>Pause</Button> : null}
    {onResume ? <Button type="text" size="small" disabled={disabled || busy} onClick={() => void action(onResume)}>Resume</Button> : null}
    {onRetry ? <Button type="text" size="small" disabled={disabled || busy} onClick={() => void action(onRetry)}>Retry</Button> : null}
    {onContinueFromNode ? <Button type="text" size="small" disabled={disabled || busy} onClick={() => void action(onContinueFromNode)}>Continue from node</Button> : null}
  </div>;
}
