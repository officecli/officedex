import { ChevronDown, PanelLeft } from "lucide-react";
import type { ReactNode } from "react";

import { PresenceFace } from "../agent/PresenceFace";
import { useShell } from "../state/ShellContext";
import type { Mode } from "../state/shellReducer";
import { Menu } from "./Menu";

const MODES: Array<{ mode: Mode; label: string; description: string; icon: ReactNode }> = [
  {
    mode: "agent",
    label: "Agent",
    description: "Give a goal; edit alongside it",
    // Agent mode is the companion, so the mark *is* the companion — the same
    // character the presence draws, at icon size and holding still.
    icon: <PresenceFace status="idle" size={16} animated={false} />,
  },
  {
    mode: "editor",
    label: "Editor",
    description: "The document, full width",
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
  const { state, dispatch } = useShell();
  const current = MODES.find((entry) => entry.mode === state.mode) ?? MODES[0];

  return (
    <Menu
      label="Workspace mode"
      width={220}
      items={MODES.map((entry) => ({
        id: entry.mode,
        label: entry.label,
        description: entry.description,
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
          title={`Mode: ${current.label}`}
          aria-label={`Switch mode. Current mode: ${current.label}`}
        >
          <span className="shell-brand-mark" aria-hidden="true">
            {current.icon}
          </span>
          <span className="shell-brand-name">OfficeDex</span>
          <ChevronDown className="shell-brand-chevron" size={12} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
    </Menu>
  );
}
