import { useT } from "../../renderer/i18n";
import { DiagnosticsControl, RuntimeRunsControl } from "./AdvancedControls";
import "./settings.css";

/**
 * The support tools, as the diagnostics dialog shows them: the four things a
 * user can hand to support, and the table of workflow runs underneath.
 *
 * Both are the controls the previous settings page had, unchanged. They are
 * debugging surfaces for a person working with support, which the approved
 * design does not draw, so they keep their own rules rather than borrow the
 * workspace's.
 */
export function AdvancedDiagnostics() {
  const t = useT();
  return (
    <div className="shell-settings-block">
      <DiagnosticsControl />
      <h3 className="shell-settings-subhead">{t("tasks.runtime.title")}</h3>
      <RuntimeRunsControl />
    </div>
  );
}
