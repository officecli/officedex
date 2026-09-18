import { ChevronDown, PanelLeft, Sparkles } from "lucide-react";
import type { ReactNode } from "react";

import { useShell } from "../state/ShellContext";
import type { Mode } from "../state/shellReducer";
import { Menu } from "./Menu";

const MODES: Array<{ mode: Mode; label: string; description: string; icon: ReactNode }> = [
  {
    mode: "agent",
    label: "Agent",
    description: "Give a goal; edit alongside it",
    icon: <Sparkles size={16} strokeWidth={1.6} aria-hidden="true" />,
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
