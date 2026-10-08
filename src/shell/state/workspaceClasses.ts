import { workspaceClosed, type ShellState } from "./shellReducer";

/**
 * The state classes `#dx-workspace` carries — OD-UI-1.2 §03.
 *
 * The design's stylesheets lay the three columns out from these: which are on
 * screen, which side the conversation is on, whether it floats. They are
 * derived here, in one function, because the stylesheets and the gate that
 * checks them (`test/combinationSelectors.test.ts`) both need to know exactly
 * which combinations can occur, and a list kept in two places is two lists.
 */
export const WORKSPACE_STATE_CLASSES = [
  "dx-compact",
  "dx-with-chat",
  "dx-chat-right",
  "dx-workspace-closed",
  "dx-sidebar-peek",
  "dx-has-workspace-toggle",
  "dx-chat-floating",
  "dx-at-home",
  "dx-at-settings",
  "dx-at-local",
] as const;

export type WorkspaceStateClass = (typeof WORKSPACE_STATE_CLASSES)[number];

/** What the classes depend on that is not shell state. */
export interface WorkspaceFacts {
  /** The hidden sidebar is being shown because the pointer is at the window's edge. */
  peek: boolean;
  /**
   * There is work beside the conversation — a message sent, a run, a file
   * opened — so the switch for the content region has appeared (§03).
   */
  hasWorkspaceToggle: boolean;
}

export function workspaceClasses(state: ShellState, facts: WorkspaceFacts): WorkspaceStateClass[] {
  const chat = state.chat !== null;
  const on: Record<WorkspaceStateClass, boolean> = {
    "dx-compact": state.navCollapsed,
    "dx-with-chat": chat,
    // Which side is a preference, kept while no conversation is open.
    "dx-chat-right": state.chatPosition === "right",
    "dx-workspace-closed": workspaceClosed(state),
    "dx-sidebar-peek": state.navCollapsed && facts.peek,
    "dx-has-workspace-toggle": chat && facts.hasWorkspaceToggle,
    "dx-chat-floating": chat && state.chatFloating,
    "dx-at-home": state.page === "home",
    "dx-at-settings": state.page === "settings",
    "dx-at-local": state.page === "local",
  };
  return WORKSPACE_STATE_CLASSES.filter((name) => on[name]);
}
