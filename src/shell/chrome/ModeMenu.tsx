import { ChevronDown, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";

import { useT } from "../../renderer/i18n";
import { PresenceFace } from "../agent/PresenceFace";
import { useShell } from "../state/ShellContext";
import type { Mode } from "../state/shellReducer";
import { Menu } from "./Menu";

const MODES: Array<{ mode: Mode; labelKey: string; descriptionKey: string; icon: ReactNode }> = [
  {
    mode: "agent",
    labelKey: "shell.mode.agent",
    descriptionKey: "shell.mode.agentDescription",
    // Agent mode is the companion, so the mark *is* the companion — the same
    // character the presence draws, at icon size and holding still.
    icon: <PresenceFace status="idle" size={16} animated={false} />,
  },
  {
    mode: "editor",
    labelKey: "shell.mode.editor",
    descriptionKey: "shell.mode.editorDescription",
    icon: <PanelLeft size={16} strokeWidth={1.6} aria-hidden="true" />,
  },
];

/**
 * The mode switch lives under the brand, not in the top bar.
 *
 * That is the prototype's central IA call — mode is a property of the shell you
 * occasionally change, not a navigation destination competing for the most
 * valuable strip of the window. Putting it here is what frees the entire top
 * row for the file tabs.
 *
 * A segmented Agent/Editor control was added to the window bar once, and had to
 * be hidden on the compact rail — the state the shell opens in — because it
 * covered the first tab. This is the control; there is no second one.
 */
export function ModeMenu() {
  const t = useT();
  const { state, dispatch } = useShell();
  const current = MODES.find((entry) => entry.mode === state.mode) ?? MODES[0];
  const currentLabel = t(current.labelKey);

  return (
    <Menu
      label={t("shell.mode.menuLabel")}
      width={220}
      items={MODES.map((entry) => ({
        id: entry.mode,
        label: t(entry.labelKey),
        description: t(entry.descriptionKey),
        icon: entry.icon,
        checked: entry.mode === state.mode,
        onSelect: () => dispatch({ type: "set-mode", mode: entry.mode }),
      }))}
    >
      {(triggerProps) => (
        <button
          {...triggerProps}
          type="button"
          className="shell-brand"
          title={t("shell.mode.title", { mode: currentLabel })}
          aria-label={t("shell.mode.switchAria", { mode: currentLabel })}
        >
          <span className="shell-brand-mark" aria-hidden="true">
            {current.icon}
          </span>
          <span className="shell-brand-name">{t("settings.about.productName")}</span>
          <ChevronDown className="shell-brand-chevron" size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </Menu>
  );
}
