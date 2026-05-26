import { StatusDot } from "./Shell";
import { useT } from "../i18n";
import type { DesktopTask } from "../../shared/types";

interface Props {
  task: DesktopTask;
}

/**
 * TaskRuntimePanel renders the provider snapshot that was captured at task
 * start time. Per-task, frozen — distinct from the live RuntimeChip in the
 * topbar. Renders nothing when the task has no snapshot (legacy tasks
 * persisted before this field was introduced).
 */
export function TaskRuntimePanel({ task }: Props) {
  const t = useT();
  const snap = task.runtimeSnapshot;
  if (!snap) return null;
  const isCustom = snap.mode === "custom";
  const provider = snap.provider;

  return (
    <div className="effective-card" data-testid="task-runtime-panel">
      <div className="effective-row">
        <span className="effective-label">{t("dialogue.runtime.title")}</span>
        <span className="effective-value">
          <StatusDot tone={isCustom ? "green" : "gray"} />
          {isCustom ? "Custom" : "Hosted"}
        </span>
      </div>
      {isCustom && provider ? (
        <>
          <div className="effective-row">
            <span className="effective-label">{t("settings.effective.provider")}</span>
            <span className="effective-value">{provider.type}</span>
          </div>
          <div className="effective-row">
            <span className="effective-label">{t("settings.effective.baseUrl")}</span>
            <span className="effective-value">{provider.baseUrlHost || "—"}</span>
          </div>
          <div className="effective-row">
            <span className="effective-label">{t("settings.effective.model")}</span>
            <span className="effective-value">{provider.model || "—"}</span>
          </div>
          <div className="effective-row">
            <span className="effective-label">{t("settings.effective.apiKey")}</span>
            <span className="effective-value">
              {provider.apiKeyMasked
                ? t("settings.effective.apiKeyValue")
                    .replace("{masked}", provider.apiKeyMasked)
                    .replace("{length}", String(provider.apiKeyLength))
                : "—"}
            </span>
          </div>
          {snap.appliedAt ? (
            <div className="effective-row">
              <span className="effective-label">{t("settings.effective.appliedAt")}</span>
              <span className="effective-value">{snap.appliedAt}</span>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
