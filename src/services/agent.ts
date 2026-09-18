import type { DesktopAPI } from "../shared/types";
import type { AgentEvent, AgentPort, AgentTask } from "../shared/uiPort";

/**
 * The agent surface. **A skeleton: S4 builds this.**
 *
 * It is here rather than absent so `createDesktopUiPort` returns a complete
 * `UiPort` and the rest of the shell can run against the real service today.
 * Every method refuses in a way that names the reason, because a silent no-op
 * in a half-built layer is the thing that wastes an afternoon.
 *
 * What S4 has to reconcile, recorded now while it is fresh:
 *
 *   - `current(folderId)` is scoped to a folder. The desktop's tasks are scoped
 *     to a conversation. One folder can hold several conversations, so this has
 *     to aggregate rather than look up.
 *   - `send` maps to generate/modify, but `SendInput` also carries `mentions`,
 *     `modelId` and `permission`, none of which the generate path accepts yet.
 *   - `pause`/`resume` take no task id and exist for every type; the desktop has
 *     `pausePptx(taskId)` and nothing for the others.
 *   - `finish` ends a task but keeps applied changes. The desktop's `cancel`
 *     means "stop and discard", which is a different promise.
 *   - `AgentSuggestion` with apply/undo **has no desktop model at all**. The
 *     docx path applies edits straight through the editor. This is the one
 *     genuinely new product concept in the port, not a migration — see
 *     docs/uiport-scope.md.
 */

const NOT_YET = "The agent service is not wired up yet (S4).";

export function createAgentService(_api: DesktopAPI): AgentPort {
  return {
    async current(_folderId): Promise<AgentTask | null> {
      // Null is the contract's "no task started here", which is honest for a
      // surface that cannot start one yet — and lets the shell render.
      return null;
    },

    async send(_input) {
      throw new Error(NOT_YET);
    },

    subscribe(_listener: (event: AgentEvent) => void) {
      // A subscription that never fires is correct for a surface with no tasks;
      // returning a working unsubscribe keeps the caller's cleanup honest.
      return () => {};
    },

    async pause() {
      throw new Error(NOT_YET);
    },

    async resume() {
      throw new Error(NOT_YET);
    },

    async finish() {
      throw new Error(NOT_YET);
    },

    async applySuggestion(_id) {
      throw new Error(NOT_YET);
    },

    async undoSuggestion(_id) {
      throw new Error(NOT_YET);
    },
  };
}
